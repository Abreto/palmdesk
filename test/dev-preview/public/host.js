// Stand-in for the PalmDesk host renderer. It owns the WebRTC side and relays
// preview frames to the gateway; policy lives in the gateway, as it would in
// the Electron main process.
const socket = window.io({
  query: { role: 'host' },
  transports: ['websocket'],
});
const peers = new Map();
const HIGH_WATER = 256 * 1024;
const LOW_WATER = 64 * 1024;
// Diagnostics: when each request arrived and when its head left again.
const timings = new Map();
window.hostDebug = { timings };

function render() {
  document.querySelector('#peers').textContent = `${peers.size} controllers`;
}

function close(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.connection.close();
  socket.emit('preview-close', id);
  render();
}

// An ordered channel delivers a small response only after everything queued
// before it, and bufferedAmount does not show all of that queue: a probe
// waited up to 1.5 s behind a download on the same channel, against 11-82 ms
// on a second one (separate SCTP streams). So each request or socket sends
// its head, body and end, in order, on one data channel; only frames that
// belong to no stream (the approved list, denials) use the control channel.
function channelQueue(id, channel) {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = LOW_WATER;
  const queue = { channel, items: [], bytes: 0, streams: 0 };
  const flush = () => {
    while (
      queue.items.length &&
      channel.readyState === 'open' &&
      channel.bufferedAmount < HIGH_WATER
    ) {
      const item = queue.items.shift();
      queue.bytes -= item.byteLength ?? item.length;
      channel.send(item);
    }
  };
  queue.push = (data) => {
    queue.items.push(data);
    queue.bytes += data.byteLength ?? data.length;
    flush();
  };
  queue.load = () => queue.bytes + channel.bufferedAmount;
  channel.onbufferedamountlow = flush;
  channel.onmessage = ({ data }) => {
    if (typeof data === 'string') {
      const { t, id: stream } = JSON.parse(data);
      if (t === 'req') timings.set(stream, { in: Date.now() });
    }
    socket.emit('preview-in', id, data);
  };
  channel.onclose = () => close(id);
  return queue;
}

function bind(id, peer, channel) {
  const queue = channelQueue(id, channel);
  if (channel.label === 'PalmDeskPreview') peer.control = queue;
  else peer.data.push(queue);
}

// bufferedAmount misses what SCTP already holds, so pick the channel with
// the fewest open streams first and use queued bytes only to break ties.
function route(peer, data) {
  let stream;
  let last = false;
  if (typeof data === 'string') {
    const message = JSON.parse(data);
    stream = message.id;
    last = ['end', 'fail', 'ws-closed', 'ws-fail'].includes(message.t);
    if (message.t === 'res' && timings.has(stream))
      timings.get(stream).out = Date.now();
  } else stream = new DataView(data).getUint32(1);
  const open = peer.data.filter(({ channel }) => channel.readyState === 'open');
  if (stream === undefined || !open.length) return peer.control;
  let queue = peer.streams.get(stream);
  if (!queue) {
    queue = open.reduce((best, item) =>
      item.streams < best.streams ||
      (item.streams === best.streams && item.load() < best.load())
        ? item
        : best
    );
    queue.streams += 1;
    peer.streams.set(stream, queue);
  }
  if (last) {
    peer.streams.delete(stream);
    queue.streams -= 1;
  }
  return queue;
}

function createPeer(id) {
  const connection = new RTCPeerConnection();
  const peer = {
    connection,
    control: undefined,
    data: [],
    streams: new Map(),
    send(data) {
      route(peer, data)?.push(data);
    },
  };
  peers.set(id, peer);
  connection.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('signal', id, { candidate: candidate.toJSON() });
  };
  connection.ondatachannel = ({ channel }) => {
    // Like #88's host, ignore channels it does not know.
    if (/^PalmDeskPreview(Data[0-3])?$/.test(channel.label))
      bind(id, peer, channel);
    else channel.close();
  };
  connection.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(connection.connectionState)) close(id);
  };
  render();
  return peer;
}

socket.on('signal', async (id, message) => {
  const peer = peers.get(id) ?? createPeer(id);
  if (message.offer) {
    await peer.connection.setRemoteDescription(message.offer);
    await peer.connection.setLocalDescription(
      await peer.connection.createAnswer()
    );
    socket.emit('signal', id, {
      answer: peer.connection.localDescription.toJSON(),
    });
  }
  if (message.candidate)
    await peer.connection.addIceCandidate(message.candidate);
});
socket.on('preview-out', (id, data) => peers.get(id)?.send(data));
// The host ends a controller's session (password change, revoke, quit).
socket.on('disconnect-peer', (id) => close(id));
socket.on('peer-gone', (id) => close(id));
