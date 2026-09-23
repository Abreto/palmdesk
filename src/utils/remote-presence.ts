// Controllers renew this lease while visible. The host's timer still runs when
// a phone is suspended before its final visibility message can be delivered.
export const PRESENCE_TIMEOUT = 10000;

export class VideoActivityLease {
  active = true; // Older controllers keep their existing streaming behavior.
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private change: (active: boolean) => void) {}

  receive(data: { visible?: unknown; video?: unknown }) {
    if (
      this.disposed ||
      typeof data.visible !== 'boolean' ||
      typeof data.video !== 'boolean'
    )
      return false;
    clearTimeout(this.timer);
    this.set(data.visible && data.video);
    this.timer = setTimeout(() => this.set(false), PRESENCE_TIMEOUT);
    return true;
  }

  private set(active: boolean) {
    if (this.disposed || this.active === active) return;
    this.active = active;
    this.change(active);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}

// Recreate authenticated sessions after suspension, including a peer that still
// claims to be connected but no longer answers. Old hosts need not answer probes.
export class ControllerRecovery {
  private attempts = 0;
  private retryAfter = 0;
  private lastReply = 0;
  private supported = false;
  private stopped = false;

  started(now: number) {
    this.retryAfter = now + 20000;
    this.lastReply = now;
  }

  acknowledge(now: number) {
    this.supported = true;
    this.lastReply = now;
    this.attempts = 0;
  }

  foreground(now: number) {
    this.attempts = 0;
    this.retryAfter = now;
    // Give a surviving connection time to answer the foreground probe.
    this.lastReply = now;
  }

  reset(now: number) {
    this.stopped = false;
    this.foreground(now);
  }

  stop() {
    this.stopped = true;
  }

  retry(now: number, visible: boolean, connected: boolean) {
    if (!visible || this.stopped || this.attempts >= 3) return false;
    if (
      connected &&
      (!this.supported || now - this.lastReply < PRESENCE_TIMEOUT)
    )
      return false;
    if (now < this.retryAfter) return false;
    this.attempts += 1;
    this.started(now);
    return true;
  }
}
