// Modified for PalmDesk: head/tail summaries, per-turn message deduplication,
// and a bounded detail-file read. Original Glassline code is Apache-2.0.
import { open, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pageTimelineItems } from "../core/session-registry.mjs";
import { commandTokens } from "./process-utils.mjs";
import { createSessionFileCatalog } from "./session-file-catalog.mjs";

const CODEX_SESSION_PREFIX = "codex:session-file:";
const SESSION_UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION_UUID_PATTERN = new RegExp(`(${SESSION_UUID_SOURCE})`, "i");
const SESSION_ID_PATTERN =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\.jsonl$)/i;
const SESSION_TITLE_MAX_LENGTH = 96;
const TURN_STATE_TAIL_BYTES = 64 * 1024;
const SUMMARY_CONCURRENCY = 8;
const MAX_SESSION_FILE_BYTES = 32 * 1024 * 1024;

class SessionFileTooLargeError extends Error {
  constructor() {
    super("会话日志超过 32 MiB，请在原窗口查看");
  }
}

async function readSessionText(filePath) {
  const file = await open(filePath, "r");
  try {
    if ((await file.stat()).size > MAX_SESSION_FILE_BYTES)
      throw new SessionFileTooLargeError();
    const chunks = [];
    let bytes = 0;
    // Recheck during reading: Codex can append after the initial stat.
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > MAX_SESSION_FILE_BYTES) throw new SessionFileTooLargeError();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {
    await file.close();
  }
}

export function resolveCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function extractCodexSessionReference(command) {
  const tokens = commandTokens(command);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "--session-id" || token === "--resume" || token === "resume") {
      const value = nextOptionValue(tokens, index);
      const sessionId = value ? extractSessionUuid(value) : null;
      if (sessionId) {
        return sessionId;
      }
      continue;
    }

    if (token.startsWith("--session-id=") || token.startsWith("--resume=")) {
      const sessionId = extractSessionUuid(token.slice(token.indexOf("=") + 1));
      if (sessionId) {
        return sessionId;
      }
    }
  }

  return null;
}

export function codexResumeRef(sessionUuid, sourceRefs = [], confidence = "medium") {
  return {
    value: sessionUuid,
    command: `codex resume ${sessionUuid}`,
    label: "Codex resume id",
    confidence,
    sourceRefs
  };
}

export async function listCodexSessionFileSessions({
  codexHome = resolveCodexHome(),
  summaryOnly = false
} = {}) {
  const catalog = createCodexSessionFileCatalog({ codexHome, summaryOnly });
  return catalog.listSessions();
}

export function createCodexSessionFileCatalog({
  codexHome = resolveCodexHome(),
  summaryOnly = true,
  concurrency = SUMMARY_CONCURRENCY,
  statFile = stat
} = {}) {
  let indexCache = null;

  return createSessionFileCatalog({
    concurrency,
    statFile,
    loadContext: async () => {
      const indexPath = path.join(codexHome, "session_index.jsonl");
      let indexStat;
      try {
        indexStat = await statFile(indexPath);
      } catch {
        indexCache = null;
        return codexIndexContext([]);
      }

      const fingerprint = statFingerprint(indexStat);
      if (indexCache?.fingerprint === fingerprint) {
        return indexCache.context;
      }

      try {
        const context = codexIndexContext(
          await readSessionIndex(codexHome, { tolerateReadError: false })
        );
        indexCache = { fingerprint, context };
        return context;
      } catch {
        return codexIndexContext([]);
      }
    },
    discoverFiles: () => findSessionJsonlFiles(path.join(codexHome, "sessions")),
    dependencyKey: (filePath, context) => {
      const sessionUuid = sessionIdFromFilePath(filePath);
      return JSON.stringify(sessionUuid ? context.indexById.get(sessionUuid) ?? null : null);
    },
    loadFile: async (filePath, { context, fileStat }) => {
      const sessionUuid = sessionIdFromFilePath(filePath);
      const indexEntry = sessionUuid ? context.indexById.get(sessionUuid) : undefined;
      return summaryOnly
        ? summarizeCodexSessionFile(filePath, { indexEntry, fileStat })
        : parseCodexSessionFile(filePath, { indexEntry, fileStat });
    },
    onFileError: async (_error, filePath, { context }) => {
      const sessionUuid = sessionIdFromFilePath(filePath);
      const indexEntry = sessionUuid ? context.indexById.get(sessionUuid) : undefined;
      return indexEntry ? staleIndexSession(indexEntry, filePath) : null;
    },
    finalize: (fileSessions, context) => {
      const parsedById = new Map();
      for (const session of fileSessions) {
        setNewestSession(parsedById, session);
      }

      for (const entry of context.indexEntries) {
        const id = glasslineSessionId(entry.id);
        if (!parsedById.has(id)) {
          parsedById.set(id, staleIndexSession(entry));
        }
      }

      return [...parsedById.values()];
    }
  });
}

