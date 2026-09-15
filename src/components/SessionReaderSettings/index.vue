<template>
  <section class="reader-settings">
    <label>
      <input
        type="checkbox"
        :checked="enabled"
        :disabled="busy || !supported"
        @change="configure"
      />
      <strong>会话阅读</strong>
    </label>
    <p>
      {{
        supported
          ? '允许已连接设备读取此用户的 Codex 和 Claude Code 会话，包含回复与工具输出。'
          : '会话阅读支持 macOS 上的 Codex 和 Claude Code。'
      }}
    </p>
    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { IPC_EVENT } from '@/event';
import { ipcRenderer } from '@/utils';

const emit = defineEmits<{ change: [enabled: boolean] }>();
const enabled = ref(false);
const supported = ref(true);
const busy = ref(true);
const error = ref('');

async function load(channel: string, data = {}) {
  busy.value = true;
  error.value = '';
  try {
    const result = await ipcRenderer?.invoke(channel, {
      requestId: 'reader-settings',
      data,
    });
    if (result?.code !== 0) throw new Error(result?.msg || '无法读取设置');
    enabled.value = result.data.enabled;
    supported.value = result.data.supported;
    emit('change', enabled.value);
  } catch (cause) {
    enabled.value = false;
    emit('change', false);
    error.value = cause instanceof Error ? cause.message : '保存失败';
  } finally {
    busy.value = false;
  }
}

function configure(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  emit('change', false);
  void load(IPC_EVENT.sessionReaderConfigure, { enabled: checked });
}

onMounted(() => {
  void load(IPC_EVENT.sessionReaderSettings);
});
</script>

<style scoped>
.reader-settings {
  margin: 18px 0;
  padding: 16px;
  border: 1px solid #dce4ef;
  border-radius: 12px;
}
label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
input {
  width: 18px;
  height: 18px;
  accent-color: #2563eb;
}
p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
[role='alert'] {
  color: #b91c1c;
}
</style>
