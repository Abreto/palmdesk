// Host-side policy for the development-server preview prototype (#26). The
// host, never the controller, decides which loopback ports and paths a
// preview may reach. Everything a controller sends is checked here.

// Ports that browsers refuse for HTTP (Fetch standard, "bad port").
const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

export const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1'];
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
export const METHODS = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

// Request headers the controller may not choose. The host sets Host, Origin,
// Referer and Cookie itself; the rest are hop-by-hop or describe the phone's
// connection rather than the request.
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'origin',
  'referer',
  'cookie',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
  'forwarded',
  'via',
  'accept-encoding',
  'service-worker',
  'service-worker-navigation-preload',
]);

// Response headers that must not reach the preview document: hop-by-hop
// fields, cookies (kept in the host's jar), framing protection that would
// stop the preview frame, and fields with origin-wide effects.
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
  'set-cookie',
  'set-cookie2',
  'x-frame-options',
  'strict-transport-security',
  'alt-svc',
  'clear-site-data',
  'service-worker-allowed',
  'nel',
  'report-to',
  'reporting-endpoints',
]);

export function normalizeTargets(list) {
  if (!Array.isArray(list)) throw new TypeError('targets must be an array');
  const ids = new Set();
  return list.map((entry) => {
    const id = String(entry?.id ?? '');
    if (!/^[a-z0-9-]{1,32}$/.test(id) || ids.has(id))
      throw new Error(`invalid target id: ${id}`);
    ids.add(id);
    const port = Number(entry.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(`invalid port for ${id}`);
    if (BAD_PORTS.has(port)) throw new Error(`port ${port} is not allowed`);
    const prefix = entry.prefix ?? '/';
    if (
      typeof prefix !== 'string' ||
      !prefix.startsWith('/') ||
      !prefix.endsWith('/') ||
      new URL(prefix, 'http://h').pathname !== prefix ||
      /%2f|%5c|%2e/i.test(prefix)
    )
      throw new Error(`invalid path prefix for ${id}`);
    const label = String(entry.label ?? `localhost:${port}`).slice(0, 64);
    return Object.freeze({ id, port, prefix, label });
  });
}

export function inPrefix(pathname, prefix) {
  return (
    prefix === '/' ||
    pathname.startsWith(prefix) ||
    pathname === prefix.slice(0, -1)
  );
}

// Returns the normalized origin-form request target the host will send to
// 127.0.0.1/::1 on the target's port, or the reason it is refused. The port
// always comes from the host's list, so a path cannot name another server.
export function resolvePath(target, raw) {
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > 8192)
    return { ok: false, code: 'bad-path' };
  if (!raw.startsWith('/') || raw[1] === '/' || raw[1] === '\\')
    return { ok: false, code: 'bad-path' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f\\#]/.test(raw) || /%2f|%5c/i.test(raw))
    return { ok: false, code: 'bad-path' };
  let url;
  try {
    url = new URL(raw, 'http://preview.invalid');
  } catch {
    return { ok: false, code: 'bad-path' };
  }
  if (url.host !== 'preview.invalid') return { ok: false, code: 'bad-path' };
  if (!inPrefix(url.pathname, target.prefix))
    return { ok: false, code: 'outside-prefix' };
  return { ok: true, path: `${url.pathname}${url.search}` };
}

export function isLoopbackName(hostname) {
  return LOOPBACK_NAMES.has(hostname);
}

// Redirects are returned to the browser, never followed on the host. A
// Location on the same target becomes a path on the preview origin; anything
// else (another port, the LAN, the internet) is refused.
export function rewriteLocation(target, requestPath, location) {
  let url;
  try {
    url = new URL(location, `http://localhost:${target.port}${requestPath}`);
  } catch {
    return { ok: false, code: 'redirect-blocked' };
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (
    url.protocol !== 'http:' ||
    !isLoopbackName(url.hostname) ||
    port !== target.port ||
    url.username ||
    url.password
  )
    return {
      ok: false,
      code: 'redirect-blocked',
      destination: /^https?:$/.test(url.protocol) ? url.origin : url.protocol,
    };
  const resolved = resolvePath(target, `${url.pathname}${url.search}`);
  if (!resolved.ok) return { ok: false, code: 'redirect-blocked' };
  return { ok: true, location: `${resolved.path}${url.hash}` };
}

function validHeader(name, value) {
  return (
    typeof name === 'string' &&
    typeof value === 'string' &&
    /^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/i.test(name) &&
    value.length <= 8192 &&
    // eslint-disable-next-line no-control-regex
    !/[\r\n\u0000]/.test(value)
  );
}

export function requestHeaders(target, entries, cookie) {
  const headers = {};
  if (Array.isArray(entries))
    entries.slice(0, 100).forEach((entry) => {
      if (!Array.isArray(entry)) return;
      const [name, value] = entry;
      if (!validHeader(name, value)) return;
      const key = name.toLowerCase();
      if (
        DROPPED_REQUEST_HEADERS.has(key) ||
        key.startsWith('sec-') ||
        key.startsWith('proxy-') ||
        key.startsWith('x-forwarded-')
      )
        return;
      headers[key] = value;
    });
  const origin = `http://localhost:${target.port}`;
  headers.host = `localhost:${target.port}`;
  // Dev servers compare Origin with Host for CSRF and WebSocket checks.
  headers.origin = origin;
  headers.referer = `${origin}/`;
  headers['accept-encoding'] = 'identity';
  if (cookie) headers.cookie = cookie;
  return headers;
}

export function responseHeaders(rawHeaders) {
  const headers = [];
  const cookies = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    const value = rawHeaders[index + 1];
    if (name === 'set-cookie') cookies.push(value);
    else if (name === 'content-security-policy') {
      // The preview is meant to be framed by PalmDesk; keep the rest.
      const kept = value
        .split(';')
        .filter((part) => !/^\s*frame-ancestors\b/i.test(part))
        .join(';')
        .trim();
      if (kept) headers.push([name, kept]);
    } else if (!DROPPED_RESPONSE_HEADERS.has(name)) headers.push([name, value]);
  }
  return { headers, cookies };
}

const COMPRESSIBLE =
  /^(text\/|application\/(javascript|json|xml|wasm|manifest\+json)|image\/svg\+xml)/i;

export function compressible(contentType) {
  return COMPRESSIBLE.test(contentType || '');
}

// A deliberately small cookie jar: host-only cookies for one target, kept in
// host memory for one controller connection. The browser never sees them.
export class CookieJar {
  constructor(now = () => Date.now()) {
    this.cookies = new Map();
    this.now = now;
  }

  store(setCookies, requestPath) {
    setCookies.forEach((line) => {
      const [pair, ...attributes] = String(line).split(';');
      const split = pair.indexOf('=');
      if (split < 1) return;
      const name = pair.slice(0, split).trim();
      const value = pair.slice(split + 1).trim();
      let path = requestPath.split('?')[0].replace(/\/[^/]*$/, '') || '/';
      let expires;
      attributes.forEach((attribute) => {
        const [key, ...rest] = attribute.split('=');
        const option = key.trim().toLowerCase();
        const data = rest.join('=').trim();
        if (option === 'path' && data.startsWith('/')) path = data;
        else if (option === 'max-age' && /^-?\d+$/.test(data))
          expires = this.now() + Number(data) * 1000;
        else if (option === 'expires' && expires === undefined) {
          const time = Date.parse(data);
          if (!Number.isNaN(time)) expires = time;
        }
      });
      const key = `${name};${path}`;
      if (expires !== undefined && expires <= this.now())
        this.cookies.delete(key);
      else this.cookies.set(key, { name, value, path, expires });
    });
  }

  header(requestPath) {
    const pathname = requestPath.split('?')[0];
    const now = this.now();
    const values = [];
    this.cookies.forEach((cookie, key) => {
      if (cookie.expires !== undefined && cookie.expires <= now) {
        this.cookies.delete(key);
        return;
      }
      if (
        inPrefix(
          pathname,
          cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`
        )
      )
        values.push(`${cookie.name}=${cookie.value}`);
    });
    return values.join('; ');
  }

  clear() {
    this.cookies.clear();
  }
}
