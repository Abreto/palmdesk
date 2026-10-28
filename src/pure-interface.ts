import type { AgentId } from './utils/agent-registry';

export interface IIpcRendererData {
  windowId: number;
  channel: any;
  requestId: string;
  data: any;
  code?: number;
  msg?: string;
}

export interface ICaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureBoundsSource = 'window' | 'display' | 'unknown';

export interface ICaptureSource {
  id: string;
  /** Electron source ID, present only while the window is available for capture. */
  captureId?: string;
  isOnScreen: boolean;
  nativeId: number;
  ownerPid: number;
  bundleId: string;
  appName?: string;
  name: string;
  displayId?: string;
  thumbnail: string;
  appIcon: string;
  isAiTarget: boolean;
  /** @deprecated Use isAiTarget. Kept as a compatibility alias for older clients. */
  isCodex?: boolean;
  bounds: ICaptureBounds | null;
  boundsSource: CaptureBoundsSource;
  /** 将窗口边界转换为 nut.js 屏幕坐标时使用的缩放比例。 */
  inputScale: number;
}

export interface IRemoteWindow {
  id: string;
  contextId?: string;
  agentId?: AgentId;
  name: string;
  appName: string;
  thumbnail: string;
  appIcon: string;
  isOnScreen: boolean;
}

export interface IRemoteAgent {
  id: AgentId;
  name: string;
}

export interface RemoteInput {
  action:
    | 'move'
    | 'down'
    | 'up'
    | 'click'
    | 'doubleClick'
    | 'rightClick'
    | 'scroll'
    | 'text'
    | 'keysDown'
    | 'keysUp'
    | 'releaseAll'
    | 'resume';
  x?: number;
  y?: number;
  amount?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  text?: string;
  keys?: number[];
}

export interface IReleaseInfo {
  version: string;
  url: string;
  /** The release notes contain a line starting with `Security:`. */
  security: boolean;
}

export interface IReleaseStatus {
  /** Automatic checks; a check requested by the user always runs. */
  enabled: boolean;
  current: string;
  checking: boolean;
  checkedAt?: number;
  latest?: IReleaseInfo;
  available: boolean;
  error?: string;
  /** The last check was requested by the user. */
  manual?: boolean;
}

export interface IKeepAwakeStatus {
  /** The saved choice for this desktop installation; off by default. */
  enabled: boolean;
  /** PalmDesk holds a blocker against automatic idle sleep. */
  active: boolean;
  supported: boolean;
  /** Why the option is on but not in effect. */
  error?: string;
}
