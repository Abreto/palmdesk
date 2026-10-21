import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'path';
import { platform } from 'process';

import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  screen,
  session,
  shell,
  systemPreferences,
} from 'electron';

import { IPC_EVENT } from '../src/event';

import { AgentLauncher } from './agent-launcher';
import { assertUniqueApplicationIdentity } from './app-identity';
import { CaptureSession, InputUnavailableError } from './capture-session';
import {
  pasteClipboardImage,
  pasteWindowsClipboardImage,
  supportsImagePaste,
} from './image-paste';
import {
  NativeWindowBridge,
  NativeWindowError,
  matchCaptureSources,
  nativeHelperPath,
  enableWindowsCapture,
  discoverAgents,
} from './native-window';
import { ReleaseChecker, RELEASES_API } from './release-check';
import {
  externalLinkUrl,
  isAppDocumentUrl,
  isPermissionAllowed,
  parseControllerSession,
} from './renderer-security';
import { DesktopSessionReader } from './session-reader';

import type { ApplicationIdentity } from './app-identity';
import type { NativeApplication, NativeWindow } from './native-window';
import type { ControllerSession } from './renderer-security';
import type { nutjsTs } from './types';
import type { ICaptureSource, IIpcRendererData } from '../src/pure-interface';

let nutjs: nutjsTs;

const windowsCaptureEnabled =
  platform !== 'win32' || enableWindowsCapture(app.commandLine);

// 该版本electron所对应的node版本
console.log('process.version', process.version);
// electron版本
console.log('process.versions.electron', process.versions.electron);
// abi版本
console.log('process.versions.modules', process.versions.modules);

if (platform === 'darwin') {
  console.log('运行在 macOS 上');
} else if (platform === 'linux') {
  console.log('运行在 Linux 上');
} else if (platform === 'win32') {
  console.log('运行在 Windows 上');
} else {
  console.log(`运行在: ${platform}上`);
}

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public');

const appName = app.isPackaged
  ? app.getName()
  : process.env.PALMDESK_APP_NAME || 'PalmDesk Dev';
app.setName(appName);
const userData = path.join(app.getPath('appData'), appName);
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);
app.setPath('sessionData', userData);

const windowNormalParams = { width: 960, height: 720 };
let winBounds: Electron.Rectangle | null;
let mainWindow: BrowserWindow | undefined;
type ChildWindowKind = 'about' | 'webrtc';
const childWindows = new Map<BrowserWindow, ChildWindowKind>();
// Credentials for each controller window; its page takes them once after loading.
const controllerSessions = new WeakMap<
  Electron.WebContents,
  ControllerSession
>();
// Only this document, in a PalmDesk window, may use IPC or navigate.
const appEntryUrl =
  process.env.VITE_DEV_SERVER_URL ||
  pathToFileURL(path.join(process.env.DIST as string, 'index.html')).href;
const isAppUrl = (url: string) =>
  isAppDocumentUrl(url, appEntryUrl, platform === 'win32');
const nativeWindows = new NativeWindowBridge(
  nativeHelperPath(
    platform,
    __dirname,
    app.isPackaged ? process.resourcesPath : undefined
  )
);

async function listCaptureSources(): Promise<ICaptureSource[]> {
  if (platform !== 'darwin' && platform !== 'win32')
    throw new Error('当前单窗口控制支持 macOS 和 Windows');
  if (!windowsCaptureEnabled)
    throw new Error(
      'Windows Graphics Capture 已禁用，无法保证窗口控制坐标准确'
    );
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  if (
    platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('screen') !== 'granted'
  ) {
    throw new Error(`请为 ${appName} 开启屏幕录制权限并重启应用`);
  }
  const owners = await nativeWindows.request<NativeWindow[]>('list');
  return matchCaptureSources(
    sources,
    owners.filter((owner) => owner.ownerPid !== process.pid)
  );
}

