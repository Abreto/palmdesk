// PalmDesk-side bridge: runs on the controller's own origin, next to the
// WebRTC connection, and embeds the separate preview origin in a sandboxed
// frame. Messages from that frame are untrusted; it only ever receives a
// MessagePort that speaks the preview protocol.
const KIND = { response: 1, request: 2, wsText: 3, wsBinary: 4 };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);
const MAX_IN_FLIGHT = 24;
const CHUNK_BYTES = 16 * 1024;
// No allow-top-navigation: preview content cannot navigate PalmDesk away.
export const SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads';

// crypto.randomUUID() needs a secure context; LAN HTTP pages lack one.
function nonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function inPrefix(pathname, prefix) {
  return (
    prefix === '/' ||
    pathname.startsWith(prefix) ||
    pathname === prefix.slice(0, -1)
  );
}

function validHeaders(headers) {
  return (
    Array.isArray(headers) &&
    headers.length <= 100 &&
    headers.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string' &&
        entry[0].length <= 128 &&
        entry[1].length <= 8192
    )
  );
}

export class PreviewBridge {
  constructor({
    channel,
    dataChannels = [],
    previewOrigin,
    container,
    maxMessageSize = () => undefined,
    onState = () => {},
  }) {
    this.channel = channel;
    this.maxMessageSize = maxMessageSize;
    this.previewOrigin = previewOrigin;
    this.previewHost = new URL(previewOrigin).host;
    this.container = container;
    this.onState = onState;
    this.state = 'connecting';
    this.reason = '';
    this.grant = undefined;
    this.nextId = 1;
    this.requests = new Map();
    this.sockets = new Map();
    this.queue = [];
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    // Request paths and times, for measuring when a page settles.
    this.log = [];
    this.stats = {
      requests: 0,
      sockets: 0,
      wireBytes: 0,
      bodyBytes: 0,
      statuses: {},
      failures: {},
      ignoredMessages: 0,
    };
    // Requests go out on the control channel; replies may arrive on any of
    // them, each stream on one channel.
    [channel, ...dataChannels].forEach((item) => {
      item.binaryType = 'arraybuffer';
      item.addEventListener('message', ({ data }) => this.receive(data));
      item.addEventListener('close', () => this.teardown('disconnected'));
    });
    window.addEventListener('message', this.onWindowMessage);
    if (channel.readyState === 'open') this.hello();
    else channel.addEventListener('open', () => this.hello(), { once: true });
  }

  // The host sizes its frames to what this browser's SCTP transport accepts;
  // without RTCSctpTransport it assumes the conservative 16 KiB.
  hello() {
    const size = this.maxMessageSize();
    this.sendControl({
      t: 'hello',
      v: 1,
      frame: Math.min(64 * 1024, size > 0 ? size : 16 * 1024),
    });
  }

  setState(state, reason = '') {
    this.state = state;
    this.reason = reason;
    this.stateAt = Date.now();
    this.onState(state, reason);
  }

  snapshot() {
    return {
      ...JSON.parse(JSON.stringify(this.stats)),
      inFlight: this.requests.size + this.queue.length,
    };
  }

  currentTarget() {
    return this.grant?.targets.find(({ id }) => id === this.target?.id);
  }

  async open(targetId, path = '/') {
    const target = this.grant?.targets.find(({ id }) => id === targetId);
    if (!target) throw new Error(`Not an approved target: ${targetId}`);
    // Finish the old relay's cleanup before the new one registers.
    await this.closeFrame();
    this.target = target;
    this.nonce = nonce();
    this.pendingPath = path;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', SANDBOX);
    frame.referrerPolicy = 'no-referrer';
    frame.allow = '';
    frame.title = target.label;
    frame.src = `${this.previewOrigin}/__palmdesk_preview/relay.html#nonce=${this.nonce}&parent=${encodeURIComponent(location.origin)}`;
    this.frame = frame;
    this.container.replaceChildren(frame);
    this.setState('loading');
  }

