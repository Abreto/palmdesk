<template>
  <section
    class="agent-picker"
    aria-label="Agent 入口"
  >
    <div class="picker-content">
      <header class="picker-heading">
        <div>
          <h2>继续工作</h2>
          <span>{{ directory.agents.length }} 个 Agent</span>
        </div>
        <button
          class="icon-button"
          type="button"
          title="刷新 Agent 和窗口"
          aria-label="刷新 Agent 和窗口"
          :disabled="loading || disabled"
          @click="$emit('refresh')"
        >
          <RefreshOutline :class="{ spinning: loading }" />
        </button>
      </header>
      <div
        class="picker-tabs"
        role="tablist"
        aria-label="入口类型"
      >
        <button
          id="agents-tab"
          type="button"
          role="tab"
          aria-controls="agents-panel"
          :aria-selected="tab === 'agents'"
          @click="tab = 'agents'"
        >
          <HardwareChipOutline />Agent
          <span>{{ directory.agents.length }}</span>
        </button>
        <button
          id="other-apps-tab"
          type="button"
          role="tab"
          aria-controls="other-apps-panel"
          :aria-selected="tab === 'other'"
          @click="tab = 'other'"
        >
          <AppsOutline />其他应用
          <span>{{ directory.otherWindows.length }}</span>
        </button>
      </div>
      <label class="picker-search">
        <SearchOutline aria-hidden="true" />
        <input
          v-model="query"
          type="search"
          placeholder="搜索窗口或 Agent"
          aria-label="搜索 Agent、应用或窗口"
        />
      </label>
      <p
        v-if="error || discoveryError"
        class="picker-error"
        role="alert"
      >
        {{ error || discoveryError }}
      </p>
      <p
        v-if="loading || disabled"
        class="picker-status"
        role="status"
      >
        {{ disabled ? '打开中…' : '刷新中…' }}
      </p>

      <div
        v-if="tab === 'agents'"
        id="agents-panel"
        role="tabpanel"
        aria-labelledby="agents-tab"
      >
        <div
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="agent-group"
          :data-agent="agent.id"
        >
          <div class="agent-row">
            <button
              class="agent-entry"
              type="button"
              :aria-label="`打开 ${agent.name}`"
              :aria-expanded="
                agent.windows.length > 1 ? expanded === agent.id : undefined
              "
              :disabled="loading || disabled || !agent.windows.length"
              @click="openAgent(agent)"
            >
              <span class="agent-icon">
                <img
                  v-if="agent.windows.some((source) => source.appIcon)"
                  :src="agent.windows.find((source) => source.appIcon)?.appIcon"
                  alt=""
                />
                <HardwareChipOutline
                  v-else
                  aria-hidden="true"
                />
              </span>
              <span class="agent-details">
                <span class="agent-name"
                  >{{ agent.name
                  }}<span
                    v-if="recent[agent.id]"
                    class="recent-label"
                    >最近使用</span
                  ></span
                >
                <span class="agent-context">{{
                  agent.windows.length === 1
                    ? agent.windows[0].name
                    : agent.windows.length
                      ? `${agent.windows.length} 个窗口`
                      : '暂无窗口'
                }}</span>
                <span class="agent-state"
                  ><span :class="{ manual: !agent.discovered }"></span
                  >{{ agent.discovered ? '已打开' : '手动关联' }}</span
                >
              </span>
              <ChevronDownOutline
                v-if="agent.windows.length > 1 && expanded === agent.id"
                class="entry-arrow"
              />
              <ChevronForwardOutline
                v-else-if="agent.windows.length"
                class="entry-arrow"
              />
            </button>
            <button
              class="icon-button pin-button"
              type="button"
              :title="
                pinned.includes(agent.id)
                  ? `取消置顶 ${agent.name}`
                  : `置顶 ${agent.name}`
              "
              :aria-label="
                pinned.includes(agent.id)
                  ? `取消置顶 ${agent.name}`
                  : `置顶 ${agent.name}`
              "
              :aria-pressed="pinned.includes(agent.id)"
              @click="togglePin(agent.id)"
            >
              <Star v-if="pinned.includes(agent.id)" /><StarOutline v-else />
            </button>
          </div>
          <div
            v-if="
              agent.windows.length &&
              (expanded === agent.id ||
                (!!query.trim() && agent.windows.length > 1))
            "
            class="agent-windows"
          >
            <div
              v-for="source in agent.windows"
              :key="source.id"
              class="window-row"
            >
              <button
                class="window-item"
                type="button"
                :disabled="loading || disabled"
                :aria-label="`选择 ${source.name}`"
                @click="openWindow(source, agent.id)"
              >
                <span class="window-preview"
                  ><img
                    v-if="source.thumbnail"
                    :src="source.thumbnail"
                    alt="" /><BrowsersOutline v-else
                /></span>
                <span class="window-details"
                  ><span class="window-title">{{ source.name }}</span
                  ><span class="window-app"
                    >{{ source.appName
                    }}{{
                      !source.isOnScreen ? ' · 未在当前桌面显示' : ''
                    }}</span
                  ></span
                >
                <ChevronForwardOutline class="entry-arrow" />
              </button>
              <button
                v-if="!source.agentId"
                class="icon-button"
                type="button"
                title="取消关联"
                aria-label="取消关联"
                :disabled="loading || disabled"
                @click="$emit('bind', source, undefined)"
              >
                <UnlinkOutline />
              </button>
            </div>
          </div>
          <button
            v-else-if="agent.windows.length === 1 && !agent.windows[0].agentId"
            type="button"
            class="unlink-command"
            :disabled="loading || disabled"
            @click="$emit('bind', agent.windows[0], undefined)"
          >
            <UnlinkOutline />取消关联
          </button>
        </div>
        <div
          v-if="!filteredAgents.length && !loading"
          class="picker-empty"
          role="status"
        >
          <HardwareChipOutline />
          <p>
            {{ query.trim() ? '没有匹配的 Agent' : '未发现已打开的 Agent' }}
          </p>
          <button
            v-if="!query.trim()"
            type="button"
            class="text-command"
            @click="tab = 'other'"
          >
            <AppsOutline />查看其他应用<ChevronForwardOutline />
          </button>
        </div>
      </div>

      <div
        v-else
        id="other-apps-panel"
        role="tabpanel"
        aria-labelledby="other-apps-tab"
      >
        <div
          v-for="source in filteredOtherWindows"
          :key="source.id"
          class="window-row other-window"
        >
          <button
            class="window-item"
            type="button"
            :disabled="loading || disabled"
            :aria-label="`选择 ${source.name}`"
            @click="openWindow(source)"
          >
            <span class="window-preview"
              ><img
                v-if="source.thumbnail"
                :src="source.thumbnail"
                alt="" /><BrowsersOutline v-else
            /></span>
            <span class="window-details"
              ><span class="window-app">{{ source.appName }}</span
              ><span class="window-title">{{ source.name }}</span
              ><span
                v-if="!source.isOnScreen"
                class="window-app"
                >未在当前桌面显示</span
              ></span
            >
            <ChevronForwardOutline class="entry-arrow" />
          </button>
          <button
            class="icon-button"
            type="button"
            :title="`将 ${source.appName} 关联到 Agent`"
            :aria-label="`将 ${source.appName} 关联到 Agent`"
            :disabled="loading || disabled"
            :aria-expanded="linking === source.id"
            @click="linking = linking === source.id ? '' : source.id"
          >
            <LinkOutline />
          </button>
          <div
            v-if="linking === source.id"
            class="binding-row"
          >
            <label
              >关联到<select
                aria-label="选择关联的 Agent"
                :disabled="loading || disabled"
                @change="bindWindow(source, $event)"
              >
                <option value="">选择 Agent</option>
                <option
                  v-for="agent in AGENT_DEFINITIONS"
                  :key="agent.id"
                  :value="agent.id"
                >
                  {{ agent.name }}
                </option>
              </select></label
            >
            <button
              class="icon-button"
              type="button"
              title="取消关联操作"
              aria-label="取消关联操作"
              @click="linking = ''"
            >
              <CloseOutline />
            </button>
          </div>
        </div>
        <div
          v-if="!filteredOtherWindows.length && !loading"
          class="picker-empty"
          role="status"
        >
          <AppsOutline />
          <p>{{ query.trim() ? '没有匹配的窗口' : '没有其他应用窗口' }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import {
  AppsOutline,
  BrowsersOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseOutline,
  HardwareChipOutline,
  LinkOutline,
  RefreshOutline,
  SearchOutline,
  Star,
  StarOutline,
  UnlinkOutline,
} from '@vicons/ionicons5';
import { computed, ref, watch } from 'vue';

import type { IRemoteAgent, IRemoteWindow } from '@/pure-interface';
import {
  buildAgentDirectory,
  type AgentBindings,
  type AgentEntry,
} from '@/utils/agent-directory';
import {
  AGENT_DEFINITIONS,
  getAgent,
  type AgentId,
} from '@/utils/agent-registry';

const props = defineProps<{
  applications: IRemoteAgent[];
  sources: IRemoteWindow[];
  bindings: AgentBindings;
  deviceId: string;
  loading: boolean;
  disabled: boolean;
  error: string;
  discoveryError: string;
}>();
const emit = defineEmits<{
  refresh: [];
  select: [source: IRemoteWindow];
  bind: [source: IRemoteWindow, agentId: AgentId | undefined];
}>();
const tab = ref<'agents' | 'other'>('agents');
const query = ref('');
const expanded = ref<AgentId>();
const linking = ref('');
const pinned = ref<AgentId[]>([]);
const recent = ref<Partial<Record<AgentId, number>>>({});
const preferenceKey = () => `palmdesk-agent-preferences:${props.deviceId}`;
watch(
  () => props.deviceId,
  () => {
    pinned.value = [];
    recent.value = {};
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey()) || '{}');
      if (Array.isArray(saved.pinned))
        pinned.value = AGENT_DEFINITIONS.filter((agent) =>
          saved.pinned.includes(agent.id)
        ).map((agent) => agent.id);
      AGENT_DEFINITIONS.forEach(({ id }) => {
        if (
          typeof saved.recent?.[id] === 'number' &&
          Number.isFinite(saved.recent[id])
        )
          recent.value[id] = saved.recent[id];
      });
    } catch {
      /* The directory remains usable when browser storage is unavailable. */
    }
  },
  { immediate: true }
);

