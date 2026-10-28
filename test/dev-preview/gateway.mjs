// Host end of the preview transport. In PalmDesk this would run in the
// Electron main process, behind the host renderer that owns the WebRTC
// connection; here the prototype host page forwards DataChannel frames to it.
// Every frame comes from the phone and is untrusted: a frame that cannot be
// served is refused, never allowed to throw (in the main process an uncaught
// exception would take the whole app down).
import http from 'node:http';
import zlib from 'node:zlib';

import {
  compressible,
  CookieJar,
  LOOPBACK_ADDRESSES,
  METHODS,
  normalizeTargets,
  requestHeaders,
  resolvePath,
  responseHeaders,
  rewriteLocation,
} from './policy.mjs';

export const PROTOCOL_VERSION = 1;
// Binary frames: kind (1 byte), stream id (uint32), payload.
export const KIND = { response: 1, request: 2, wsText: 3, wsBinary: 4 };
// Frames grow to 64 KiB when the phone's SCTP max-message-size allows it,
// which cut per-message overhead on a busy machine (see the ADR). One
// WebSocket message must fit in one frame.
const DEFAULT_FRAME_BYTES = 16 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;
// Per stream, what the phone has not yet confirmed reading. Host memory is
// bounded separately, by the host's own transport buffer (below).
const WINDOW_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
// Request bodies wait in host memory until complete; cap them across streams.
const MAX_PENDING_BODY_BYTES = 16 * 1024 * 1024;
const MAX_STREAMS = 64;
const HOST_BUFFER_BYTES = 2 * 1024 * 1024;
export const TIMEOUTS = {
  // Until the development server sends response headers.
  headers: 60_000,
  // A request body must arrive in full, and keep arriving.
  body: 120_000,
  bodyIdle: 15_000,
  // A response the phone stopped reading (no credits) holds a slot this long.
  creditStall: 120_000,
};

export function binaryFrame(kind, id, payload) {
  const bytes = Buffer.allocUnsafe(5 + payload.length);
  bytes[0] = kind;
  bytes.writeUInt32BE(id, 1);
  Buffer.from(payload.buffer, payload.byteOffset, payload.length).copy(
    bytes,
    5
  );
  return bytes;
}

