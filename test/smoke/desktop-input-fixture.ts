import '../../src/assets/css/main.scss';
import { createApp, defineComponent, h, markRaw, ref } from 'vue';

import Viewport from '../../src/components/RemoteViewport/index.vue';
import { NUT_KEY_MAP } from '../../src/constant';
import { useInteractionProfile } from '../../src/hooks/use-interaction-profile';
import { BilldDeskBehaviorEnum } from '../../src/types/websocket';

// RemoteViewport with a synthetic 16:10 window; behaviors are recorded in
// order instead of reaching a host.
createApp(
  defineComponent({
    setup() {
      const video = document.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 800;
      const context = canvas.getContext('2d')!;
      const paint = () => {
        context.fillStyle = '#f7f7f5';
        context.fillRect(0, 0, 1280, 800);
        context.fillStyle = '#2f3a33';
        context.font = '28px sans-serif';
        context.fillText('Agent window · desktop input fixture', 40, 60);
        context.strokeRect(40, 640, 1200, 110);
      };
      paint();
      video.srcObject = canvas.captureStream(10);
      const painting = setInterval(paint, 100);
      const connected = ref(true);
      const blocked = ref(false);
      const draft = ref('');
      const { mode, profile, setMode } = useInteractionProfile();
      const state = {
        behaviors: [] as any[],
        events: [] as string[],
        keys: NUT_KEY_MAP,
        connect: (value: boolean) => {
          connected.value = value;
        },
      };
      (window as any).desktopSmoke = state;
      window.addEventListener('beforeunload', () => {
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
            h(
              'div',
              {
                style:
                  'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:4px 8px;background:#e5ede9',
              },
              [
                'PalmDesk · 桌面输入联调',
                h('input', { 'aria-label': '本地搜索' }),
                h(
                  'select',
                  {
                    'aria-label': '交互方式',
                    value: mode.value,
                    onChange: (event: Event) =>
                      setMode((event.target as HTMLSelectElement).value),
                  },
                  [
                    h('option', { value: 'auto' }, '自动'),
                    h('option', { value: 'touch' }, '触摸'),
                    h('option', { value: 'desktop' }, '鼠标和键盘'),
                  ]
                ),
                h(
                  'button',
                  {
                    onClick: () => {
                      blocked.value = !blocked.value;
                    },
                  },
                  blocked.value ? '返回窗口' : '切到阅读'
                ),
                h('output', { 'aria-label': '当前布局' }, profile.value),
              ]
            ),
            h(Viewport, {
              video: markRaw(video),
              connected: connected.value,
              inputBlocked: blocked.value,
              draft: draft.value,
              'onUpdate:draft': (value: string) => {
                draft.value = value;
              },
              onBehavior: (data: any) => {
                state.behaviors.push(data);
                state.events.push(BilldDeskBehaviorEnum[data.type]);
              },
            }),
          ]
        );
    },
  })
).mount('#app');
