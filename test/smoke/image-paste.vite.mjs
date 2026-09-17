import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root,
  resolve: { alias: { '@': path.join(root, 'src') } },
  define: {
    'process.env': { NODE_ENV: 'development', BilldHtmlWebpackPlugin: {} },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData:
          '@use "billd-scss/src/index.scss" as *;@import "@/assets/css/constant.scss";',
      },
    },
  },
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5196, strictPort: true },
});
