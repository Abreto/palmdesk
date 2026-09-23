import type { ICaptureSource } from '@/pure-interface';

const lifetime = 5 * 60 * 1000;
type Entry = { device: string; source: ICaptureSource; expires: number };

// References survive transport replacement, never authentication. Native window
// identities remain on the desktop and must match a fresh enumeration on resume.
export class WindowResumeStore {
  private entries = new Map<string, Entry>();

  remember(device: string, source: ICaptureSource, now = Date.now()) {
    this.entries.forEach((entry, token) => {
      if (entry.expires <= now || entry.device === device)
        this.entries.delete(token);
    });
    if (this.entries.size >= 32)
      this.entries.delete(this.entries.keys().next().value!);
    const token = crypto.randomUUID();
    this.entries.set(token, {
      device,
      source: { ...source },
      expires: now + lifetime,
    });
    return token;
  }

  touch(token: string, now = Date.now()) {
    const entry = this.entries.get(token);
    if (entry) entry.expires = now + lifetime;
  }

  resolve(
    token: string,
    device: string,
    sources: ICaptureSource[],
    now = Date.now()
  ) {
    const entry = this.entries.get(token);
    if (!entry || entry.device !== device || entry.expires <= now)
      throw new Error('窗口恢复信息已过期，请重新选择窗口');
    const previous = entry.source;
    const source = sources.find(
      (value) =>
        value.id === previous.id &&
        value.nativeId === previous.nativeId &&
        value.ownerPid === previous.ownerPid &&
        value.bundleId === previous.bundleId
    );
    if (!source) throw new Error('原窗口已关闭或身份已变化，请重新选择窗口');
    return source;
  }
}
