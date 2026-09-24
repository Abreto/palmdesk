import { identifyAgent } from '../src/utils/agent-registry';
import { validateImage } from '../src/utils/image-payload';

import { InputUnavailableError } from './capture-session';
import { NativeWindowError } from './native-window';

import type { NativeWindowBridge } from './native-window';
import type { ICaptureSource } from '../src/pure-interface';
import type { ImagePayload } from '../src/utils/image-payload';

export function supportsImagePaste(source: ICaptureSource, platform: string) {
  if (platform === 'darwin') return source.bundleId === 'com.openai.codex';
  return (
    platform === 'win32' &&
    source.bundleId.startsWith('win32:') &&
    identifyAgent(source.bundleId)?.id === 'codex'
  );
}

type ClipboardDriver = {
  decode: (bytes: Uint8Array) => Electron.NativeImage;
  write: (image: Electron.NativeImage) => void;
};

export async function pasteClipboardImage(
  payload: ImagePayload,
  current: () => boolean,
  driver: ClipboardDriver & {
    verify?: () => Promise<unknown>;
    press: () => Promise<unknown>;
    release: () => Promise<unknown>;
  }
) {
  const info = validateImage(payload);
  const image = driver.decode(payload.bytes);
  const size = image.getSize();
  if (image.isEmpty() || size.width * size.height !== info.width * info.height)
    throw new Error('无法解码图片，请重新选择');
  if (!current()) throw new Error('图片粘贴已取消');
  await driver.verify?.();
  if (!current()) throw new Error('图片粘贴已取消');
  // Leave the image in the clipboard, as a normal copy/paste would. Restoring
  // immediately can race Codex's asynchronous reading of the pasteboard.
  try {
    driver.write(image);
  } catch {
    throw new Error('无法写入电脑剪贴板，请关闭占用剪贴板的应用后手动重试');
  }
  try {
    if (!current()) throw new Error('图片粘贴已取消');
    await driver.press();
  } finally {
    await driver.release();
  }
}

export async function pasteWindowsClipboardImage(
  payload: ImagePayload,
  source: ICaptureSource,
  current: () => boolean,
  driver: ClipboardDriver & Pick<NativeWindowBridge, 'request'>
) {
  if (!supportsImagePaste(source, 'win32'))
    throw new Error('图片粘贴仅支持已验证的 Windows Codex 窗口');
  const target = {
    nativeId: source.nativeId,
    ownerPid: source.ownerPid,
    bundleId: source.bundleId,
  };
  let shortcutRequested = false;
  try {
    await pasteClipboardImage(payload, current, {
      ...driver,
      // These commands never activate a window. A focus change after the
      // session's initial focus check must stop this paste, not steal it back.
      verify: () => driver.request('verifyImagePaste', target, current),
      press: () => {
        shortcutRequested = true;
        return driver.request('pasteImage', target, current);
      },
      // The native helper sends and releases Ctrl+V in one SendInput batch,
      // including key-up cleanup if Windows accepts only part of the batch.
      release: async () => {},
    });
  } catch (error) {
    if (error instanceof NativeWindowError) {
      const blocked: Record<string, string> = {
        permission:
          'Windows 不允许控制此窗口，请使用相同权限级别运行 Codex 和 PalmDesk 后重试',
        focus:
          'Codex 窗口不在前台或被对话框阻挡，请在电脑上切回目标窗口后重试控制',
        input_busy: '电脑上仍有输入按下，请释放所有按键和鼠标按钮后手动重试',
      };
      if (blocked[error.code])
        throw new InputUnavailableError(blocked[error.code]);
      if (error.code === 'cancelled') throw new Error('图片粘贴已取消');
      if (error.code === 'gone')
        throw new Error('目标窗口已关闭或身份已变化，请重新连接');
      if (error.code === 'invalid')
        throw new Error('目标不是已验证的 Windows Codex 窗口，请刷新窗口列表');
    }
    if (shortcutRequested)
      throw new Error(
        '粘贴结果未确认，请先查看 Codex 输入框中的附件，避免重复粘贴'
      );
    throw error;
  }
}
