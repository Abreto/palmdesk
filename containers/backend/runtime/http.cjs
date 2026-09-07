const { isAllowedOrigin } = require('./config.cjs');

function cors(config) {
  return async (ctx, next) => {
    const value = ctx.get('Origin');
    ctx.vary('Origin');
    if (!isAllowedOrigin(value, config)) {
      ctx.status = 403;
      ctx.body = { code: 403, message: 'Origin is not allowed' };
      return;
    }
    if (value) {
      ctx.set('Access-Control-Allow-Origin', value);
      ctx.set('Access-Control-Allow-Credentials', 'true');
      ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      ctx.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (ctx.method === 'OPTIONS') {
      ctx.status = 204;
      return;
    }
    await next();
  };
}

async function errors(ctx, next) {
  ctx.set('Cache-Control', 'no-store');
  try {
    await next();
  } catch (error) {
    const status = error.httpStatusCode || error.status || 500;
    ctx.status = status >= 400 && status < 600 ? status : 500;
    ctx.body = {
      code: ctx.status < 500 ? (error.errorCode || ctx.status) : 500,
      message: ctx.status < 500 ? error.message : 'Internal server error',
      ...(ctx.status >= 500 ? { error: 'Internal server error' } : {}),
    };
    if (ctx.status >= 500) console.error(`HTTP ${ctx.method} ${ctx.path} failed (${error.name || 'Error'})`);
  }
}

function engineCors(config) {
  return (request, response, next) => {
    const value = request.headers.origin;
    if (!isAllowedOrigin(value, config)) return next(new Error('Origin is not allowed'));
    response.setHeader('Vary', 'Origin');
    if (value) {
      response.setHeader('Access-Control-Allow-Origin', value);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    next();
  };
}

const deskEvents = new Set([
  'billdDeskJoin', 'billdDeskUpdateUser', 'billdDeskStartRemote',
  'billdDeskBehavior', 'nativeWebRtcOffer', 'nativeWebRtcAnswer',
  'nativeWebRtcCandidate', 'nativeWebRtcRestart', 'billdDeskEndRemote', 'heartbeat',
]);

function deskPackets(socket, next) {
  socket.use(([event, payload], proceed) => {
    if (!deskEvents.has(event) || !payload || typeof payload.data !== 'object' || !payload.data || Array.isArray(payload.data)) {
      socket.disconnect(true);
      return;
    }
    proceed();
  });
  next();
}

module.exports = { cors, errors, engineCors, deskPackets };
