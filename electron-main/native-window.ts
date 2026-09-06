import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { ICaptureBounds, ICaptureSource } from '../src/pure-interface';

export interface NativeWindow {
  nativeId: number;
  ownerPid: number;
  bundleId: string;
  name: string;
  bounds: ICaptureBounds;
}

export const TARGET_BUNDLES = new Set(['com.openai.codex', 'com.openai.chat']);

export function matchCaptureSources(
  sources: Electron.DesktopCapturerSource[],
  owners: NativeWindow[]
): ICaptureSource[] {
  return sources.flatMap((source) => {
    const match = /^window:(\d+):\d+$/.exec(source.id);
    const owner = owners.find((item) => item.nativeId === Number(match?.[1]));
    if (!match || !owner || !TARGET_BUNDLES.has(owner.bundleId)) return [];
    return [
      {
        ...owner,
        id: source.id,
        name: source.name || owner.name,
        displayId: source.display_id,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon?.toDataURL() || '',
        isCodex: true,
        boundsSource: 'window' as const,
        inputScale: 1,
      },
    ];
  });
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
          if (message.error) pending.reject(new Error(message.error));
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
      const timer = setTimeout(() => this.close(), 2500);
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