const captureSession = new CaptureSession(
  {
    position: (point) => nutjs.mouse.setPosition(point),
    buttonDown: (button) =>
      nutjs.mouse.pressButton(
        button === 'left' ? nutjs.Button.LEFT : nutjs.Button.RIGHT
      ),
    buttonUp: (button) =>
      nutjs.mouse.releaseButton(
        button === 'left' ? nutjs.Button.LEFT : nutjs.Button.RIGHT
      ),
    click: (button, double) => {
      const value = button === 'left' ? nutjs.Button.LEFT : nutjs.Button.RIGHT;
      return double ? nutjs.mouse.doubleClick(value) : nutjs.mouse.click(value);
    },
    scroll: (direction, amount) => {
      if (direction === 'up') return nutjs.mouse.scrollUp(amount);
      if (direction === 'down') return nutjs.mouse.scrollDown(amount);
      if (direction === 'left') return nutjs.mouse.scrollLeft(amount);
      return nutjs.mouse.scrollRight(amount);
    },
    text: (value, source) =>
      platform === 'win32'
        ? nativeWindows.request('text', {
            nativeId: source.nativeId,
            ownerPid: source.ownerPid,
            bundleId: source.bundleId,
            text: value,
          })
        : nutjs.keyboard.type(value),
    keysDown: (keys) => nutjs.keyboard.pressKey(...keys),
    keysUp: (keys) => nutjs.keyboard.releaseKey(...keys),
    validKey: (key) =>
      typeof key === 'number' && Object.values(nutjs.Key).includes(key),
    canPasteImage: (source) => supportsImagePaste(source, platform),
    pasteImage: (image, source, current) => {
      const clipboardDriver = {
        decode: (bytes) => nativeImage.createFromBuffer(Buffer.from(bytes)),
        write: (value) => clipboard.writeImage(value),
        read: () => clipboard.readImage(),
      };
      if (platform === 'win32')
        return pasteWindowsClipboardImage(image, source, current, {
          ...clipboardDriver,
          request: (command, target, current) =>
            nativeWindows.request(command, target, current),
        });
      return pasteClipboardImage(image, current, {
        ...clipboardDriver,
        press: () => nutjs.keyboard.pressKey(nutjs.Key.LeftCmd, nutjs.Key.V),
        release: () =>
          nutjs.keyboard.releaseKey(nutjs.Key.V, nutjs.Key.LeftCmd),
      });
    },
  },
  listCaptureSources,
  async (source) => {
    if (
      platform === 'darwin' &&
      !systemPreferences.isTrustedAccessibilityClient(false)
    ) {
      throw new InputUnavailableError(`请为 ${appName} 开启辅助功能权限`);
    }
    try {
      const refreshed = await nativeWindows.request<NativeWindow>('focus', {
        nativeId: source.nativeId,
        ownerPid: source.ownerPid,
        bundleId: source.bundleId,
      });
      return { ...source, ...refreshed };
    } catch (error) {
      const inputErrors: Record<string, string> = {
        permission:
          platform === 'win32'
            ? 'Windows 不允许控制此窗口，请使用相同权限级别运行目标应用和 PalmDesk 后重试'
            : `原生窗口服务没有辅助功能权限，请在电脑上重新授权 ${appName} 并重启`,
        ambiguous:
          '无法识别选定窗口的辅助功能信息，请在电脑上打开该窗口后重试控制',
        focus: '无法聚焦选定窗口，请在电脑上将该窗口切到前台后重试控制',
      };
      if (error instanceof NativeWindowError && inputErrors[error.code])
        throw new InputUnavailableError(inputErrors[error.code]);
      throw error;
    }
  }
);

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void captureSession.end().finally(() => {
    nativeWindows.close();
    app.quit();
  });
});

// Keep every page on the bundled app: no new windows, no navigation
// elsewhere and no <webview>. Allowed links open in the system browser.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalLinkUrl(url);
    if (external) void shell.openExternal(external);
    return { action: 'deny' };
  });
  contents.on('will-frame-navigate', (event) => {
    // DevTools, available only in development, navigates its own frames.
    if (!isAppUrl(event.url) && !event.url.startsWith('devtools://'))
      event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.mjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,
    devTools: !app.isPackaged,
  };
}

