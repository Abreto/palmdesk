import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { ICaptureSource, RemoteInput } from '../src/pure-interface';

function sameWindow(a: ICaptureSource, b: ICaptureSource) {
  return (
    a.id === b.id &&
    a.nativeId === b.nativeId &&
    a.ownerPid === b.ownerPid &&
    a.bundleId === b.bundleId
  );
}

export interface InputDriver {
  position: (point: { x: number; y: number }) => Promise<unknown>;
  buttonDown: (button: 'left' | 'right') => Promise<unknown>;
  buttonUp: (button: 'left' | 'right') => Promise<unknown>;
  click: (button: 'left' | 'right', double: boolean) => Promise<unknown>;
  scroll: (
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number
  ) => Promise<unknown>;
  text: (value: string) => Promise<unknown>;
  keysDown: (keys: number[]) => Promise<unknown>;
  keysUp: (keys: number[]) => Promise<unknown>;
  validKey: (key: number) => boolean;
}

export class InputUnavailableError extends Error {}

export function normalizedPoint(
  source: ICaptureSource,
  x: unknown,
  y: unknown
) {
  if (source.boundsSource !== 'window' || !source.bounds)
    throw new Error('无法读取精确窗口边界，已停止输入');
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    throw new Error('无效的鼠标坐标');
  const b = source.bounds;
  if (
    ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
    b.width < 1 ||
    b.height < 1
  )
    throw new Error('无效的窗口边界，已停止输入');
  return {
    x: Math.round(
      b.x + ((b.width - 1) * Math.max(0, Math.min(1000, x))) / 1000
    ),
    y: Math.round(
      b.y + ((b.height - 1) * Math.max(0, Math.min(1000, y))) / 1000
    ),
  };
}

export class CaptureSession {
  private generation = 0;
  private serial: Promise<unknown> = Promise.resolve();
  private active?: { id: string; source: ICaptureSource; inputError?: string };
  private keys = new Set<number>();
  private buttons = new Set<'left' | 'right'>();

