// Preview-origin service worker. It turns every request from the preview
// frame into a message for PalmDesk, which carries it to the host over the
// WebRTC DataChannel. It never fetches anything from the network itself.
const PREFIX = '/__palmdesk_preview/';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const HEAD_TIMEOUT_MS = 60_000;
const WINDOW_BYTES = 1024 * 1024;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const same = url.origin === self.location.origin;
  // The relay and this worker load from the preview server itself.
  if (same && url.pathname.startsWith(PREFIX)) return;
  // Other sites (CDNs, APIs on the internet) load directly on the phone.
  // Loopback URLs meant the host's localhost, never the phone's.
  if (!same && !LOOPBACK.has(url.hostname)) return;
  event.respondWith(forward(event.request));
});

function problem(request, status, code, message) {
  const headers = { 'x-palmdesk-preview-error': code };
  if (request.mode === 'navigate') {
    headers['content-type'] = 'text/html; charset=utf-8';
    return new Response(
      `<!doctype html><meta name="viewport" content="width=device-width"><title>Preview unavailable</title><body style="font:16px system-ui;margin:24px"><h1 style="font-size:20px">Preview unavailable</h1><p id="palmdesk-preview-error" data-code="${code}">${message}</p></body>`,
      { status, headers }
    );
  }
  headers['content-type'] = 'text/plain; charset=utf-8';
  return new Response(`${code}: ${message}`, { status, headers });
}

const MESSAGES = {
  disconnected: [503, 'PalmDesk is not connected to the computer.'],
  revoked: [403, 'The computer stopped sharing this address.'],
  unverified: [403, 'The computer has not verified this device yet.'],
  'not-approved': [403, 'This address is not on the computer’s preview list.'],
  'not-routed': [403, 'Only addresses the computer approved can be previewed.'],
  'outside-prefix': [403, 'This path is outside the approved preview path.'],
  'bad-path': [400, 'The request path is not allowed.'],
  'bad-method': [405, 'This request method is not supported in previews.'],
  'bad-header': [400, 'A request header could not be sent to the computer.'],
  'bad-request': [400, 'The request could not be sent to the computer.'],
  internal: [500, 'The computer refused this request.'],
  'too-large': [413, 'The request body is too large for a preview.'],
  busy: [503, 'Too many preview requests are open.'],
  'upstream-unavailable': [
    502,
    'Nothing is listening on this port on the computer. Start the development server, then reload.',
  ],
  'upstream-error': [502, 'The development server closed the connection.'],
  'redirect-blocked': [
    502,
    'The page redirected outside the approved address, so the preview stopped it.',
  ],
  timeout: [504, 'The development server did not answer in time.'],
};

function failure(request, code) {
  const [status, message] = MESSAGES[code] || [502, 'The preview failed.'];
  return problem(request, status, code, message);
}

function fragment(client) {
  return new URLSearchParams(new URL(client.url).hash.slice(1));
}

async function relayClient() {
  const list = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  return list.find(
    (client) =>
      new URL(client.url).pathname === `${PREFIX}relay.html` &&
      fragment(client).get('mode') !== 'inspect'
  );
}

// One cache per connection, named after the relay's nonce: a cache left by
// a teardown that never finished is not read by the next connection.
function cacheName(relay) {
  const nonce = fragment(relay).get('nonce');
  return nonce ? `palmdesk-preview-${nonce}` : undefined;
}

function cacheable(request) {
  return (
    request.method === 'GET' &&
    request.mode !== 'navigate' &&
    !request.headers.has('if-none-match') &&
    !request.headers.has('range')
  );
}

async function cached(request, name) {
  if (!name || !cacheable(request)) return undefined;
  try {
    const match = await (await caches.open(name)).match(request.url);
    const etag = match?.headers.get('etag');
    return etag ? { response: match, etag } : undefined;
  } catch {
    return undefined;
  }
}

function waitForHead(port) {
  return new Promise((resolve) => {
    const early = [];
    const timer = setTimeout(
      () => resolve({ type: 'fail', code: 'timeout' }),
      HEAD_TIMEOUT_MS
    );
    port.onmessage = ({ data }) => {
      if (data?.type === 'head' || data?.type === 'fail') {
        clearTimeout(timer);
        port.onmessage = null;
        resolve({ ...data, early });
      } else early.push(data);
    };
  });
}

