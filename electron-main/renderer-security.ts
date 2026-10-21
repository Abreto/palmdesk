import { IPC_EVENT } from '../src/event';

/**
 * Requests the renderer may make with `ipcRenderer.invoke`. Every other
 * channel is rejected in the preload and never reaches `ipcMain`.
 */
export const RENDERER_INVOKE_CHANNELS: readonly string[] = [
  IPC_EVENT.getPlatform,
  IPC_EVENT.shellOpenExternal,
  IPC_EVENT.setWindowPosition,
  IPC_EVENT.scaleFactor,
  IPC_EVENT.getPrimaryDisplaySize,
  IPC_EVENT.createWindow,
  IPC_EVENT.takeWindowSession,
  IPC_EVENT.getCaptureSources,
  IPC_EVENT.getAgentApplications,
  IPC_EVENT.getInstalledAgents,
  IPC_EVENT.launchAgent,
  IPC_EVENT.cancelAgentLaunch,
  IPC_EVENT.sessionReaderSettings,
  IPC_EVENT.sessionReaderConfigure,
  IPC_EVENT.sessionReaderRequest,
  IPC_EVENT.beginCapture,
  IPC_EVENT.stopCapture,
  IPC_EVENT.remoteInput,
  IPC_EVENT.pasteImage,
  IPC_EVENT.cancelImagePaste,
  IPC_EVENT.capturePermissions,
  IPC_EVENT.openCapturePermission,
];

/** Notifications the renderer may send with `ipcRenderer.send`. */
export const RENDERER_SEND_CHANNELS: readonly string[] = [
  IPC_EVENT.closeAllWindow,
  IPC_EVENT.closeWindow,
  IPC_EVENT.windowMinimize,
  IPC_EVENT.handleOpenDevTools,
  IPC_EVENT.setAlwaysOnTop,
  IPC_EVENT.workAreaSize,
];

/** Main-process events the renderer may subscribe to. */
export const RENDERER_RECEIVE_CHANNELS: readonly string[] = [
  IPC_EVENT.response_open_about,
  IPC_EVENT.response_open_version,
  IPC_EVENT.response_powerMonitorSuspend,
  IPC_EVENT.response_powerMonitorResume,
  IPC_EVENT.response_workAreaSize,
];

/** Hosts the desktop app may open in the system browser. */
export const EXTERNAL_LINK_HOSTS: readonly string[] = ['github.com'];

/**
 * Whether `candidate` is the app's own document: the bundled `index.html`
 * (any hash or query) in packaged builds, or the dev server origin.
 * Windows paths compare case-insensitively.
 */
export function isAppDocumentUrl(
  candidate: string,
  entry: string,
  caseInsensitivePath = false
) {
  try {
    const target = new URL(candidate);
    const app = new URL(entry);
    if (app.protocol !== 'file:') return target.origin === app.origin;
    if (target.protocol !== 'file:' || target.host !== app.host) return false;
    const normalize = (pathname: string) => {
      const decoded = decodeURIComponent(pathname);
      return caseInsensitivePath ? decoded.toLowerCase() : decoded;
    };
    return normalize(target.pathname) === normalize(app.pathname);
  } catch {
    return false;
  }
}

/**
 * Returns the URL to hand to `shell.openExternal`, or `undefined` when it is
 * anything other than a credential-free `https:` link to an allowed host.
 */
export function externalLinkUrl(
  value: unknown,
  hosts: readonly string[] = EXTERNAL_LINK_HOSTS
) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hosts.includes(url.hostname)
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export type RendererPermissionRequest = {
  /** The request comes from the top-level app document of a PalmDesk window. */
  trusted: boolean;
  /** The request comes from the host window that owns capture and input. */
  mainWindow: boolean;
  /** Camera/microphone devices requested; desktop capture requests none. */
  mediaTypes?: readonly string[];
};

/**
 * Chromium permissions are denied unless PalmDesk uses them: window capture
 * on the host, clipboard access and fullscreen in the controller view.
 */
export function isPermissionAllowed(
  permission: string,
  request: RendererPermissionRequest
) {
  if (!request.trusted) return false;
  switch (permission) {
    case 'media':
      // Desktop capture selects a window source and requests no device.
      // Cameras and microphones are never used by the desktop app.
      return request.mainWindow && !request.mediaTypes?.length;
    case 'clipboard-read':
    case 'clipboard-sanitized-write':
    case 'fullscreen':
      return true;
    default:
      return false;
  }
}

export type ControllerSession = {
  deskUserUuid: string;
  deskUserPassword: string;
  remoteDeskUserUuid: string;
  remoteDeskUserPassword: string;
};

const CONTROLLER_SESSION_FIELDS: (keyof ControllerSession)[] = [
  'deskUserUuid',
  'deskUserPassword',
  'remoteDeskUserUuid',
  'remoteDeskUserPassword',
];

/** Credentials handed to a controller window after it loads, never in its URL. */
export function parseControllerSession(value: unknown): ControllerSession {
  if (!value || typeof value !== 'object') throw new Error('连接信息无效');
  const session = {} as ControllerSession;
  CONTROLLER_SESSION_FIELDS.forEach((field) => {
    const item = (value as Record<string, unknown>)[field];
    if (typeof item !== 'string' || !item || item.length > 256)
      throw new Error('连接信息无效');
    session[field] = item;
  });
  return session;
}
