import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { AGENT_DEFINITIONS, identifyAgent } from '../src/utils/agent-registry';

import type { ICaptureBounds, ICaptureSource } from '../src/pure-interface';

export interface NativeApplication {
  ownerPid: number;
  bundleId: string;
  appName: string;
}

export interface NativeWindow {
  nativeId: number;
  ownerPid: number;
  bundleId: string;
  appName?: string;
  name: string;
  isOnScreen: boolean;
  bounds: ICaptureBounds;
}

type WindowIdentity = Pick<NativeWindow, 'nativeId' | 'ownerPid' | 'bundleId'>;
type WindowThumbnail = WindowIdentity & { thumbnail: string };

/** macOS bundle IDs for desktop clients that are useful agent targets. */
export const TARGET_BUNDLES = new Set<string>(
  AGENT_DEFINITIONS.flatMap((agent) => [...agent.bundles])
);

export function isAiTargetIdentity(identity: string) {
  return !!identifyAgent(identity);
}

export function discoverAgents(applications: NativeApplication[]) {
  const ids = new Set(
    applications.map((application) => identifyAgent(application.bundleId)?.id)
  );
  return AGENT_DEFINITIONS.filter((agent) => ids.has(agent.id)).map(
    ({ id, name }) => ({ id, name })
  );
}

export function enableWindowsCapture(commandLine: Electron.CommandLine) {
  const feature = 'AllowWgcWindowCapturer';
  const disabled = commandLine.getSwitchValue('disable-features').split(',');
  if (disabled.some((value) => value.split(/[<:]/)[0].trim() === feature))
    return false;
  const enabled = commandLine
    .getSwitchValue('enable-features')
    .split(',')
    .filter(Boolean);
  if (!enabled.some((value) => value.split(/[<:]/)[0].trim() === feature))
    enabled.push(feature);
  commandLine.appendSwitch('enable-features', enabled.join(','));
  return true;
}

export function nativeHelperPath(
  platform: NodeJS.Platform,
  mainDirectory: string,
  resourcesDirectory?: string
) {
  const windows = platform === 'win32';
  const directory = resourcesDirectory
    ? path.join(resourcesDirectory, windows ? 'native' : '../MacOS')
    : path.join(mainDirectory, '../native-bin');
  return path.join(directory, windows ? 'palmdesk-window.exe' : 'codex-window');
}

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
    const isAiTarget = isAiTargetIdentity(owner.bundleId);
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
      isAiTarget,
      // Keep the old wire field for clients that have not migrated yet.
      isCodex: isAiTarget,
      boundsSource: 'window' as const,
      inputScale: 1,
    };
  });
  return matched.sort((a, b) => Number(b.isAiTarget) - Number(a.isAiTarget));
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

  constructor(
    private executable: string,
    private platform: NodeJS.Platform = process.platform
  ) {}

  async addThumbnails(sources: ICaptureSource[]): Promise<ICaptureSource[]> {
    const missing = sources.filter((source) => !source.thumbnail);
    if (!missing.length) return sources;
    try {
      const thumbnails = await this.request<WindowThumbnail[]>('thumbnails', {
        windows: missing.map(({ nativeId, ownerPid, bundleId }) => ({
          nativeId,
          ownerPid,
          bundleId,
        })),
      });
      return sources.map((source) => {
        const preview = thumbnails.find(
          (item) =>
            item.nativeId === source.nativeId &&
            item.ownerPid === source.ownerPid &&
            item.bundleId === source.bundleId
        );
        if (
          source.thumbnail ||
          !preview?.thumbnail.startsWith('data:image/jpeg;base64,') ||
          preview.thumbnail.length > 40000
        )
          return source;
        return { ...source, thumbnail: preview.thumbnail };
      });
    } catch (error) {
      // A missing preview must not make an otherwise selectable window disappear.
      console.warn('Native window previews unavailable:', error);
      return sources;
    }
  }

  request<T>(
    command: string,
    target?: Partial<NativeWindow> & {
      windows?: WindowIdentity[];
      text?: string;
    }
  ): Promise<T> {
    if (this.platform !== 'darwin' && this.platform !== 'win32') {
      return Promise.reject(
        new Error('当前单窗口控制支持 macOS 和 Windows；此平台尚无原生适配器')
      );
    }
    if (!this.child) {
      const child = spawn(this.executable, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
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
      // Lists can queue behind native activation and desktop transitions.
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
