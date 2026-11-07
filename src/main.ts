import '@/assets/css/main.scss';
import { createApp } from 'vue';

import { PRODUCT_NAME } from '@/constant';
import { i18n } from '@/hooks/use-i18n';
import router from '@/router/index';
import store from '@/store/index';

import App from './App.vue';

const app = createApp(App);
document.title = `${PRODUCT_NAME} · Tenori`;

app.use(store);
app.use(router);
app.use(i18n);

app.mount('#app');
