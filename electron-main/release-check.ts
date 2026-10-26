import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IReleaseInfo, IReleaseStatus } from '../src/pure-interface';

// Every PalmDesk build is a GitHub prerelease, which the "latest release"
// endpoint ignores, so list recent releases instead.
export const RELEASES_API =
  'https://api.github.com/repos/Abreto/palmdesk/releases?per_page=10';
export const RELEASES_PAGE = 'https://github.com/Abreto/palmdesk/releases';
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

type ReleaseInfo = IReleaseInfo;
type ReleaseStatus = IReleaseStatus;

type Version = [number, number, number];

/** Parses `v1.2.3` or `1.2.3`; any other tag is not a PalmDesk release. */
export function parseVersion(value: unknown): Version | undefined {
  const match =
    typeof value === 'string' && /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}

export function compareVersions(a: Version, b: Version) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The newest published release with a version tag, ignoring drafts. */
export function newestRelease(releases: unknown): ReleaseInfo | undefined {
  if (!Array.isArray(releases)) return undefined;
  let newest: { version: Version; info: ReleaseInfo } | undefined;
  releases.forEach((release) => {
    if (!release || typeof release !== 'object' || release.draft) return;
    const version = parseVersion(release.tag_name);
    if (!version || (newest && compareVersions(version, newest.version) <= 0))
      return;
    const tag = encodeURIComponent(release.tag_name.trim());
    newest = {
      version,
      info: {
        version: version.join('.'),
        // Link to our own release page; never to a URL from the response.
        url: `${RELEASES_PAGE}/tag/${tag}`,
        security:
          typeof release.body === 'string' &&
          /^\s*security:/im.test(release.body),
      },
    };
  });
  return newest?.info;
}

export class ReleaseChecker {
  private enabled = true;
  private status: ReleaseStatus;
  private ready: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<ReleaseStatus>;

  constructor(
    private options: {
      directory: string;
      current: string;
      fetchReleases: () => Promise<unknown>;
      onChange: (status: ReleaseStatus) => void;
      now?: () => number;
    }
  ) {
    this.status = {
      enabled: true,
      current: options.current,
      checking: false,
      available: false,
    };
    this.ready = this.load();
  }

  private get file() {
    return path.join(this.options.directory, 'release-check.json');
  }

  private async load() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      this.enabled = value.enabled !== false;
    } catch {
      this.enabled = true;
    }
    this.update({ enabled: this.enabled });
  }

  private update(change: Partial<ReleaseStatus>) {
    this.status = { ...this.status, ...change };
    this.options.onChange(this.state());
  }

  private state(): ReleaseStatus {
    return { ...this.status };
  }

  async settings() {
    await this.ready;
    return this.state();
  }

  async configure(enabled: unknown) {
    await this.ready;
    if (typeof enabled !== 'boolean') throw new Error('无效的更新检查设置');
    await mkdir(this.options.directory, { recursive: true });
    await writeFile(`${this.file}.tmp`, JSON.stringify({ enabled }), {
      mode: 0o600,
    });
    await rename(`${this.file}.tmp`, this.file);
    this.enabled = enabled;
    this.update({ enabled });
    return this.state();
  }

  /** Checks now. Automatic checks are skipped, without a request, when disabled. */
  async check(manual = false) {
    await this.ready;
    if (!manual && !this.enabled) return this.state();
    if (this.pending) return this.pending;
    this.update({ checking: true, manual });
    this.pending = (async () => {
      try {
        const latest = newestRelease(await this.options.fetchReleases());
        const current = parseVersion(this.options.current);
        const version = latest && parseVersion(latest.version);
        this.update({
          checking: false,
          checkedAt: (this.options.now || Date.now)(),
          latest,
          available: !!(
            current &&
            version &&
            compareVersions(version, current) > 0
          ),
          error: undefined,
        });
      } catch (error) {
        this.update({
          checking: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.pending = undefined;
      }
      return this.state();
    })();
    return this.pending;
  }

  /** Checks on launch and then once a day while the app runs. */
  start() {
    this.stop();
    void this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    // A background check never keeps the process alive.
    if (typeof this.timer === 'object') this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