function setNewestSession(sessionsById, session) {
  const existing = sessionsById.get(session.id);
  if (!existing || Date.parse(session.lastUpdatedAt) > Date.parse(existing.lastUpdatedAt)) {
    sessionsById.set(session.id, session);
  }
}

export async function getCodexSessionFileSession(id, options = {}) {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const sessionUuid = sessionFileUuidFromGlasslineId(id);
  if (!sessionUuid) {
    return null;
  }

  const indexEntry = Object.hasOwn(options, "indexEntry")
    ? options.indexEntry ?? undefined
    : (await readSessionIndex(codexHome)).find((entry) => entry.id === sessionUuid);
  const filePath = Object.hasOwn(options, "sessionFilePath")
    ? options.sessionFilePath
    : await findSessionFileById(codexHome, sessionUuid);

  if (!filePath) {
    return indexEntry ? staleIndexSession(indexEntry) : null;
  }

  try {
    return await parseCodexSessionFile(filePath, { indexEntry });
  } catch {
    return indexEntry ? staleIndexSession(indexEntry, filePath) : null;
  }
}

export async function getCodexSessionFileTimelinePage(
  id,
  options = {}
) {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const { limit, cursor } = options;
  const sessionUuid = sessionFileUuidFromGlasslineId(id);
  if (!sessionUuid) {
    return null;
  }

  const indexEntry = Object.hasOwn(options, "indexEntry")
    ? options.indexEntry ?? undefined
    : (await readSessionIndex(codexHome)).find((entry) => entry.id === sessionUuid);
  const filePath = Object.hasOwn(options, "sessionFilePath")
    ? options.sessionFilePath
    : await findSessionFileById(codexHome, sessionUuid);

  if (!filePath) {
    return indexEntry ? pageTimelineItems(staleIndexSession(indexEntry).timeline, { limit, cursor }) : null;
  }

  try {
    const session = await parseCodexSessionFile(filePath, { indexEntry });
    return pageTimelineItems(session.timeline, { limit, cursor });
  } catch (error) {
    if (error instanceof SessionFileTooLargeError) throw error;
    return indexEntry
      ? pageTimelineItems(staleIndexSession(indexEntry, filePath).timeline, { limit, cursor })
      : null;
  }
}

export function isCodexSessionFileSessionId(id) {
  return id.startsWith(CODEX_SESSION_PREFIX);
}

