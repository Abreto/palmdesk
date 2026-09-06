import path from 'path';
import { platform } from 'process';

import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  Menu,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell,
  systemPreferences,
} from 'electron';

import { IPC_EVENT } from '../src/event';
import { WINDOW_ID_ENUM } from '../src/pure-constant';

import { CaptureSession } from './capture-session';
import { NativeWindowBridge, matchCaptureSources } from './native-window';

import type { NativeWindow } from './native-window';
import type { nutjsTs } from './types';
import type { ICaptureSource, IIpcRendererData } from '../src/pure-interface';

const nutjs: nutjsTs = require('@nut-tree-fork/nut-js');

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

// https://www.electronjs.org/zh/docs/latest/tutorial/security#%E9%9A%94%E7%A6%BB%E4%B8%8D%E5%8F%97%E4%BF%A1%E4%BB%BB%E7%9A%84%E5%86%85%E5%AE%B9
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

process.env.DIST = path.join(__dirname, '../dist');
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public');

app.setName('PalmDesk');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const windowNormalParams = { width: 960, height: 720 };
let winBounds: Electron.Rectangle | null;
const mainWindowId = WINDOW_ID_ENUM.remote;
const windowMap = new Map<number, BrowserWindow>();
const appName = app.getName();
const nativeWindows = new NativeWindowBridge(
  path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    'native-bin',
    'codex-window'
  )
);

async function listCaptureSources(): Promise<ICaptureSource[]> {
  if (platform !== 'darwin') throw new Error('当前单窗口控制支持 macOS');
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    throw new Error('请为 PalmDesk 开启屏幕录制权限并重启应用');
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
    text: (value) => nutjs.keyboard.type(value),
    keysDown: (keys) => nutjs.keyboard.pressKey(...keys),
    keysUp: (keys) => nutjs.keyboard.releaseKey(...keys),
    validKey: (key) =>
      typeof key === 'number' && Object.values(nutjs.Key).includes(key),
  },
  listCaptureSources,
  async (source) => {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      throw new Error('请为 PalmDesk 开启辅助功能权限');
    }
    const refreshed = await nativeWindows.request<NativeWindow>('focus', {
      nativeId: source.nativeId,
      ownerPid: source.ownerPid,
      bundleId: source.bundleId,
    });
    return { ...source, ...refreshed };
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

async function createWindow({
  windowId,
  width,
  height,
  minWidth,
  minHeight,
  route,
  query,
  x,
  y,
  useWorkAreaSize,
  frame,
}) {
  let w = width || windowNormalParams.width;
  let h = height || windowNormalParams.height;
  const workAreaSize = screen.getPrimaryDisplay().workAreaSize;

  if (useWorkAreaSize) {
    w = workAreaSize.width;
    h = workAreaSize.height;
  }
  let xx = x;
  let yy = y;
  if (x === undefined && y === undefined) {
    // 计算居中位置
    xx = Math.round((workAreaSize.width - w) / 2);
    yy = Math.round((workAreaSize.height - h) / 2);
  }
  const win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: minWidth || w,
    minHeight: minHeight || h,
    autoHideMenuBar: true,
    x: xx,
    y: yy,
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      devTools: true,
      // nodeIntegration: true, // 在网页中集成Node
      preload: path.join(__dirname, 'preload.mjs'),
    },
    frame,
  });

  windowMap.set(windowId, win);
  let url = '';
  const params = `${(route ? route : '') as string}${handleUrlQuery({
    windowId: `${windowId as number}`,
    ...query,
  })}`;
  if (process.env.VITE_DEV_SERVER_URL) {
    url = `${process.env.VITE_DEV_SERVER_URL as string}#/${params}`;
    await win.loadURL(url);
  } else {
    url = `${path.join(process.env.DIST as string, 'index.html')}#/${params}`;
    await win.loadFile(
      `${path.join(process.env.DIST as string, 'index.html')}`,
      {
        hash: route
          ? `${route as string}${handleUrlQuery({
              windowId: `${windowId as number}`,
              ...query,
            })}`
          : undefined,
      }
    );
  }
  win.on('close', () => {
    console.log('close', windowId);
    winWebContentsSend({
      windowId,
      channel: IPC_EVENT.response_closeWindow,
      requestId: '',
      data: { windowId },
      code: 0,
    });
  });
  win.on('closed', () => {
    console.log('closed', windowId);
    win.removeAllListeners();
    windowMap.delete(windowId);
    winWebContentsSend({
      windowId,
      channel: IPC_EVENT.response_closeWindowed,
      requestId: '',
      data: { windowId },
      code: 0,
    });
  });
}

function winWebContentsSend(data: IIpcRendererData) {
  const win = windowMap.get(data.windowId);
  if (win && !win?.isDestroyed()) {
    win.webContents.send(data.channel, data);
  }
}

