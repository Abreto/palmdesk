import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { ReaderList, ReaderPage } from '../session-core/index.mjs';

export interface SessionReaderOptions {
  codexHome?: string;
  claudeConfigDir?: string;
  claudeDesktopDataDir?: string;
}

const TIMEOUTS = {
  request: 30_000,
  // The controller polls every 8 seconds while the Read tab is open.
  idle: 120_000,
};

// Parses session logs on a worker thread so a large log never blocks IPC or
// remote input in the main process. Requests run one at a time, and the
// worker exits when idle or closed, dropping any parsed transcript.
export function createWorkerSessionReader(
  options: SessionReaderOptions,
  file = path.join(__dirname, 'session-worker.cjs'),
  timeouts = TIMEOUTS
) {
  let worker: Worker | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  function stop(error: Error) {
    clearTimeout(idle);
    const current = worker;
    worker = undefined;
    pending.forEach(({ reject }) => reject(error));
    pending.clear();
    void current?.terminate();
  }

  function start() {
    if (worker) return worker;
    const current = new Worker(file, { workerData: options });
    // Pending requests keep the process alive through their timeout timer.
    current.unref();
    current.on('message', ({ id, result, error }) => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error));
      else request.resolve(result);
    });
    current.on('error', (error) => {
      if (worker === current) stop(error);
    });
    current.on('exit', () => {
      if (worker === current) stop(new Error('会话读取已中断，请重试'));
    });
    worker = current;
    return current;
  }

  function call<T>(method: 'list' | 'read', args: unknown[]): Promise<T> {
    const result = queue
      .then(
        () =>
          new Promise<T>((resolve, reject) => {
            clearTimeout(idle);
            sequence += 1;
            const id = sequence;
            const timer = setTimeout(
              () => stop(new Error('会话读取超时，请稍后重试')),
              timeouts.request
            );
            pending.set(id, {
              resolve: (value) => {
                clearTimeout(timer);
                resolve(value as T);
              },
              reject: (error) => {
                clearTimeout(timer);
                reject(error);
              },
            });
            start().postMessage({ id, method, args });
          })
      )
      .finally(() => {
        if (!worker || pending.size) return;
        clearTimeout(idle);
        idle = setTimeout(
          () => stop(new Error('会话读取已关闭')),
          timeouts.idle
        );
        idle.unref();
      });
    queue = result.catch(() => {});
    return result;
  }

  return {
    list: (query?: string) => call<ReaderList>('list', [query]),
    read: (id: string, cursor?: string) =>
      call<ReaderPage>('read', [id, cursor]),
    close: () => stop(new Error('会话读取已关闭')),
  };
}
