import { pageTimelineItems } from "../core/session-registry.mjs";
import {
  claudeResumeRef,
  createClaudeSessionFileCatalog,
  getClaudeSessionFileSession,
  getClaudeSessionFileTimelinePage,
  getRawClaudeSessionFile,
  isClaudeSessionFileSessionId,
  resolveClaudeConfigDir
} from "./claude-session-file.mjs";
import { commandTokens, listAgentProcesses, processSession } from "./process-utils.mjs";

const CLAUDE_PROCESS_MATCHERS = [matchesClaudeCodeAgentProcess];

export function matchesClaudeCodeAgentProcess(processInfo) {
  const command = processInfo.command ?? "";
  const lower = command.toLowerCase();

  if (!/(^|\s|\/)(claude|claude-code)(\s|$)/i.test(command)) {
    return false;
  }

  return !lower.includes(" daemon run ");
}

export function extractClaudeResumeReference(command) {
  const tokens = commandTokens(command);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "-r" || token === "--resume" || token === "--session-id") {
      return validResumeValue(tokens[index + 1]);
    }

    if (token.startsWith("--resume=") || token.startsWith("--session-id=")) {
      return validResumeValue(token.slice(token.indexOf("=") + 1));
    }
  }

  return null;
}

export function createClaudeCodeProvider(options = {}) {
  const claudeConfigDir = options.claudeConfigDir ?? resolveClaudeConfigDir();
  const sessionFiles =
    options.sessionFileCatalog ??
    createClaudeSessionFileCatalog({ claudeConfigDir, summaryOnly: true });
  const listProcesses =
    options.listAgentProcesses ??
    (() =>
      options.processSnapshot
        ? options.processSnapshot.listAgentProcesses(CLAUDE_PROCESS_MATCHERS)
        : listAgentProcesses(CLAUDE_PROCESS_MATCHERS));

  return {
    id: "claude-code",
    displayName: "Claude Code",

    async listSessions() {
      const [sessionFileSessions, processes] = await Promise.all([
        sessionFiles.listSessions(),
        listProcesses()
      ]);
      const sessionFileById = new Map(sessionFileSessions.map((session) => [session.id, session]));
      const processSessions = [];

      for (const processInfo of processes) {
        const session = claudeProcessSession(processInfo);
        const linkedSession = session.resumeRef?.value
          ? sessionFileById.get(`claude-code:session-file:${session.resumeRef.value}`)
          : null;

        if (linkedSession) {
          sessionFileById.set(linkedSession.id, mergeProcessSource(linkedSession, session));
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
      if (isClaudeSessionFileSessionId(id)) {
        const location = await sessionFiles.resolve(id);
        if (!location) {
          return null;
        }
        let session = await getClaudeSessionFileSession(id, {
          claudeConfigDir,
          sessionFilePath: location.filePath
        });
        if (!session) {
          return null;
        }

        const processes = await listProcesses();
        for (const processInfo of processes) {
          const processFileSession = claudeProcessSession(processInfo);
          if (`claude-code:session-file:${processFileSession.resumeRef?.value}` === id) {
            session = mergeProcessSource(session, processFileSession);
          }
        }
        return session;
      }

      const sessions = await this.listSessions();
      return sessions.find((session) => session.id === id) ?? null;
    },

    async getSessionTimelinePage(id, options = {}) {
      if (isClaudeSessionFileSessionId(id)) {
        const location = await sessionFiles.resolve(id);
        if (!location) {
          return null;
        }
        return getClaudeSessionFileTimelinePage(id, {
          ...options,
          claudeConfigDir,
          sessionFilePath: location.filePath
        });
      }

      const session = await this.getSession(id);
      return session ? pageTimelineItems(session.timeline, options) : null;
    },

    async getRawSession(id) {
      const location = isClaudeSessionFileSessionId(id) ? await sessionFiles.resolve(id) : null;
      const sessionFileRaw = await getRawClaudeSessionFile(id, {
        claudeConfigDir,
        ...(isClaudeSessionFileSessionId(id)
          ? { sessionFilePath: location?.filePath ?? null }
          : {})
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

function claudeProcessSession(processInfo) {
  const resumeValue = extractClaudeResumeReference(processInfo.command ?? "");
  return processSession({
    providerId: "claude-code",
    providerName: "Claude Code",
    processInfo,
    title: "Claude Code process",
    resumeRef: resumeValue ? claudeResumeRef(resumeValue, [], "high") : undefined
  });
}

function mergeProcessSource(sessionFileSession, processFileSession) {
  return {
    ...sessionFileSession,
    status: "running",
    sources: [...sessionFileSession.sources, ...processFileSession.sources],
    recentMessage: sessionFileSession.recentMessage ?? processFileSession.recentMessage
  };
}

function validResumeValue(value) {
  return value && !value.startsWith("-") ? value : null;
}
