// Injected first into every previewed document. Service workers cannot see
// WebSocket connections, so same-origin and loopback sockets (Vite HMR) are
// carried by the relay over PalmDesk's DataChannel instead.
(() => {
  function findRelay() {
    let current = window;
    while (current.parent !== current) {
      current = current.parent;
      try {
        if (current.palmdeskPreviewRelay) return current.palmdeskPreviewRelay;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  const relay = findRelay();
  if (!relay) return;
  const NativeWebSocket = window.WebSocket;
  const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
  const STATES = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];

  class PreviewWebSocket extends EventTarget {
    constructor(url, protocols = []) {
      super();
      const resolved = new URL(url, location.href);
      if (resolved.protocol === 'http:') resolved.protocol = 'ws:';
      if (resolved.protocol === 'https:') resolved.protocol = 'wss:';
      if (resolved.protocol !== 'ws:' && resolved.protocol !== 'wss:')
        throw new DOMException('Invalid WebSocket URL', 'SyntaxError');
      if (resolved.host !== location.host && !LOOPBACK.has(resolved.hostname))
        return new NativeWebSocket(url, protocols);
      this.url = resolved.href;
      this.readyState = 0;
      this.protocol = '';
      this.extensions = '';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.handlers = {};
      const list = typeof protocols === 'string' ? [protocols] : [...protocols];
      this.port = relay.openSocket(this.url, list);
      if (!this.port) {
        setTimeout(() => this.finish(1006, '', false));
        return;
      }
      this.port.onmessage = ({ data }) => this.receive(data);
    }

    receive(data) {
      if (data?.type === 'open' && this.readyState === 0) {
        this.readyState = 1;
        this.protocol = data.protocol || '';
        this.fire(new Event('open'));
      } else if (data?.type === 'message' && this.readyState === 1) {
        let payload = data.data;
        if (payload instanceof ArrayBuffer && this.binaryType === 'blob')
          payload = new Blob([payload]);
        this.fire(
          new MessageEvent('message', {
            data: payload,
            origin: new URL(this.url).origin,
          })
        );
      } else if (data?.type === 'closed')
        this.finish(data.code || 1006, data.reason || '', data.code === 1000);
    }

    finish(code, reason, clean) {
      if (this.readyState === 3) return;
      const failed = this.readyState === 0 || code === 1006;
      this.readyState = 3;
      this.port?.close();
      if (failed) this.fire(new Event('error'));
      this.fire(new CloseEvent('close', { code, reason, wasClean: clean }));
    }

    fire(event) {
      this.dispatchEvent(event);
      const handler = this.handlers[event.type];
      if (typeof handler === 'function') handler.call(this, event);
    }

    send(data) {
      if (this.readyState === 0)
        throw new DOMException('Still connecting', 'InvalidStateError');
      if (this.readyState !== 1) return;
      if (data instanceof Blob)
        data.arrayBuffer().then((buffer) => this.send(buffer));
      else if (ArrayBuffer.isView(data))
        this.port.postMessage({
          type: 'send',
          data: data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ),
        });
      else if (data instanceof ArrayBuffer)
        this.port.postMessage({ type: 'send', data: data.slice(0) });
      else this.port.postMessage({ type: 'send', data: String(data) });
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      this.readyState = 2;
      this.port.postMessage({ type: 'close', code, reason });
    }
  }

  ['open', 'message', 'error', 'close'].forEach((type) => {
    Object.defineProperty(PreviewWebSocket.prototype, `on${type}`, {
      get() {
        return this.handlers[type] ?? null;
      },
      set(value) {
        this.handlers[type] = value;
      },
    });
  });
  STATES.forEach((name, value) => {
    PreviewWebSocket[name] = value;
    PreviewWebSocket.prototype[name] = value;
  });
  window.WebSocket = PreviewWebSocket;

  // The preview origin is shared and owned by PalmDesk's worker; apps cannot
  // install their own.
  if (navigator.serviceWorker)
    navigator.serviceWorker.register = () =>
      Promise.reject(
        new DOMException(
          'Service workers are not available in PalmDesk previews',
          'SecurityError'
        )
      );
})();
