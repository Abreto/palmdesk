// Shared PalmDesk bounds for the Apache-2.0 Glassline file adapters.
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

const MAX_SESSION_FILE_BYTES = 32 * 1024 * 1024;

export class SessionFileTooLargeError extends Error {
  constructor() {
    super('会话日志超过 32 MiB，请在原窗口查看');
  }
}

async function* readSessionChunks(filePath) {
  const file = await open(filePath, 'r');
  try {
    if ((await file.stat()).size > MAX_SESSION_FILE_BYTES)
      throw new SessionFileTooLargeError();
    let bytes = 0;
    // Agents can append after the initial stat, so also bound the stream.
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > MAX_SESSION_FILE_BYTES) throw new SessionFileTooLargeError();
      yield chunk;
    }
  } finally {
    await file.close();
  }
}

export async function readSessionText(filePath) {
  const chunks = [];
  for await (const chunk of readSessionChunks(filePath)) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function* readSessionLines(filePath) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of readSessionChunks(filePath)) {
    pending += decoder.write(chunk);
    let start = 0;
    let end;
    while ((end = pending.indexOf('\n', start)) !== -1) {
      yield pending.slice(start, end);
      start = end + 1;
    }
    pending = pending.slice(start);
  }
  pending += decoder.end();
  if (pending) yield pending;
}