  // Ask the relay to reload or navigate the previewed app.
  command(message) {
    this.port?.postMessage(message);
  }

  onWindowMessage = (event) => {
    if (event.origin !== this.previewOrigin) return;
    const { data } = event;
    if (this.inspector && event.source === this.inspector.frame.contentWindow) {
      if (data?.type !== 'relay-hello' || data.nonce !== this.inspector.nonce)
        return;
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = ({ data: reply }) => {
        if (reply?.type !== 'inspected') return;
        this.inspector.frame.remove();
        this.inspector.resolve(reply);
        this.inspector = undefined;
        port1.close();
      };
      event.source.postMessage(
        { type: 'relay-init', nonce: data.nonce, inspectOnly: true },
        this.previewOrigin,
        [port2]
      );
      port1.postMessage({ type: 'inspect' });
      return;
    }
    if (
      !this.frame ||
      event.source !== this.frame.contentWindow ||
      data?.type !== 'relay-hello' ||
      data.nonce !== this.nonce
    ) {
      // For example the previewed app posting to window.top.
      this.stats.ignoredMessages += 1;
      return;
    }
    if (data.unsupported) {
      this.closeFrame();
      this.setState('unsupported', data.unsupported);
      return;
    }
    // A reloaded relay gets a fresh port; the old one stops working.
    this.port?.close();
    this.failAll('disconnected');
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    port1.onmessage = (message) => this.onRelayMessage(message);
    event.source.postMessage(
      { type: 'relay-init', nonce: this.nonce, path: this.pendingPath },
      this.previewOrigin,
      [port2]
    );
  };

  onRelayMessage({ data, ports }) {
    if (data?.type === 'fetch' && ports[0]) this.enqueueFetch(data, ports[0]);
    else if (data?.type === 'ws-open' && ports[0])
      this.openSocket(data, ports[0]);
    else if (data?.type === 'ready') this.setState('open');
    else if (data?.type === 'loaded') {
      this.path = data.path;
      this.onState(this.state, this.reason);
    } else if (data?.type === 'error') this.setState('error', data.code);
    else if (data?.type === 'teardown-done') this.teardownDone?.();
    else this.stats.ignoredMessages += 1;
  }