function loadApp(win: BrowserWindow, route?: string) {
  if (process.env.VITE_DEV_SERVER_URL)
    return win.loadURL(
      route
        ? `${process.env.VITE_DEV_SERVER_URL}#/${route}`
        : process.env.VITE_DEV_SERVER_URL
    );
  return win.loadFile(
    path.join(process.env.DIST as string, 'index.html'),
    route ? { hash: route } : undefined
  );
}

const CHILD_WINDOWS: Record<
  ChildWindowKind,
  {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    useWorkAreaSize?: boolean;
    singleton?: boolean;
  }
> = {
  about: { width: 550, height: 380, singleton: true },
  webrtc: { minWidth: 300, minHeight: 300, useWorkAreaSize: true },
};

function createChildWindow(
  kind: ChildWindowKind,
  controllerSession?: ControllerSession
) {
  const spec = CHILD_WINDOWS[kind];
  const existing = spec.singleton
    ? [...childWindows].find(([, value]) => value === kind)?.[0]
    : undefined;
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }
  const workAreaSize = screen.getPrimaryDisplay().workAreaSize;
  const w = spec.useWorkAreaSize
    ? workAreaSize.width
    : spec.width || windowNormalParams.width;
  const h = spec.useWorkAreaSize
    ? workAreaSize.height
    : spec.height || windowNormalParams.height;
  const win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: spec.minWidth || w,
    minHeight: spec.minHeight || h,
    autoHideMenuBar: true,
    // 计算居中位置
    x: Math.round((workAreaSize.width - w) / 2),
    y: Math.round((workAreaSize.height - h) / 2),
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: secureWebPreferences(),
    frame: true,
  });
  childWindows.set(win, kind);
  if (controllerSession)
    controllerSessions.set(win.webContents, controllerSession);
  win.on('closed', () => {
    childWindows.delete(win);
  });
  loadApp(win, kind).catch((error) => {
    console.error('[PalmDesk] window failed to load', kind, error);
  });
}

function closeChildWindows() {
  childWindows.forEach((_kind, win) => {
    if (!win.isDestroyed()) win.close();
  });
  childWindows.clear();
}

function appWindows() {
  return [mainWindow, ...childWindows.keys()].filter(
    (win): win is BrowserWindow => !!win && !win.isDestroyed()
  );
}

function sendToWindow(
  win: BrowserWindow | undefined,
  channel: string,
  data: object = {}
) {
  if (win && !win.isDestroyed())
    win.webContents.send(channel, { channel, requestId: '', data, code: 0 });
}

type WindowScope = 'main' | 'any';

/**
 * The PalmDesk window behind an IPC message, if the message came from the
 * top-level app document of that window. `main` also requires the host
 * window, which owns capture, input and the local services.
 */
function senderWindow(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  scope: WindowScope
) {
  const frame = event.senderFrame;
  if (!frame || frame.parent || !isAppUrl(frame.url)) return undefined;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || (win !== mainWindow && !childWindows.has(win))) return undefined;
  return scope === 'any' || win === mainWindow ? win : undefined;
}

