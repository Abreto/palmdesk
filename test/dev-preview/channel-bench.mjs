// Raw DataChannel behaviour between two headless Chromium pages, without the
// preview transport: throughput by message size, and how long a small message
// waits while 8 MiB is queued, on the same channel and on a second channel.
//
//   lockf -k "$(git rev-parse --git-common-dir)/browser-smoke.lock" \
//     node test/dev-preview/channel-bench.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({
  executablePath: process.env.SMOKE_BROWSER_EXECUTABLE || undefined,
  headless: true,
  args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
});

async function connect() {
  const [sender, receiver] = await Promise.all(
    [0, 1].map(async () => (await browser.newContext()).newPage())
  );
  const setup = () => {
    window.peer = new RTCPeerConnection();
    window.candidates = [];
    window.channels = {};
    window.peer.onicecandidate = ({ candidate }) =>
      candidate && window.candidates.push(candidate.toJSON());
    window.peer.ondatachannel = ({ channel }) => {
      channel.binaryType = 'arraybuffer';
      window.channels[channel.label] = channel;
    };
  };
  await sender.evaluate(setup);
  await receiver.evaluate(setup);
  const offer = await sender.evaluate(async () => {
    ['bulk', 'probe'].forEach((label) => {
      window.channels[label] = window.peer.createDataChannel(label);
      window.channels[label].binaryType = 'arraybuffer';
    });
    await window.peer.setLocalDescription(await window.peer.createOffer());
    return window.peer.localDescription.toJSON();
  });
  const answer = await receiver.evaluate(async (description) => {
    await window.peer.setRemoteDescription(description);
    await window.peer.setLocalDescription(await window.peer.createAnswer());
    return window.peer.localDescription.toJSON();
  }, offer);
  await sender.evaluate(
    (description) => window.peer.setRemoteDescription(description),
    answer
  );
  // Trickle candidates both ways until the channels open.
  const exchange = async (from, to) => {
    const list = await from.evaluate(() => window.candidates.splice(0));
    await to.evaluate(
      (items) =>
        Promise.all(items.map((item) => window.peer.addIceCandidate(item))),
      list
    );
  };
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await exchange(sender, receiver);
    await exchange(receiver, sender);
    const open = await receiver.evaluate(
      () =>
        window.channels.bulk?.readyState === 'open' &&
        window.channels.probe?.readyState === 'open'
    );
    if (open) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // The receiver echoes text messages on the channel they arrived on.
  await receiver.evaluate(() =>
    Object.values(window.channels).forEach((channel) => {
      channel.onmessage = ({ data }) => {
        if (typeof data === 'string') channel.send(data);
      };
    })
  );
  return { sender, receiver };
}

const { sender, receiver } = await connect();
console.log(
  'SCTP max-message-size:',
  await sender.evaluate(() => window.peer.sctp.maxMessageSize)
);

for (const size of [16 * 1024, 64 * 1024, 256 * 1024]) {
  const total = 32 * 1024 * 1024;
  const received = receiver.evaluate(
    (bytes) =>
      new Promise((resolve) => {
        let count = 0;
        const start = performance.now();
        window.channels.bulk.onmessage = ({ data }) => {
          count += data.byteLength ?? 0;
          if (count >= bytes) resolve(performance.now() - start);
        };
      }),
    total
  );
  await sender.evaluate(
    async ({ bytes, length }) => {
      const channel = window.channels.bulk;
      const chunk = new Uint8Array(length);
      channel.bufferedAmountLowThreshold = 1024 * 1024;
      for (let sent = 0; sent < bytes; sent += length) {
        while (channel.bufferedAmount > 4 * 1024 * 1024)
          await new Promise((resolve) => {
            channel.onbufferedamountlow = resolve;
          });
        channel.send(chunk);
      }
    },
    { bytes: total, length: size }
  );
  const ms = await received;
  console.log(
    `${size / 1024} KiB messages: ${((total * 8) / (ms / 1000) / 1e6).toFixed(0)} Mbit/s`
  );
}

await receiver.evaluate(() => {
  window.channels.bulk.onmessage = ({ data }) => {
    if (typeof data === 'string') window.channels.bulk.send(data);
  };
});
for (const label of ['bulk', 'probe'])
  for (const cap of [256 * 1024, 4 * 1024 * 1024]) {
    const times = await sender.evaluate(
      async ({ probeLabel, bufferCap }) => {
        const bulk = window.channels.bulk;
        const probe = window.channels[probeLabel];
        const chunk = new Uint8Array(64 * 1024 - 5);
        bulk.bufferedAmountLowThreshold = bufferCap / 4;
        let sent = 0;
        const pump = (async () => {
          while (sent < 8 * 1024 * 1024) {
            while (bulk.bufferedAmount > bufferCap)
              await new Promise((resolve) => {
                bulk.onbufferedamountlow = resolve;
              });
            bulk.send(chunk);
            sent += chunk.length;
          }
        })();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const rounds = [];
        for (let index = 0; index < 5; index += 1) {
          const start = performance.now();
          await new Promise((resolve) => {
            const echo = ({ data }) => {
              if (data !== `probe-${index}`) return;
              probe.removeEventListener('message', echo);
              resolve();
            };
            probe.addEventListener('message', echo);
            probe.send(`probe-${index}`);
          });
          rounds.push(Math.round(performance.now() - start));
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await pump;
        return rounds;
      },
      { probeLabel: label, bufferCap: cap }
    );
    console.log(
      `probe on the ${label === 'bulk' ? 'same' : 'second'} channel, sender buffer ${cap / 1024} KiB: ${times.join(', ')} ms`
    );
  }
await browser.close();
