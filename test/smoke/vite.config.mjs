import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Keep the comparison anchored to the toolbar from before this iteration.
const beforeRevision = 'b73ebf77547df1b425b41bd15211b5698a6ba3a6';
const beforeViewportId = fileURLToPath(
  new URL('./.baseline/RemoteViewport.vue', import.meta.url)
);

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    {
      name: 'viewport-before-comparison',
      enforce: 'pre',
      resolveId(id) {
        if (id === 'virtual:remote-viewport-before.vue')
          return beforeViewportId;
      },
      load(id) {
        if (id === beforeViewportId) {
          return execFileSync(
            'git',
            [
              'show',
              `${beforeRevision}:src/components/RemoteViewport/index.vue`,
            ],
            {
              cwd: fileURLToPath(new URL('../..', import.meta.url)),
              encoding: 'utf8',
            }
          );
        }
      },
    },
    vue(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  optimizeDeps: { exclude: ['virtual:remote-viewport-before.vue'] },
  define: { 'process.env.BilldHtmlWebpackPlugin': '{}' },
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
});