function handle(
  channel: string,
  scope: WindowScope,
  action: (data: any, win: BrowserWindow) => unknown
) {
  ipcMain.handle(channel, async (event, request: IIpcRendererData) => {
    try {
      const win = senderWindow(event, scope);
      if (!win) throw new Error('无权访问本机功能');
      return {
        code: 0,
        requestId: request?.requestId,
        data: (await action(request?.data || {}, win)) ?? {},
      };
    } catch (error) {
      return {
        code: 1,
        requestId: request?.requestId,
        data: {},
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function listen(
  channel: string,
  scope: WindowScope,
  action: (data: any, win: BrowserWindow) => void
) {
  ipcMain.on(channel, (event, request: IIpcRendererData) => {
    const win = senderWindow(event, scope);
    if (win) action(request?.data || {}, win);
  });
}

function permissionRequest(
  contents: Electron.WebContents | null,
  requestingUrl: string | undefined
) {
  const win = contents ? BrowserWindow.fromWebContents(contents) : null;
  return {
    trusted:
      !!win &&
      (win === mainWindow || childWindows.has(win)) &&
      !!requestingUrl &&
      isAppUrl(requestingUrl),
    mainWindow: !!win && win === mainWindow,
  };
}

function installPermissionHandlers() {
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      callback(
        isPermissionAllowed(permission, {
          ...permissionRequest(contents, details.requestingUrl),
          mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
        })
      );
    }
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _requestingOrigin, details) =>
      isPermissionAllowed(permission, {
        ...permissionRequest(contents, details.requestingUrl),
        mediaTypes:
          details.mediaType && details.mediaType !== 'unknown'
            ? [details.mediaType]
            : undefined,
      })
  );
}

function main() {
  const win = new BrowserWindow({
    width: windowNormalParams.width,
    height: windowNormalParams.height,
    minWidth: 800,
    minHeight: 560,
    // 隐藏菜单栏
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
    frame: false,
  });
  mainWindow = win;
  void loadApp(win);

  // Notify about new releases; never download or install anything.
  const releaseChecker = new ReleaseChecker({
    directory: app.getPath('userData'),
    current: app.getVersion(),
    fetchReleases: async () => {
      const response = await net.fetch(RELEASES_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `PalmDesk/${app.getVersion()}`,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
      return response.json();
    },
    onChange: (status) =>
      sendToWindow(mainWindow, IPC_EVENT.response_releaseStatus, status),
  });
  releaseChecker.start();

  win.webContents.on('render-process-gone', () => {
    void captureSession.end();
  });
  win.webContents.on(
    'did-start-navigation',
    (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) void captureSession.end();
    }
  );
  win.on('close', () => {
    void captureSession.end();
    closeChildWindows();
  });
  win.on('closed', () => {
    void captureSession.end();
    closeChildWindows();
    mainWindow = undefined;
    releaseChecker.stop();
  });

  // 创建菜单
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: `关于${appName}`,
          click: () => {
            sendToWindow(mainWindow, IPC_EVENT.response_open_about);
          },
        },
        { type: 'separator' }, // 分隔线
        {
          label: '检查更新',
          click: () => {
            void releaseChecker.check(true);
          },
        },

        { type: 'separator' }, // 分隔线
        {
          label: '重新启动',
          role: 'forceReload',
        },
        { role: 'quit', label: `退出${appName}` },
      ],
    },
    {
      label: '编辑',
      role: 'editMenu',
      submenu: [
        {
          label: '撤销',
          role: 'undo',
        },
        {
          label: '恢复',
          role: 'redo',
        },
        { type: 'separator' }, // 分隔线
        {
          label: '剪切',
          role: 'cut',
        },
        {
          label: '复制',
          role: 'copy',
        },
        {
          label: '粘贴',
          role: 'paste',
        },
        {
          label: '全选',
          role: 'selectAll',
        },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);

  winBounds = win.getBounds();

  handle(IPC_EVENT.getPlatform, 'any', () => ({ platform }));

  handle(IPC_EVENT.releaseStatus, 'main', () => releaseChecker.settings());
  handle(IPC_EVENT.releaseCheck, 'main', () => releaseChecker.check(true));
  handle(IPC_EVENT.releaseConfigure, 'main', (data) =>
    releaseChecker.configure(data.enabled)
  );

  handle(IPC_EVENT.shellOpenExternal, 'any', async (data) => {
    // Never hand renderer-chosen schemes, files or hosts to the OS.
    const url = externalLinkUrl(data.url);
    if (!url) throw new Error('不支持打开此链接');
    await shell.openExternal(url);
  });

  listen(IPC_EVENT.closeAllWindow, 'main', (_data, sender) => sender.close());
  listen(IPC_EVENT.closeWindow, 'any', (_data, sender) => sender.close());
  listen(IPC_EVENT.windowMinimize, 'any', (_data, sender) => sender.minimize());
  listen(IPC_EVENT.handleOpenDevTools, 'any', (_data, sender) => {
    if (!app.isPackaged)
      sender.webContents.openDevTools({ mode: 'detach', activate: true });
  });

  handle(IPC_EVENT.setWindowPosition, 'main', (data, sender) => {
    const x = Math.round(Number(data.x));
    const y = Math.round(Number(data.y));
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('窗口位置无效');
    if (winBounds) {
      // electron无边框窗口在Windows下拖拽导致窗口放大（Windows系统缩放不为100%时）
      // https://github.com/electron/electron/issues/20320
      // https://github.com/electron/electron/issues/10862
      sender.setBounds(winBounds);
    }
    sender.setPosition(x, y);
  });

  const captureHandler = (
    channel: string,
    action: (data: any) => Promise<any>
  ) => {
    ipcMain.handle(channel, async (event, request: IIpcRendererData) => {
      try {
        if (!senderWindow(event, 'main'))
          throw new Error('无权访问本机捕获会话');
        return {
          code: 0,
          requestId: request?.requestId,
          data: await action(request?.data || {}),
        };
      } catch (error) {
        console.warn('[PalmDesk] capture request failed', {
          channel,
          action: request?.data?.input?.action,
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          code: 1,
          requestId: request?.requestId,
          data: { inputBlocked: error instanceof InputUnavailableError },
          msg: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };
  captureHandler(IPC_EVENT.getCaptureSources, async (data) => {
    const result = await captureSession.refresh();
    if (!result.sessionId && data.previews !== false)
      result.sources = await nativeWindows.addThumbnails(result.sources);
    return result;
  });
  captureHandler(IPC_EVENT.getAgentApplications, async () => ({
    agents: discoverAgents(
      await nativeWindows.request<NativeApplication[]>('applications')
    ),
  }));
  const agentLauncher = new AgentLauncher(nativeWindows);
  captureHandler(IPC_EVENT.getInstalledAgents, () => agentLauncher.list());
  captureHandler(IPC_EVENT.launchAgent, (data) =>
    agentLauncher.launch(data.id, data.operationId)
  );
  captureHandler(IPC_EVENT.cancelAgentLaunch, (data) => {
    agentLauncher.cancel(data.operationId);
    return Promise.resolve({});
  });
  const sessionReader = new DesktopSessionReader(app.getPath('userData'));
  captureHandler(IPC_EVENT.sessionReaderSettings, () =>
    sessionReader.settings()
  );
  captureHandler(IPC_EVENT.sessionReaderConfigure, (data) =>
    sessionReader.configure(data.enabled)
  );
  captureHandler(IPC_EVENT.sessionReaderRequest, (data) =>
    sessionReader.request(data)
  );
  captureHandler(IPC_EVENT.beginCapture, (data) =>
    captureSession.begin(String(data.sourceId || ''), data.expectedSource)
  );
  captureHandler(IPC_EVENT.stopCapture, (data) =>
    captureSession.end(data.sessionId)
  );
  captureHandler(IPC_EVENT.remoteInput, (data) =>
    captureSession.input(data.sessionId, data.input)
  );
  captureHandler(IPC_EVENT.pasteImage, (data) =>
    captureSession.pasteImage(data.sessionId, data.id, data.image)
  );
  captureHandler(IPC_EVENT.cancelImagePaste, (data) =>
    Promise.resolve(captureSession.cancelImagePaste(data.sessionId, data.id))
  );
  captureHandler(IPC_EVENT.capturePermissions, async () => {
    const nativePermissions =
      platform === 'darwin' || platform === 'win32'
        ? await nativeWindows.request<{
            accessibility: boolean;
            captureSupported?: boolean;
          }>('permissions')
        : { accessibility: false, captureSupported: false };
    const diagnostics =
      platform === 'darwin' || platform === 'win32'
        ? await nativeWindows.request<{ applications: { bundleId: string }[] }>(
            'diagnostics'
          )
        : { applications: [] };
    const defaultScreenStatus =
      platform === 'win32' &&
      nativePermissions.captureSupported &&
      windowsCaptureEnabled
        ? 'granted'
        : 'unsupported';
    return {
      screen:
        platform === 'darwin'
          ? systemPreferences.getMediaAccessStatus('screen')
          : defaultScreenStatus,
      accessibility:
        nativePermissions.accessibility &&
        (platform === 'win32' ||
          (platform === 'darwin' &&
            systemPreferences.isTrustedAccessibilityClient(false))),
      platform,
      appName: app.getName(),
      packaged: app.isPackaged,
      targetApps: diagnostics.applications.map(
        (application) => application.bundleId
      ),
    };
  });
  captureHandler(IPC_EVENT.openCapturePermission, async (data) => {
    if (platform !== 'darwin') throw new Error('当前平台不支持此权限设置');
    if (data.kind === 'accessibility') {
      systemPreferences.isTrustedAccessibilityClient(true);
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      );
    } else if (data.kind === 'screen') {
      await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 0, height: 0 },
      });
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
      );
    }
  });

  listen(IPC_EVENT.setAlwaysOnTop, 'main', (data, sender) =>
    sender.setAlwaysOnTop(data.flag === true)
  );

  handle(IPC_EVENT.scaleFactor, 'main', () => ({
    scaleFactor: screen.getPrimaryDisplay().scaleFactor,
    platform,
  }));

  listen(IPC_EVENT.workAreaSize, 'main', (_data, sender) => {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    sendToWindow(sender, IPC_EVENT.response_workAreaSize, { width, height });
  });

  handle(IPC_EVENT.getPrimaryDisplaySize, 'main', () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    return { width, height };
  });

  // The renderer names a window kind; size, route and identity stay here.
  handle(IPC_EVENT.createWindow, 'main', (data) => {
    if (data.kind === 'about') return createChildWindow('about');
    if (data.kind === 'webrtc')
      return createChildWindow('webrtc', parseControllerSession(data.session));
    throw new Error('不支持打开此窗口');
  });

  handle(IPC_EVENT.takeWindowSession, 'any', (_data, sender) => {
    const controllerSession = controllerSessions.get(sender.webContents);
    controllerSessions.delete(sender.webContents);
    return controllerSession || {};
  });
}

