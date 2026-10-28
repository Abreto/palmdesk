import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { App, BrowserWindow, Session, WebContents } from 'electron';

/**
 * `--smoke-exit` checks a packaged build in CI. The app starts with a
 * throwaway profile, cancels every network request, refuses capture and
 * input, and quits with code 0 once the host page has rendered. The switch
 * takes no value.
 */
export const SMOKE_RUN_SWITCH = '--smoke-exit';
export const SMOKE_RUN_PASSED = '[PalmDesk smoke] passed';

// The host route rendered with the preload bridge in place.
const RENDERED = `!!document.getElementById('app')?.firstElementChild &&
  !!window.electronAPI && location.hash.startsWith('#/remote')`;

export function isSmokeRun(argv: readonly string[]) {
  return argv.includes(SMOKE_RUN_SWITCH);
}

export class SmokeRun {
  readonly profile = mkdtempSync(path.join(tmpdir(), 'palmdesk-smoke-'));
  private passed = false;
  private failed = false;
  private blocked = new Set<string>();
  private timer: ReturnType<typeof setTimeout>;

  constructor(
    private app: Pick<App, 'exit' | 'quit'>,
    timeoutMs = 60_000,
    private pollMs = 250
  ) {
    console.log(`[PalmDesk smoke] profile: ${this.profile}`);
    this.timer = setTimeout(
      () => this.fail(`the host page did not render within ${timeoutMs} ms`),
      timeoutMs
    );
    // Also keeps Electron from showing a blocking error dialog.
    process.on('uncaughtException', (error) => this.fail(error));
    process.on('unhandledRejection', (reason) => this.fail(reason));
  }

  /** Cancels HTTP and WebSocket requests, including those to the default services. */
  blockNetwork(session: Session) {
    session.webRequest.onBeforeRequest((details, callback) => {
      const remote = /^(?:https?|wss?):/i.test(details.url);
      if (remote) {
        const { origin } = new URL(details.url);
        if (!this.blocked.has(origin)) {
          this.blocked.add(origin);
          console.log(`[PalmDesk smoke] blocked requests to ${origin}`);
        }
      }
      callback({ cancel: remote });
    });
  }

  watch(win: BrowserWindow) {
    const contents = win.webContents;
    contents.on('preload-error', (_event, _preload, error) => this.fail(error));
    contents.on(
      'did-fail-load',
      (_event, code, description, url, isMainFrame) => {
        if (isMainFrame)
          this.fail(`${url} did not load: ${description} (${code})`);
      }
    );
    contents.on('render-process-gone', (_event, details) =>
      this.fail(`the renderer exited: ${details.reason}`)
    );
    contents.on('unresponsive', () =>
      this.fail('the renderer stopped responding')
    );
    contents.on('console-message', ({ level, message }) => {
      if (level === 'error')
        console.log(`[PalmDesk smoke] renderer: ${message}`);
    });
    contents.once(
      'did-finish-load',
      () => void this.waitUntilRendered(contents)
    );
  }

  fail(reason: unknown) {
    if (this.failed) return;
    this.failed = true;
    clearTimeout(this.timer);
    const detail =
      reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[PalmDesk smoke] failed: ${detail}`);
    this.app.exit(1);
  }

  private async waitUntilRendered(contents: WebContents) {
    while (!this.passed && !this.failed) {
      try {
        if (await contents.executeJavaScript(RENDERED)) {
          this.passed = true;
          clearTimeout(this.timer);
          console.log(SMOKE_RUN_PASSED);
          this.app.quit();
          return;
        }
      } catch (error) {
        this.fail(error);
        return;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, this.pollMs);
      });
    }
  }
}
