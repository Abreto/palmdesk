import { MAX_IMAGE_BYTES, validateImage } from './image-payload';

import type { ImagePayload } from './image-payload';

const CHUNK_BYTES = 16 * 1024;
const BUFFER_BYTES = 64 * 1024;
const TIMEOUT_MS = 120000;
let sequence = 0;

function parse(value: unknown) {
  if (typeof value !== 'string' || value.length > 1024) return;
  try {
    const frame = JSON.parse(value);
    if (frame && typeof frame === 'object') return frame;
  } catch {
    /* Ignore malformed control messages. */
  }
}

type Pending = {
  id: number;
  sessionId: string;
  image: ImagePayload;
  phase: 'waiting' | 'sending' | 'uploaded' | 'pasting';
  resolve: () => void;
  reject: (error: Error) => void;
  progress: (percent: number) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class ImageTransferClient {
  private pending?: Pending;
  private closed = false;

  constructor(
    private channel: RTCDataChannel,
    private commit: (sessionId: string, id: number) => void,
    private timeout = TIMEOUT_MS
  ) {
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', this.receive);
    channel.addEventListener('close', this.dispose);
    channel.addEventListener('error', this.dispose);
  }

  async paste(
    image: ImagePayload,
    sessionId: string,
    progress: (percent: number) => void
  ) {
    validateImage(image);
    if (this.closed || this.channel.readyState !== 'open')
      throw new Error('图片通道尚未连接，请稍后重试');
    if (this.pending) throw new Error('已有图片正在传输');
    if (!sessionId) throw new Error('请先选择 Codex 窗口');
    sequence += 1;
    const id = sequence;
    await new Promise<void>((resolve, reject) => {
      this.pending = {
        id,
        sessionId,
        image,
        resolve,
        reject,
        progress,
        phase: 'waiting',
        timer: setTimeout(() => this.cancel('图片传输超时'), this.timeout),
      };
      try {
        this.channel.send(
          JSON.stringify({
            type: 'start',
            id,
            sessionId,
            size: image.bytes.length,
            mime: image.mime,
          })
        );
      } catch {
        this.fail('图片通道已断开');
      }
    });
  }

  private receive = (event: MessageEvent) => {
    const frame = parse(event.data);
    const pending = this.pending;
    if (!pending || frame?.id !== pending.id) return;
    if (frame.type === 'error') {
      this.fail(
        typeof frame.message === 'string'
          ? frame.message.slice(0, 240)
          : '图片粘贴失败'
      );
    } else if (frame.type === 'ready' && pending.phase === 'waiting') {
      pending.phase = 'sending';
      void this.sendImage(pending);
    } else if (frame.type === 'uploaded' && pending.phase === 'uploaded') {
      // Commit on the ordinary input channel so earlier clicks reach the
      // desktop input queue before the paste, even if the image arrived first.
      pending.phase = 'pasting';
      try {
        this.commit(pending.sessionId, pending.id);
      } catch {
        this.cancel('无法提交图片粘贴，请检查窗口连接');
      }
    } else if (frame.type === 'done' && pending.phase === 'pasting') {
      clearTimeout(pending.timer);
      this.pending = undefined;
      pending.progress(100);
      pending.resolve();
    }
  };

  private async sendImage(pending: Pending) {
    try {
      const bytes = pending.image.bytes;
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        while (this.channel.bufferedAmount > BUFFER_BYTES) {
          if (this.pending !== pending) return;
          if (this.channel.readyState !== 'open')
            throw new Error('图片通道已断开');
          await new Promise((resolve) => setTimeout(resolve, 15));
        }
        if (this.pending !== pending) return;
        this.channel.send(bytes.slice(offset, offset + CHUNK_BYTES).buffer);
        pending.progress(
          Math.min(
            99,
            Math.round(((offset + CHUNK_BYTES) / bytes.length) * 100)
          )
        );
      }
      pending.phase = 'uploaded';
      this.channel.send(JSON.stringify({ type: 'finish', id: pending.id }));
    } catch {
      if (this.pending === pending) this.cancel('图片传输失败');
    }
  }

  private fail(message: string) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }

  cancel = (message = '图片传输已取消') => {
    const pending = this.pending;
    if (!pending) return;
    try {
      if (this.channel.readyState === 'open')
        this.channel.send(JSON.stringify({ type: 'cancel', id: pending.id }));
    } catch {
      // Closing the connection can race the cancellation message.
    } finally {
      this.fail(
        pending.phase === 'pasting'
          ? `${message}，粘贴结果未确认，请先查看 Codex 输入框`
          : message
      );
    }
  };

  dispose = () => {
    if (this.closed) return;
    this.closed = true;
    this.cancel('图片通道已断开');
    this.channel.removeEventListener('message', this.receive);
    this.channel.removeEventListener('close', this.dispose);
    this.channel.removeEventListener('error', this.dispose);
  };
}

type Transfer = {
  id: number;
  sessionId: string;
  image: ImagePayload;
  received: number;
  uploaded: boolean;
  applying: boolean;
  timer: ReturnType<typeof setTimeout>;
};

export class ImageTransferHost {
  private active?: Transfer;
  private lastId = 0;
  private applying = false;
  private closed = false;

