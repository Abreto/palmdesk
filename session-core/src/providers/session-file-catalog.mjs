import { stat } from "node:fs/promises";

const DEFAULT_CONCURRENCY = 8;

export function createSessionFileCatalog({
  discoverFiles,
  loadFile,
  loadContext = async () => undefined,
  dependencyKey = () => "",
  onFileError = async () => null,
  finalize = (sessions) => sessions,
  concurrency = DEFAULT_CONCURRENCY,
  statFile = stat
}) {
  let cacheByPath = new Map();
  let sessions = [];
  let sessionsById = new Map();
  let pathsById = new Map();
  let context;
  let initialized = false;
  let refreshPromise = null;

  async function listSessions() {
    if (refreshPromise) {
      return refreshPromise;
    }

    const currentRefresh = refreshCatalog();
    refreshPromise = currentRefresh;
    try {
      return await currentRefresh;
    } finally {
      if (refreshPromise === currentRefresh) {
        refreshPromise = null;
      }
    }
  }

  async function refreshCatalog() {
    const nextContext = await loadContext();
    const discoveredPaths = await discoverFiles(nextContext);
    const filePaths = [...new Set(discoveredPaths)];
    const nextCacheByPath = new Map();

    const loadedSessions = await mapWithConcurrency(
      filePaths,
      concurrency,
      async (filePath) => {
        let fileStat;
        try {
          fileStat = await statFile(filePath);
        } catch (error) {
          return onFileError(error, filePath, { context: nextContext });
        }

        const fingerprint = fileFingerprint(fileStat);
        const fileDependencyKey = String(dependencyKey(filePath, nextContext) ?? "");
        const cached = cacheByPath.get(filePath);
        if (
          cached?.fingerprint === fingerprint &&
          cached.dependencyKey === fileDependencyKey
        ) {
          nextCacheByPath.set(filePath, cached);
          return cached.session;
        }

        try {
          const session = await loadFile(filePath, {
            context: nextContext,
            fileStat
          });
          nextCacheByPath.set(filePath, {
            fingerprint,
            dependencyKey: fileDependencyKey,
            session
          });
          return session;
        } catch (error) {
          return onFileError(error, filePath, {
            context: nextContext,
            fileStat
          });
        }
      }
    );

    const nextSessions = (await finalize(loadedSessions.filter(Boolean), nextContext)).filter(
      Boolean
    );
    const nextSessionsById = new Map();
    const nextPathsById = new Map();

    for (const session of nextSessions) {
      nextSessionsById.set(session.id, session);
      const filePath = session.sources?.find((source) => source.kind === "session-file")?.path;
      if (filePath) {
        nextPathsById.set(session.id, filePath);
      }
    }

    cacheByPath = nextCacheByPath;
    sessions = nextSessions;
    sessionsById = nextSessionsById;
    pathsById = nextPathsById;
    context = nextContext;
    initialized = true;
    return sessions;
  }

  async function resolve(sessionId) {
    if (refreshPromise) {
      await refreshPromise;
    } else if (!initialized || !sessionsById.has(sessionId) || !pathsById.has(sessionId)) {
      await listSessions();
    }

    const session = sessionsById.get(sessionId);
    return session
      ? {
          session,
          filePath: pathsById.get(sessionId) ?? null,
          context
        }
      : null;
  }

  return {
    listSessions,
    resolve
  };
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerLimit = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : DEFAULT_CONCURRENCY;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(workerLimit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function fileFingerprint(fileStat) {
  return [
    fileStat.dev,
    fileStat.ino,
    fileStat.size,
    fileStat.mtimeMs,
    fileStat.ctimeMs
  ].join(":");
}