function handleUrlQuery(obj: Record<string, string>) {
  const query = new URLSearchParams(obj).toString();
  return query ? `?${query}` : '';
}

function main() {
  const mainWindow = new BrowserWindow({
    width: windowNormalParams.width,
    height: windowNormalParams.height,
    minWidth: 800,
    minHeight: 560,
    // 隐藏菜单栏
    autoHideMenuBar: true,
    webPreferences: {
      // devTools: true,
      // nodeIntegration: true, // 在网页中集成Node
      preload: path.join(__dirname, 'preload.mjs'),
    },
    frame: false,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL as string);
  } else {
    mainWindow.loadFile(path.join(process.env.DIST as string, 'index.html'));
  }

  windowMap.set(mainWindowId, mainWindow);

  mainWindow.webContents.on('render-process-gone', () => {
    void captureSession.end();
  });
  mainWindow.webContents.on(
    'did-start-navigation',
    (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) void captureSession.end();
    }
  );
  mainWindow.on('close', () => {
    void captureSession.end();
    console.log('mainWindow-close');
    windowMap.forEach((item) => {
      if (!item?.isDestroyed()) {
        item.removeAllListeners();
        item.close();
      }
    });
    windowMap.clear();
  });
  mainWindow.on('closed', () => {
    void captureSession.end();
    console.log('mainWindow-closed');
    windowMap.forEach((item) => {
      if (!item?.isDestroyed()) {
        item.removeAllListeners();
        item.close();
      }
    });
    windowMap.clear();
  });

  // 创建菜单
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: `关于${appName}`,
          click: () => {
            winWebContentsSend({
              windowId: mainWindowId,
              channel: IPC_EVENT.response_open_about,
              requestId: '',
              data: {},
              code: 0,
            });
          },
        },
        { type: 'separator' }, // 分隔线
        {
          label: '检查更新',
          click: () => {
            winWebContentsSend({
              windowId: mainWindowId,
              channel: IPC_EVENT.response_open_version,
              requestId: '',
              data: {},
              code: 0,
            });
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

  winBounds = mainWindow.getBounds();

  ipcMain.handle(IPC_EVENT.getPlatform, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.getPlatform}`, reqData);
    const { requestId } = reqData;
    const res = {
      requestId,
      data: { platform },
      code: 0,
    };

    return res;
  });

  ipcMain.handle(
    IPC_EVENT.shellOpenExternal,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.shellOpenExternal}`, reqData);
      const { requestId, data } = reqData;
      const { url } = data;
      const res = {
        requestId,
        data: {},
        code: 0,
      };
      try {
        await shell.openExternal(url);
      } catch (error) {
        console.log(error);
        res.code = 1;
      }
      return res;
    }
  );

  ipcMain.on(
    IPC_EVENT.powerSaveBlockerStart,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.powerSaveBlockerStart}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      try {
        powerSaveBlocker.start('prevent-display-sleep');
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_powerSaveBlockerStart,
          requestId,
          data: {},
          code: 0,
        });
      } catch (error) {
        console.log('powerSaveBlockerStart失败');
        console.log(error);
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_powerSaveBlockerStart,
          requestId,
          data,
          code: 1,
          msg: JSON.stringify(error),
        });
      }
    }
  );

  ipcMain.on(IPC_EVENT.closeAllWindow, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.closeAllWindow}`, reqData);
    windowMap.forEach((item) => {
      if (!item?.isDestroyed()) {
        item.removeAllListeners();
        item.close();
      }
    });
    windowMap.clear();
  });

  ipcMain.on(IPC_EVENT.closeWindow, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.closeWindow}`, reqData);
    const { data } = reqData;
    const { windowId } = data;
    const win = windowMap.get(windowId);
    win?.close();
  });

  ipcMain.on(IPC_EVENT.windowMinimize, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.windowMinimize}`, reqData);
    const { data } = reqData;
    const { windowId } = data;
    const win = windowMap.get(windowId);
    win?.minimize();
  });

  ipcMain.on(IPC_EVENT.windowMaximize, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.windowMaximize}`, reqData);
    const { data } = reqData;
    const { windowId } = data;
    const win = windowMap.get(windowId);
    win?.maximize();
  });

  ipcMain.on(
    IPC_EVENT.handleOpenDevTools,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.handleOpenDevTools}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(Number(windowId || 1));
      win?.webContents.openDevTools({
        mode: 'detach',
        activate: true,
      });
      winWebContentsSend({
        windowId,
        channel: IPC_EVENT.response_handleOpenDevTools,
        requestId,
        data,
        code: 0,
      });
    }
  );

  ipcMain.on(
    IPC_EVENT.handleMoveScreenRightBottom,
    (_event, reqData: IIpcRendererData) => {
      console.log(
        `electron收到${IPC_EVENT.handleMoveScreenRightBottom}`,
        reqData
      );
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(windowId);
      if (win) {
        const { width, height, y } = screen.getPrimaryDisplay().workArea;
        // 窗口的高度和宽度
        const bounds = win.getBounds();
        const windowWidth = bounds.width;
        const windowHeight = bounds.height;
        // const [windowWidth, windowHeight] = win?.getContentSize() ;
        // 计算新位置
        const newX = width - windowWidth; // 屏幕左下角的 X 坐标是 0
        const newY = height - windowHeight; // 需要减去窗口本身的高度
        // 移动窗口
        win.setPosition(newX, newY + y);
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_handleMoveScreenRightBottom,
          requestId,
          data: {},
          code: 0,
        });
      }
    }
  );

  ipcMain.on(IPC_EVENT.setWindowBounds, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.setWindowBounds}`, reqData);
    const { requestId, data } = reqData;
    const { windowId, width, height } = data;
    const win = windowMap.get(windowId);
    if (win) {
      if (!win?.isDestroyed()) {
        win.setBounds({ width, height });
      }
      winWebContentsSend({
        windowId,
        channel: IPC_EVENT.response_setWindowBounds,
        requestId,
        data,
        code: 0,
      });
    }
  });

  ipcMain.handle(
    IPC_EVENT.getWindowTitlebarHeight,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.getWindowTitlebarHeight}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(Number(windowId));
      const res = {
        windowId,
        requestId,
        data: { height: 0 },
        code: 0,
      };
      if (win) {
        const contentBounds = win.getContentBounds();
        const windowBounds = win.getBounds();
        const borderWidth = (windowBounds.width - contentBounds.width) / 2;
        res.data.height =
          windowBounds.height - contentBounds.height - borderWidth;
      } else {
        res.code = 1;
      }
      return res;
    }
  );

  ipcMain.handle(
    IPC_EVENT.setWindowPosition,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.setWindowPosition}`, reqData);
      const { requestId, data } = reqData;
      const { x, y, windowId } = data;
      const win = windowMap.get(windowId);
      const res = {
        windowId,
        requestId,
        data: {},
        code: 0,
      };
      if (win) {
        if (winBounds) {
          // electron无边框窗口在Windows下拖拽导致窗口放大（Windows系统缩放不为100%时）
          // https://github.com/electron/electron/issues/20320
          // https://github.com/electron/electron/issues/10862
          if (!win?.isDestroyed()) {
            win.setBounds(winBounds);
          }
        }
        win?.setPosition(x, y);
      } else {
        res.code = 1;
      }
      return res;
    }
  );

  ipcMain.on(
    IPC_EVENT.setWindowPosition,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.setWindowPosition}`, reqData);
      const { requestId, data } = reqData;
      const { x, y, windowId } = data;
      const win = windowMap.get(Number(windowId));
      if (win) {
        if (winBounds) {
          // electron无边框窗口在Windows下拖拽导致窗口放大（Windows系统缩放不为100%时）
          // https://github.com/electron/electron/issues/20320
          // https://github.com/electron/electron/issues/10862
          if (!win?.isDestroyed()) {
            win.setBounds(winBounds);
          }
        }
        win?.setPosition(x, y);
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_setWindowPosition,
          requestId,
          data: {},
          code: 0,
        });
      }
    }
  );

  ipcMain.on(
    IPC_EVENT.getWindowPosition,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.getWindowPosition}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(Number(windowId));
      if (win) {
        const point = win.getPosition();
        winWebContentsSend({
          windowId,
          channel: IPC_EVENT.response_getWindowPosition,
          requestId,
          data: { position: { x: point[0], y: point[1] } },
          code: 0,
        });
      }
    }
  );

  const captureHandler = (
    channel: string,
    action: (data: any) => Promise<any>
  ) => {
    ipcMain.handle(channel, async (event, request: IIpcRendererData) => {
      try {
        if (windowMap.get(mainWindowId)?.webContents !== event.sender)
          throw new Error('无权访问本机捕获会话');
        return {
          code: 0,
          requestId: request.requestId,
          data: await action(request.data || {}),
        };
      } catch (error) {
        return {
          code: 1,
          requestId: request.requestId,
          data: {},
          msg: error instanceof Error ? error.message : String(error),
        };
      }
    });
  };
  captureHandler(IPC_EVENT.getCaptureSources, () => captureSession.refresh());
  captureHandler(IPC_EVENT.beginCapture, (data) =>
    captureSession.begin(String(data.sourceId || ''), data.expectedSource)
  );
  captureHandler(IPC_EVENT.stopCapture, (data) =>
    captureSession.end(data.sessionId)
  );
  captureHandler(IPC_EVENT.remoteInput, (data) =>
    captureSession.input(data.sessionId, data.input)
  );
  captureHandler(IPC_EVENT.capturePermissions, async () => {
    const diagnostics =
      platform === 'darwin'
        ? await nativeWindows.request<{ applications: { bundleId: string }[] }>(
            'diagnostics'
          )
        : { applications: [] };
    return {
      screen:
        platform === 'darwin'
          ? systemPreferences.getMediaAccessStatus('screen')
          : 'unsupported',
      accessibility:
        platform === 'darwin' &&
        systemPreferences.isTrustedAccessibilityClient(false),
      appName: app.getName(),
      packaged: app.isPackaged,
      targetApps: diagnostics.applications.map(
        (application) => application.bundleId
      ),
    };
  });
  captureHandler(IPC_EVENT.showTargetApplication, (data) =>
    nativeWindows.request('reveal', { bundleId: data.bundleId })
  );
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

  ipcMain.on(IPC_EVENT.setAlwaysOnTop, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.setAlwaysOnTop}`, reqData);
    const { requestId, data } = reqData;
    const { flag } = data;
    const { windowId } = data;
    const win = windowMap.get(Number(windowId));
    if (win) {
      win.setAlwaysOnTop(flag);
      winWebContentsSend({
        windowId,
        channel: IPC_EVENT.response_setAlwaysOnTop,
        requestId,
        data,
        code: 0,
      });
    }
  });

  ipcMain.handle(IPC_EVENT.scaleFactor, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.scaleFactor}`, reqData);
    const { requestId, data } = reqData;
    const { windowId } = data;
    const win = windowMap.get(Number(windowId));
    const res = {
      windowId,
      requestId,
      data: { scaleFactor: 0, platform: '' },
      code: 0,
    };
    if (win) {
      const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
      res.data.scaleFactor = scaleFactor;
      res.data.platform = platform;
    } else {
      res.code = 1;
    }
    return res;
  });

  ipcMain.on(IPC_EVENT.workAreaSize, (_event, reqData: IIpcRendererData) => {
    console.log(`electron收到${IPC_EVENT.workAreaSize}`, reqData);
    const { requestId, data } = reqData;
    const { windowId } = data;
    const win = windowMap.get(Number(windowId));
    if (win) {
      const { width, height } = screen.getPrimaryDisplay().workAreaSize;
      winWebContentsSend({
        windowId,
        channel: IPC_EVENT.response_workAreaSize,
        requestId,
        data: { width, height },
        code: 0,
      });
    }
  });

  ipcMain.handle(
    IPC_EVENT.getPrimaryDisplaySize,
    (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.getPrimaryDisplaySize}`, reqData);
      const { requestId, data } = reqData;
      const { windowId } = data;
      const win = windowMap.get(Number(windowId));
      const res = {
        windowId,
        requestId,
        data: { width: 0, height: 0 },
        code: 0,
      };
      if (win) {
        const { width, height } = screen.getPrimaryDisplay().size;
        res.data.width = width;
        res.data.height = height;
      } else {
        res.code = 1;
      }
      return res;
    }
  );

  ipcMain.on(
    IPC_EVENT.createWindow,
    async (_event, reqData: IIpcRendererData) => {
      console.log(`electron收到${IPC_EVENT.createWindow}`, reqData);
      const { data } = reqData;
      const {
        windowId,
        width,
        height,
        minWidth,
        minHeight,
        route,
        query,
        x,
        y,
        useWorkAreaSize,
        frame,
      } = data;
      try {
        await createWindow({
          windowId,
          width,
          height,
          minWidth,
          minHeight,
          route,
          query,
          x,
          y,
          useWorkAreaSize,
          frame,
        });
        console.log('createWindow成功');
      } catch (error) {
        console.log('createWindow失败');
        console.log(error);
      }
    }
  );
}

app.on('ready', () => {
  powerMonitor.on('suspend', () => {
    windowMap.forEach((item) => {
      const windowId = item.id;
      winWebContentsSend({
        windowId,
        channel: IPC_EVENT.response_powerMonitorSuspend,
        requestId: '',
        data: { windowId: item.id },
        code: 0,
      });
    });
  });
  powerMonitor.on('resume', () => {
    windowMap.forEach((item) => {
      const windowId = item.id;
      winWebContentsSend({
        windowId,
        channel: IPC_EVENT.response_powerMonitorResume,
        requestId: '',
        data: { windowId: item.id },
        code: 0,
      });
    });
  });
  main();
});

app.on('window-all-closed', () => {
  app.quit();
  windowMap.clear();
});

// app.whenReady().then(main);