  route(raw, socket) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return undefined;
    }
    const schemes = socket ? ['ws:', 'wss:'] : ['http:', 'https:'];
    if (!schemes.includes(url.protocol) || url.username || url.password)
      return undefined;
    const path = `${url.pathname}${url.search}`;
    if (url.host === this.previewHost) {
      const target = this.currentTarget();
      return target ? { target: target.id, path } : { revoked: true };
    }
    if (!LOOPBACK.has(url.hostname)) return undefined;
    const secure = url.protocol === 'https:' || url.protocol === 'wss:';
    const port = Number(url.port || (secure ? 443 : 80));
    const target = this.grant?.targets.find(
      (item) => item.port === port && inPrefix(url.pathname, item.prefix)
    );
    return target ? { target: target.id, path } : undefined;
  }

  enqueueFetch(data, port) {
    const body = data.body instanceof ArrayBuffer ? data.body : null;
    const fail = (code) => {
      this.stats.failures[code] = (this.stats.failures[code] || 0) + 1;
      port.postMessage({ type: 'fail', code });
      port.close();
    };
    if (
      typeof data.url !== 'string' ||
      data.url.length > 8192 ||
      !METHODS.has(data.method) ||
      !validHeaders(data.headers) ||
      (body && body.byteLength > (this.grant?.limits.maxBody ?? 0))
    ) {
      fail('bad-request');
      return;
    }
    const route = this.route(data.url, false);
    if (!route) fail('not-routed');
    else if (route.revoked) fail('revoked');
    else {
      this.queue.push({
        ...route,
        method: data.method,
        headers: data.headers,
        body,
        port,
      });
      this.pump();
    }
  }

  pump() {
    while (this.requests.size < MAX_IN_FLIGHT && this.queue.length)
      this.startRequest(this.queue.shift());
  }

  startRequest({ target, path, method, headers, body, port }) {
    const id = this.nextId;
    this.nextId += 1;
    this.stats.requests += 1;
    if (this.log.length < 5000) this.log.push({ id, path, at: Date.now() });
    this.requests.set(id, { port });
    port.onmessage = ({ data }) => {
      if (
        data?.type === 'credit' &&
        Number.isInteger(data.bytes) &&
        data.bytes > 0
      )
        this.sendControl({ t: 'credit', id, bytes: data.bytes });
      else if (data?.type === 'cancel' && this.requests.has(id)) {
        this.sendControl({ t: 'cancel', id });
        this.finishRequest(id);
      }
    };
    this.sendControl({
      t: 'req',
      id,
      target,
      method,
      path,
      headers,
      body: body ? body.byteLength : 0,
    });
    if (!body) return;
    const bytes = new Uint8Array(body);
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES)
      this.sendBinary(
        KIND.request,
        id,
        bytes.subarray(offset, offset + CHUNK_BYTES)
      );
  }

  finishRequest(id) {
    const request = this.requests.get(id);
    if (!request) return;
    this.requests.delete(id);
    request.port.close();
    this.pump();
  }

  openSocket(data, port) {
    const route =
      typeof data.url === 'string' && data.url.length <= 8192
        ? this.route(data.url, true)
        : undefined;
    const protocols = Array.isArray(data.protocols)
      ? data.protocols.slice(0, 4).filter((item) => typeof item === 'string')
      : [];
    if (!route || route.revoked) {
      port.postMessage({
        type: 'closed',
        code: route ? 4403 : 1006,
        reason: route ? 'revoked' : 'not-routed',
      });
      port.close();
      return;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.stats.sockets += 1;
    this.sockets.set(id, { port });
    const send = (kind, payload) => {
      // One message per frame; larger messages close the socket (1009).
      if (payload.length + 5 > (this.grant?.limits.frame ?? 0)) {
        this.sendControl({
          t: 'ws-close',
          id,
          code: 1000,
          reason: 'too large',
        });
        this.closeSocket(id, 1009, 'message too large');
      } else this.sendBinary(kind, id, payload);
    };
    port.onmessage = ({ data: message }) => {
      if (message?.type === 'send' && typeof message.data === 'string')
        send(KIND.wsText, this.encoder.encode(message.data));
      else if (message?.type === 'send' && message.data instanceof ArrayBuffer)
        send(KIND.wsBinary, new Uint8Array(message.data));
      else if (message?.type === 'close')
        this.sendControl({
          t: 'ws-close',
          id,
          code: message.code,
          reason: String(message.reason || '').slice(0, 120),
        });
    };
    this.sendControl({
      t: 'ws-open',
      id,
      target: route.target,
      path: route.path,
      protocols,
    });
  }

  closeSocket(id, code, reason) {
    const socket = this.sockets.get(id);
    if (!socket) return;
    this.sockets.delete(id);
    socket.port.postMessage({ type: 'closed', code, reason });
    socket.port.close();
  }

  sendControl(message) {
    if (this.channel.readyState === 'open')
      this.channel.send(JSON.stringify(message));
  }

  sendBinary(kind, id, payload) {
    if (this.channel.readyState !== 'open') return;
    const frame = new Uint8Array(5 + payload.length);
    frame[0] = kind;
    new DataView(frame.buffer).setUint32(1, id);
    frame.set(payload, 5);
    this.channel.send(frame);
  }

  receive(data) {
    if (typeof data === 'string') {
      this.stats.wireBytes += data.length;
      let message;
      try {
        message = JSON.parse(data);
      } catch {
        return;
      }
      this.handleControl(message);
      return;
    }
    this.stats.wireBytes += data.byteLength;
    const view = new DataView(data);
    const kind = view.getUint8(0);
    const id = view.getUint32(1);
    const payload = data.slice(5);
    if (kind === KIND.response) {
      const request = this.requests.get(id);
      if (!request) return;
      this.stats.bodyBytes += payload.byteLength;
      request.port.postMessage({ type: 'chunk', data: payload }, [payload]);
    } else if (kind === KIND.wsText)
      this.sockets.get(id)?.port.postMessage({
        type: 'message',
        data: this.decoder.decode(payload),
      });
    else if (kind === KIND.wsBinary)
      this.sockets
        .get(id)
        ?.port.postMessage({ type: 'message', data: payload }, [payload]);
  }

  handleControl(message) {
    if (message.t === 'grant') {
      this.grant = message;
      if (this.target && !this.currentTarget()) this.setState('revoked');
      else if (this.state === 'revoked') this.setState('open');
      else if (['connecting', 'denied', 'disconnected'].includes(this.state))
        this.setState('ready');
      else this.onState(this.state, this.reason);
    } else if (message.t === 'denied') {
      this.grant = undefined;
      this.closeFrame();
      this.setState('denied', message.reason);
    } else if (message.t === 'res') {
      const request = this.requests.get(message.id);
      if (!request) return;
      this.stats.statuses[message.status] =
        (this.stats.statuses[message.status] || 0) + 1;
      request.port.postMessage({
        type: 'head',
        status: message.status,
        statusText: message.statusText,
        headers: message.headers,
        encoding: message.encoding,
        upstreamMs: message.upstreamMs,
      });
    } else if (message.t === 'end') {
      this.requests.get(message.id)?.port.postMessage({ type: 'end' });
      this.finishRequest(message.id);
    } else if (message.t === 'fail') {
      const request = this.requests.get(message.id);
      if (!request) return;
      this.stats.failures[message.code] =
        (this.stats.failures[message.code] || 0) + 1;
      request.port.postMessage({ type: 'fail', code: message.code });
      this.finishRequest(message.id);
    } else if (message.t === 'ws-opened')
      this.sockets
        .get(message.id)
        ?.port.postMessage({ type: 'open', protocol: message.protocol });
    else if (message.t === 'ws-closed')
      this.closeSocket(message.id, message.code, message.reason);
    else if (message.t === 'ws-fail')
      this.closeSocket(
        message.id,
        message.code === 'revoked' ? 4403 : 1006,
        message.code
      );
  }

  failAll(code) {
    this.queue.splice(0).forEach(({ port }) => {
      port.postMessage({ type: 'fail', code });
      port.close();
    });
    [...this.requests.keys()].forEach((id) => {
      this.requests.get(id).port.postMessage({ type: 'fail', code });
      this.finishRequest(id);
    });
    [...this.sockets.keys()].forEach((id) => this.closeSocket(id, 1001, code));
  }

  // Ends the preview. The relay unregisters the worker and clears the preview
  // origin's storage, so nothing outlives this preview on the phone.
  async closeFrame() {
    this.failAll('disconnected');
    const { frame, port } = this;
    this.frame = undefined;
    this.port = undefined;
    this.target = undefined;
    if (frame && port) {
      await new Promise((resolve) => {
        this.teardownDone = resolve;
        port.postMessage({ type: 'teardown' });
        setTimeout(resolve, 2000);
      });
      this.teardownDone = undefined;
    }
    port?.close();
    frame?.remove();
  }

  async stop() {
    await this.closeFrame();
    this.setState(this.grant ? 'ready' : this.state);
  }

  // Every channel's close event lands here; the first one does the work.
  teardown(reason) {
    this.closing ??= (async () => {
      this.grant = undefined;
      await this.closeFrame();
      this.setState('disconnected', reason);
    })();
    return this.closing;
  }

  // Test helper: what is left on the preview origin in this browser.
  inspect() {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', SANDBOX);
      frame.style.display = 'none';
      const token = nonce();
      this.inspector = { frame, nonce: token, resolve };
      frame.src = `${this.previewOrigin}/__palmdesk_preview/relay.html#nonce=${token}&parent=${encodeURIComponent(location.origin)}`;
      document.body.append(frame);
    });
  }
}