const directory = computed(() =>
  buildAgentDirectory(props.applications, props.sources, props.bindings)
);
const matchesWindow = (source: IRemoteWindow) =>
  `${source.appName} ${source.name}`
    .toLocaleLowerCase()
    .includes(query.value.trim().toLocaleLowerCase());
const filteredAgents = computed(() =>
  directory.value.agents
    .map((agent) =>
      agent.name
        .toLocaleLowerCase()
        .includes(query.value.trim().toLocaleLowerCase())
        ? agent
        : { ...agent, windows: agent.windows.filter(matchesWindow) }
    )
    .filter(
      (agent) =>
        agent.name
          .toLocaleLowerCase()
          .includes(query.value.trim().toLocaleLowerCase()) ||
        agent.windows.length
    )
    .sort(
      (a, b) =>
        Number(pinned.value.includes(b.id)) -
          Number(pinned.value.includes(a.id)) ||
        (recent.value[b.id] || 0) - (recent.value[a.id] || 0)
    )
);
const filteredOtherWindows = computed(() =>
  directory.value.otherWindows.filter(matchesWindow)
);

function savePreferences() {
  try {
    localStorage.setItem(
      preferenceKey(),
      JSON.stringify({ pinned: pinned.value, recent: recent.value })
    );
  } catch {
    /* Keep preferences in memory for this visit. */
  }
}
function togglePin(id: AgentId) {
  pinned.value = pinned.value.includes(id)
    ? pinned.value.filter((value) => value !== id)
    : [...pinned.value, id];
  savePreferences();
}
function openAgent(agent: AgentEntry) {
  if (agent.windows.length === 1) openWindow(agent.windows[0], agent.id);
  else expanded.value = expanded.value === agent.id ? undefined : agent.id;
}
function openWindow(source: IRemoteWindow, agentId?: AgentId) {
  if (agentId) {
    recent.value[agentId] = Date.now();
    savePreferences();
  }
  emit('select', source);
}
function bindWindow(source: IRemoteWindow, event: Event) {
  const agent = getAgent((event.target as HTMLSelectElement).value);
  if (!agent) return;
  emit('bind', source, agent.id);
  linking.value = '';
  query.value = '';
  tab.value = 'agents';
  expanded.value = agent.id;
}
</script>

