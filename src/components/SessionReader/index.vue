<template>
  <section
    class="reader-panel"
    aria-label="会话阅读"
  >
    <div
      v-if="!client && !selected"
      class="empty-reader"
      role="status"
    >
      <strong>连接中</strong>
      <p>请先切到窗口，或确认设备版本一致。</p>
    </div>
    <div
      v-else-if="settings && !settings.enabled"
      class="empty-reader"
    >
      <strong>{{
        settings.supported ? '开启会话阅读' : '此电脑暂不支持会话阅读'
      }}</strong>
      <p>
        {{
          settings.supported
            ? '在电脑首页开启「会话阅读」即可查看本地会话。'
            : '会话阅读支持 macOS 和 Windows。'
        }}
      </p>
      <button
        type="button"
        :disabled="busy"
        @click="initialize()"
      >
        重新检查
      </button>
    </div>
    <template v-else-if="!selected">
      <div class="reader-heading">
        <div>
          <span class="eyebrow">会话</span>
          <h2>最近会话</h2>
        </div>
        <button
          type="button"
          :disabled="busy || !settings?.enabled"
          @click="loadList"
        >
          刷新
        </button>
      </div>
      <form
        class="reader-search"
        @submit.prevent="loadList"
      >
        <input
          v-model="query"
          aria-label="搜索会话"
          placeholder="搜索项目或内容"
          maxlength="200"
        />
        <button
          type="submit"
          :disabled="busy || !settings?.enabled"
        >
          搜索
        </button>
      </form>
      <div class="reader-scroll session-list">
        <button
          v-for="session in sessions"
          :key="session.id"
          class="session-card"
          type="button"
          :disabled="busy"
          @click="openSession(session)"
        >
          <span class="session-meta"
            ><span>{{ projectName(session.projectPath) }}</span
            ><time>{{ formatTime(session.lastUpdatedAt) }}</time></span
          >
          <strong>{{ session.title }}</strong>
          <span class="preview">{{
            session.recentMessage || '打开查看会话记录'
          }}</span>
          <span class="session-state"
            >{{ sessionLabel(session) }} ·
            {{ turnLabel(session.turnState) }}</span
          >
        </button>
        <p
          v-if="!busy && !sessions.length && !error"
          class="empty-list"
        >
          {{ query ? '没有匹配的会话，换个关键词试试。' : '暂无可读会话。' }}
        </p>
        <p
          v-if="total > sessions.length"
          class="list-note"
        >
          显示 {{ sessions.length }} / {{ total }} 条；搜索可查找更早会话。
        </p>
      </div>
    </template>
    <template v-else>
      <div class="reader-heading detail-heading">
        <button
          type="button"
          aria-label="返回会话列表"
          @click="back"
        >
          ← 会话
        </button>
        <button
          type="button"
          :disabled="busy"
          @click="loadLatest"
        >
          刷新
        </button>
        <button
          type="button"
          class="primary"
          @click="emit('open-window')"
        >
          继续 ↗
        </button>
      </div>
      <div class="session-context">
        <h2>{{ selected.title }}</h2>
        <p :title="selected.projectPath">
          {{ selected.projectPath || '未提供项目目录' }}
        </p>
        <div>
          <span>{{ sessionLabel(selected) }}</span>
          <span>{{ turnLabel(selected.turnState) }}</span
          ><span>{{
            selected.quality === 'complete' ? '完整记录' : '记录可能不完整'
          }}</span>
        </div>
        <p
          v-if="windowName"
          class="window-link"
        >
          关联窗口：{{ windowName }} · 发送前确认任务
        </p>
      </div>
      <button
        v-if="hasUpdate"
        type="button"
        class="update-banner"
        :disabled="busy"
        @click="loadLatest"
      >
        有新内容 · 查看最新回复 ↓
      </button>
      <div
        ref="scrollArea"
        class="reader-scroll timeline"
      >
        <button
          v-if="hasMore"
          type="button"
          class="load-older"
          :disabled="busy"
          @click="loadOlder"
        >
          加载更早的记录
        </button>
        <template
          v-for="block in blocks"
          :key="block.id"
        >
          <article
            v-if="block.message"
            class="message-card"
            :class="{ 'user-message': block.message.role === 'user' }"
            :data-message-id="block.id"
          >
            <header>
              <span>{{ roleLabel(block.message.role) }}</span
              ><button
                type="button"
                @click="copy(block.message)"
              >
                {{ copied === block.id ? '已复制' : '复制' }}
              </button>
            </header>
            <!-- renderMarkdown escapes HTML and allows only http(s)/mailto links. -->
            <div
              class="message-body"
              v-html="renderMarkdown(block.message.text)"
            ></div>
            <p
              v-if="block.message.truncated"
              class="truncation"
            >
              内容过长，仅显示前 16,384 字符；完整内容请在原窗口查看。
            </p>
          </article>
          <details
            v-else
            class="activity-group"
          >
            <summary>
              工具活动 <span>{{ block.actions.length }} 项</span>
            </summary>
            <section
              v-for="item in block.actions"
              :key="item.id"
              class="activity-item"
            >
              <strong>{{ item.title || '活动' }}</strong>
              <pre v-if="item.text">{{ item.text }}</pre>
              <details
                v-if="item.detail"
                class="tool-output"
              >
                <summary>
                  {{ item.type === 'file_change' ? '查看差异' : '查看输出' }}
                </summary>
                <pre>{{ item.detail }}</pre>
              </details>
              <p
                v-if="item.truncated"
                class="truncation"
              >
                长内容已截断，完整内容请在原窗口查看。
              </p>
            </section>
          </details>
        </template>
        <p
          v-if="!busy && !items.length && !error"
          class="empty-list"
        >
          暂未读取到消息，可稍后刷新或前往窗口查看。
        </p>
      </div>
    </template>
    <p
      v-if="busy && !polling"
      class="reader-notice"
      role="status"
    >
      正在读取…
    </p>
    <p
      v-if="error"
      class="reader-notice error"
      role="alert"
    >
      {{ error }}
      <button
        v-if="!settings"
        type="button"
        :disabled="busy"
        @click="initialize()"
      >
        重试
      </button>
    </p>
    <p
      v-if="copyError"
      class="reader-notice error"
      role="alert"
    >
      {{ copyError }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

import type { ReaderClient } from '@/utils/session-reader-channel';

import { renderMarkdown } from '../../../session-core/public/timeline-renderers.js';

import type {
  ReaderItem,
  ReaderList,
  ReaderPage,
  ReaderSession,
  ReaderSettings,
} from '../../../session-core/index.mjs';

const props = defineProps<{
  client?: ReaderClient;
  revision?: number;
  active: boolean;
  windowName?: string;
}>();
const emit = defineEmits<{
  'open-window': [];
  select: [session: ReaderSession | undefined];
  available: [enabled: boolean];
}>();
const settings = ref<ReaderSettings>();
const sessions = ref<ReaderSession[]>([]);
const total = ref(0);
const query = ref('');
const selected = ref<ReaderSession>();
const items = ref<ReaderItem[]>([]);
const nextCursor = ref<string>();
const hasMore = ref(false);
const hasUpdate = ref(false);
const busy = ref(false);
const polling = ref(false);
const error = ref('');
const copied = ref('');
const copyError = ref('');
const scrollArea = ref<HTMLElement>();
let generation = 0;
let latestSignature = '';

const blocks = computed(() => {
  const result: { id: string; message?: ReaderItem; actions: ReaderItem[] }[] =
    [];
  items.value.forEach((item) => {
    if (item.type === 'message')
      result.push({ id: item.id, message: item, actions: [] });
    else {
      const previous = result[result.length - 1];
      if (previous && !previous.message) previous.actions.push(item);
      else result.push({ id: item.id, actions: [item] });
    }
  });
  return result;
});

const turnLabel = (state: string) =>
  ({ running: '正在执行', idle: '本轮已结束', unknown: '状态未知' })[state] ||
  '状态未知';
const sessionLabel = (session?: ReaderSession) =>
  ({
    codex: 'Codex',
    'claude-code': 'Claude Code',
    'claude-desktop': 'Claude Desktop · Code',
  })[session?.source || session?.providerId || ''] || '助手';
const roleLabel = (role?: string) =>
  ({
    user: '你',
    assistant: sessionLabel(selected.value),
    system: '系统',
    tool: '工具',
  })[role || ''] || '消息';
const projectName = (value: string) =>
  value.split(/[\\/]/).filter(Boolean).pop() || '未提供项目';
function formatTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
}
const signature = (page: ReaderPage) => JSON.stringify(page);