function parseControl(text) {
  if (typeof text !== 'string' || text.length > 65536) return undefined;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && typeof value.t === 'string'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function validId(id) {
  return Number.isInteger(id) && id > 0 && id < 2 ** 31;
}

export class PreviewGateway {
  constructor({
    targets = [],
    send,
    verified = false,
    log = () => {},
    hostBufferBytes = HOST_BUFFER_BYTES,
    timeouts = {},
  }) {
    this.targets = normalizeTargets(targets);
    this.send = send;
    this.verified = verified;
    this.log = log;
    this.hostBufferBytes = hostBufferBytes;
    this.timeouts = { ...TIMEOUTS, ...timeouts };
    this.helloReceived = false;
    this.frameBytes = DEFAULT_FRAME_BYTES;
    this.closed = false;
    this.streams = new Map();
    this.sockets = new Map();
    this.jars = new Map();
    // Bytes handed to send() that the host page has not yet passed to a
    // DataChannel. Only the host reports this, so the phone cannot lie about
    // it the way it can about credits.
    this.unsent = 0;
    this.transportFull = false;
    this.pendingBody = 0;
    // Which loopback address answered last, per port: Vite on macOS binds
    // localhost to ::1 only, other servers bind 127.0.0.1 only.
    this.addresses = new Map();
    this.stats = {
      requests: 0,
      sockets: 0,
      refused: {},
      upstreamBytes: 0,
      sentBodyBytes: 0,
      sentFrameBytes: 0,
      maxUnsent: 0,
    };
  }

  emit(data) {
    if (this.closed) return;
    this.stats.sentFrameBytes += data.length;
    this.unsent += data.length;
    this.stats.maxUnsent = Math.max(this.stats.maxUnsent, this.unsent);
    if (this.unsent >= this.hostBufferBytes) this.transportFull = true;
    this.send(data);
  }

  // The host page reports bytes it moved into the DataChannels, whose own
  // buffers it keeps small. Upstream reads resume once the backlog halves.
  drained(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    this.unsent = Math.max(0, this.unsent - bytes);
    if (this.transportFull && this.unsent < this.hostBufferBytes / 2) {
      this.transportFull = false;
      this.streams.forEach((stream) => this.resumeIfAllowed(stream));
    }
  }

  control(message) {
    this.emit(JSON.stringify(message));
  }

  refuse(code, id, kind = 'fail') {
    this.stats.refused[code] = (this.stats.refused[code] || 0) + 1;
    if (id !== undefined) this.control({ t: kind, id, code });
  }

  grant() {
    if (!this.helloReceived) return;
    if (!this.verified) {
      this.control({ t: 'denied', reason: 'unverified' });
      return;
    }
    this.control({
      t: 'grant',
      v: PROTOCOL_VERSION,
      targets: this.targets.map(({ id, label, port, prefix }) => ({
        id,
        label,
        port,
        prefix,
      })),
      limits: {
        maxBody: MAX_BODY_BYTES,
        maxStreams: MAX_STREAMS,
        frame: this.frameBytes,
      },
    });
  }

  // Called once the host knows this controller proved the password (#88).
  setVerified(verified) {
    this.verified = verified;
    if (!verified) this.abortAll('unverified');
    this.grant();
  }

  // The host user changed the approved list: end everything that used a
  // removed or changed target, then publish the new list.
  setTargets(list) {
    const next = normalizeTargets(list);
    const kept = new Set(
      next.map(({ id, port, prefix }) => `${id}:${port}:${prefix}`)
    );
    const revoked = this.targets.filter(
      ({ id, port, prefix }) => !kept.has(`${id}:${port}:${prefix}`)
    );
    this.targets = next;
    revoked.forEach(({ id }) => {
      this.jars.delete(id);
      this.streams.forEach((stream, streamId) => {
        if (stream.target.id === id) this.endStream(streamId, 'revoked');
      });
      this.sockets.forEach((socket, socketId) => {
        if (socket.target.id === id)
          this.closeSocket(socketId, 4403, 'revoked');
      });
    });
    this.grant();
  }

  receive(data) {
    if (this.closed) return;
    try {
      if (typeof data === 'string') {
        const message = parseControl(data);
        if (message) this.handleControl(message);
        else this.refuse('malformed');
        return;
      }
      const bytes = Buffer.isBuffer(data)
        ? data
        : Buffer.from(
            data.buffer ?? data,
            data.byteOffset ?? 0,
            data.byteLength
          );
      if (bytes.length < 5) {
        this.refuse('malformed');
        return;
      }
      const kind = bytes[0];
      const id = bytes.readUInt32BE(1);
      const payload = bytes.subarray(5);
      if (kind === KIND.request) this.requestBody(id, payload);
      else if (kind === KIND.wsText || kind === KIND.wsBinary)
        this.socketMessage(id, kind, payload);
      else this.refuse('malformed');
    } catch (error) {
      // A last line of defence: a frame the checks above missed costs that
      // frame, not the host.
      this.refuse('internal');
      this.log(`refused a frame: ${error?.message ?? error}`);
    }
  }

  handleControl(message) {
    if (message.t === 'hello') {
      this.helloReceived = true;
      if (Number.isInteger(message.frame))
        this.frameBytes = Math.max(
          1024,
          Math.min(MAX_FRAME_BYTES, message.frame)
        );
      this.grant();
      return;
    }
    if (message.t === 'credit') {
      const stream = this.streams.get(message.id);
      if (stream && Number.isInteger(message.bytes) && message.bytes > 0) {
        stream.unacked = Math.max(0, stream.unacked - message.bytes);
        this.resumeIfAllowed(stream);
      }
      return;
    }
    if (message.t === 'cancel') {
      if (this.streams.has(message.id)) this.endStream(message.id);
      return;
    }
    if (message.t === 'ws-close') {
      const socket = this.sockets.get(message.id);
      if (!socket) return;
      const code =
        message.code === 1000 || (message.code >= 3000 && message.code <= 4999)
          ? message.code
          : 1000;
      try {
        socket.ws.close(code, String(message.reason ?? '').slice(0, 120));
      } catch {
        socket.ws.close();
      }
      return;
    }
    if (message.t === 'req') this.startRequest(message);
    else if (message.t === 'ws-open') this.openSocket(message);
    else this.refuse('unknown-message');
  }

  // Shared checks for HTTP requests and WebSockets.
  admit(message, kind) {
    if (
      !validId(message.id) ||
      this.streams.has(message.id) ||
      this.sockets.has(message.id)
    ) {
      this.refuse('bad-id');
      return undefined;
    }
    if (!this.verified) {
      this.refuse('unverified', message.id, kind);
      return undefined;
    }
    const target = this.targets.find(({ id }) => id === message.target);
    if (!target) {
      this.refuse('not-approved', message.id, kind);
      return undefined;
    }
    if (this.streams.size + this.sockets.size >= MAX_STREAMS) {
      this.refuse('busy', message.id, kind);
      return undefined;
    }
    const resolved = resolvePath(target, message.path);
    if (!resolved.ok) {
      this.refuse(resolved.code, message.id, kind);
      return undefined;
    }
    return { target, path: resolved.path };
  }

  startRequest(message) {
    const method = String(message.method || '').toUpperCase();
    const bodyBytes = Number(message.body || 0);
    const id = validId(message.id) ? message.id : undefined;
    if (!METHODS.has(method)) {
      this.refuse('bad-method', id);
      return;
    }
    if (
      !Number.isInteger(bodyBytes) ||
      bodyBytes < 0 ||
      bodyBytes > MAX_BODY_BYTES ||
      (bodyBytes > 0 && (method === 'GET' || method === 'HEAD'))
    ) {
      this.refuse('too-large', id);
      return;
    }
    const admitted = this.admit(message, 'fail');
    if (!admitted) return;
    if (!requestHeaders(admitted.target, message.headers).ok) {
      this.refuse('bad-header', id);
      return;
    }
    if (this.pendingBody + bodyBytes > MAX_PENDING_BODY_BYTES) {
      this.refuse('busy', id);
      return;
    }
    this.stats.requests += 1;
    const stream = {
      ...admitted,
      method,
      headers: message.headers,
      bodyBytes,
      body: [],
      received: 0,
      unacked: 0,
      started: false,
      receivedAt: performance.now(),
    };
    this.streams.set(id, stream);
    if (bodyBytes === 0) {
      this.connect(id, stream);
      return;
    }
    this.pendingBody += bodyBytes;
    stream.bodyTimer = setTimeout(
      () => this.endStream(id, 'timeout'),
      this.timeouts.body
    );
    this.touchBody(id, stream);
  }

  touchBody(id, stream) {
    clearTimeout(stream.bodyIdleTimer);
    stream.bodyIdleTimer = setTimeout(
      () => this.endStream(id, 'timeout'),
      this.timeouts.bodyIdle
    );
  }

  requestBody(id, payload) {
    const stream = this.streams.get(id);
    if (!stream || stream.started) {
      this.refuse('malformed');
      return;
    }
    stream.received += payload.length;
    if (stream.received > stream.bodyBytes) {
      this.endStream(id, 'too-large');
      return;
    }
    stream.body.push(Buffer.from(payload));
    if (stream.received === stream.bodyBytes) this.connect(id, stream);
    else this.touchBody(id, stream);
  }

  // Ends the wait for a request body: its timers stop and its reservation
  // against MAX_PENDING_BODY_BYTES is released.
  settleBody(stream) {
    clearTimeout(stream.bodyTimer);
    clearTimeout(stream.bodyIdleTimer);
    if (!stream.started && stream.bodyBytes)
      this.pendingBody -= stream.bodyBytes;
    stream.started = true;
  }

  jar(target) {
    if (!this.jars.has(target.id)) this.jars.set(target.id, new CookieJar());
    return this.jars.get(target.id);
  }

  orderedAddresses(port) {
    const preferred = this.addresses.get(port);
    return preferred
      ? [preferred, ...LOOPBACK_ADDRESSES.filter((item) => item !== preferred)]
      : [...LOOPBACK_ADDRESSES];
  }

  connect(id, stream, attempt = 0) {
    this.settleBody(stream);
    const { target, path } = stream;
    const addresses = this.orderedAddresses(target.port);
    const address = addresses[attempt];
    const body = Buffer.concat(stream.body);
    stream.body = [];
    const { headers } = requestHeaders(
      target,
      stream.headers,
      this.jar(target).header(path)
    );
    if (body.length) headers['content-length'] = String(body.length);
    let request;
    try {
      request = http.request({
        host: address,
        family: address.includes(':') ? 6 : 4,
        port: target.port,
        method: stream.method,
        path,
        headers,
        agent: false,
      });
    } catch (error) {
      this.log(`refused a request: ${error.message}`);
      this.endStream(id, 'bad-request');
      return;
    }
    stream.request = request;
    clearTimeout(stream.headerTimer);
    stream.headerTimer = setTimeout(
      () => request.destroy(new Error('headers timeout')),
      this.timeouts.headers
    );
    request.on('response', (response) => {
      clearTimeout(stream.headerTimer);
      this.addresses.set(target.port, address);
      this.respond(id, stream, response);
    });
    request.on('error', (error) => {
      clearTimeout(stream.headerTimer);
      if (!this.streams.has(id) || stream.request !== request) return;
      if (
        error.code === 'ECONNREFUSED' &&
        !stream.responded &&
        attempt + 1 < addresses.length
      ) {
        stream.body = [body];
        this.connect(id, stream, attempt + 1);
        return;
      }
      let code = 'upstream-error';
      if (error.code === 'ECONNREFUSED') code = 'upstream-unavailable';
      else if (error.message === 'headers timeout') code = 'timeout';
      this.endStream(id, code);
    });
    request.end(body);
  }

  // Upstream reads pause when the phone has not confirmed a window of data or
  // when the host's own outgoing buffer is full, and resume only when neither
  // holds. Credits alone would let a phone that never reads fill host memory.
  pauseIfNeeded(id, stream) {
    if (stream.unacked >= WINDOW_BYTES && !stream.stallTimer)
      stream.stallTimer = setTimeout(
        () => this.endStream(id, 'timeout'),
        this.timeouts.creditStall
      );
    if (stream.unacked >= WINDOW_BYTES || this.transportFull)
      stream.source.pause();
  }

  resumeIfAllowed(stream) {
    if (stream.unacked < WINDOW_BYTES) {
      clearTimeout(stream.stallTimer);
      stream.stallTimer = undefined;
    }
    if (stream.source && stream.unacked < WINDOW_BYTES && !this.transportFull)
      stream.source.resume();
  }

  respond(id, stream, response) {
    stream.responded = true;
    stream.response = response;
    const { target, path } = stream;
    const { headers, cookies } = responseHeaders(response.rawHeaders);
    if (cookies.length) this.jar(target).store(cookies, path);
    const location = headers.find(([name]) => name === 'location');
    if (location && response.statusCode >= 300 && response.statusCode < 400) {
      const rewritten = rewriteLocation(target, path, location[1]);
      if (!rewritten.ok) {
        this.log(`blocked redirect to ${rewritten.destination ?? 'unknown'}`);
        response.destroy();
        this.endStream(id, 'redirect-blocked');
        return;
      }
      location[1] = rewritten.location;
    }
    const contentType = response.headers['content-type'];
    const upstreamEncoding = (
      response.headers['content-encoding'] || 'identity'
    ).toLowerCase();
    const hasBody =
      stream.method !== 'HEAD' &&
      ![204, 205, 304].includes(response.statusCode) &&
      !(response.statusCode >= 100 && response.statusCode < 200);
    let encoding = 'identity';
    let source = response;
    if (upstreamEncoding === 'gzip') encoding = 'gzip';
    else if (upstreamEncoding !== 'identity') {
      response.destroy();
      this.endStream(id, 'unsupported-encoding');
      return;
    } else if (hasBody && compressible(contentType)) {
      // Flush every write so streamed responses (SSE, logs) stay live.
      source = response.pipe(
        zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH })
      );
      encoding = 'gzip';
    }
    response.on('data', (chunk) => {
      this.stats.upstreamBytes += chunk.length;
    });
    stream.source = source;
    this.control({
      t: 'res',
      id,
      status: response.statusCode,
      statusText: response.statusMessage || '',
      headers,
      encoding,
      // Diagnostics: time spent waiting for the development server.
      upstreamMs: Math.round(performance.now() - stream.receivedAt),
    });
    if (!hasBody) {
      response.resume();
      this.endStream(id);
      return;
    }
    source.on('data', (chunk) => {
      if (!this.streams.has(id)) return;
      const size = this.frameBytes - 5;
      for (let offset = 0; offset < chunk.length; offset += size) {
        const part = chunk.subarray(offset, offset + size);
        stream.unacked += part.length;
        this.stats.sentBodyBytes += part.length;
        this.emit(binaryFrame(KIND.response, id, part));
      }
      this.pauseIfNeeded(id, stream);
    });
    source.on('end', () => this.endStream(id));
    source.on('error', () => this.endStream(id, 'upstream-error'));
    response.on('error', () => this.endStream(id, 'upstream-error'));
  }

  endStream(id, code) {
    const stream = this.streams.get(id);
    if (!stream) return;
    this.streams.delete(id);
    this.settleBody(stream);
    clearTimeout(stream.headerTimer);
    clearTimeout(stream.stallTimer);
    stream.source?.destroy?.();
    stream.response?.destroy();
    stream.request?.destroy();
    if (code) this.refuse(code, id);
    else this.control({ t: 'end', id });
  }

  openSocket(message) {
    const id = validId(message.id) ? message.id : undefined;
    const protocols = Array.isArray(message.protocols)
      ? message.protocols.slice(0, 4).map(String)
      : [];
    if (
      protocols.some((item) => !/^[\w.-]{1,64}$/.test(item)) ||
      new Set(protocols).size !== protocols.length
    ) {
      this.refuse('bad-protocol', id, 'ws-fail');
      return;
    }
    const admitted = this.admit(message, 'ws-fail');
    if (!admitted) return;
    this.stats.sockets += 1;
    const entry = { ...admitted, protocols };
    this.sockets.set(id, entry);
    this.dialSocket(id, entry, 0);
  }

  dialSocket(id, entry, attempt) {
    const { target, path, protocols } = entry;
    const addresses = this.orderedAddresses(target.port);
    const address = addresses[attempt];
    const host = address.includes(':') ? `[${address}]` : address;
    let ws;
    try {
      // Node's WebSocket client cannot override Host; Vite accepts IP hosts.
      ws = new WebSocket(`ws://${host}:${target.port}${path}`, {
        protocols,
        headers: { origin: `http://localhost:${target.port}` },
      });
    } catch (error) {
      this.log(`refused a socket: ${error.message}`);
      this.closeSocket(id, 1006, 'bad-request');
      return;
    }
    ws.binaryType = 'arraybuffer';
    entry.ws = ws;
    ws.addEventListener('open', () => {
      if (this.sockets.get(id) !== entry) {
        ws.close();
        return;
      }
      entry.open = true;
      this.addresses.set(target.port, address);
      this.control({ t: 'ws-opened', id, protocol: ws.protocol });
    });
    ws.addEventListener('message', ({ data }) => {
      if (this.sockets.get(id) !== entry) return;
      const text = typeof data === 'string';
      const payload = Buffer.from(data);
      // Socket messages cannot be paused; past twice the host buffer the
      // socket closes ("try again later") instead of growing host memory.
      if (this.unsent > 2 * this.hostBufferBytes) {
        this.closeSocket(id, 1013, 'host buffer full');
        return;
      }
      if (payload.length > this.frameBytes - 5) {
        this.closeSocket(id, 1009, 'message too large');
        return;
      }
      this.emit(binaryFrame(text ? KIND.wsText : KIND.wsBinary, id, payload));
    });
    ws.addEventListener('close', ({ code, reason }) => {
      if (this.sockets.get(id) !== entry) return;
      if (!entry.open && attempt + 1 < addresses.length) {
        this.dialSocket(id, entry, attempt + 1);
        return;
      }
      this.sockets.delete(id);
      this.control({
        t: 'ws-closed',
        id,
        code: entry.open ? code : 1006,
        reason: entry.open ? reason : 'upstream-unavailable',
      });
    });
    ws.addEventListener('error', () => {});
  }

  socketMessage(id, kind, payload) {
    const entry = this.sockets.get(id);
    if (!entry?.open) return;
    try {
      entry.ws.send(
        kind === KIND.wsText ? payload.toString('utf8') : Buffer.from(payload)
      );
    } catch {
      this.closeSocket(id, 1011, 'send failed');
    }
  }

  closeSocket(id, code, reason) {
    const entry = this.sockets.get(id);
    if (!entry) return;
    this.sockets.delete(id);
    try {
      entry.ws?.close();
    } catch {
      // Closing a socket that is still connecting can throw.
    }
    this.control({ t: 'ws-closed', id, code, reason });
  }

  abortAll(code) {
    [...this.streams.keys()].forEach((id) => this.endStream(id, code));
    [...this.sockets.keys()].forEach((id) => this.closeSocket(id, 4401, code));
  }

  // Disconnect, password change or the host turning preview off.
  close(reason = 'closed') {
    if (this.closed) return;
    this.abortAll(reason);
    this.closed = true;
    this.jars.clear();
  }
}
