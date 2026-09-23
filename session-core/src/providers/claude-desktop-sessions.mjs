// Claude Desktop's local Code index points to Claude Code JSONL transcripts.
// Keep discovery separate from parsing: index files can contain private app state.
import { lstat, open, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createSessionFileCatalog,
  mapWithConcurrency,
} from './session-file-catalog.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const ACCOUNT_DIRECTORY = /^[0-9a-f-]{8,36}$/i;
const MAX_INDEX_BYTES = 10 * 1024 * 1024;

export function resolveClaudeDesktopDataDirs(
  env = process.env,
  platform = process.platform
) {
  if (env.CLAUDE_USER_DATA_DIR) return [env.CLAUDE_USER_DATA_DIR];
  if (platform === 'win32') {
    const roaming =
      env.APPDATA || path.win32.join(os.homedir(), 'AppData', 'Roaming');
    const local =
      env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local');
    // MSIX virtualizes Claude's app data; PalmDesk runs outside that package.
    const cache = path.win32.join(
      local,
      'Packages',
      'Claude_pzs8sxrjxfjjc',
      'LocalCache'
    );
    return [
      path.win32.join(roaming, 'Claude'),
      path.win32.join(local, 'Claude-3p'),
      path.win32.join(roaming, 'Claude-3p'), // Legacy third-party profile.
      path.win32.join(cache, 'Roaming', 'Claude'),
      path.win32.join(cache, 'Local', 'Claude-3p'),
      path.win32.join(cache, 'Roaming', 'Claude-3p'),
    ];
  }
  return platform === 'darwin'
    ? ['Claude', 'Claude-3p'].map((name) =>
        path.join(os.homedir(), 'Library', 'Application Support', name)
      )
    : [];
}

export function createClaudeDesktopSessionDiscovery({
  claudeDesktopDataDirs = resolveClaudeDesktopDataDirs(),
} = {}) {
  const index = createSessionFileCatalog({
    discoverFiles: async () =>
      (await Promise.all(claudeDesktopDataDirs.map(findIndexFiles))).flat(),
    statFile: lstat,
    loadFile: readIndexEntry,
  });

  return async () => {
    const entries = await index.listSessions();
    const byUuid = new Map();
    const byPath = new Map();
    const groups = await mapWithConcurrency(entries, 8, async (entry) => ({
      entry,
      files: await findSessionTranscripts(entry),
    }));
    for (const { entry, files } of groups) {
      const previous = byUuid.get(entry.sessionUuid);
      if (!previous || entry.lastUpdatedAt > previous.lastUpdatedAt) {
        byUuid.set(entry.sessionUuid, entry);
      }
      for (const file of files) byPath.set(file, entry.sessionUuid);
    }
    return { byUuid, byPath };
  };
}

async function findIndexFiles(dataDir) {
  if (!dataDir) return [];
  const root = await childDirectory(dataDir, 'claude-code-sessions');
  if (!root) return [];
  const accounts = (await directoryEntries(root)).filter(
    (entry) => entry.isDirectory() && ACCOUNT_DIRECTORY.test(entry.name)
  );
  const groups = await mapWithConcurrency(accounts, 8, async (account) => {
    const accountDir = path.join(root, account.name);
    const organizations = (await directoryEntries(accountDir)).filter((entry) =>
      entry.isDirectory()
    );
    const files = await mapWithConcurrency(
      organizations,
      8,
      async (organization) => {
        const directory = path.join(accountDir, organization.name);
        return (await directoryEntries(directory))
          .filter((entry) => entry.isFile() && indexSessionUuid(entry.name))
          .map((entry) => path.join(directory, entry.name));
      }
    );
    return files.flat();
  });
  return groups.flat().sort();
}

async function readIndexEntry(filePath, { fileStat }) {
  if (!fileStat.isFile() || fileStat.size > MAX_INDEX_BYTES) return null;
  const file = await open(filePath, 'r');
  let record;
  try {
    // Read at most the observed size plus one byte, including concurrent growth.
    const size = (await file.stat()).size;
    if (size > MAX_INDEX_BYTES) return null;
    const buffer = Buffer.alloc(size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        length,
        buffer.length - length,
        length
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > size) return null;
    record = JSON.parse(buffer.toString('utf8', 0, length));
  } finally {
    await file.close();
  }

  const desktopUuid = indexSessionUuid(path.basename(filePath));
  if (
    !record ||
    record.sessionId !== `local_${desktopUuid}` ||
    typeof record.cliSessionId !== 'string' ||
    !UUID.test(record.cliSessionId) ||
    // SSH/WSL mirrors aren't local Code sessions. Never follow paths from metadata.
    record.sshConfig ||
    record.wslConfig
  )
    return null;

  const lastUpdatedAt = timestamp(record.lastActivityAt);
  if (!lastUpdatedAt || !timestamp(record.createdAt)) return null;
  return {
    id: record.sessionId,
    sessionUuid: record.cliSessionId,
    title: text(record.title, 160),
    projectPath: text(record.cwd, 512),
    lastUpdatedAt,
    directory: path.dirname(filePath),
  };
}

async function findSessionTranscripts(entry) {
  // Desktop also uses an eight-character directory name for local_<uuid>.
  const storage =
    (await childDirectory(entry.directory, entry.id)) ??
    (await childDirectory(entry.directory, entry.id.slice(6, 14)));
  if (!storage) return [];
  const config = await childDirectory(storage, '.claude');
  const projects = config && (await childDirectory(config, 'projects'));
  if (!projects) return [];
  const groups = await mapWithConcurrency(
    (await directoryEntries(projects)).filter((entry) => entry.isDirectory()),
    8,
    async (project) => {
      const file = path.join(
        projects,
        project.name,
        `${entry.sessionUuid}.jsonl`
      );
      try {
        return (await lstat(file)).isFile() ? [file] : [];
      } catch {
        return [];
      }
    }
  );
  return groups.flat();
}

async function childDirectory(parent, name) {
  const directory = path.join(parent, name);
  try {
    return (await lstat(directory)).isDirectory() ? directory : null;
  } catch {
    return null;
  }
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function indexSessionUuid(name) {
  if (!name.startsWith('local_') || !name.endsWith('.json')) return null;
  const uuid = name.slice(6, -5);
  return UUID.test(uuid) ? uuid : null;
}

function timestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function text(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}
