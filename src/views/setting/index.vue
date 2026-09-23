<template>
  <main class="settings-page pd-page">
    <header class="pd-page-heading">
      <span class="pd-eyebrow">设置</span>
      <h1>按你的习惯<span class="heading-accent">设置。</span></h1>
      <p>连接服务与使用偏好。</p>
    </header>
    <section class="pd-card">
      <header class="section-heading">
        <span class="section-icon"><ServerOutline aria-hidden="true" /></span>
        <div>
          <h2>连接服务</h2>
          <p>连接与通信</p>
        </div>
        <button
          type="button"
          class="pd-icon-button"
          title="修改连接服务"
          aria-label="修改连接服务"
          @click="showUrlModal = true"
        >
          <CreateOutline />
        </button>
      </header>
      <dl>
        <template v-if="ipcRenderer"
          ><dt>手机网页地址</dt>
          <dd>{{ getClientUrl() || '未配置' }}</dd></template
        >
        <dt>服务地址</dt>
        <dd>{{ getAxiosBaseUrl() || AXIOS_BASEURL }}</dd>
        <dt>信令地址</dt>
        <dd>{{ getWssUrl() || WEBSOCKET_URL }}</dd>
        <dt>中继地址</dt>
        <dd>{{ getCoturnUrl() || COTURN_URL || '自动' }}</dd>
      </dl>
    </section>
    <section
      v-if="ipcRenderer"
      class="pd-card"
    >
      <header class="section-heading">
        <span class="section-icon"><LaptopOutline aria-hidden="true" /></span>
        <div>
          <h2>桌面端</h2>
          <p>保持窗口专注</p>
        </div>
      </header>
      <label class="toggle"
        ><span><strong>窗口置顶</strong><small>保持 PalmDesk 置顶</small></span
        ><input
          v-model="cacheStore.isAlwaysOnTop"
          type="checkbox"
          class="pd-switch"
          role="switch"
          aria-label="窗口置顶"
      /></label>
    </section>
    <section class="pd-card about-card">
      <div class="about-brand">
        <span class="about-mark"
          ><PhonePortraitOutline aria-hidden="true"
        /></span>
        <div>
          <h2>{{ PRODUCT_NAME }}</h2>
          <p>AI-native remote control</p>
        </div>
        <span class="version">v{{ appStore.version }}</span>
      </div>
      <p class="about-description">为 Agent 工作流连接桌面与掌心。</p>
      <div class="project-links">
        <a
          :href="PROJECT_GITHUB"
          target="_blank"
          rel="noopener"
          @click.prevent="openProject(PROJECT_GITHUB)"
          >项目主页<OpenOutline /></a
        ><a
          :href="UPSTREAM_GITHUB"
          target="_blank"
          rel="noopener"
          @click.prevent="openProject(UPSTREAM_GITHUB)"
          >BilldDesk · MIT<OpenOutline
        /></a>
      </div>
    </section>
    <UrlModal
      v-if="showUrlModal"
      @close="showUrlModal = false"
    />
  </main>
</template>

<script setup lang="ts">
import {
  CreateOutline,
  LaptopOutline,
  OpenOutline,
  PhonePortraitOutline,
  ServerOutline,
} from '@vicons/ionicons5';
import { ref, watch } from 'vue';

import {
  AXIOS_BASEURL,
  COTURN_URL,
  PRODUCT_NAME,
  PROJECT_GITHUB,
  UPSTREAM_GITHUB,
  WEBSOCKET_URL,
  WINDOW_ID_ENUM,
} from '@/constant';
import { useIpcRendererSend } from '@/hooks/use-ipcRendererSend';
import { useAppStore } from '@/store/app';
import { usePiniaCacheStore } from '@/store/cache';
import { ipcRenderer } from '@/utils';
import {
  getAxiosBaseUrl,
  getClientUrl,
  getCoturnUrl,
  getWssUrl,
} from '@/utils/localStorage/app';

import UrlModal from './urlModal.vue';

const appStore = useAppStore();
const cacheStore = usePiniaCacheStore();
const showUrlModal = ref(false);
const { handleOpenExternal, handlesetAlwaysOnTop } = useIpcRendererSend();
function openProject(url: string) {
  handleOpenExternal({
    windowId: WINDOW_ID_ENUM.remote,
    url,
  });
}
watch(
  () => cacheStore.isAlwaysOnTop,
  (flag) => {
    if (ipcRenderer)
      handlesetAlwaysOnTop({ windowId: WINDOW_ID_ENUM.remote, flag });
  }
);
</script>

<style scoped lang="scss">
section {
  margin-bottom: 18px;
  &:first-of-type {
    border-color: var(--pd-border-strong);
  }
}
.section-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  > button {
    margin-left: auto;
  }
  p {
    margin: 4px 0 0;
    color: var(--pd-muted);
    font-size: 12px;
  }
}
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.section-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: var(--pd-radius-sm);
  border: 1px solid var(--pd-border-strong);
  background: var(--pd-accent-soft);
  color: var(--pd-accent);
  svg {
    width: 21px;
    height: 21px;
  }
}
dl {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 16px 20px;
  margin: 0;
  padding-top: 20px;
  border-top: 1px solid var(--pd-border);
  font-size: 13px;
}
dt {
  color: var(--pd-muted);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--pd-mono);
  font-size: 12px;
  user-select: text;
}
.toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid var(--pd-border);
  cursor: pointer;
  strong {
    font-size: 13px;
    font-weight: 550;
  }
  small {
    display: block;
    margin-top: 4px;
    color: var(--pd-muted);
    font-size: 12px;
  }
}
.about-card {
  background: var(--pd-surface-soft);
  box-shadow: none;
}
.about-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  p {
    margin: 3px 0 0;
    color: var(--pd-muted);
    font-size: 11px;
  }
}
.about-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 46px;
  border-radius: var(--pd-radius-sm);
  background: var(--pd-accent);
  color: #071108;
  svg {
    width: 26px;
    height: 26px;
  }
}
.version {
  margin-left: auto;
  padding: 3px 9px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  color: var(--pd-muted);
  font: 11px/1.6 var(--pd-mono);
}
.about-description {
  margin: 20px 0;
  color: var(--pd-muted);
  font-size: 13px;
  line-height: 1.8;
}
.project-links {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 24px;
  padding-top: 16px;
  border-top: 1px solid var(--pd-border);
}
a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--pd-accent);
  font-size: 12px;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
  svg {
    width: 14px;
    height: 14px;
  }
}
@media (max-width: 700px) {
  dl {
    grid-template-columns: 86px minmax(0, 1fr);
    gap: 16px 12px;
    font-size: 12px;
  }
  .section-heading {
    gap: 10px;
  }
}
</style>
