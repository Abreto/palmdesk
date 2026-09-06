<template>
  <div class="setting-wrap">
    <div class="nav"></div>
    <div class="container">
      <div class="label">最近连接</div>
      <div v-if="!cacheStore.linkDeviceList.length">暂无记录</div>
      <div
        v-else
        class="link-device-list"
      >
        <div
          v-for="(item, index) in cacheStore.linkDeviceList"
          :key="index"
          class="link-device-item"
        >
          <button
            class="left"
            type="button"
            @click="selectDevice(item)"
          >
            <LaptopOutline />{{ item.remoteDeskUserUuid }}
          </button>
          <div class="right">
            <button
              class="del"
              type="button"
              title="移除记录"
              :aria-label="`移除 ${item.remoteDeskUserUuid}`"
              @click="handleDelLinkDeviceList(item)"
            >
              <TrashOutline />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { LaptopOutline, TrashOutline } from '@vicons/ionicons5';

import router, { routerName } from '@/router';
import { usePiniaCacheStore } from '@/store/cache';

const cacheStore = usePiniaCacheStore();

function selectDevice(item) {
  cacheStore.remoteDeskUserUuid = item.remoteDeskUserUuid;
  cacheStore.remoteDeskUserPassword = item.remoteDeskUserPassword;
  void router.push({ name: routerName.remote });
}
function handleDelLinkDeviceList(item) {
  cacheStore.linkDeviceList = cacheStore.linkDeviceList.filter(
    (v) => v.remoteDeskUserUuid !== item.remoteDeskUserUuid
  );
}
</script>

<style lang="scss" scoped>
.setting-wrap {
  box-sizing: border-box;
  height: 100vh;
  .nav {
    height: $top-system-bar-height;
  }
  .container {
    overflow: scroll;
    padding: 0 40px;
    height: calc(100vh - $top-system-bar-height);

    @extend %customScrollbarHide;
    &:hover {
      @extend %customScrollbar;
    }

    .label {
      margin-bottom: 10px;
      font-weight: 500;
      font-size: 16px;
    }

    .link-device-list {
      position: relative;
      overflow: scroll;
      box-sizing: border-box;
      max-height: 200px;
      width: 100%;
      border: 1px solid rgba(153, 153, 153, 0.2);
      border-radius: 2px;
      background-color: #fff;

      @extend %hideScrollbar;
      .link-device-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-sizing: border-box;
        padding: 0 15px;
        width: 100%;
        height: 40px;
        &:hover {
          background-color: #f8f8fb;
        }
        .left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          height: 40px;
          padding: 0;
          border: 0;
          background: transparent;
          color: #167c65;
          cursor: pointer;
          font-size: 16px;
          svg {
            width: 20px;
            height: 20px;
          }
        }
        .right {
          .del {
            display: grid;
            place-items: center;
            width: 36px;
            height: 36px;
            padding: 8px;
            border: 0;
            background: transparent;
            color: #66756e;
            cursor: pointer;
            svg {
              width: 20px;
              height: 20px;
            }
          }
        }
      }
    }
  }
}
</style>

<style scoped lang="scss">
@media (max-width: 640px) {
  .setting-wrap {
    height: auto;
  }
  .setting-wrap .nav {
    display: none;
  }
  .setting-wrap .container {
    height: auto;
    padding: 30px 18px;
  }
}
</style>
