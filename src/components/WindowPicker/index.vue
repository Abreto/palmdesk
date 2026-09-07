<template>
  <section
    class="window-picker"
    aria-label="电脑窗口列表"
  >
    <header class="picker-heading">
      <div>
        <h2>选择窗口</h2>
        <span>{{ sources.length }} 个窗口</span>
      </div>
      <button
        type="button"
        title="刷新窗口列表"
        aria-label="刷新窗口列表"
        :disabled="loading || disabled"
        @click="$emit('refresh')"
      >
        <RefreshOutline :class="{ spinning: loading }" />
      </button>
    </header>
    <label class="window-search">
      <SearchOutline aria-hidden="true" />
      <input
        v-model="query"
        type="search"
        placeholder="搜索应用或窗口"
        aria-label="搜索应用或窗口"
      />
    </label>
    <div
      v-if="error"
      class="picker-error"
      role="alert"
    >
      {{ error }}
    </div>
    <div
      v-if="loading || disabled"
      class="picker-status"
      role="status"
    >
      {{ disabled ? '正在打开窗口…' : '正在读取窗口…' }}
    </div>
    <div
      v-if="filtered.length"
      class="window-list"
    >
      <button
        v-for="source in filtered"
        :key="source.id"
        type="button"
        class="window-item"
        :disabled="loading || disabled"
        :aria-label="`选择 ${source.name}`"
        @click="$emit('select', source)"
      >
        <span class="window-preview"
          ><img
            v-if="source.thumbnail"
            :src="source.thumbnail"
            alt="" /><BrowsersOutline
            v-else
            aria-hidden="true"
        /></span>
        <span class="window-details"
          ><span class="window-app"
            ><img
              v-if="source.appIcon"
              :src="source.appIcon"
              alt=""
            />{{ source.appName }}</span
          ><span class="window-title">{{ source.name }}</span>
          <span
            v-if="!source.isOnScreen"
            class="window-visibility"
            >未在当前桌面显示</span
          ></span
        >
        <ChevronForwardOutline
          class="window-arrow"
          aria-hidden="true"
        />
      </button>
    </div>
    <p
      v-else-if="!loading && !error"
      class="picker-empty"
      role="status"
    >
      {{ query.trim() ? '没有匹配的窗口' : '没有可用的应用窗口' }}
    </p>
  </section>
</template>

<script setup lang="ts">
import {
  BrowsersOutline,
  ChevronForwardOutline,
  RefreshOutline,
  SearchOutline,
} from '@vicons/ionicons5';
import { computed, ref } from 'vue';

import type { IRemoteWindow } from '@/pure-interface';

const props = defineProps<{
  sources: IRemoteWindow[];
  loading: boolean;
  disabled: boolean;
  error: string;
}>();
defineEmits<{ refresh: []; select: [source: IRemoteWindow] }>();
const query = ref('');
const filtered = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return props.sources.filter((source) =>
    `${source.appName} ${source.name}`.toLocaleLowerCase().includes(search)
  );
});
</script>

<style scoped lang="scss">
.window-picker {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px max(16px, env(safe-area-inset-right))
    max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}
.window-picker > * {
  max-width: 860px;
  margin-left: auto;
  margin-right: auto;
  box-sizing: border-box;
}
.picker-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.picker-heading h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.picker-heading span {
  color: #66736c;
  font-size: 13px;
}
.picker-heading button {
  width: 44px;
  height: 44px;
  padding: 10px;
  border: 1px solid #cbd6cf;
  border-radius: 4px;
  color: #176d5a;
  background: #fff;
  cursor: pointer;
}
.window-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  background: #fff;
  border: 1px solid #bbc9c1;
  border-radius: 4px;
}
.window-search svg {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  color: #66736c;
}
.window-search input {
  min-width: 0;
  flex: 1;
  height: 44px;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 16px;
  color: #263b32;
}
.window-search:focus-within {
  outline: 2px solid #167c65;
  outline-offset: 2px;
}
.window-list {
  margin-top: 16px;
}
.window-visibility {
  color: #66736c;
  font-size: 12px;
}
.window-item {
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 106px;
  padding: 12px 4px;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #d6dfd9;
  color: #263b32;
  cursor: pointer;
}
.window-item:hover:not(:disabled) {
  background: #e5ece8;
}
.window-item:focus-visible {
  outline: 2px solid #167c65;
  outline-offset: 2px;
}
.window-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 128px;
  aspect-ratio: 16 / 10;
  border: 1px solid #cbd6cf;
  border-radius: 4px;
  box-sizing: border-box;
  overflow: hidden;
  background: #e1e7e3;
}
.window-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.window-preview svg {
  width: 32px;
  height: 32px;
  color: #66736c;
}
.window-details {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.window-app {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #66736c;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.window-app img {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
.window-title {
  font-size: 15px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.window-arrow {
  width: 20px;
  height: 20px;
  color: #66736c;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.picker-error,
.picker-status,
.picker-empty {
  font-size: 14px;
  line-height: 1.6;
  margin-top: 16px;
  overflow-wrap: anywhere;
}
.picker-error {
  color: #a13e3e;
}
.picker-status,
.picker-empty {
  color: #66736c;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 480px) {
  .window-picker {
    padding-top: 18px;
  }
  .window-item {
    grid-template-columns: 96px minmax(0, 1fr) 16px;
    gap: 10px;
    min-height: 88px;
  }
  .window-preview {
    width: 96px;
  }
  .window-arrow {
    width: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }
}
</style>