async function run<T>(
  request: Parameters<ReaderClient['request']>[0],
  accept: (value: T) => void | Promise<void>
) {
  const client = props.client;
  if (!client || busy.value) return;
  const current = generation;
  busy.value = true;
  error.value = '';
  try {
    const result = await client.request<T>(request);
    if (current === generation) {
      await accept(result);
      return result;
    }
  } catch (cause) {
    if (current === generation)
      error.value = cause instanceof Error ? cause.message : '读取失败，请重试';
  } finally {
    if (current === generation) busy.value = false;
  }
}

function clearReading() {
  settings.value = undefined;
  sessions.value = [];
  selected.value = undefined;
  items.value = [];
  hasUpdate.value = false;
  emit('select', undefined);
}

async function initialize(reset = true) {
  generation += 1;
  busy.value = false;
  polling.value = false;
  if (reset) clearReading();
  error.value = '';
  copyError.value = '';
  const state = await run<ReaderSettings>({ method: 'status' }, (value) => {
    if (!value.enabled) clearReading();
    settings.value = value;
    emit('available', value.enabled);
  });
  if (state?.enabled) {
    if (selected.value) await poll();
    else await loadList();
  }
}

async function loadList() {
  await run<ReaderList>({ method: 'list', query: query.value }, (value) => {
    sessions.value = value.sessions;
    total.value = value.total;
  });
}