export async function parseCodexSessionFile(filePath, { indexEntry, fileStat: knownFileStat } = {}) {
  const text = await readSessionText(filePath);
  const fileStat = knownFileStat ?? (await stat(filePath));
  const fileUpdatedAt = fileStat.mtime.toISOString();
  const sourceRef = {
    kind: "session-file",
    label: "Codex JSONL",
    confidence: "medium",
    path: filePath,
    updatedAt: fileUpdatedAt
  };
  const timeline = [];
  const callsById = new Map();
  const seenMessages = new Set();
  let parseErrors = 0;
  let meta = {};
  let latestCreatedAt;
  let turnState = "unknown";

  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      parseErrors += 1;
      continue;
    }

    const payload = record.payload ?? {};
    const createdAt = toIsoTimestamp(record.timestamp ?? payload.timestamp) ?? fileUpdatedAt;
    latestCreatedAt = maxIso(latestCreatedAt, createdAt);

    if (record.type === "event_msg") {
      if (payload.type === "task_started") seenMessages.clear();
      turnState = nextTurnState(turnState, payload.type);
    }

    if (record.type === "session_meta") {
      meta = {
        ...meta,
        id: payload.session_id ?? payload.id ?? meta.id,
        cwd: payload.cwd ?? meta.cwd,
        startedAt: toIsoTimestamp(payload.timestamp ?? record.timestamp) ?? meta.startedAt
      };
      continue;
    }

    if (record.type === "event_msg" && payload.type === "user_message") {
      addMessage(timeline, seenMessages, {
        id: timelineItemId(filePath, timeline.length, "message"),
        role: "user",
        content: contentToText(payload.message ?? payload.text_elements),
        createdAt,
        sourceRef
      });
      continue;
    }

    if (record.type === "event_msg" && payload.type === "agent_message") {
      addMessage(timeline, seenMessages, {
        id: timelineItemId(filePath, timeline.length, "message"),
        role: "assistant",
        content: contentToText(payload.message),
        createdAt,
        sourceRef
      });
      continue;
    }

    if (record.type === "response_item" && payload.type === "message") {
      if (payload.role === "user" || payload.role === "assistant") {
        addMessage(timeline, seenMessages, {
          id: payload.id ?? timelineItemId(filePath, timeline.length, "message"),
          role: payload.role,
          content: contentToText(payload.content),
          createdAt,
          sourceRef
        });
      }
      continue;
    }

    if (
      record.type === "response_item" &&
      (payload.type === "function_call" || payload.type === "custom_tool_call")
    ) {
      const item = callToTimelineItem(payload, createdAt, sourceRef);
      timeline.push(item);
      callsById.set(payload.call_id ?? payload.id, item);
      continue;
    }

    if (
      record.type === "response_item" &&
      (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")
    ) {
      applyCallOutput(callsById.get(payload.call_id), payload.output);
      continue;
    }

    if (record.type === "event_msg" && payload.type === "patch_apply_end") {
      applyCallOutput(callsById.get(payload.call_id), payload.stdout || payload.stderr);
      for (const [changePath, change] of Object.entries(payload.changes ?? {})) {
        timeline.push({
          id: timelineItemId(filePath, timeline.length, "file"),
          type: "file_change",
          createdAt,
          path: changePath,
          summary: `${change.type ?? "change"} ${changePath}`,
          diff: change.unified_diff,
          sourceRefs: [sourceRef]
        });
      }
    }
  }

  const sessionUuid = meta.id ?? indexEntry?.id ?? sessionIdFromFilePath(filePath);
  const lastUpdatedAt = newestIso(indexEntry?.updated_at, latestCreatedAt) ?? fileUpdatedAt;
  sourceRef.updatedAt = lastUpdatedAt;

  return {
    id: glasslineSessionId(sessionUuid),
    providerId: "codex",
    providerName: "Codex",
    title: codexSessionTitle(indexEntry?.thread_name, firstUserMessage(timeline)),
    projectPath: meta.cwd,
    status: "unknown",
    turnState,
    quality: "partial",
    startedAt: meta.startedAt,
    lastUpdatedAt,
    recentMessage: latestText(timeline) ?? indexEntry?.thread_name,
    sources: [sourceRef],
    resumeRef: codexResumeRef(sessionUuid, [sourceRef]),
    timeline,
    rawAvailable: true,
    parseErrors
  };
}

