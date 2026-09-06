import { io } from 'socket.io-client';

const result = document.querySelector('#result');
const run = document.querySelector('#run');
const canvas = document.querySelector('#source');
const video = document.querySelector('#receiver');
const endpoint = 'http://127.0.0.1:4300';
const lines = [];
const log = (text) => {
  lines.push(text);
  result.textContent = lines.join('\n');
};
const check = (value, message) => {
  if (!value) throw new Error(message);
};

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(timer);
        reject(new Error(`Timeout: ${label}`));
      }
    }, 30);
  });
}

function send(socket, event, data) {
  socket.emit(event, {
    request_id: crypto.randomUUID(),
    socket_id: socket.id,
    user_info: {},
    user_token: '',
    time: Date.now(),
    data,
  });
}

async function register() {
  const response = await fetch(`${endpoint}/desk_user/create`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  check(body.code === 200, 'Device registration failed');
  return body.data;
}

async function cycle(number) {
  const devices = await Promise.all([register(), register()]);
  const sockets = devices.map(() =>
    io(endpoint, { transports: ['websocket'], reconnection: false })
  );
  const peers = [new RTCPeerConnection(), new RTCPeerConnection()];
  let stream;
  let drawing;
  let returned = '';
  let receivedTrack;
  const errors = [];
  try {
    await waitFor(
      () => sockets.every((socket) => socket.connected),
      'WebSocket connections'
    );
    const room = devices[0].uuid;
    let joined = 0;
    sockets.forEach((socket, i) => {
      socket.on('billdDeskJoined', () => {
        joined += 1;
      });
      send(socket, 'billdDeskJoin', {
        live_room_id: room,
        deskUserUuid: devices[i].uuid,
        deskUserPassword: devices[i].password,
      });
    });
    await waitFor(() => joined === 2, 'device room registration');
    let accepted = 0;
    sockets.forEach((socket) =>
      socket.on('billdDeskStartRemoteResult', (message) => {
        if (message.code === 0) accepted += 1;
        else errors.push(message.msg);
      })
    );
    send(sockets[1], 'billdDeskStartRemote', {
      roomId: room,
      sender: sockets[1].id,
      receiver: sockets[0].id,
      deskUserUuid: devices[1].uuid,
      deskUserPassword: devices[1].password,
      remoteDeskUserUuid: devices[0].uuid,
      remoteDeskUserPassword: devices[0].password,
      maxBitrate: 2000,
      maxFramerate: 20,
      resolutionRatio: 180,
      audioContentHint: '',
      videoContentHint: 'detail',
    });
    await waitFor(() => accepted === 2, 'authenticated connection');
    log(`PASS cycle ${number}: two devices authenticated over local WebSocket`);

    const signal = (i, event, data) =>
      send(sockets[i], event, {
        live_room_id: room,
        sender: sockets[i].id,
        receiver: sockets[1 - i].id,
        ...data,
      });
    const pendingCandidates = [[], []];
    async function addPending(i) {
      for (const candidate of pendingCandidates[i].splice(0))
        await peers[i].addIceCandidate(candidate);
    }
    sockets.forEach((socket, i) => {
      peers[i].onicecandidate = ({ candidate }) => {
        if (candidate)
          signal(i, 'srsCandidate', { candidate: candidate.toJSON() });
      };
      socket.on('srsCandidate', async ({ candidate, receiver }) => {
        if (receiver !== socket.id) return;
        try {
          if (peers[i].remoteDescription)
            await peers[i].addIceCandidate(candidate);
          else pendingCandidates[i].push(candidate);
        } catch (error) {
          errors.push(error.message);
        }
      });
    });
    sockets[1].on('srsOffer', async ({ sdp }) => {
      try {
        await peers[1].setRemoteDescription(sdp);
        await addPending(1);
        await peers[1].setLocalDescription(await peers[1].createAnswer());
        signal(1, 'srsAnswer', { sdp: peers[1].localDescription.toJSON() });
      } catch (error) {
        errors.push(error.message);
      }
    });
    sockets[0].on('srsAnswer', async ({ sdp }) => {
      try {
        await peers[0].setRemoteDescription(sdp);
        await addPending(0);
      } catch (error) {
        errors.push(error.message);
      }
    });
    peers[1].ontrack = ({ track, streams }) => {
      receivedTrack = track;
      video.srcObject = streams[0];
    };
    peers[1].ondatachannel = ({ channel }) => {
      channel.onmessage = ({ data }) => channel.send(data);
    };
    const channel = peers[0].createDataChannel('smoke-input');
    channel.onmessage = ({ data }) => {
      returned = data;
    };
    let frame = 0;
    const context = canvas.getContext('2d');
    const draw = () => {
      context.fillStyle = '#12aa96';
      context.fillRect(0, 0, 320, 180);
      context.fillStyle = '#c43e4e';
      context.fillRect(180, 0, 140, 180);
      context.fillStyle = '#ffffff';
      context.font = '22px sans-serif';
      context.fillText(`Cycle ${number} / frame ${frame++}`, 20, 100);
    };
    draw();
    drawing = setInterval(draw, 50);
    stream = canvas.captureStream(20);
    stream.getTracks().forEach((track) => peers[0].addTrack(track, stream));
    await peers[0].setLocalDescription(await peers[0].createOffer());
    signal(0, 'srsOffer', {
      sdp: peers[0].localDescription.toJSON(),
      isRemoteDesk: true,
    });
    await waitFor(
      () => peers.every((peer) => peer.connectionState === 'connected'),
      'WebRTC connection'
    );
    await waitFor(
      () => video.videoWidth === 320 && video.readyState >= 2,
      'remote video frame'
    );
    await video.play();
    const sample = document.createElement('canvas');
    sample.width = 320;
    sample.height = 180;
    const sampleContext = sample.getContext('2d');
    sampleContext.drawImage(video, 0, 0);
    video.poster = sample.toDataURL('image/png');
    const pixel = sampleContext.getImageData(20, 20, 1, 1).data;
    check(
      Math.abs(pixel[0] - 18) < 25 &&
        Math.abs(pixel[1] - 170) < 25 &&
        Math.abs(pixel[2] - 150) < 25,
      `Unexpected video pixel: ${pixel}`
    );
    log(
      `PASS cycle ${number}: real video decoded at ${video.videoWidth}x${video.videoHeight}; pixel ${Array.from(pixel).join(',')}`
    );
    await waitFor(() => channel.readyState === 'open', 'DataChannel');
    const payload = JSON.stringify({
      type: 'pointer',
      x: 500,
      y: 500,
      normalized: true,
      sequence: number,
    });
    channel.send(payload);
    await waitFor(() => returned === payload, 'DataChannel round trip');
    log(`PASS cycle ${number}: DataChannel input payload round trip`);
    check(errors.length === 0, errors.join('; '));
    return {
      sourceTrackId: stream.getVideoTracks()[0].id,
      socketId: sockets[0].id,
    };
  } finally {
    clearInterval(drawing);
    stream?.getTracks().forEach((track) => track.stop());
    receivedTrack?.stop();
    video.srcObject = null;
    peers.forEach((peer) => peer.close());
    sockets.forEach((socket) => socket.close());
    check(
      !stream ||
        stream.getTracks().every((track) => track.readyState === 'ended'),
      'Source track leaked'
    );
    check(
      peers.every((peer) => peer.connectionState === 'closed'),
      'Peer connection leaked'
    );
    log(`PASS cycle ${number}: tracks stopped and peer connections closed`);
  }
}

run.addEventListener('click', async () => {
  run.disabled = true;
  lines.length = 0;
  result.dataset.status = 'RUNNING';
  log('RUNNING: local synthetic-video transport smoke');
  try {
    const first = await cycle(1);
    const second = await cycle(2);
    check(
      first.sourceTrackId !== second.sourceTrackId,
      'Reconnect reused source track'
    );
    check(first.socketId !== second.socketId, 'Reconnect reused socket');
    log('PASS reconnect: fresh media track and fresh socket');
    result.dataset.status = 'PASS';
    log(
      'PASS: local WebRTC transport. Native window capture and OS input are separate tests.'
    );
  } catch (error) {
    result.dataset.status = 'FAIL';
    log(`FAIL: ${error.message}`);
  } finally {
    run.disabled = false;
  }
});
