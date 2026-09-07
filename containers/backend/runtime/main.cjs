const http = require('node:http');
const { readConfig } = require('./config.cjs');
const { initializeDatabase } = require('./init.cjs');
const { cors, errors, engineCors, deskPackets } = require('./http.cjs');

async function main() {
  const mode = process.argv[2];
  if (!['init', 'serve'].includes(mode)) throw new Error('Expected init or serve');
  const config = readConfig();
  if (process.env.NODE_APP_INIT_MYSQL) throw new Error('NODE_APP_INIT_MYSQL is not supported by this deployment');
  require('../dist/init/alias');
  const { default: sequelize, connectMysql } = require('../dist/config/mysql');

  if (mode === 'init') {
    try {
      const liveConfig = require('../dist/model/liveConfig.model').default;
      await initializeDatabase({ sequelize, connectMysql, liveConfig });
      console.log('Database initialization complete. Existing data preserved.');
    } finally {
      await sequelize.close();
    }
    return;
  }

  await connectMysql();
  const { redisClient, connectRedis } = require('../dist/config/redis');
  await connectRedis();
  const Koa = require('koa');
  const bodyParser = require('koa-bodyparser');
  const deskRouter = require('../dist/router/deskUser.router').default;
  const { connectWebSocket, wsSocket } = require('../dist/config/websocket');
  const app = new Koa();
  app.proxy = true;
  app.use(errors);
  app.use(cors(config));
  app.use(async (ctx, next) => {
    if (ctx.path !== '/healthz' || ctx.method !== 'GET') return next();
    await Promise.all([sequelize.authenticate({ logging: false }), redisClient.ping()]);
    ctx.body = { status: 'ok' };
  });
  app.use(bodyParser({ enableTypes: ['json'], jsonLimit: '64kb' }));
  app.use(deskRouter.routes());
  app.use(deskRouter.allowedMethods());
  app.use(async (ctx) => {
    if (ctx.status === 404) {
      ctx.body = { code: 404, message: 'Not found' };
      ctx.status = 404;
    }
  });
  const server = http.createServer(app.callback());
  connectWebSocket(server);
  wsSocket.io.engine.use(engineCors(config));
  wsSocket.io.use(deskPackets);
  wsSocket.io.of('/live').use((_socket, next) => next(new Error('Namespace disabled')));

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    await new Promise((resolve) => wsSocket.io.close(resolve));
    await Promise.all([redisClient.quit(), sequelize.close()]);
    clearTimeout(timeout);
  }
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => shutdown().catch(() => process.exit(1)));
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '0.0.0.0', resolve);
  });
  console.log(`PalmDesk API and signaling listening on port ${config.port}`);
}

main().catch((error) => {
  console.error(`Backend failed (${error.name || 'Error'}). Check configuration and dependency health.`);
  process.exit(1);
});