app.on('ready', async () => {
  try {
    if (platform === 'darwin') {
      const identity =
        await nativeWindows.request<ApplicationIdentity>('appIdentity');
      assertUniqueApplicationIdentity(
        identity,
        process.execPath,
        app.isPackaged
      );
      console.log('Desktop permission identity:', identity);
    }
  } catch (error) {
    nativeWindows.close();
    dialog.showErrorBox(
      'PalmDesk 应用身份冲突',
      error instanceof Error ? error.message : String(error)
    );
    app.exit(1);
    return;
  }
  // Validate before the singleton handoff and before native modules can request access.
  if (!app.requestSingleInstanceLock()) {
    nativeWindows.close();
    app.quit();
    return;
  }
  // eslint-disable-next-line global-require -- Keep native bindings external and initialize only after identity validation.
  nutjs = require('@nut-tree-fork/nut-js');
  // Remote pointer events already arrive at the user's gesture cadence.
  nutjs.mouse.config.autoDelayMs = 0;
  installPermissionHandlers();
  powerMonitor.on('suspend', () => {
    appWindows().forEach((win) => {
      sendToWindow(win, IPC_EVENT.response_powerMonitorSuspend);
    });
  });
  powerMonitor.on('resume', () => {
    appWindows().forEach((win) => {
      sendToWindow(win, IPC_EVENT.response_powerMonitorResume);
    });
  });
  main();
});

app.on('window-all-closed', () => {
  app.quit();
  childWindows.clear();
});

// app.whenReady().then(main);