async function openSession(session: ReaderSession) {
  if (busy.value) return;
  selected.value = session;
  items.value = [];
  hasMore.value = false;
  hasUpdate.value = false;
  copyError.value = '';
  emit('select', session);
  await loadLatest();
}

async function loadLatest() {
  if (!selected.value) return;
  await run<ReaderPage>(
    { method: 'read', id: selected.value.id },
    async (page) => {
      selected.value = page.session;
      items.value = page.items;
      hasMore.value = page.hasMore;
      nextCursor.value = page.nextCursor;
      latestSignature = signature(page);
      hasUpdate.value = false;
      emit('select', page.session);
      await nextTick();
      const messages =
        scrollArea.value?.querySelectorAll<HTMLElement>('[data-message-id]');
      const latest = messages?.[messages.length - 1];
      if (latest && scrollArea.value)
        scrollArea.value.scrollTop =
          latest.offsetTop - scrollArea.value.offsetTop;
    }
  );
}

async function loadOlder() {
  if (!selected.value || !nextCursor.value) return;
  const height = scrollArea.value?.scrollHeight || 0;
  const top = scrollArea.value?.scrollTop || 0;
  await run<ReaderPage>(
    { method: 'read', id: selected.value.id, cursor: nextCursor.value },
    async (page) => {
      const existing = new Set(items.value.map((item) => item.id));
      items.value = [
        ...page.items.filter((item) => !existing.has(item.id)),
        ...items.value,
      ];
      hasMore.value = page.hasMore;
      nextCursor.value = page.nextCursor;
      await nextTick();
      if (scrollArea.value)
        scrollArea.value.scrollTop =
          top + scrollArea.value.scrollHeight - height;
    }
  );
}

function back() {
  generation += 1;
  busy.value = false;
  selected.value = undefined;
  items.value = [];
  hasUpdate.value = false;
  error.value = '';
  emit('select', undefined);
}

async function copy(item: ReaderItem) {
  copyError.value = '';
  try {
    await navigator.clipboard.writeText(item.text);
    copied.value = item.id;
  } catch {
    copyError.value = '无法访问剪贴板，请长按选择文字复制。';
  }
}

async function poll() {
  if (
    !props.active ||
    !props.client ||
    document.hidden ||
    !selected.value ||
    busy.value ||
    hasUpdate.value ||
    error.value
  )
    return;
  polling.value = true;
  await run<ReaderPage>({ method: 'read', id: selected.value.id }, (page) => {
    hasUpdate.value = signature(page) !== latestSignature;
  });
  polling.value = false;
}

watch(
  () => props.client,
  () => {
    void initialize(false);
  },
  { immediate: true }
);
// A host reset revokes cached content even when the transport stays open.
watch(
  () => props.revision,
  () => {
    void initialize();
  }
);
const pollTimer = setInterval(() => {
  void poll();
}, 8000);
onUnmounted(() => {
  generation += 1;
  clearInterval(pollTimer);
});
</script>

