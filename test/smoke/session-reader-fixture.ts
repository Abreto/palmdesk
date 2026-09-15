import { createApp, defineComponent, h, markRaw, nextTick, ref, shallowRef } from 'vue';
import Reader from '../../src/components/SessionReader/index.vue';
import Viewport from '../../src/components/RemoteViewport/index.vue';
import { BilldDeskBehaviorEnum } from '../../src/types/websocket';
import { ReaderClient, ReaderHost } from '../../src/utils/session-reader-channel';

async function fixture(request: object) {
  const response = await fetch('/__reader_fixture', { method: 'POST', body: JSON.stringify(request) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

createApp(defineComponent({
  setup() {
    const client = shallowRef<ReaderClient>();
    const video = shallowRef<HTMLVideoElement>();
    const revision = ref(0);
    const mode = ref('read');
    const connected = ref(false);
    const inputCount = ref(0);
    const events: unknown[] = [];
    const error = ref('');
    const currentSession = ref('');
    let peers: RTCPeerConnection[] = [];
    let host: ReaderHost;
    let stream: MediaStream;
    let paint: ReturnType<typeof setInterval>;

    async function connect() {
      client.value?.dispose();
      host?.dispose();
      peers.forEach((peer) => peer.close());
      stream?.getTracks().forEach((track) => track.stop());
      clearInterval(paint);
      client.value = undefined;
      connected.value = false;
      const a = new RTCPeerConnection();
      const b = new RTCPeerConnection();
      peers = [a, b];
      const aOut = a.createDataChannel('SessionReader');
      const bOut = b.createDataChannel('SessionReader');
      let aIn: RTCDataChannel;
      let bIn: RTCDataChannel;
      a.ondatachannel = (event) => { aIn = event.channel; aIn.onopen = ready; ready(); };
      b.ondatachannel = (event) => { bIn = event.channel; bIn.onopen = ready; ready(); };
      aOut.onopen = ready;
      bOut.onopen = ready;
      function ready() {
        if (client.value || [aIn, bIn, aOut, bOut].some((channel) => channel?.readyState !== 'open')) return;
        host = new ReaderHost(bIn, bOut, fixture, () => true);
        client.value = markRaw(new ReaderClient(aIn, aOut, () => { revision.value += 1; }));
        connected.value = true;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1100; canvas.height = 680;
      const context = canvas.getContext('2d')!;
      paint = setInterval(() => {
        context.fillStyle = '#202823'; context.fillRect(0, 0, 1100, 680);
        context.fillStyle = '#a9c3b3'; context.font = '28px sans-serif';
        context.fillText('Codex · 合成窗口', 55, 65);
        context.fillStyle = '#eef7f1'; context.font = '36px sans-serif';
        context.fillText('PalmDesk 会话阅读', 55, 190);
        context.font = '25px sans-serif'; context.fillStyle = '#a9c3b3';
        context.fillText('返回阅读页时，键盘输入不应发往这个窗口。', 55, 255);
        context.strokeStyle = '#789785'; context.strokeRect(50, 495, 1000, 110);
        context.fillText('在手机输入框继续提问…', 75, 560);
      }, 100);
      stream = canvas.captureStream(10);
      b.addTrack(stream.getVideoTracks()[0], stream);
      a.ontrack = async (event) => {
        const element = document.createElement('video');
        element.autoplay = true; element.muted = true; element.playsInline = true;
        element.srcObject = event.streams[0]; video.value = markRaw(element);
        await element.play();
      };
      const gather = (peer: RTCPeerConnection) => new Promise<void>((resolve) => {
        if (peer.iceGatheringState === 'complete') resolve();
        else peer.addEventListener('icegatheringstatechange', () => { if (peer.iceGatheringState === 'complete') resolve(); });
      });
      await a.setLocalDescription(await a.createOffer()); await gather(a);
      await b.setRemoteDescription(a.localDescription!);
      await b.setLocalDescription(await b.createAnswer()); await gather(b);
      await a.setRemoteDescription(b.localDescription!);
    }
    function changeMode(value: string) { mode.value = value; }
    async function toggle() { await fixture({ method: 'toggle' }); host.reset(); }
    (window as any).readerFixture = { events, reconnect: connect, nextTick };
    void connect().catch((cause) => { error.value = String(cause); });
    return () => h('main', { class: 'fixture' }, [
      h('aside', { class: 'fixture-controls' }, [
        h('span', '合成数据联调'),
        h('button', { onClick: () => fixture({ method: 'append' }) }, '添加回复'),
        h('button', { onClick: toggle }, '切换读取开关'),
        h('button', { onClick: connect }, '重新连接'),
        h('output', { 'data-input-count': inputCount.value }, `远端输入 ${inputCount.value}`),
        error.value,
      ]),
      h('section', { class: 'phone' }, [
        h('header', { class: 'brand' }, [h('strong', 'PalmDesk'), h('span', connected.value ? '已连接' : '正在连接')]),
        h('nav', [h('button', { 'aria-pressed': mode.value === 'read', onClick: () => changeMode('read') }, '阅读'), h('button', { 'aria-pressed': mode.value === 'window', onClick: () => changeMode('window') }, '窗口')]),
        h(Reader, { client: client.value, revision: revision.value, active: mode.value === 'read', style: mode.value === 'read' ? '' : 'display:none', onSelect: (session) => { currentSession.value = session?.id || ''; }, onOpenWindow: () => changeMode('window') }),
        h(Viewport, { video: video.value, connected: connected.value, inputBlocked: mode.value !== 'window', style: mode.value === 'window' ? '' : 'display:none', onBehavior: (data) => { events.push(data); if (data.type !== BilldDeskBehaviorEnum.releaseAll) inputCount.value += 1; } }),
      ]),
    ]);
  },
})).mount('#app');

const style = document.createElement('style');
style.textContent = '*{box-sizing:border-box}body{margin:0;background:#e3eae5;font-family:system-ui,sans-serif}button{font:inherit;cursor:pointer}.fixture{height:100dvh;display:flex;flex-direction:column}.fixture-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;font-size:11px;color:#56685c}.fixture-controls button{border:1px solid #c7d5ca;padding:5px 8px;border-radius:6px;background:white;color:inherit}.phone{width:min(100%,430px);min-height:0;flex:1;margin:auto;display:flex;flex-direction:column;background:#f5f7f6;box-shadow:0 0 25px #75897920}.brand{display:flex;justify-content:space-between;padding:14px 18px;background:white;color:#294a38}.brand span{font-size:12px;color:#3b825a}nav{display:flex;gap:6px;padding:8px 14px;background:white;border-bottom:1px solid #dce5df}nav button{border:0;border-radius:8px;padding:9px 22px;background:transparent;color:#658170;font-size:13px}nav button[aria-pressed=true]{background:#e5efe8;color:#245e43;font-weight:600}';
document.head.appendChild(style);
