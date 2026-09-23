<template>
  <div
    class="pwd-wrap"
    @keydown.esc.stop="!busy && emits('close')"
  >
    <div class="mask"></div>
    <div
      class="content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-dialog-title"
    >
      <div class="top">
        <div
          id="password-dialog-title"
          class="title"
        >
          连接密码
        </div>
        <button
          class="close"
          type="button"
          aria-label="关闭密码输入"
          title="关闭密码输入"
          :disabled="busy"
          @click="emits('close')"
        >
          <CloseOutline />
        </button>
      </div>
      <div class="uuid">设备代码：{{ uuid }}</div>
      <div
        v-if="errMsg"
        class="err-msg"
        role="alert"
      >
        {{ errMsg }}
      </div>
      <div class="ipt-wrap">
        <input
          ref="iptRef"
          v-model="password"
          :type="hidePwd ? 'password' : 'text'"
          class="ipt"
          maxlength="12"
          placeholder="请输入连接密码"
          aria-label="连接密码"
          :disabled="busy"
          @keydown.enter="handleConfirm"
        />
        <button
          class="ico eye"
          type="button"
          :aria-label="hidePwd ? '显示连接密码' : '隐藏连接密码'"
          :aria-pressed="!hidePwd"
          @click="hidePwd = !hidePwd"
        >
          <EyeOffOutline v-if="hidePwd" /><EyeOutline v-else />
        </button>
      </div>
      <button
        class="btn pd-button"
        type="button"
        :disabled="busy"
        @click="handleConfirm"
      >
        {{ busy ? '连接中' : '确定' }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { CloseOutline, EyeOffOutline, EyeOutline } from '@vicons/ionicons5';
import { onMounted, ref } from 'vue';

const hidePwd = ref(true);
const password = ref('');
const iptRef = ref<HTMLInputElement>();

const props = withDefaults(
  defineProps<{
    uuid?: string;
    pwd?: string;
    errMsg: string;
    busy?: boolean;
  }>(),
  {
    uuid: '',
    pwd: '',
    errMsg: '',
    busy: false,
  }
);

const emits = defineEmits(['confirm', 'close']);

onMounted(() => {
  password.value = props.pwd;
  iptRef.value?.focus();
});

function handleConfirm() {
  if (props.busy) return;
  if (
    password.value &&
    password.value.length >= 6 &&
    password.value.length <= 12
  ) {
    emits('confirm', password.value);
  } else {
    window.$message.warning('密码长度要求6-12位！');
  }
}
</script>

<style lang="scss" scoped>
.pwd-wrap {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  padding: 16px;
}
.mask {
  position: absolute;
  inset: 0;
  background: rgb(27 43 33 / 30%);
  backdrop-filter: blur(5px);
}
.content {
  position: relative;
  box-sizing: border-box;
  width: min(380px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 28px;
  border: 1px solid var(--pd-border);
  border-radius: var(--pd-radius-lg);
  background: var(--pd-surface);
  box-shadow: var(--pd-shadow-raised);
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.title {
  font-size: 20px;
  font-weight: 600;
}
.close,
.eye {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 8px;
  border: 0;
  border-radius: 9px;
  background: var(--pd-surface-soft);
  color: var(--pd-muted);
  cursor: pointer;
  svg {
    width: 20px;
    height: 20px;
  }
  &:hover:not(:disabled) {
    background: var(--pd-accent-soft);
    color: var(--pd-accent);
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
}
.uuid {
  margin-top: 14px;
  color: var(--pd-muted);
  font-size: 13px;
}
.err-msg {
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--pd-danger-soft);
  color: var(--pd-danger);
  font-size: 12px;
}
.ipt-wrap {
  position: relative;
  margin-top: 24px;
}
.ipt {
  box-sizing: border-box;
  width: 100%;
  height: 50px;
  padding: 12px 52px 12px 14px;
  border: 1px solid var(--pd-border-strong);
  border-radius: var(--pd-radius-sm);
  outline: none;
  background: var(--pd-bg);
  color: var(--pd-text);
  font-size: 16px;
  &::placeholder {
    color: var(--pd-muted);
    font-size: 13px;
  }
  &:focus {
    border-color: var(--pd-accent);
    box-shadow: 0 0 0 3px rgb(98 255 120 / 12%);
  }
}
.eye {
  position: absolute;
  top: 7px;
  right: 7px;
  background: transparent;
}
.btn {
  width: 100%;
  margin-top: 20px;
}
</style>