// Chunks arrive as port messages. Credits go back as the page consumes them,
// so a slow reader stops the host instead of filling memory.
function bodyStream(port, early) {
  let pending = 0;
  return new ReadableStream(
    {
      start(controller) {
        const handle = (data) => {
          if (data?.type === 'chunk' && data.data instanceof ArrayBuffer) {
            controller.enqueue(new Uint8Array(data.data));
            if (controller.desiredSize > 0)
              port.postMessage({ type: 'credit', bytes: data.data.byteLength });
            else pending += data.data.byteLength;
          } else if (data?.type === 'end') {
            controller.close();
            port.close();
          } else if (data?.type === 'fail') {
            controller.error(new TypeError(`preview ${data.code}`));
            port.close();
          }
        };
        early.forEach(handle);
        port.onmessage = ({ data }) => handle(data);
      },
      pull() {
        if (pending) port.postMessage({ type: 'credit', bytes: pending });
        pending = 0;
      },
      cancel() {
        port.postMessage({ type: 'cancel' });
        port.close();
      },
    },
    { highWaterMark: WINDOW_BYTES, size: (chunk) => chunk.byteLength }
  );
}

const SHIM = '<script src="/__palmdesk_preview/client.js"></script>';

// Every document gets the client shim first, so it can route WebSockets
// (Vite HMR) through PalmDesk; service workers cannot intercept them.
function injectShim(html) {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${SHIM}${html.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype[0].length : 0;
  return `${html.slice(0, at)}${SHIM}${html.slice(at)}`;
}

async function forward(request) {
  const started = performance.now();
  const relay = await relayClient();
  const relayFound = performance.now();
  if (!relay) return failure(request, 'disconnected');
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? null
      : await request.arrayBuffer();
  const headers = [...request.headers];
  const namespace = cacheName(relay);
  const entry = await cached(request, namespace);
  const cacheChecked = performance.now();
  if (entry) headers.push(['if-none-match', entry.etag]);
  const { port1, port2 } = new MessageChannel();
  relay.postMessage(
    {
      type: 'fetch',
      url: request.url,
      method: request.method,
      headers,
      body,
      navigate: request.mode === 'navigate',
    },
    body ? [port2, body] : [port2]
  );
  const head = await waitForHead(port1);
  // Diagnostics for the ADR: where a request's time goes before headers.
  const timing = [
    `relay=${(relayFound - started).toFixed(1)}`,
    `cache=${(cacheChecked - relayFound).toFixed(1)}`,
    `head=${(performance.now() - cacheChecked).toFixed(1)}`,
    `upstream=${head.upstreamMs ?? ''}`,
  ].join(';');
  if (head.type === 'fail') {
    port1.close();
    return failure(request, head.code);
  }
  if (head.status === 304 && entry) {
    port1.postMessage({ type: 'cancel' });
    port1.close();
    return entry.response;
  }
  let init;
  try {
    init = {
      status: head.status,
      statusText: /^[\t\x20-\x7e]*$/.test(head.statusText)
        ? head.statusText
        : '',
      headers: new Headers(head.headers),
    };
    init.headers.set('x-palmdesk-preview-timing', timing);
    if (head.status < 200 || head.status > 599) throw new RangeError();
  } catch {
    port1.postMessage({ type: 'cancel' });
    port1.close();
    return failure(request, 'upstream-error');
  }
  if ([101, 204, 205, 304].includes(head.status) || request.method === 'HEAD') {
    port1.postMessage({ type: 'cancel' });
    port1.close();
    return new Response(null, init);
  }
  let stream = bodyStream(port1, head.early);
  if (head.encoding === 'gzip')
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const contentType = init.headers.get('content-type') || '';
  if (
    (request.mode === 'navigate' || request.destination === 'iframe') &&
    contentType.includes('text/html')
  ) {
    const html = await new Response(stream).text();
    return new Response(injectShim(html), init);
  }
  const response = new Response(stream, init);
  if (
    namespace &&
    cacheable(request) &&
    head.status === 200 &&
    response.headers.has('etag') &&
    !/no-store/i.test(response.headers.get('cache-control') || '')
  ) {
    // Keep a validated copy: the browser's HTTP cache never sees responses
    // made here, so without this every reload re-downloads every module.
    const copy = response.clone();
    caches
      .open(namespace)
      .then((cache) => cache.put(request.url, copy))
      .catch(() => {});
  }
  return response;
}
