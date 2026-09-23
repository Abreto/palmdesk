<template>
  <div
    class="modal-backdrop"
    @keydown.esc="emit('close')"
  >
    <form
      class="service-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-dialog-title"
      @submit.prevent="save"
    >
      <header>
        <h2 id="service-dialog-title">连接服务</h2>
        <button
          type="button"
          title="关闭"
          aria-label="关闭连接设置"
          @click="emit('close')"
        >
          <CloseOutline />
        </button>
      </header>
      <label v-if="ipcRenderer"
        >手机网页地址<input
          v-model="clientUrl"
          placeholder="https://remote.example.com/"
          autocapitalize="none"
          :spellcheck="false"
      /></label>
      <label
        >服务地址<input
          ref="firstInput"
          v-model="apiUrl"
          placeholder="/api"
          autocapitalize="none"
          :spellcheck="false"
      /></label>
      <label
        >信令地址<input
          v-model="signalingUrl"
          placeholder="https://remote.example.com"
          autocapitalize="none"
          :spellcheck="false"
      /></label>
      <label
        >中继地址<input
          v-model="turnUrl"
          placeholder="turn:relay.example.com:3478"
          autocapitalize="none"
          :spellcheck="false"
      /></label>
      <label
        >TURN 用户名<input
          v-model="turnUsername"
          autocomplete="off"
          autocapitalize="none"
          :spellcheck="false"
      /></label>
      <label
        >TURN 密码<input
          v-model="turnCredential"
          type="password"
          autocomplete="off"
      /></label>
      <p
        v-if="error"
        class="error"
        role="alert"
      >
        {{ error }}
      </p>
      <footer>
        <button
          class="save"
          type="submit"
        >
          <SaveOutline />保存并重新连接
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { CloseOutline, SaveOutline } from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';

import { AXIOS_BASEURL, COTURN_URL, WEBSOCKET_URL } from '@/constant';
import { ipcRenderer } from '@/utils';
import { normalizeClientUrl } from '@/utils/connection-invite';
import {
  getAxiosBaseUrl,
  getClientUrl,
  getCoturnCredential,
  getCoturnUrl,
  getCoturnUsername,
  getWssUrl,
  setAxiosBaseUrl,
  setClientUrl,
  setCoturnCredential,
  setCoturnUrl,
  setCoturnUsername,
  setWssUrl,
} from '@/utils/localStorage/app';

const emit = defineEmits(['close']);
const apiUrl = ref(getAxiosBaseUrl() || AXIOS_BASEURL);
const clientUrl = ref(getClientUrl());
const signalingUrl = ref(getWssUrl() || WEBSOCKET_URL);
const turnUrl = ref(getCoturnUrl() || COTURN_URL);
const turnUsername = ref(
  getCoturnUsername() || import.meta.env.VITE_TURN_USERNAME || ''
);
const turnCredential = ref(
  getCoturnCredential() || import.meta.env.VITE_TURN_CREDENTIAL || ''
);
const firstInput = ref<HTMLInputElement>();
const error = ref('');
onMounted(() => firstInput.value?.focus());

function validUrl(value: string, protocols: string[], relative = false) {
  if (!value) return true;
  if (relative && value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function save() {
  const api = apiUrl.value.trim();
  const signaling = signalingUrl.value.trim();
  const turn = turnUrl.value.trim();
  let client = clientUrl.value.trim();
  if (ipcRenderer && client) {
    try {
      client = normalizeClientUrl(client);
    } catch (cause) {
      error.value = (cause as Error).message;
      return;
    }
  }
  if (
    !validUrl(api, ['http:', 'https:'], true) ||
    !validUrl(signaling, ['http:', 'https:', 'ws:', 'wss:'])
  ) {
    error.value = '请输入有效的服务地址和信令地址';
    return;
  }
  if (!validUrl(turn, ['stun:', 'stuns:', 'turn:', 'turns:'])) {
    error.value = '请输入有效的 STUN/TURN 中继地址';
    return;
  }
  setAxiosBaseUrl(api);
  setWssUrl(signaling);
  setCoturnUrl(turn);
  setCoturnUsername(turnUsername.value.trim());
  setCoturnCredential(turnCredential.value);
  if (ipcRenderer) setClientUrl(client);
  window.location.reload();
}
</script>

<style scoped lang="scss">
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(27 43 33 / 30%);
  backdrop-filter: blur(5px);
}
.service-dialog {
  box-sizing: border-box;
  width: min(460px, 100%);
  max-height: calc(100dvh - 32px);
  overflow: auto;
  padding: 28px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-lg);
  background: white;
  color: var(--pd-text);
  box-shadow: var(--pd-shadow-raised);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
  color: var(--pd-muted);
  font-size: 13px;
}
input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 46px;
  padding: 10px 12px;
  outline: none;
  color: var(--pd-text);
  background: var(--pd-bg);
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  font-size: 16px;
  &:focus {
    border-color: var(--pd-accent);
    box-shadow: 0 0 0 3px #25634d0c;
  }
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 8px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-sm);
  background: white;
  color: var(--pd-accent);
  cursor: pointer;
}
header button {
  width: 40px;
}
svg {
  width: 20px;
  height: 20px;
}
footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.save {
  width: 100%;
  height: 46px;
  border-color: var(--pd-accent);
  padding: 8px 14px;
  background: var(--pd-accent);
  color: white;
}
.error {
  color: var(--pd-danger);
  font-size: 13px;
}
@media (max-width: 480px) {
  .service-dialog {
    padding: 22px;
  }
}
</style>
