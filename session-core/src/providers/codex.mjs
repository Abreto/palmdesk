import { pageTimelineItems } from "../core/session-registry.mjs";
import { listAgentProcesses, processSession } from "./process-utils.mjs";
import {
  codexResumeRef,
  createCodexSessionFileCatalog,
  extractCodexSessionReference,
  getCodexSessionFileSession,
  getCodexSessionFileTimelinePage,
  getRawCodexSessionFile,
  isCodexSessionFileSessionId,
  resolveCodexHome
} from "./codex-session-file.mjs";

const CODEX_PROCESS_MATCHERS = [matchesCodexAgentProcess];

export function matchesCodexAgentProcess(processInfo) {
  const command = processInfo.command ?? "";
  const lower = command.toLowerCase();

  if (!/(^|\s|\/)(codex|codex-cli)(\s|$)/i.test(command)) {
    return false;
  }

  return ![
    "app-server",
    "codex.app",
    "crashpad",
    "(renderer)",
    "(service)",
    "codex computer use",
    "skycomputeruseclient",
    "skycomputeruseservice",
    "openai.chatgpt"
  ].some((fragment) => lower.includes(fragment));
}

export function createCodexProvider(options = {}) {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const sessionFiles =
    options.sessionFileCatalog ??
    createCodexSessionFileCatalog({ codexHome, summaryOnly: true });
  const listProcesses =
    options.listAgentProcesses ??
    (() =>
      options.processSnapshot
        ? options.processSnapshot.listAgentProcesses(CODEX_PROCESS_MATCHERS)
        : listAgentProcesses(CODEX_PROCESS_MATCHERS));

  return {
    id: "codex",
    displayName: "Codex",

    async listSessions() {
      const [sessionFileSessions, processes] = await Promise.all([
        sessionFiles.listSessions(),
        listProcesses()
      ]);
      const sessionFileById = new Map(sessionFileSessions.map((session) => [session.id, session]));
      const processSessions = [];

      for (const processInfo of processes) {
        const sessionRef = extractCodexSessionReference(processInfo.command ?? "");
        const session = processSession({
          providerId: "codex",
          providerName: "Codex",
          processInfo,
          title: "Codex process",
          resumeRef: sessionRef ? codexResumeRef(sessionRef, [], "high") : undefined
        });
        const linkedSession = sessionRef
          ? sessionFileById.get(`codex:session-file:${sessionRef}`)
          : null;

        if (linkedSession) {
          sessionFileById.set(linkedSession.id, {
            ...linkedSession,
            status: "running",
            sources: [...linkedSession.sources, ...session.sources],
            recentMessage: linkedSession.recentMessage ?? session.recentMessage
          });
        } else {
          processSessions.push(session);
        }
      }

      return [
        ...sessionFileSessions.map((session) => sessionFileById.get(session.id)),
        ...processSessions
      ];
    },

    async getSession(id) {
      if (isCodexSessionFileSessionId(id)) {
        const location = await sessionFiles.resolve(id);
        if (!location) {
          return null;
        }
        return getCodexSessionFileSession(id, {
          codexHome,
          sessionFilePath: location.filePath,
          indexEntry: location.context?.indexById.get(location.session.resumeRef?.value)
        });
      }

      const sessions = await this.listSessions();
      return sessions.find((session) => session.id === id) ?? null;
    },

    async getSessionTimelinePage(id, options = {}) {
      if (isCodexSessionFileSessionId(id)) {
        const location = await sessionFiles.resolve(id);
        if (!location) {
          return null;
        }
        return getCodexSessionFileTimelinePage(id, {
          ...options,
          codexHome,
          sessionFilePath: location.filePath,
          indexEntry: location.context?.indexById.get(location.session.resumeRef?.value)
        });
      }

      const session = await this.getSession(id);
      return session ? pageTimelineItems(session.timeline, options) : null;
    },

    async getRawSession(id) {
      const sessionFileId = isCodexSessionFileSessionId(id);
      const location = sessionFileId ? await sessionFiles.resolve(id) : null;
      const sessionFileRaw = await getRawCodexSessionFile(id, {
        codexHome,
        ...(sessionFileId ? { sessionFilePath: location?.filePath ?? null } : {})
      });
      if (sessionFileRaw) {
        return sessionFileRaw;
      }

      const session = await this.getSession(id);
      return session
        ? {
            text: JSON.stringify(session, null, 2),
            source: "process",
            confidence: "high"
          }
        : null;
    }
  };
}
