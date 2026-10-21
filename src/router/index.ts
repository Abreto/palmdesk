import { createRouter, createWebHashHistory } from 'vue-router';

import Layout from '@/layout/index.vue';

import type { RouteRecordRaw } from 'vue-router';

export const routerName = {
  remote: 'remote',
  home: 'home',
  about: 'about',
  version: 'version',
  webrtc: 'webrtc',
  deviceManage: 'deviceManage',
  setting: 'setting',
  notFound: 'notFound',
};

const routes: RouteRecordRaw[] = [
  {
    name: routerName.home,
    path: '/',
    component: Layout,
    redirect: routerName.remote,
    children: [
      {
        name: routerName.remote,
        path: '/remote',
        component: () => import('@/views/remote/index.vue'),
      },
      {
        name: routerName.deviceManage,
        path: '/deviceManage',
        component: () => import('@/views/deviceManage/index.vue'),
      },
      {
        name: routerName.setting,
        path: '/setting',
        component: () => import('@/views/setting/index.vue'),
      },
    ],
  },
  {
    name: routerName.webrtc,
    path: '/webrtc',
    component: () => import('@/views/webrtc/index.vue'),
  },
  {
    name: routerName.about,
    path: '/about',
    component: () => import('@/views/about/index.vue'),
  },
  {
    name: routerName.version,
    path: '/version',
    component: () => import('@/views/version/index.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: routerName.notFound,
    component: () => import('@/views/notFound.vue'),
  },
];

export default createRouter({
  routes,
  history: createWebHashHistory(),
});
