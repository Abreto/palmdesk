// Runs the prototype servers and gateways on their own thread, so the
// measurement harness (Playwright) does not share their event loop, much as
// PalmDesk's gateway would run in the Electron main process.
import { parentPort, workerData } from 'node:worker_threads';

import { startPrototype } from './server.mjs';

const prototype = await startPrototype(workerData);

function stats() {
  const total = {
    requests: 0,
    sockets: 0,
    upstreamBytes: 0,
    sentBodyBytes: 0,
    sentFrameBytes: 0,
    refused: {},
    open: 0,
    maxUnsent: 0,
    socketProtocols: [],
  };
  prototype.gateways.forEach((gateway) => {
    Object.keys(total).forEach((key) => {
      if (
        typeof total[key] === 'number' &&
        !['open', 'maxUnsent'].includes(key)
      )
        total[key] += gateway.stats[key];
    });
    total.maxUnsent = Math.max(total.maxUnsent, gateway.stats.maxUnsent);
    Object.entries(gateway.stats.refused).forEach(([code, count]) => {
      total.refused[code] = (total.refused[code] || 0) + count;
    });
    total.open += gateway.streams.size + gateway.sockets.size;
    gateway.sockets.forEach(({ protocols }) =>
      total.socketProtocols.push(protocols.join())
    );
  });
  return total;
}

const commands = {
  setTargets: (list) => prototype.setTargets(list),
  setVerified: (value) => prototype.setVerified(value),
  disconnectAll: () => prototype.disconnectAll(),
  stats,
  close: () => prototype.close(),
};

parentPort.on('message', async ({ id, command, args }) => {
  parentPort.postMessage({ id, result: await commands[command](args) });
});
parentPort.postMessage({
  ready: {
    controllerUrl: prototype.controllerUrl,
    hostUrl: prototype.hostUrl,
    palmdeskPort: prototype.palmdeskPort,
    previewOrigin: prototype.previewOrigin,
  },
});