  constructor(
    private channel: RTCDataChannel,
    private allowed: (sessionId: string) => boolean,
    private paste: (
      sessionId: string,
      id: number,
      image: ImagePayload
    ) => Promise<unknown>,
    private cancelPaste: (sessionId: string, id: number) => void,
    private timeout = TIMEOUT_MS
  ) {
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', this.receive);
    channel.addEventListener('close', this.dispose);
    channel.addEventListener('error', this.dispose);
  }

  private send(type: string, id: number, message?: string) {
    if (this.closed || this.channel.readyState !== 'open') return;
    try {
      this.channel.send(JSON.stringify({ type, id, message }));
    } catch {
      this.dispose();
    }
  }

  private receive = (event: MessageEvent) => {
    if (this.closed) return;
    if (event.data instanceof ArrayBuffer) {
      const transfer = this.active;
      if (!transfer) return;
      if (!this.allowed(transfer.sessionId))
        return this.reset('窗口控制会话已结束');
      const bytes = new Uint8Array(event.data);
      if (
        transfer.applying ||
        !bytes.length ||
        bytes.length > CHUNK_BYTES ||
        transfer.received + bytes.length > transfer.image.bytes.length
      )
        return this.reset('图片数据不完整，请重试');
      transfer.image.bytes.set(bytes, transfer.received);
      transfer.received += bytes.length;
      return;
    }
    const frame = parse(event.data);
    if (!frame || !Number.isSafeInteger(frame.id) || frame.id < 1) return;
    if (frame.type === 'start') {
      if (frame.id <= this.lastId) return;
      this.lastId = frame.id;
      if (
        typeof frame.sessionId !== 'string' ||
        frame.sessionId.length > 80 ||
        !this.allowed(frame.sessionId)
      ) {
        this.send('error', frame.id, '当前窗口不支持图片粘贴或控制会话已结束');
        return;
      }
      if (this.active || this.applying) {
        this.send('error', frame.id, '已有图片正在处理，请稍后重试');
        return;
      }
      if (
        !Number.isInteger(frame.size) ||
        frame.size < 1 ||
        frame.size > MAX_IMAGE_BYTES ||
        !['image/png', 'image/jpeg'].includes(frame.mime)
      ) {
        this.send('error', frame.id, '请选择不超过 10 MB 的 PNG 或 JPEG 图片');
        return;
      }
      this.active = {
        id: frame.id,
        sessionId: frame.sessionId,
        image: { mime: frame.mime, bytes: new Uint8Array(frame.size) },
        received: 0,
        uploaded: false,
        applying: false,
        timer: setTimeout(() => this.reset('图片接收超时'), this.timeout),
      };
      this.send('ready', frame.id);
      return;
    }
    const transfer = this.active;
    if (!transfer || transfer.id !== frame.id) return;
    if (frame.type === 'cancel') return this.reset('图片传输已取消');
    if (frame.type !== 'finish' || transfer.applying || transfer.uploaded)
      return;
    if (!this.allowed(transfer.sessionId))
      return this.reset('窗口控制会话已结束');
    if (transfer.received !== transfer.image.bytes.length)
      return this.reset('图片数据不完整，请重试');
    try {
      validateImage(transfer.image);
    } catch (error) {
      this.reset((error as Error).message);
      return;
    }
    transfer.uploaded = true;
    this.send('uploaded', transfer.id);
  };

  // Called only by the authenticated, ordered input-channel handler.
  commit(sessionId: string, id: number) {
    const transfer = this.active;
    if (
      this.closed ||
      !transfer ||
      transfer.sessionId !== sessionId ||
      transfer.id !== id ||
      !transfer.uploaded ||
      transfer.applying
    )
      return;
    if (!this.allowed(sessionId)) return this.reset('窗口控制会话已结束');
    transfer.applying = true;
    this.applying = true;
    void this.apply(transfer);
  }

  private async apply(transfer: Transfer) {
    try {
      await this.paste(transfer.sessionId, transfer.id, transfer.image);
      if (this.active === transfer && this.allowed(transfer.sessionId))
        this.send('done', transfer.id);
      else if (this.active === transfer) this.reset('窗口控制会话已结束');
    } catch (error) {
      if (this.active === transfer)
        this.send(
          'error',
          transfer.id,
          error instanceof Error ? error.message.slice(0, 240) : '图片粘贴失败'
        );
    } finally {
      clearTimeout(transfer.timer);
      if (this.active === transfer) this.active = undefined;
      this.applying = false;
    }
  }

  reset = (message = '窗口控制会话已结束') => {
    const transfer = this.active;
    if (!transfer) return;
    this.active = undefined;
    clearTimeout(transfer.timer);
    if (transfer.applying) this.cancelPaste(transfer.sessionId, transfer.id);
    this.send(
      'error',
      transfer.id,
      transfer.applying
        ? `${message}，粘贴结果未确认，请先查看 Codex 输入框`
        : message
    );
  };

  dispose = () => {
    if (this.closed) return;
    this.closed = true;
    this.reset();
    this.channel.removeEventListener('message', this.receive);
    this.channel.removeEventListener('close', this.dispose);
    this.channel.removeEventListener('error', this.dispose);
  };
}