async function summarizeCodexSessionFile(
  filePath,
  { indexEntry, fileStat: knownFileStat } = {}
) {
  const fileStat = knownFileStat ?? (await stat(filePath));
  const fileUpdatedAt = fileStat.mtime.toISOString();
  const lastUpdatedAt = newestIso(indexEntry?.updated_at, fileUpdatedAt);
  const { firstRecord, firstPrompt } = await readSessionHead(filePath);
  const recent = await readRecentSummary(filePath, fileStat.size);
  const payload = firstRecord?.type === "session_meta" ? firstRecord.payload ?? {} : {};
  const sessionUuid = payload.session_id ?? payload.id ?? indexEntry?.id ?? sessionIdFromFilePath(filePath);
  const sourceRef = {
    kind: "session-file",
    label: "Codex JSONL",
    confidence: "medium",
    path: filePath,
    updatedAt: lastUpdatedAt
  };

  return {
    id: glasslineSessionId(sessionUuid),
    providerId: "codex",
    providerName: "Codex",
    title: codexSessionTitle(indexEntry?.thread_name, firstPrompt),
    projectPath: payload.cwd,
    status: "unknown",
    turnState: recent.turnState,
    quality: "partial",
    startedAt: toIsoTimestamp(payload.timestamp ?? firstRecord?.timestamp),
    lastUpdatedAt,
    recentMessage: recent.message || indexEntry?.thread_name,
    sources: [sourceRef],
    resumeRef: codexResumeRef(sessionUuid, [sourceRef]),
    timeline: [],
    rawAvailable: true
  };
}

export async function getRawCodexSessionFile(id, options = {}) {
  const codexHome = options.codexHome ?? resolveCodexHome();
  const sessionUuid = sessionFileUuidFromGlasslineId(id);
  if (!sessionUuid) {
    return null;
  }

  const filePath = Object.hasOwn(options, "sessionFilePath")
    ? options.sessionFilePath
    : await findSessionFileById(codexHome, sessionUuid);
  if (!filePath) {
    return null;
  }

  return {
    text: await readFile(filePath, "utf8"),
    source: "session-file",
    confidence: "medium"
  };
}

function callToTimelineItem(payload, createdAt, sourceRef) {
  const callId = payload.call_id ?? payload.id;
  const input = parseJsonLike(payload.arguments ?? payload.input);
  const command = commandFromCall(payload.name, input);

  if (command) {
    return {
      id: callId,
      type: "command",
      createdAt,
      command: command.command,
      cwd: command.cwd,
      exitCode: null,
      output: "",
      sourceRefs: [sourceRef]
    };
  }

  return {
    id: callId,
    type: "tool_call",
    createdAt,
    name: payload.name ?? "tool",
    input,
    output: undefined,
    status: normalizeToolStatus(payload.status),
    sourceRefs: [sourceRef]
  };
}

function commandFromCall(name, input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const command = typeof input.cmd === "string" ? input.cmd : input.command;
  if (typeof command !== "string") {
    return null;
  }

  return {
    command,
    cwd: typeof input.workdir === "string" ? input.workdir : input.cwd
  };
}

function applyCallOutput(item, output) {
  if (!item) {
    return;
  }

  if (item.type === "command") {
    item.output = contentToText(output);
    item.exitCode = extractExitCode(item.output);
    return;
  }

  if (item.type === "tool_call") {
    item.output = contentToText(output);
    item.status = "complete";
  }
}

function addMessage(timeline, seenMessages, { id, role, content, createdAt, sourceRef }) {
  const text = contentToText(content);
  if (!text) {
    return;
  }

  const dedupeKey = `${role}\0${text}`;
  if (seenMessages.has(dedupeKey)) {
    return;
  }

  seenMessages.add(dedupeKey);
  timeline.push({
    id,
    type: "message",
    role,
    createdAt,
    content: text,
    sourceRefs: [sourceRef]
  });
}

async function readSessionIndex(codexHome, { tolerateReadError = true } = {}) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  let text;

  try {
    text = await readFile(indexPath, "utf8");
  } catch (error) {
    if (tolerateReadError) {
      return [];
    }
    throw error;
  }

  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line);
      if (entry.id) {
        entries.push(entry);
      }
    } catch {
      // Best-effort index parsing: a bad line should not hide every transcript.
    }
  }

  return entries;
}

function codexIndexContext(indexEntries) {
  return {
    indexEntries,
    indexById: new Map(indexEntries.map((entry) => [entry.id, entry]))
  };
}