  constructor(
    private driver: InputDriver,
    private list: () => Promise<ICaptureSource[]>,
    private focus: (source: ICaptureSource) => Promise<ICaptureSource>
  ) {}

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.serial.then(task);
    this.serial = result.catch(() => {});
    return result;
  }

  private async release() {
    const keys = [...this.keys];
    const buttons = [...this.buttons];
    this.keys.clear();
    this.buttons.clear();
    await Promise.allSettled([
      ...(keys.length ? [this.driver.keysUp(keys)] : []),
      ...buttons.map((button) => this.driver.buttonUp(button)),
    ]);
  }

  begin(
    sourceId: string,
    expectedSource?: Pick<ICaptureSource, 'ownerPid' | 'bundleId'>
  ) {
    this.generation += 1;
    const generation = this.generation;
    this.active = undefined;
    return this.enqueue(async () => {
      await this.release();
      let source = (await this.list()).find((item) => item.id === sourceId);
      if (generation !== this.generation) throw new Error('捕获请求已取消');
      if (!source || source.boundsSource !== 'window' || !source.bounds)
        throw new Error('选定窗口已不可用');
      if (
        expectedSource &&
        (source.ownerPid !== expectedSource.ownerPid ||
          source.bundleId !== expectedSource.bundleId)
      )
        throw new Error('选定窗口身份已变化，请刷新窗口列表');
      if (!source.isOnScreen || !source.captureId) {
        const focused = await this.focus(source);
        if (generation !== this.generation) throw new Error('捕获请求已取消');
        if (!sameWindow(source, focused)) throw new Error('选定窗口身份已变化');
        // Electron only exposes windows on an active Space. Wait for its catalog to catch up.
        const deadline = Date.now() + 2000;
        for (;;) {
          const current = (await this.list()).find(
            (item) => item.id === sourceId
          );
          if (generation !== this.generation) throw new Error('捕获请求已取消');
          if (!current) throw new Error('选定窗口已不可用');
          if (!sameWindow(source, current))
            throw new Error('选定窗口身份已变化');
          if (current.isOnScreen && current.captureId) {
            source = current;
            break;
          }
          if (Date.now() >= deadline)
            throw new Error('窗口尚未出现在当前桌面，无法启动捕获');
          await delay(100);
          if (generation !== this.generation) throw new Error('捕获请求已取消');
        }
      }
      normalizedPoint(source, 0, 0);
      this.active = { id: randomUUID(), source };
      return {
        sessionId: this.active.id,
        source,
        stream: { id: source.captureId! },
      };
    });
  }

  end(sessionId?: string) {
    if (sessionId && sessionId !== this.active?.id) return Promise.resolve();
    this.generation += 1;
    this.active = undefined;
    return this.enqueue(() => this.release());
  }

  async refresh() {
    const generation = this.generation;
    const active = this.active;
    try {
      const sources = await this.list();
      if (active && this.active === active && generation === this.generation) {
        const previous = active.source;
        const retained = sources.find(
          (source) =>
            sameWindow(source, previous) &&
            source.isOnScreen &&
            source.captureId === previous.captureId
        );
        if (retained) active.source = retained;
        else await this.end(active.id);
      }
      return { sources, sessionId: this.active?.id || '' };
    } catch (error) {
      if (generation === this.generation && this.active === active)
        await this.end(active?.id);
      throw error;
    }
  }

  input(sessionId: string, input: RemoteInput) {
    return this.enqueue(async () => {
      const active = this.active;
      if (!active || active.id !== sessionId)
        throw new Error('远程控制会话已结束');
      if (input.action === 'releaseAll') {
        await this.release();
        return;
      }
      if (active.inputError && input.action !== 'resume')
        throw new InputUnavailableError(active.inputError);
      try {
        const source = await this.focus(active.source);
        if (this.active !== active) throw new Error('目标窗口已失效');
        if (!sameWindow(source, active.source))
          throw new Error('目标窗口身份已变化');
        if (!source.isOnScreen) throw new Error('目标窗口当前不可见');
        active.source = source;
        if (input.action === 'resume') {
          active.inputError = undefined;
          return;
        }
        if (
          [
            'move',
            'down',
            'up',
            'click',
            'doubleClick',
            'rightClick',
            'scroll',
          ].includes(input.action)
        ) {
          await this.driver.position(normalizedPoint(source, input.x, input.y));
          if (this.active !== active) throw new Error('目标窗口已失效');
        }
        switch (input.action) {
          case 'move':
            break;
          case 'down':
            this.buttons.add('left');
            await this.driver.buttonDown('left');
            break;
          case 'up':
            await this.driver.buttonUp('left');
            this.buttons.delete('left');
            break;
          case 'click':
          case 'doubleClick':
          case 'rightClick':
            await this.driver.click(
              input.action === 'rightClick' ? 'right' : 'left',
              input.action === 'doubleClick'
            );
            break;
          case 'scroll':
            if (
              !['up', 'down', 'left', 'right'].includes(
                input.direction || ''
              ) ||
              !Number.isFinite(input.amount)
            )
              throw new Error('无效的滚动事件');
            await this.driver.scroll(
              input.direction!,
              Math.max(1, Math.min(100, Math.round(Math.abs(input.amount!))))
            );
            break;
          case 'text':
            if (
              typeof input.text !== 'string' ||
              !input.text.length ||
              input.text.length > 4096
            )
              throw new Error('文字长度须为 1 至 4096');
            await this.driver.text(input.text);
            break;
          case 'keysDown':
          case 'keysUp': {
            if (
              !Array.isArray(input.keys) ||
              input.keys.length > 16 ||
              !input.keys.length ||
              !input.keys.every((key) => this.driver.validKey(key))
            )
              throw new Error('无效的键盘事件');
            if (input.action === 'keysDown') {
              input.keys.forEach((key) => this.keys.add(key));
              await this.driver.keysDown(input.keys);
            } else {
              await this.driver.keysUp(input.keys);
              input.keys.forEach((key) => this.keys.delete(key));
            }
            break;
          }
          default:
            throw new Error('不支持的输入事件');
        }
      } catch (error) {
        if (this.active === active) {
          if (error instanceof InputUnavailableError)
            active.inputError = error.message;
          else {
            this.active = undefined;
            this.generation += 1;
          }
        }
        await this.release();
        throw error;
      }
    });
  }
}
