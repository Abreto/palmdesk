<template>
  <div class="pwd-wrap">
    <div class="mask"></div>
    <div class="content">
      <div class="top">
        <div class="title">连接密码</div>
        <button
          class="close"
          type="button"
          aria-label="关闭密码输入"
          title="关闭密码输入"
          :disabled="busy"
          @click="emits('close')"
        ></button>
      </div>
      <div class="uuid">设备代码：{{ uuid }}</div>
      <div class="err-msg">{{ errMsg }}</div>
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
        <div
          class="ico eye"
          :class="{ hide: hidePwd }"
          @click="hidePwd = !hidePwd"
        ></div>
      </div>
      <button
        class="btn"
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
  position: relative;
  z-index: 20;
  .mask {
    background-color: rgba($color: #000000, $alpha: 0.3) !important;

    @extend %maskBg;
  }
  .content {
    position: fixed;
    top: 50%;
    left: 50%;
    box-sizing: border-box;
    padding: 15px 20px;
    width: min(320px, calc(100vw - 32px));
    height: 220px;
    border-radius: 6px;
    background-color: white;
    box-shadow: 0 2px 20px rgb(0 0 0 / 20%);
    transform: translate(-50%, -50%);
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      .title {
        font-weight: 500;
        font-size: 16px;
      }
      .close {
        padding: 0;
        border: 0;
        background: transparent;
        width: 14px;
        height: 14px;
        cursor: pointer;

        @include cross(#666, 2px);
      }
    }
    .uuid {
      margin-top: 10px;
      color: #666;
    }
    .err-msg {
      color: red;
      height: 26px;
      margin-top: 10px;
    }
    .ipt-wrap {
      position: relative;
      margin-top: 10px;
      width: 100%;
      .ipt {
        box-sizing: border-box;
        padding: 0 15px;
        width: 100%;
        height: 40px;
        outline: none;
        border: 1px solid rgba(153, 153, 153, 0.2);
        border-radius: 4px;
        color: #666;
        font-size: 16px;
        &::placeholder {
          color: #c2c2c2;
          font-size: 14px;
        }
        &:focus {
          border: 1px solid $theme-color-gold;
        }
      }
      .ico {
        position: absolute;
        top: 50%;
        right: 2px;
        margin-right: 10px;
        width: 20px;
        height: 20px;
        cursor: pointer;
        transform: translate(0%, -50%);

        &.eye {
          @include setBackground('@/assets/img/view.png');
        }
        &.hide {
          @include setBackground('@/assets/img/view_off.png');
        }
      }
    }
    .btn {
      display: block;
      padding: 0;
      border: 0;
      margin-top: 15px;
      margin-left: auto;
      width: 80px;
      height: 32px;
      border-radius: 4px;
      background-color: $theme-color-gold;
      color: white;
      text-align: center;
      font-size: 14px;
      line-height: 32px;
      cursor: pointer;
      &:hover {
        opacity: 0.7;
      }
      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }
}
</style>