function statFingerprint(fileStat) {
  return [
    fileStat.dev,
    fileStat.ino,
    fileStat.size,
    fileStat.mtimeMs,
    fileStat.ctimeMs
  ].join(":");
}

async function readSessionHead(filePath) {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(65_536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const records = buffer.subarray(0, bytesRead).toString("utf8").split("\n").flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const prompt = records.find((record) =>
      (record.type === "response_item" && record.payload?.type === "message" && record.payload.role === "user") ||
      (record.type === "event_msg" && record.payload?.type === "user_message")
    );
    return { firstRecord: records[0], firstPrompt: contentToText(prompt?.payload?.content ?? prompt?.payload?.message) };
  } catch {
    return {};
  } finally {
    await file.close();
  }
}

async function readRecentSummary(filePath, fileSize) {
  const length = Math.min(fileSize, TURN_STATE_TAIL_BYTES);
  if (length === 0) {
    return { turnState: "unknown", message: "" };
  }

  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, fileSize - length);
    let turnState = "unknown";
    let message = "";

    for (const line of buffer.toString("utf8").split("\n")) {
      try {
        const record = JSON.parse(line);
        if (record.type === "event_msg") {
          turnState = nextTurnState(turnState, record.payload?.type);
        }
        const payload = record.payload ?? {};
        if (record.type === "event_msg" && ["user_message", "agent_message"].includes(payload.type))
          message = contentToText(payload.message).slice(0, 300) || message;
        if (record.type === "response_item" && payload.type === "message" && ["user", "assistant"].includes(payload.role))
          message = contentToText(payload.content).slice(0, 300) || message;
      } catch {
        // The first tail line may be partial and malformed records are best-effort data.
      }
    }

    return { turnState, message };
  } finally {
    await handle.close();
  }
}

function nextTurnState(currentState, eventType) {
  if (eventType === "task_started") {
    return "running";
  }

  if (eventType === "task_complete" || eventType === "turn_aborted") {
    return "idle";
  }

  return currentState;
}

async function findSessionJsonlFiles(root) {
  const files = [];
  const directories = [root];

  while (directories.length > 0) {
    const batch = directories.splice(0, SUMMARY_CONCURRENCY);
    const entryGroups = await Promise.all(
      batch.map(async (directory) => {
        try {
          const entries = await readdir(directory, { withFileTypes: true });
          return { directory, entries };
        } catch {
          return { directory, entries: [] };
        }
      })
    );

    for (const { directory, entries } of entryGroups) {
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          directories.push(entryPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(entryPath);
        }
      }
    }
  }

  return files;
}

async function findSessionFileById(codexHome, sessionUuid) {
  const files = await findSessionJsonlFiles(path.join(codexHome, "sessions"));
  return files.find((filePath) => sessionIdFromFilePath(filePath) === sessionUuid) ?? null;
}

function staleIndexSession(indexEntry, filePath) {
  const sourceRef = {
    kind: "session-file",
    label: "Codex session index",
    confidence: "low",
    path: filePath,
    updatedAt: indexEntry.updated_at
  };

  return {
    id: glasslineSessionId(indexEntry.id),
    providerId: "codex",
    providerName: "Codex",
    title: codexSessionTitle(indexEntry.thread_name),
    status: "unknown",
    turnState: "unknown",
    quality: "stale",
    lastUpdatedAt: indexEntry.updated_at ?? new Date().toISOString(),
    recentMessage: indexEntry.thread_name,
    sources: [sourceRef],
    resumeRef: codexResumeRef(indexEntry.id, [sourceRef]),
    timeline: [
      {
        id: `${glasslineSessionId(indexEntry.id)}:stale`,
        type: "status",
        createdAt: indexEntry.updated_at ?? new Date().toISOString(),
        status: "unknown",
        detail: "Codex session file is missing or unreadable.",
        sourceRefs: [sourceRef]
      }
    ],
    rawAvailable: false
  };
}

