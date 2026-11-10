// Local servers for the preview prototype: a "PalmDesk" origin with the
// controller and host pages plus signaling, a separate preview origin that
// serves only the relay, worker and shim, and one gateway per controller.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PreviewGateway } from './gateway.mjs';

const require = createRequire(import.meta.url);
const { Server } = require('socket.io');

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function listen(server, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

async function serveFile(res, file, headers = {}) {
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)],
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(await readFile(file));
}

export async function startPrototype({
  targets,
  verified = false,
  palmdeskHost = 'palmdesk.localhost',
  previewHost = 'preview.localhost',
  extraParentHosts = [],
  listenHost = '127.0.0.1',
  tls,
  log = () => {},
}) {
  const scheme = tls ? 'https' : 'http';
  const create = (handler) =>
    tls ? https.createServer(tls, handler) : http.createServer(handler);
  let previewOrigin = '';
  let parentOrigins = [];

  const palmdesk = create(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://palmdesk');
    if (pathname === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ previewOrigin }));
      return;
    }
    const files = [
      'controller.html',
      'controller.js',
      'bridge.js',
      'host.html',
      'host.js',
    ];
    const name = pathname.slice(1);
    if (!files.includes(name)) {
      res.writeHead(404).end();
      return;
    }
    await serveFile(res, path.join(here, 'public', name), {
      // The preview origin is the only frame PalmDesk may embed.
      'content-security-policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; frame-src ${previewOrigin}; object-src 'none'; base-uri 'none'`,
    });
  });

  const preview = create(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://preview');
    const name = pathname.startsWith('/__palmdesk_preview/')
      ? pathname.slice('/__palmdesk_preview/'.length)
      : '';
    const ancestors = `frame-ancestors ${parentOrigins.join(' ')}`;
    if (name === 'sw.js')
      await serveFile(res, path.join(here, 'preview-origin', name), {
        // The worker lives under /__palmdesk_preview/ but controls '/'.
        'service-worker-allowed': '/',
      });
    else if (['client.js', 'relay.js'].includes(name))
      await serveFile(res, path.join(here, 'preview-origin', name));
    else if (name === 'relay.html')
      await serveFile(res, path.join(here, 'preview-origin', name), {
        'content-security-policy': `default-src 'self'; style-src 'unsafe-inline'; ${ancestors}`,
      });
    else {
      // Reached only when no worker controls the page, for example a preview
      // URL opened outside PalmDesk.
      res.writeHead(404, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': `default-src 'none'; ${ancestors}`,
      });
      res.end(
        '<!doctype html><title>Not connected</title><p id="palmdesk-preview-error" data-code="not-connected">Open previews from PalmDesk.</p>'
      );
    }
  });

  const palmdeskPort = await listen(palmdesk, listenHost);
  const previewPort = await listen(preview, listenHost);
  const palmdeskOrigin = `${scheme}://${palmdeskHost}:${palmdeskPort}`;
  previewOrigin = `${scheme}://${previewHost}:${previewPort}`;
  parentOrigins = [palmdeskHost, ...extraParentHosts].map(
    (host) => `${scheme}://${host}:${palmdeskPort}`
  );

  const io = new Server(palmdesk, { maxHttpBufferSize: 4 * 1024 * 1024 });
  const gateways = new Map();
  let hostSocket;
  let currentTargets = targets;
  let currentVerified = verified;

  function gatewayFor(id) {
    if (!gateways.has(id))
      gateways.set(
        id,
        new PreviewGateway({
          targets: currentTargets,
          verified: currentVerified,
          send: (data) => hostSocket?.emit('preview-out', id, data),
          log,
        })
      );
    return gateways.get(id);
  }

  io.on('connection', (socket) => {
    const { role } = socket.handshake.query;
    if (role === 'host') {
      hostSocket = socket;
      socket.on('signal', (id, message) => io.to(id).emit('signal', message));
      socket.on('preview-in', (id, data) => gatewayFor(id).receive(data));
      socket.on('preview-drained', (id, bytes) =>
        gateways.get(id)?.drained(bytes)
      );
      socket.on('preview-close', (id) => {
        gateways.get(id)?.close('disconnected');
        gateways.delete(id);
      });
    } else if (role === 'controller') {
      socket.on('signal', (message) =>
        hostSocket?.emit('signal', socket.id, message)
      );
      socket.on('disconnect', () => hostSocket?.emit('peer-gone', socket.id));
    } else socket.disconnect(true);
  });

  return {
    palmdeskOrigin,
    previewOrigin,
    controllerUrl: `${palmdeskOrigin}/controller.html`,
    hostUrl: `${palmdeskOrigin}/host.html`,
    palmdeskPort,
    gateways,
    // Host-side decisions, as the host user would make them in PalmDesk.
    setVerified(value) {
      currentVerified = value;
      gateways.forEach((gateway) => gateway.setVerified(value));
    },
    setTargets(list) {
      currentTargets = list;
      gateways.forEach((gateway) => gateway.setTargets(list));
    },
    disconnectAll() {
      [...gateways.keys()].forEach((id) =>
        hostSocket?.emit('disconnect-peer', id)
      );
    },
    async close() {
      gateways.forEach((gateway) => gateway.close('closed'));
      io.close();
      await Promise.all(
        [palmdesk, preview].map(
          (server) =>
            new Promise((resolve) => {
              server.closeAllConnections?.();
              server.close(resolve);
            })
        )
      );
    },
  };
}