<style scoped lang="scss">
.agent-picker {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 32px max(20px, env(safe-area-inset-right))
    max(32px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  color: var(--pd-text);
}
.picker-content {
  max-width: 780px;
  margin: 0 auto;
}
.picker-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}
h2 {
  margin: 0 0 6px;
  font-size: 22px;
  line-height: 1.4;
}
.picker-heading span {
  color: var(--pd-muted);
  font-size: 13px;
}
button,
input,
select {
  font: inherit;
  letter-spacing: 0;
}
button {
  color: inherit;
  cursor: pointer;
}
button:disabled {
  cursor: default;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid var(--pd-accent);
  outline-offset: 2px;
}
.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  padding: 9px;
  border: 0;
  border-radius: var(--pd-radius-sm);
  background: transparent;
  color: var(--pd-muted);
}
.icon-button:hover:not(:disabled) {
  background: var(--pd-accent-soft);
  color: var(--pd-accent);
}
.icon-button:disabled {
  opacity: 0.45;
}
.icon-button svg {
  width: 20px;
  height: 20px;
}
.pin-button[aria-pressed='true'] {
  color: var(--pd-warning);
}
.picker-tabs {
  display: flex;
  gap: 4px;
  padding: 5px;
  border: 1px solid var(--pd-border);
  border-radius: 13px;
  background: var(--pd-surface-soft);
  margin-bottom: 18px;
}
.picker-tabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  flex: 1;
  justify-content: center;
  padding: 8px 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  font-size: 14px;
  color: var(--pd-muted);
}
.picker-tabs button[aria-selected='true'] {
  background: var(--pd-surface);
  box-shadow: 0 2px 12px rgb(0 0 0 / 32%);
  color: var(--pd-accent);
  font-weight: 600;
}
.picker-tabs svg {
  width: 18px;
  height: 18px;
}
.picker-tabs span {
  padding: 0 6px;
  border-radius: 6px;
  background: var(--pd-accent-soft);
  font-size: 11px;
  font-weight: 500;
}
.picker-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  margin-bottom: 20px;
}
.picker-search svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--pd-muted);
}
.picker-search input {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font-size: 16px;
  color: var(--pd-text);
}
.picker-search:focus-within {
  outline: 2px solid var(--pd-accent);
  outline-offset: 2px;
}
.agent-group {
  margin-bottom: 12px;
  padding: 0 16px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  background: var(--pd-surface);
  box-shadow: var(--pd-shadow);
}
.agent-group:focus-within {
  border-color: var(--pd-border-strong);
}
.agent-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.agent-entry {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  min-height: 106px;
  gap: 16px;
  padding: 18px 0;
  border: 0;
  background: transparent;
  text-align: left;
}
.agent-entry:disabled {
  color: inherit;
}
.agent-entry:hover:not(:disabled) .agent-name {
  color: var(--pd-accent);
}
.agent-icon {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border: 1px solid var(--pd-border);
  background: var(--pd-surface-soft);
  border-radius: 13px;
}
.agent-icon img,
.agent-icon svg {
  width: 30px;
  height: 30px;
  object-fit: contain;
  color: var(--pd-muted);
}
.agent-details {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}
.agent-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.recent-label {
  font-size: 11px;
  color: var(--pd-muted);
  font-weight: 400;
}
.agent-context {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  color: var(--pd-muted);
}
.agent-state {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--pd-muted);
}
.agent-state > span {
  width: 5px;
  height: 5px;
  background: var(--pd-accent);
  border-radius: 50%;
}
.agent-state > span.manual {
  background: #8aa8ff;
}
.entry-arrow {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  color: var(--pd-muted);
}
.agent-windows {
  margin: 0 0 14px 20px;
  padding-left: 18px;
  border-left: 2px solid var(--pd-border-strong);
}
.window-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.window-item {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 90px;
  align-items: center;
  gap: 12px;
  border: 0;
  padding: 12px 0;
  background: transparent;
  text-align: left;
}
.window-item:hover:not(:disabled) {
  color: var(--pd-accent);
}
.window-item:disabled {
  opacity: 0.6;
}
.window-preview {
  width: 88px;
  flex: 0 0 88px;
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--pd-radius-sm);
  border: 1px solid var(--pd-border-strong);
  background: var(--pd-surface-soft);
  overflow: hidden;
  box-sizing: border-box;
}
.window-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.window-preview svg {
  width: 24px;
  height: 24px;
  color: var(--pd-muted);
}
.window-details {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}
.window-title {
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.window-app {
  font-size: 11px;
  line-height: 1.5;
  color: var(--pd-muted);
  overflow-wrap: anywhere;
}
.other-window {
  margin-bottom: 12px;
  padding: 4px 14px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius);
  background: var(--pd-surface);
}
.binding-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 8px;
  padding-bottom: 12px;
}
.binding-row label {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 12px;
  font-size: 13px;
}
.binding-row select {
  min-width: 0;
  flex: 1;
  height: 40px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  background: var(--pd-surface);
  padding: 0 8px;
  color: var(--pd-text);
}
.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 16px;
  color: var(--pd-muted);
  text-align: center;
  font-size: 14px;
}
.picker-empty > svg {
  width: 30px;
  height: 30px;
}
.text-command,
.unlink-command {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: var(--pd-accent);
  font-size: 13px;
}
.text-command svg,
.unlink-command svg {
  width: 16px;
  height: 16px;
}
.unlink-command {
  margin: 0 0 8px 60px;
  color: var(--pd-muted);
  font-size: 12px;
}
.picker-error {
  margin: 12px 0;
  color: var(--pd-danger);
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.picker-status {
  margin: 10px 0;
  color: var(--pd-muted);
  font-size: 12px;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 380px) {
  .agent-entry {
    gap: 10px;
  }
  .agent-windows {
    margin-left: 10px;
    padding-left: 10px;
  }
  .window-preview {
    width: 60px;
    flex-basis: 60px;
  }
  .window-item {
    gap: 8px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
