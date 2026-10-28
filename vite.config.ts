import path from 'path';

import vue from '@vitejs/plugin-vue';
import autoImport from 'unplugin-auto-import/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import unpluginVueComponents from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import electron from 'vite-plugin-electron/simple';
import eslint from 'vite-plugin-eslint2';
import { createHtmlPlugin } from 'vite-plugin-html';

import pkg from './package.json';

import type { ChildProcess } from 'node:child_process';

const isWeb = process.env['VITE_APP_RELEASE_PROJECT_ISWEB'] === 'true';

// Scripts come only from the bundle. Network access stays open to the
// http(s)/ws(s) services users can configure for self-hosting.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' https: wss: http: ws:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const isProduction = mode === 'production';
  const isDevServer = command === 'serve';

  const outputStaticUrl = () => './';

  return {
    base: outputStaticUrl(),
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use 'billd-scss/src/index.scss' as *;@import "@/assets/css/constant.scss";`,
        },
      },
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
      /**
       * 不建议省略.vue后缀
       * https://cn.vitejs.dev/config/shared-options.html#resolve-extensions
       */
      // extensions: ['.js', '.ts', '.jsx', '.tsx', '.vue'],
    },
    build: {
      outDir: 'dist',
    },
    plugins: [
      // legacy(),
      // isProduction && legacy(),
      vue(),
      createHtmlPlugin({
        inject: {
          data: {
            // @ts-ignore
            title: pkg.productName,
          },
        },
      }),
      !isWeb &&
        electron({
          main: {
            entry: 'electron-main/index.ts', // 主进程文件
            onstart: async ({ startup }) => {
              const runtime = process as NodeJS.Process & {
                electronApp?: ChildProcess;
              };
              const previous = runtime.electronApp;
              // Wait for the old app to release its single-instance lock before relaunching.
              if (
                previous &&
                previous.exitCode === null &&
                previous.signalCode === null
              ) {
                previous.removeAllListeners('exit');
                await new Promise<void>((resolve) => {
                  const timer = setTimeout(
                    () => previous.kill('SIGKILL'),
                    3000
                  );
                  previous.once('exit', () => {
                    clearTimeout(timer);
                    resolve();
                  });
                  previous.kill('SIGTERM');
                });
              }
              runtime.electronApp = undefined;
              await startup();
            },
            vite: {
              build: {
                outDir: 'electron-dist',
                // Avoid merged ESM/CJS library formats writing the same file.
                lib: false,
                rollupOptions: {
                  input: 'electron-main/index.ts',
                  output: {
                    format: 'cjs',
                    entryFileNames: '[name].cjs',
                  },
                },
              },
            },
          },
          preload: {
            input: 'electron-main/preload.ts',
            vite: {
              build: {
                outDir: 'electron-dist',
              },
            },
          },
        }),
      // renderer({
      //   resolve: {
      //     '@nut-tree/nut-js': { type: 'cjs' },
      //   },
      // }),
      // Builds rely on the separate `pnpm typecheck` and `pnpm lint` steps;
      // only the dev server reports type and lint errors as you edit.
      isDevServer && checker({ vueTsc: true }),
      isDevServer && eslint(),
      autoImport({
        imports: [
          {
            'naive-ui': ['useMessage', 'useNotification'],
          },
        ],
      }),
      unpluginVueComponents({
        resolvers: [NaiveUiResolver()],
      }),
      {
        name: 'palmdesk-content-security-policy',
        apply: 'build',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: contentSecurityPolicy,
            },
            injectTo: 'head-prepend',
          },
        ],
      },
    ],
    define: {
      PALMDESK_VERSION: JSON.stringify(pkg.version),
      // Compile i18n messages without eval, which the CSP blocks.
      __INTLIFY_JIT_COMPILATION__: true,
      'process.env': {
        NODE_ENV: JSON.stringify(isProduction ? 'production' : 'development'),
        PUBLIC_PATH: outputStaticUrl(),
        VUE_APP_RELEASE_PROJECT_NAME: JSON.stringify(
          process.env.VUE_APP_RELEASE_PROJECT_NAME
        ),
        VUE_APP_RELEASE_PROJECT_ENV: JSON.stringify(
          process.env.VUE_APP_RELEASE_PROJECT_ENV
        ),
        VUE_APP_RELEASE_PROJECT_VERSION: JSON.stringify(pkg.version),
      },
    },

    server: {
      host: '127.0.0.1',
      proxy: {
        '/socket.io': {
          target: 'http://127.0.0.1:4300',
          ws: true,
          changeOrigin: true,
        },
        '/api': {
          target: 'http://localhost:4300',
          secure: false, // 默认情况下（secure: true），不接受在HTTPS上运行的带有无效证书的后端服务器。设置secure: false后，后端服务器的HTTPS有无效证书也可运行
          /**
           * changeOrigin，是否修改请求地址的源
           * 默认changeOrigin: false，即发请求即使用devServer的localhost:port发起的，如果后端服务器有校验源，就会有问题
           * 设置changeOrigin: true，就会修改发起请求的源，将原本的localhost:port修改为target，这样就可以通过后端服务器对源的校验
           */
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '/'),
        },
        '/betaapi': {
          target: 'http://localhost:4300',
          secure: false, // 默认情况下（secure: true），不接受在HTTPS上运行的带有无效证书的后端服务器。设置secure: false后，后端服务器的HTTPS有无效证书也可运行
          /**
           * changeOrigin，是否修改请求地址的源
           * 默认changeOrigin: false，即发请求即使用devServer的localhost:port发起的，如果后端服务器有校验源，就会有问题
           * 设置changeOrigin: true，就会修改发起请求的源，将原本的localhost:port修改为target，这样就可以通过后端服务器对源的校验
           */
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/betaapi/, '/'),
        },
        '/prodapi': {
          target: 'http://localhost:4200',
          secure: false, // 默认情况下（secure: true），不接受在HTTPS上运行的带有无效证书的后端服务器。设置secure: false后，后端服务器的HTTPS有无效证书也可运行
          /**
           * changeOrigin，是否修改请求地址的源
           * 默认changeOrigin: false，即发请求即使用devServer的localhost:port发起的，如果后端服务器有校验源，就会有问题
           * 设置changeOrigin: true，就会修改发起请求的源，将原本的localhost:port修改为target，这样就可以通过后端服务器对源的校验
           */
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/prodapi/, '/'),
        },
      },
    },
  };
});
