<template>
  <div class="video-settings">
    <label>
      画质预设
      <select
        aria-label="画质预设"
        :aria-describedby="descriptionId"
        :value="profile"
        @change="selectProfile"
      >
        <option value="balanced">均衡</option>
        <option value="lowData">省流量</option>
        <option value="highDetail">高细节</option>
        <option
          value="custom"
          disabled
        >
          自定义
        </option>
      </select>
    </label>
    <p
      :id="descriptionId"
      class="quality-description"
      aria-live="polite"
    >
      {{ description }}
    </p>
    <label>
      分辨率上限
      <select
        aria-label="分辨率上限"
        :value="modelValue.resolutionRatio"
        @change="changeNumber('resolutionRatio', $event)"
      >
        <option
          v-for="value in REMOTE_VIDEO_OPTIONS.resolutionRatio"
          :key="value"
          :value="value"
        >
          {{ value }}p
        </option>
      </select>
    </label>
    <label>
      帧率上限
      <select
        aria-label="帧率上限"
        :value="modelValue.maxFramerate"
        @change="changeNumber('maxFramerate', $event)"
      >
        <option
          v-for="value in REMOTE_VIDEO_OPTIONS.maxFramerate"
          :key="value"
          :value="value"
        >
          {{ value }} fps
        </option>
      </select>
    </label>
    <label>
      码率上限
      <select
        aria-label="码率上限"
        :value="modelValue.maxBitrate"
        @change="changeNumber('maxBitrate', $event)"
      >
        <option
          v-for="value in REMOTE_VIDEO_OPTIONS.maxBitrate"
          :key="value"
          :value="value"
        >
          {{ value }} kbit/s
        </option>
      </select>
    </label>
    <label>
      视频内容
      <select
        aria-label="视频内容"
        :value="modelValue.videoContentHint"
        @change="changeHint"
      >
        <option value="">默认</option>
        <option value="text">文本</option>
        <option value="motion">运动</option>
        <option value="detail">细节</option>
      </select>
    </label>
    <p>
      码率是上限，实际用量随画面和网络变化。选择会保存在当前客户端中，重连时沿用。
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';

import {
  REMOTE_VIDEO_OPTIONS,
  REMOTE_VIDEO_PROFILES,
  remoteVideoProfile,
  type RemoteVideoProfile,
  type RemoteVideoQuality,
} from '@/utils/remote-video';

const props = defineProps<{ modelValue: RemoteVideoQuality }>();
const descriptionId = useId();
const emit = defineEmits<{
  'update:modelValue': [value: RemoteVideoQuality];
}>();
const profile = computed(() => remoteVideoProfile(props.modelValue));
const description = computed(
  () =>
    ({
      balanced: '保留文字分辨率，降低帧率和码率。滚动可能较不流畅。',
      lowData: '降低分辨率和帧率以节省流量，小字和放大后的细节可能变模糊。',
      highDetail: '提高码率和帧率，适合较好的网络，可能增加流量。',
      custom: '使用手动设置。选择预设可恢复整组参数。',
    })[profile.value]
);

function selectProfile(event: Event) {
  const key = (event.target as HTMLSelectElement).value;
  if (Object.prototype.hasOwnProperty.call(REMOTE_VIDEO_PROFILES, key))
    emit('update:modelValue', {
      ...REMOTE_VIDEO_PROFILES[key as RemoteVideoProfile],
    });
}
function changeNumber(
  key: 'resolutionRatio' | 'maxFramerate' | 'maxBitrate',
  event: Event
) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: Number((event.target as HTMLSelectElement).value),
  });
}
function changeHint(event: Event) {
  emit('update:modelValue', {
    ...props.modelValue,
    videoContentHint: (event.target as HTMLSelectElement).value,
  });
}
</script>

<style scoped lang="scss">
.video-settings {
  display: grid;
  gap: 12px;
  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }
  select {
    min-width: 130px;
    min-height: 40px;
    padding: 0 8px;
    border: 1px solid var(--pd-border);
    border-radius: var(--pd-radius-sm);
    background: var(--pd-bg);
    color: var(--pd-text);
    font: inherit;
  }
  p {
    margin: 0;
    color: var(--pd-muted);
    font-size: 12px;
    line-height: 1.6;
  }
}
</style>
