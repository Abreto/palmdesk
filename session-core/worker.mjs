// Runs the reader on a worker thread so the desktop host's main process keeps
// handling IPC and remote input while a large log is parsed.
import { parentPort, workerData } from 'node:worker_threads';

import { createSessionReader } from './index.mjs';

const reader = createSessionReader(workerData);

parentPort.on('message', async ({ id, method, args }) => {
  try {
    if (method !== 'list' && method !== 'read')
      throw new Error('不支持的会话请求');
    parentPort.postMessage({ id, result: await reader[method](...args) });
  } catch (error) {
    parentPort.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
