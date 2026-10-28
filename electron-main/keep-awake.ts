import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IKeepAwakeStatus } from '../src/pure-interface';

type SleepBlocker = Pick<
  Electron.PowerSaveBlocker,
  'start' | 'stop' | 'isStarted'
>;

/**
 * Keeps the computer from sleeping on its own while PalmDesk runs, once the
 * user turns the option on. `prevent-app-suspension` still lets the display
 * turn off and lock. PalmDesk holds at most one blocker and never changes the
 * system's power settings; quitting or turning the option off releases it.
 */
export class KeepAwake {
  private enabled = false;
  private blockerId?: number;
  private error?: string;
  private closed = false;
  private ready: Promise<void> = Promise.resolve();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    private directory: string,
    private blocker: SleepBlocker,
    private platform = process.platform
  ) {}

  private get supported() {
    return this.platform === 'darwin' || this.platform === 'win32';
  }

  private get file() {
    return path.join(this.directory, 'keep-awake.json');
  }

  private get active() {
    return (
      this.blockerId !== undefined && this.blocker.isStarted(this.blockerId)
    );
  }

  /** Applies the saved choice. Call once the app is ready. */
  restore() {
    this.ready = (async () => {
      try {
        const value = JSON.parse(await readFile(this.file, 'utf8'));
        this.enabled = value.enabled === true && this.supported;
      } catch {
        this.enabled = false;
      }
      if (this.enabled) this.acquire();
    })();
    return this.ready;
  }

  /** Starts the single blocker unless it is running; a failure is reported. */
  private acquire() {
    if (this.closed || this.active) return;
    this.error = undefined;
    try {
      const id = this.blocker.start('prevent-app-suspension');
      if (!this.blocker.isStarted(id)) throw new Error('系统未启用防止睡眠');
      this.blockerId = id;
    } catch (error) {
      this.blockerId = undefined;
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private release() {
    const id = this.blockerId;
    this.blockerId = undefined;
    if (id !== undefined) this.blocker.stop(id);
  }

  private state(): IKeepAwakeStatus {
    return {
      enabled: this.enabled,
      active: this.active,
      supported: this.supported,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  async status() {
    await this.ready;
    return this.state();
  }

  /** Saves and applies the choice. Requests apply one at a time, in order. */
  configure(enabled: unknown) {
    const result = this.pending.then(() => this.apply(enabled));
    this.pending = result.catch(() => {});
    return result;
  }

  private async apply(enabled: unknown) {
    await this.ready;
    if (typeof enabled !== 'boolean') throw new Error('无效的保持唤醒设置');
    if (!this.supported) throw new Error('保持唤醒支持 macOS 和 Windows');
    if (!enabled) {
      // Normal sleep returns at once, even if the choice cannot be saved.
      this.enabled = false;
      this.error = undefined;
      this.release();
    }
    await mkdir(this.directory, { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ enabled }), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
    if (enabled) {
      this.enabled = true;
      this.acquire();
    }
    return this.state();
  }

  /** PalmDesk is quitting: release the blocker for good, keep the choice. */
  close() {
    this.closed = true;
    this.release();
  }
}
