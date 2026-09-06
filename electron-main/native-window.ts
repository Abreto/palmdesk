import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { ICaptureBounds, ICaptureSource } from '../src/pure-interface';

export interface NativeWindow {
  nativeId: number;
  ownerPid: number;
  bundleId: string;
  appName?: string;
  name: string;
  isOnScreen: boolean;
  bounds: ICaptureBounds;
}

export const TARGET_BUNDLES = new Set(['com.openai.codex', 'com.openai.chat']);

export class NativeWindowError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

export function matchCaptureSources(
  sources: Electron.DesktopCapturerSource[],
  owners: NativeWindow[]
): ICaptureSource[] {
  const available = new Map(
    sources.flatMap((source) => {
      const match = /^window:(\d+):\d+$/.exec(source.id);
      return match ? [[Number(match[1]), source] as const] : [];
    })
  );
  const matched = owners.map((owner) => {
    const source = available.get(owner.nativeId);
    return {
      ...owner,
      // Catalog identities remain stable when Electron omits an offscreen window.
      id: `window:${owner.nativeId}:0`,
      captureId: owner.isOnScreen ? source?.id : undefined,
      name: source?.name || owner.name,
      displayId: source?.display_id,
      thumbnail:
        source && !source.thumbnail.isEmpty()
          ? `data:image/jpeg;base64,${source.thumbnail.toJPEG(55).toString('base64')}`
          : '',
      appIcon:
        source?.appIcon?.resize({ width: 32, height: 32 }).toDataURL() || '',
      isCodex: TARGET_BUNDLES.has(owner.bundleId),
      boundsSource: 'window' as const,
      inputScale: 1,
    };
  });
  return matched.sort((a, b) => Number(b.isCodex) - Number(a.isCodex));
}

export class NativeWindowBridge {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private executable: string) {}

  request<T>(command: string, target?: Partial<NativeWindow>): Promise<T> {
    if (process.platform !== 'darwin') {
      return Promise.reject(
        new Error('当前单窗口控制支持 macOS；此平台尚无应用身份验证适配器')
      );
    }
    if (!this.child) {
      const child = spawn(this.executable, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line);
          const pending = this.pending.get(message.requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(message.requestId);
          if (message.error)
            pending.reject(
              new NativeWindowError(
                message.error,
                message.errorCode || 'unknown'
              )
            );
          else pending.resolve(message.data);
        } catch {
          this.close();
        }
      });
      child.stderr.on('data', (chunk) =>
        console.warn('Native window helper:', String(chunk))
      );
      child.on('error', () => this.close());
      child.on('exit', () => {
        lines.close();
        if (this.child === child) this.close();
      });
    }
    return new Promise<T>((resolve, reject) => {
      this.sequence += 1;
      const requestId = this.sequence;
      // Lists can queue behind AX activation and its Space transition in the helper.
      const timer = setTimeout(() => this.close(), 12000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.child!.stdin.write(
        `${JSON.stringify({ ...target, command, requestId })}\n`,
        (error) => {
          if (error) this.close();
        }
      );
    });
  }

  close() {
    const child = this.child;
    this.child = undefined;
    child?.kill();
    this.pending.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(
        new Error(
          '原生窗口服务不可用，请运行 npm run dev:desktop 或重新启动客户端'
        )
      );
    });
    this.pending.clear();
  }
}
