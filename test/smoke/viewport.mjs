import BeforeViewport from 'virtual:remote-viewport-before.vue';
import { createApp, h, ref } from 'vue';

import RemoteViewport from '../../src/components/RemoteViewport/index.vue';
import { BilldDeskBehaviorEnum as Behavior } from '../../src/types/websocket';

// Synthetic source: this fixture never captures or controls another app.
const canvas = document.createElement('canvas');
canvas.width = 1280;
canvas.height = 900;
const ctx = canvas.getContext('2d');
const video = document.createElement('video');
video.muted = true;
video.autoplay = true;
video.playsInline = true;
const selected = ref('修复手机会话切换');
const names = [
  '修复手机会话切换',
  '检查登录页面',
  '整理接口文档',
  '优化数据库查询',
  '处理上传失败',
  '完善消息列表',
  '检查测试结果',
  '调整侧栏布局',
  '更新使用说明',
  '实现分页加载',
  '检查发布配置',
  '处理网络恢复',
  '改进搜索体验',
  '回归测试',
  '整理项目结构',
  '检查依赖更新',
];
let offset = 0;
let recent = false;
function draw() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1280, 900);
  ctx.fillStyle = '#f0f3f1';
  ctx.fillRect(0, 0, 320, 900);
  ctx.fillStyle = '#17684f';
  ctx.font = '24px system-ui';
  ctx.fillText(recent ? '🔔 最近任务' : '🔔  全部任务', 24, 45);
  ctx.font = '16px system-ui';
  ctx.fillStyle = '#718078';
  ctx.fillText('示例项目 · 合成画面', 24, 88);
  const visible = recent ? names.slice(0, 5) : names;
  visible.forEach((name, i) => {
    const y = 112 + i * 60 - offset;
    if (y < 100 || y > 820) return;
    if (name === selected.value) {
      ctx.fillStyle = '#d8eae2';
      ctx.fillRect(10, y, 300, 52);
    }
    ctx.fillStyle = '#273f33';
    ctx.font = '21px system-ui';
    ctx.fillText(name, 24, y + 32);
  });
  ctx.fillStyle = '#f0f3f1';
  ctx.fillRect(0, 850, 320, 50);
  ctx.fillStyle = '#617267';
  ctx.font = '16px system-ui';
  ctx.fillText('这是测试画面', 24, 883);
  ctx.fillStyle = '#243e33';
  ctx.font = '30px system-ui';
  ctx.fillText(selected.value, 370, 85);
  ctx.font = '22px system-ui';
  const lines = [
    '正在验证手机上的平移与点选。',
    '选择「移动画面」，滑动到左侧列表。',
    '轻点另一个任务，再滑回正文。',
    '无需反复开关「仅观看」。',
  ];
  lines.forEach((line, i) => ctx.fillText(line, 370, 165 + i * 54));
  ctx.fillStyle = '#eef4f1';
  ctx.fillRect(370, 420, 850, 300);
  ctx.fillStyle = '#426452';
  for (let i = 0; i < 8; i += 1) {
    ctx.fillText(`${i + 1}   示例代码与阅读位置 ${i + 1}`, 398, 458 + i * 32);
  }
}
draw();
video.srcObject = canvas.captureStream(15);
setInterval(draw, 100);

createApp({
  setup() {
    const version = ref('current');
    const dimensions = ref([390, 844]);
    const blocked = ref(false);
    const taskNavigation = ref(true);
    const lastInput = ref('尚未发送输入');
    const behavior = (data) => {
      if (data.type === Behavior.releaseAll) return;
      lastInput.value = `${Behavior[data.type]} · x=${data.x ?? '-'} y=${data.y ?? '-'} amount=${data.amount ?? '-'}${data.key ? ` key=${data.key.join(',')}` : ''}${data.text ? ` · ${data.text}` : ''}`;
      if (data.x >= 250) return;
      if (data.type === Behavior.scrollDown)
        offset = Math.min(recent ? 0 : 400, offset + data.amount);
      if (data.type === Behavior.scrollUp)
        offset = Math.max(0, offset - data.amount);
      if (data.type === Behavior.leftClick) {
        const y = data.y * 0.9;
        if (y < 65) {
          recent = !recent;
          offset = 0;
        } else if (y >= 112 && y <= 840) {
          const name = (recent ? names.slice(0, 5) : names)[
            Math.floor((y - 112 + offset) / 60)
          ];
          if (name) selected.value = name;
        }
      }
      draw();
    };
    return () => [
      h(
        'div',
        { class: 'fixture-controls', role: 'group', 'aria-label': '版本对照' },
        [
          h(
            'button',
            {
              'aria-pressed': version.value === 'before',
              onClick: () => (version.value = 'before'),
            },
            '修改前'
          ),
          h(
            'button',
            {
              'aria-pressed': version.value === 'current',
              onClick: () => (version.value = 'current'),
            },
            '当前版'
          ),
        ]
      ),
      h(
        'p',
        { class: 'comparison-note' },
        '两版使用同一幅合成画面。切换版本会重置缩放与输入草稿。'
      ),
      version.value === 'current'
        ? h(
            'p',
            { class: 'comparison-note' },
            '试用：选择 200% 缩放与第四个「移动画面」按钮，拖动画面、轻点任务，再拖回正文。滚动远程列表时用第二个「滚动」按钮。'
          )
        : null,
      h('div', { class: 'fixture-controls' }, [
        h('button', { onClick: () => (dimensions.value = [390, 844]) }, '竖屏'),
        h('button', { onClick: () => (dimensions.value = [844, 390]) }, '横屏'),
        h('button', { onClick: () => (dimensions.value = [320, 740]) }, '窄屏'),
        h(
          'button',
          { onClick: () => (blocked.value = !blocked.value) },
          blocked.value ? '恢复控制' : '暂停控制'
        ),
        h(
          'button',
          { onClick: () => (taskNavigation.value = !taskNavigation.value) },
          taskNavigation.value ? '切到普通应用' : '切到 Codex 示例'
        ),
      ]),
      h(
        'div',
        {
          class: 'phone',
          style: {
            width: `${dimensions.value[0]}px`,
            height: `${dimensions.value[1]}px`,
          },
        },
        [
          h('header', { class: 'fixture-header' }, [
            'PalmDesk',
            h(
              'small',
              `${version.value === 'before' ? '修改前' : '当前版'} · 合成窗口验收`
            ),
          ]),
          h(version.value === 'before' ? BeforeViewport : RemoteViewport, {
            key: version.value,
            video,
            connected: true,
            inputBlocked: blocked.value,
            ...(version.value === 'current'
              ? { taskNavigation: taskNavigation.value }
              : {}),
            onBehavior: behavior,
          }),
        ]
      ),
      h(
        'output',
        { 'aria-live': 'polite' },
        `当前示例任务：${selected.value}\n${lastInput.value}`
      ),
    ];
  },
}).mount('#app');
