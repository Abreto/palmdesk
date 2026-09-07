import { createServer } from 'vite';

process.env.VITE_APP_RELEASE_PROJECT_ISWEB = 'true';
const backend = `http://127.0.0.1:${Number(process.env.SMOKE_BACKEND_PORT || 4300)}`;
const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: Number(process.env.SMOKE_WEB_PORT || 5194),
    strictPort: true,
    proxy: {
      '/socket.io': { target: backend, ws: true, changeOrigin: true },
      '/api': {
        target: backend,
        changeOrigin: true,
        rewrite: (url) => url.replace(/^\/api/, ''),
      },
    },
  },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
