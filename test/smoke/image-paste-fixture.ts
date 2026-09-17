import { createApp, defineComponent, h, markRaw, ref, shallowRef } from 'vue';
import Viewport from '../../src/components/RemoteViewport/index.vue';
import {
  BilldDeskBehaviorEnum,
  WsMsgTypeEnum,
} from '../../src/types/websocket';
import { ImageTransferHost } from '../../src/utils/image-transfer-channel';

createApp(
  defineComponent({
    setup() {
      const channel = shallowRef<RTCDataChannel>();
      const video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 600;
      const context = canvas.getContext('2d')!;
      const paint = () => {
        context.fillStyle = '#f4f6f5';
        context.fillRect(0, 0, 960, 600);
        context.fillStyle = '#294f43';
        context.font = '28px sans-serif';
        context.fillText('Codex · 图片粘贴测试窗口', 40, 55);
        context.font = '20px sans-serif';
        context.fillText('请先点击远程 prompt 输入框', 40, 470);
        context.strokeRect(30, 490, 900, 80);
      };
      paint();
      video.srcObject = canvas.captureStream(10);
      const painting = setInterval(paint, 100);
      const blocked = ref(false);
      const connected = ref(false);
      const state = {
        images: [] as { mime: string; bytes: number[] }[],
        behaviors: [] as unknown[],
        events: [] as string[],
        delay: false,
        pendingPaste: false,
        release: () => {},
        holdControls: false,
        releaseControls: () => {},
        receivedUploads: 0,
        imageConnections: 0,
        closeImages: () => {},
        cancelled: new Set<number>(),
      };
      (window as any).__imageSmoke = state;
      const a = new RTCPeerConnection();
      const b = new RTCPeerConnection();
      const control = a.createDataChannel('MessageChannel', { ordered: true });
      control.onopen = () => {
        connected.value = true;
      };
      let host: ImageTransferHost;
      const heldControls: any[] = [];
      const applyControl = (frame: any) => {
        if (frame.msgType === WsMsgTypeEnum.remoteImagePaste) {
          host?.commit(frame.data.sessionId, frame.data.id);
        } else if (frame.msgType === WsMsgTypeEnum.billdDeskBehavior) {
          state.behaviors.push(frame.data);
          state.events.push(BilldDeskBehaviorEnum[frame.data.type]);
        }
      };
      state.releaseControls = () => {
        state.holdControls = false;
        heldControls.splice(0).forEach(applyControl);
      };
      b.ondatachannel = (event) => {
        if (event.channel.label === 'MessageChannel') {
          event.channel.onmessage = ({ data }) => {
            const frame = JSON.parse(data);
            if (state.holdControls) heldControls.push(frame);
            else applyControl(frame);
          };
          return;
        }
        state.imageConnections += 1;
        host = new ImageTransferHost(
          event.channel,
          (id) => id === 'fixture-session',
          async (_id, request, image) => {
            if (state.delay) {
              state.pendingPaste = true;
              await new Promise<void>((resolve) => {
                state.release = resolve;
              });
              state.pendingPaste = false;
            }
            if (!state.cancelled.has(request)) {
              state.images.push({ mime: image.mime, bytes: [...image.bytes] });
              state.events.push('paste');
            }
          },
          (_sessionId, id) => {
            state.cancelled.add(id);
          }
        );
        event.channel.addEventListener('message', ({ data }) => {
          if (typeof data === 'string' && JSON.parse(data).type === 'finish')
            state.receivedUploads += 1;
        });
      };
      function openImages() {
        const previous = channel.value;
        if (previous && ['connecting', 'open'].includes(previous.readyState))
          return;
        const outgoing = a.createDataChannel('ImageTransfer', {
          ordered: true,
        });
        outgoing.onclose = () => {
          if (channel.value === outgoing) channel.value = undefined;
        };
        // Expose the connecting channel too, to exercise its delayed open event.
        channel.value = markRaw(outgoing);
      }
      openImages();
      state.closeImages = () => channel.value?.close();
      async function negotiate() {
        const candidatesA: RTCIceCandidateInit[] = [];
        const candidatesB: RTCIceCandidateInit[] = [];
        a.onicecandidate = (event) => {
          if (event.candidate) {
            if (b.remoteDescription) void b.addIceCandidate(event.candidate);
            else candidatesB.push(event.candidate.toJSON());
          }
        };
        b.onicecandidate = (event) => {
          if (event.candidate) {
            if (a.remoteDescription) void a.addIceCandidate(event.candidate);
            else candidatesA.push(event.candidate.toJSON());
          }
        };
        await a.setLocalDescription(await a.createOffer());
        await b.setRemoteDescription(a.localDescription!);
        await Promise.all(
          candidatesB.map((candidate) => b.addIceCandidate(candidate))
        );
        await b.setLocalDescription(await b.createAnswer());
        await a.setRemoteDescription(b.localDescription!);
        await Promise.all(
          candidatesA.map((candidate) => a.addIceCandidate(candidate))
        );
      }
      void negotiate();
      window.addEventListener('beforeunload', () => {
        host?.dispose();
        a.close();
        b.close();
        clearInterval(painting);
        (video.srcObject as MediaStream)
          .getTracks()
          .forEach((track) => track.stop());
      });
      return () =>
        h(
          'main',
          {
            style:
              'height:100dvh;display:flex;flex-direction:column;font-family:system-ui',
          },
          [
            h('div', { style: 'padding:8px;background:#e5ede9' }, [
              'PalmDesk · 图片粘贴联调 ',
              h(
                'button',
                {
                  onClick: () => {
                    blocked.value = !blocked.value;
                  },
                },
                blocked.value ? '返回窗口' : '切到阅读'
              ),
            ]),
            h(Viewport, {
              video: markRaw(video),
              connected: connected.value,
              inputBlocked: blocked.value,
              imageChannel: channel.value,
              imagePasteSession: 'fixture-session',
              commitImagePaste: (sessionId: string, id: number) =>
                control.send(
                  JSON.stringify({
                    msgType: WsMsgTypeEnum.remoteImagePaste,
                    data: { sessionId, id },
                  })
                ),
              reconnectImageChannel: openImages,
              onBehavior: (data: unknown) => {
                if (control.readyState === 'open')
                  control.send(
                    JSON.stringify({
                      msgType: WsMsgTypeEnum.billdDeskBehavior,
                      data,
                    })
                  );
              },
            }),
          ]
        );
    },
  })
).mount('#app');