function contentToText(content) {
  if (content === null || content === undefined) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        return item?.text ?? item?.content ?? "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }

  return String(content);
}

function parseJsonLike(value) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractExitCode(output) {
  const match = output?.match(/Process exited with code (-?\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeToolStatus(status) {
  if (status === "completed" || status === "complete") {
    return "complete";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "running") {
    return "running";
  }

  return "unknown";
}

function firstUserMessage(timeline) {
  return timeline.find((item) => item.type === "message" && item.role === "user")?.content;
}

function codexSessionTitle(indexTitle, firstUserText) {
  const fallbackTitle = titleFromUserText(firstUserText);
  const indexCandidate = cleanTitle(indexTitle);

  if (indexCandidate && (indexCandidate.length <= SESSION_TITLE_MAX_LENGTH || !fallbackTitle)) {
    return clampTitle(indexCandidate);
  }

  return fallbackTitle ?? "Codex session";
}

function titleFromUserText(text) {
  const cleaned = cleanTitle(text);
  if (!cleaned) {
    return null;
  }

  const transcriptTitle = titleFromTranscript(text);
  if (transcriptTitle) {
    return clampTitle(transcriptTitle);
  }

  const firstLine = text
    .split("\n")
    .map((line) => cleanTitle(line))
    .find((line) => line && !isTitleBoilerplate(line));

  return clampTitle(firstLine ?? cleaned);
}

function titleFromTranscript(text) {
  for (const line of text.split("\n")) {
    const match = line.match(/^\[\d+\]\s+user:\s*(.+)$/);
    if (match) {
      const title = cleanTitle(match[1]);
      if (title) {
        return title;
      }
    }
  }

  return null;
}

function isTitleBoilerplate(line) {
  return (
    line === ">>> TRANSCRIPT START" ||
    line === ">>> TRANSCRIPT END" ||
    line === "Output:" ||
    line.startsWith("The following is the Codex agent history") ||
    line.startsWith("Wall time:") ||
    line.startsWith("Process exited with code ") ||
    line.startsWith("Original token count:") ||
    /^\[\d+\]\s+(assistant|tool|system|developer|agent|event|function)\b/.test(line)
  );
}

function cleanTitle(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/\s+/g, " ").trim();
}

function clampTitle(title) {
  if (title.length <= SESSION_TITLE_MAX_LENGTH) {
    return title;
  }

  return `${title.slice(0, SESSION_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

function latestText(timeline) {
  const latest = [...timeline].reverse().find((item) => {
    return item.content || item.output || item.summary || item.detail;
  });

  return latest?.content ?? latest?.output ?? latest?.summary ?? latest?.detail;
}

function nextOptionValue(tokens, index) {
  const value = tokens[index + 1];
  return value && !value.startsWith("-") ? value : null;
}

function extractSessionUuid(value) {
  return String(value ?? "").match(SESSION_UUID_PATTERN)?.[1] ?? null;
}

function maxIso(left, right) {
  if (!left) {
    return right;
  }

  return Date.parse(right) > Date.parse(left) ? right : left;
}

function newestIso(...values) {
  return values.filter(Boolean).reduce((latest, value) => maxIso(latest, value), undefined);
}

function toIsoTimestamp(value) {
  if (!value) {
    return undefined;
  }

  const date = typeof value === "number" ? numericDate(value) : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function numericDate(value) {
  return new Date(value < 10_000_000_000 ? value * 1000 : value);
}

function timelineItemId(filePath, index, type) {
  return `${glasslineSessionId(sessionIdFromFilePath(filePath) ?? "unknown")}:${type}:${index}`;
}

function glasslineSessionId(sessionUuid) {
  return `${CODEX_SESSION_PREFIX}${sessionUuid}`;
}

function sessionFileUuidFromGlasslineId(id) {
  return id.startsWith(CODEX_SESSION_PREFIX) ? id.slice(CODEX_SESSION_PREFIX.length) : null;
}

function sessionIdFromFilePath(filePath) {
  return path.basename(filePath).match(SESSION_ID_PATTERN)?.[1];
}
