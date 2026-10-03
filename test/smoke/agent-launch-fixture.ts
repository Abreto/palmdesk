import '../../src/assets/css/main.scss';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Controller from '../../src/views/webrtc/index.vue';
import router from './fixtures/agent-launch/router';

sessionStorage.setItem(
  'codex-remote-session',
  JSON.stringify({
    deskUserUuid: 'fixture-phone',
    deskUserPassword: 'fixture-only',
    remoteDeskUserUuid: 'fixture-host',
    remoteDeskUserPassword: 'fixture-only',
  })
);
createApp(Controller).use(createPinia()).use(router).mount('#app');
