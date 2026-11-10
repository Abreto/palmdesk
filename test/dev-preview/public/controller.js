// Stand-in for the PalmDesk controller page: one WebRTC connection to the host
// with a dedicated PalmDeskPreview DataChannel, and the preview bridge.
import { PreviewBridge } from './bridge.js';

// What a real controller keeps on its own origin: preview content must never
// be able to read these.
localStorage.setItem('palmdesk-secret', 'device-password');
document.cookie = 'palmdesk_cookie=secret; path=/; SameSite=Lax';

const config = await (await fetch('/config.json')).json();
const socket = window.io({
  query: { role: 'controller' },
  transports: ['websocket'],
});
const peer = new RTCPeerConnection();
const channel = peer.createDataChannel('PalmDeskPreview', { ordered: true });
// Bodies and socket frames come back on these, one stream per channel.
const dataChannels = [0, 1, 2, 3].map((index) =>
  peer.createDataChannel(`PalmDeskPreviewData${index}`, { ordered: true })
);
const stateLabel = document.querySelector('#state');
const targetList = document.querySelector('#targets');

function render(state, reason) {
  stateLabel.textContent = reason ? `${state} (${reason})` : state;
  targetList.replaceChildren(
    ...(bridge?.grant?.targets ?? []).map((target) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Open ${target.label}`;
      button.onclick = () => bridge.open(target.id);
      return button;
    })
  );
}

const bridge = new PreviewBridge({
  channel,
  dataChannels,
  previewOrigin: config.previewOrigin,
  container: document.querySelector('#preview'),
  maxMessageSize: () => peer.sctp?.maxMessageSize,
  onState: render,
});
document.querySelector('#stop').onclick = () => bridge.stop();

peer.onicecandidate = ({ candidate }) => {
  if (candidate) socket.emit('signal', { candidate: candidate.toJSON() });
};
socket.on('signal', async (message) => {
  if (message.answer) await peer.setRemoteDescription(message.answer);
  if (message.candidate) await peer.addIceCandidate(message.candidate);
});
socket.on('connect', async () => {
  await peer.setLocalDescription(await peer.createOffer());
  socket.emit('signal', { offer: peer.localDescription.toJSON() });
});

window.preview = { bridge, peer, channel, dataChannels, socket, config };
