import { createRouter, createWebHistory } from 'vue-router';
export const routerName = { remote: 'remote', webrtc: 'webrtc' };
export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/:pathMatch(.*)*',
      name: 'webrtc',
      component: { template: '<div />' },
    },
  ],
});
