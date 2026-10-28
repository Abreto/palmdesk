// The relay is the preview origin's fixed page inside PalmDesk's preview
// frame. It registers the service worker, holds the MessagePort that PalmDesk
// handed it, and hosts the previewed app in a nested frame. Anything on the
// preview origin, including the app, can reach this page, so the port it
// holds grants nothing beyond preview requests that the host checks again.
const params = new URLSearchParams(location.hash.slice(1));
const nonce = params.get('nonce') || '';
const parentOrigin = params.get('parent') || '';
let bridge;
let app;

function tellParent(message) {
  window.parent.postMessage({ ...message, nonce }, parentOrigin);
}

function tellBridge(message, transfer = []) {
  bridge?.postMessage(message, transfer);
}

function unsupported() {
  if (!window.isSecureContext) return 'insecure-context';
  if (!('serviceWorker' in navigator)) return 'no-service-worker';
  if (typeof DecompressionStream !== 'function') return 'no-decompression';
  return '';
}

function activated(registration) {
  const worker =
    registration.active || registration.waiting || registration.installing;
  if (worker?.state === 'activated') return Promise.resolve();
  return new Promise((resolve, reject) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve();
      else if (worker.state === 'redundant')
        reject(new Error('service worker became redundant'));
    });
  });
}

async function clearStorage() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((item) => item.unregister()));
  localStorage.clear();
  sessionStorage.clear();
  await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
  const databases = (await indexedDB.databases?.()) || [];
  databases.forEach(({ name }) => name && indexedDB.deleteDatabase(name));
}

async function inspect() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  return {
    registrations: registrations.length,
    localStorage: localStorage.length,
    caches: (await caches.keys()).length,
  };
}

function onWorkerMessage(event) {
  const { data } = event;
  if (data?.type !== 'fetch' || !event.ports[0]) return;
  const transfer = [event.ports[0]];
  if (data.body instanceof ArrayBuffer) transfer.push(data.body);
  tellBridge(data, transfer);
}

async function start(path) {
  const registration = await navigator.serviceWorker.register(
    '/__palmdesk_preview/sw.js',
    { scope: '/', updateViaCache: 'none' }
  );
  await activated(registration);
  navigator.serviceWorker.onmessage = onWorkerMessage;
  app = document.createElement('iframe');
  app.title = 'Preview';
  app.src = path;
  app.addEventListener('load', () => {
    let current = '';
    try {
      current = `${app.contentWindow.location.pathname}${app.contentWindow.location.search}`;
    } catch {
      // The app navigated to another origin.
    }
    tellBridge({ type: 'loaded', path: current });
  });
  document.body.append(app);
  tellBridge({ type: 'ready' });
}

async function onBridgeMessage({ data }) {
  if (data?.type === 'teardown') {
    app?.remove();
    app = undefined;
    try {
      await clearStorage();
    } finally {
      tellBridge({ type: 'teardown-done' });
      bridge.close();
      bridge = undefined;
    }
  } else if (data?.type === 'reload') app?.contentWindow.location.reload();
  else if (data?.type === 'navigate' && typeof data.path === 'string')
    app?.contentWindow.location.assign(data.path);
  else if (data?.type === 'inspect')
    tellBridge({ type: 'inspected', ...(await inspect()) });
}

// The client shim in each app document finds this object through its
// same-origin parent chain and opens WebSockets with it.
window.palmdeskPreviewRelay = {
  openSocket(url, protocols) {
    if (!bridge) return undefined;
    const { port1, port2 } = new MessageChannel();
    tellBridge({ type: 'ws-open', url, protocols }, [port2]);
    return port1;
  },
};

window.addEventListener('message', (event) => {
  if (
    event.source !== window.parent ||
    event.origin !== parentOrigin ||
    event.data?.type !== 'relay-init' ||
    event.data.nonce !== nonce ||
    !event.ports[0] ||
    bridge
  )
    return;
  [bridge] = event.ports;
  bridge.onmessage = onBridgeMessage;
  if (event.data.inspectOnly) return;
  start(event.data.path || '/').catch((error) =>
    tellBridge({ type: 'error', code: 'registration', message: String(error) })
  );
});

const ancestor = location.ancestorOrigins?.[0];
if (
  !parentOrigin ||
  window.parent === window ||
  (ancestor && ancestor !== parentOrigin)
)
  document.body.textContent = 'Open previews from PalmDesk.';
else {
  const reason = unsupported();
  tellParent({ type: 'relay-hello', unsupported: reason || undefined });
}