<style scoped>
.reader-panel {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  background: var(--pd-bg);
  color: var(--pd-text);
}
button,
input {
  font: inherit;
}
button {
  cursor: pointer;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  padding: 9px 13px;
  min-height: 40px;
  color: var(--pd-text);
  background: var(--pd-surface);
}
button:disabled {
  cursor: default;
  opacity: 0.5;
}
button:focus-visible,
input:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--pd-accent);
  outline-offset: 2px;
}
.reader-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 28px 24px 18px;
}
.eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
  color: var(--pd-accent);
}
h2 {
  margin: 4px 0 0;
  font-size: 21px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.reader-search {
  display: flex;
  gap: 8px;
  padding: 0 24px 20px;
}
.reader-search input {
  flex: 1;
  min-width: 0;
  width: 0;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  padding: 11px;
  background: var(--pd-surface);
  color: var(--pd-text);
}
.reader-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 860px;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 0 24px 32px;
}
.session-card {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 9px;
  padding: 20px;
  text-align: left;
  border-radius: var(--pd-radius);
  box-shadow: var(--pd-shadow);
}
.session-card:hover {
  border-color: var(--pd-border-strong);
  background: var(--pd-surface-soft);
}
.session-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--pd-muted);
  font-size: 11px;
}
.session-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-meta time {
  flex-shrink: 0;
}
.session-card strong {
  font-size: 16px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.preview {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.65;
  color: var(--pd-muted);
  overflow-wrap: anywhere;
}
.session-state {
  font-size: 11px;
  color: var(--pd-accent);
}
.detail-heading {
  justify-content: flex-start;
  padding: 10px 16px;
  border-bottom: 1px solid var(--pd-border);
  background: var(--pd-surface);
}
.detail-heading .primary {
  margin-left: auto;
  background: var(--pd-accent);
  color: var(--pd-on-accent);
  border-color: var(--pd-accent);
}
.session-context {
  padding: 12px 20px;
  background: var(--pd-surface);
  border-bottom: 1px solid var(--pd-border);
}
.session-context h2 {
  font-size: 17px;
}
.session-context p {
  margin: 5px 0;
  font-size: 11px;
  color: var(--pd-muted);
  overflow-wrap: anywhere;
}
.session-context > div {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--pd-muted);
  font-size: 11px;
}
.session-context .window-link {
  color: var(--pd-accent);
}
.timeline {
  position: relative;
  padding: 16px max(16px, calc((100% - 860px) / 2)) 32px;
}
.message-card {
  margin-bottom: 14px;
  background: var(--pd-surface);
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  box-shadow: var(--pd-shadow);
  padding: 20px;
}
.user-message {
  background: var(--pd-accent-soft);
  border-color: rgb(22 138 58 / 20%);
}
.message-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--pd-muted);
  font-size: 11px;
}
.message-card header button {
  font-size: 11px;
  min-height: 30px;
  padding: 4px 9px;
  background: transparent;
}
.message-body {
  line-height: 1.85;
  font-size: 15px;
  overflow-wrap: anywhere;
  user-select: text;
}
.message-body :deep(p) {
  margin: 12px 0;
}
.message-body :deep(h3),
.message-body :deep(h4),
.message-body :deep(h5) {
  line-height: 1.5;
  margin: 18px 0 8px;
}
.message-body :deep(a) {
  color: var(--pd-accent);
  text-decoration: underline;
}
.message-body :deep(pre),
pre {
  max-width: 100%;
  overflow-x: auto;
  border-radius: var(--pd-radius-sm);
  padding: 12px;
  background: #0a100c;
  color: #b9e8be;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre;
}
.message-body :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.88em;
}
.message-body :deep(blockquote) {
  margin-left: 0;
  padding-left: 14px;
  border-left: 3px solid var(--pd-accent);
  color: var(--pd-muted);
}
.message-body :deep(ul),
.message-body :deep(ol) {
  padding-left: 24px;
}
.activity-group {
  margin-bottom: 14px;
  padding: 12px 16px;
  border: 1px dashed var(--pd-border-strong);
  border-radius: var(--pd-radius);
  background: var(--pd-surface-soft);
  font-size: 13px;
}
summary {
  cursor: pointer;
  line-height: 1.7;
}
summary span {
  float: right;
  color: var(--pd-muted);
  font-size: 11px;
}
.activity-item {
  padding-top: 14px;
  min-width: 0;
}
.activity-item > strong {
  display: block;
  overflow-wrap: anywhere;
}
.tool-output {
  margin: 8px 0;
}
.load-older {
  display: block;
  margin: 0 auto 16px;
  font-size: 12px;
}
.update-banner {
  border: 0;
  border-radius: 0;
  background: var(--pd-accent-soft);
  color: var(--pd-accent);
  font-size: 13px;
}
.empty-reader {
  margin: auto;
  padding: 32px;
  max-width: 450px;
  text-align: center;
  line-height: 1.8;
}
.empty-reader p,
.empty-list,
.list-note {
  color: var(--pd-muted);
  font-size: 13px;
  line-height: 1.8;
}
.empty-list,
.list-note {
  text-align: center;
  padding: 20px 0;
}
.reader-notice {
  flex-shrink: 0;
  margin: 0;
  padding: 8px 16px;
  color: var(--pd-muted);
  background: var(--pd-surface);
  font-size: 12px;
}
.error {
  color: var(--pd-danger);
  background: var(--pd-danger-soft);
}
.truncation {
  font-size: 12px;
  color: var(--pd-warning);
  line-height: 1.7;
}
@media (min-width: 900px) {
  .reader-heading:not(.detail-heading),
  .reader-search {
    box-sizing: border-box;
    width: 100%;
    max-width: 860px;
    margin-inline: auto;
  }
}
@media (max-width: 420px) {
  .reader-heading {
    padding-inline: 14px;
  }
  .reader-search {
    padding-inline: 14px;
  }
  .session-list {
    padding-inline: 14px;
  }
  .detail-heading {
    gap: 6px;
  }
  .detail-heading button {
    padding-inline: 10px;
    font-size: 12px;
  }
  .session-context {
    padding-inline: 16px;
  }
}
</style>
