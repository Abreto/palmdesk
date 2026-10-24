import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root,
  resolve: {
    alias: [
      {
        find: '@/hooks/use-websocket',
        replacement: path.join(
          root,
          'test/smoke/fixtures/agent-launch/websocket.ts'
        ),
      },
      {
        find: '@/router',
        replacement: path.join(
          root,
          'test/smoke/fixtures/agent-launch/router.ts'
        ),
      },
      { find: '@', replacement: path.join(root, 'src') },
    ],
  },
  define: {
    'process.env': { NODE_ENV: 'development' },
    PALMDESK_VERSION: JSON.stringify('0.0.0-smoke'),
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
  // Scan only the fixture page; the root index.html loads the real router.
  optimizeDeps: { entries: ['test/smoke/agent-launch.html'] },
  server: {
    host: '127.0.0.1',
    port: 5197,
    strictPort: true,
    // Smoke screenshots written to .local/ must not reload the page.
    watch: { ignored: ['**/.local/**'] },
  },
});
