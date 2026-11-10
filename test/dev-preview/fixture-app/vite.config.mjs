// Fixture API for the preview prototype. Kept free of imports so it loads from
// a temporary copy of this folder.
import { randomBytes } from 'node:crypto';

const noise = randomBytes(16 * 1024 * 1024);
const events = [];
const words =
  'export const value = "development servers send a lot of repetitive JavaScript";\n';

function json(res, value, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.end();
}

function size(url, fallback) {
  const bytes = Number(url.searchParams.get('bytes') || fallback);
  return Math.max(0, Math.min(bytes, noise.length));
}

const routes = {
  '/api/hello': (req, res) =>
    json(res, {
      ok: true,
      host: req.headers.host,
      origin: req.headers.origin ?? null,
    }),
  '/api/echo': async (req, res) => {
    const parts = [];
    for await (const part of req) parts.push(part);
    json(res, {
      method: req.method,
      contentType: req.headers['content-type'] ?? null,
      body: Buffer.concat(parts).toString('utf8'),
    });
  },
  '/api/login': (req, res) => {
    res.setHeader('set-cookie', 'fixture_session=abc123; Path=/; HttpOnly');
    json(res, { ok: true });
  },
  '/api/whoami': (req, res) =>
    json(res, { cookie: req.headers.cookie ?? null }),
  '/api/stream': async (req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    for (let index = 0; index < 3; index += 1) {
      res.write(`chunk-${index}\n`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    res.end();
  },
  '/api/events': async (req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache');
    for (let index = 0; index < 3; index += 1) {
      res.write(`data: event-${index}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    res.end();
  },
  '/api/slow': async (req, res, url) => {
    // Lets the harness see the host abort a request when the phone leaves.
    res.on('close', () => {
      if (!res.writableFinished)
        events.push({ type: 'slow-aborted', at: Date.now() });
    });
    await new Promise((resolve) =>
      setTimeout(resolve, Number(url.searchParams.get('ms') || 5000))
    );
    if (!res.destroyed) json(res, { slow: true });
  },
  // Read by the harness directly, not through the preview.
  '/__fixture/events': (req, res) => json(res, events),
  '/api/redirect/same': (req, res) => redirect(res, '/about'),
  '/api/redirect/absolute': (req, res) =>
    redirect(res, `http://${req.headers.host}/about`),
  '/api/redirect/other-port': (req, res) =>
    redirect(
      res,
      `http://127.0.0.1:${process.env.PREVIEW_FIXTURE_CANARY_PORT}/secret`
    ),
  '/api/redirect/external': (req, res) => redirect(res, 'https://example.com/'),
  '/api/text': (req, res, url) => {
    const bytes = size(url, 1024 * 1024);
    res.setHeader('content-type', 'text/javascript');
    res.end(words.repeat(Math.ceil(bytes / words.length)).slice(0, bytes));
  },
  '/api/binary': (req, res, url) => {
    res.setHeader('content-type', 'application/octet-stream');
    res.end(noise.subarray(0, size(url, 1024 * 1024)));
  },
};

export default {
  appType: 'spa',
  logLevel: 'warn',
  clearScreen: false,
  plugins: [
    {
      name: 'preview-fixture-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://fixture');
          const route = routes[url.pathname];
          if (!route) {
            next();
            return;
          }
          Promise.resolve(route(req, res, url)).catch(next);
        });
      },
    },
  ],
};
