<template>
  <div
    class="modal-wrap"
    @click.self="maskClose"
  >
    <div
      class="container"
      :style="{ width }"
    >
      <span class="title">{{ props.title }}</span>
      <i
        v-if="!hiddenClose"
        class="close"
        @click="emits('close')"
      ></i>
      <div class="content">
        <slot></slot>
      </div>
      <div class="footer">
        <slot name="footer"></slot>

        <div
          v-if="!slots.footer"
          class="btn"
        >
          返回首页
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useSlots } from 'vue';

const slots = useSlots();
const props = withDefaults(
  defineProps<{
    hiddenClose?: Boolean;
    maskClosable?: Boolean;
    title?: string;
    width?: string;
  }>(),
  {
    width: '320px',
  }
);

function maskClose() {
  if (props.maskClosable) {
    emits('close');
  }
}

const emits = defineEmits(['close']);
</script>

<style lang="scss" scoped>
.modal-wrap {
  z-index: 1100;
  background-color: rgb(27 43 33 / 30%) !important;

  backdrop-filter: blur(5px);
  @extend %maskBg;
  .container {
    position: absolute;
    top: 50%;
    left: 50%;
    box-sizing: border-box;
    max-width: calc(100vw - 32px);
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 24px;
    border: 1px solid var(--pd-border);
    border-radius: var(--pd-radius-lg);
    box-shadow: var(--pd-shadow-raised);
    background-color: #fff;
    font-size: 14px;
    transform: translate(-50%, -50%);
    .title {
      font-weight: 600;
      font-size: 20px;
    }
    .close {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 18px;
      height: 18px;
      cursor: pointer;

      @include cross(#ccc, 3px);
    }
    .content {
      margin: 15px 0;
    }
    .footer {
      .btn {
        width: 100%;
        height: 44px;
        border-radius: var(--pd-radius-sm);
        background: $theme-color-gold;
        color: white;
        text-align: center;
        font-weight: 600;
        font-size: 16px;
        line-height: 44px;
        cursor: pointer;
      }
    }
  }
}
</style>
