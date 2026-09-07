import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createDeskSessions } from '../backend/runtime/desk-sessions.cjs';
import { createTurnService, iceRoute, readTurnConfig } from '../backend/runtime/turn.cjs';
import { cors, errors, engineCors, deskPackets } from '../backend/runtime/http.cjs';
import { MemoryRedis } from './fixtures.mjs';

if (!process.env.SMOKE_BACKEND_SOURCE) throw new Error('Set SMOKE_BACKEND_SOURCE to an installed pinned backend checkout');
const require = createRequire(path.resolve(process.env.SMOKE_BACKEND_SOURCE, 'package.json'));
const Koa = require('koa');
const bodyParser = require('koa-bodyparser');
const { Server } = require('socket.io');
const redis = new MemoryRedis();
// Use wall time so rate limits and credentials expire during real soaks.
const clock = setInterval(() => { redis.clock = Date.now(); }, 100);
redis.clock = Date.now();
clock.unref();
const records = new Map();
const users = { login: async ({ uuid, password }) => records.get(uuid)?.password === password ? { uuid } : null };
const port = Number(process.env.SMOKE_BACKEND_PORT || 4300);
const webPort = Number(process.env.SMOKE_WEB_PORT || 5194);
const config = { allowedOrigins: new Set([`http://127.0.0.1:${webPort}`, `http://localhost:${webPort}`]), allowElectronOrigin: true };
const io = new Server({ maxHttpBufferSize: 1024 * 1024 });
const sessions = createDeskSessions({ io, redis, users, prefixes: { deskUserUuid: 'desk:' } });
const turnEnv = process.env.SMOKE_TURN_ENV_FILE
  ? parseEnv(await readFile(process.env.SMOKE_TURN_ENV_FILE, 'utf8'))
  : {
    TURN_PROVIDER: 'coturn', COTURN_AUTH_SECRET: 'fixture-only-not-a-production-secret',
    COTURN_URLS: 'turn:127.0.0.1:3478?transport=udp',
  };
if (process.env.SMOKE_TURN_TTL) turnEnv.TURN_CREDENTIAL_TTL = process.env.SMOKE_TURN_TTL;
const turnConfig = readTurnConfig(turnEnv);
const turn = createTurnService({ redis, config: turnConfig });
const app = new Koa();
app.proxy = true;
app.use(errors);
app.use(cors(config));
app.use(bodyParser());
app.use(iceRoute({ sessions, turn, redis }));
app.use(async (ctx) => {
  const body = ctx.request.body || {};
  let data;
  if (ctx.path === '/healthz') { ctx.body = { status: 'ok', fixture: true, turnProvider: turnConfig.provider, turnTtl: turnConfig.ttl }; return; }
  if (ctx.path === '/__smoke/expire-ice' && ctx.method === 'POST') {
    for (const key of redis.rows.keys()) if (key.startsWith('palmdesk:ice:')) await redis.del(key);
    ctx.body = { code: 200 };
    return;
  }
  if (ctx.path === '/desk_user/create' && ctx.method === 'POST') {
    data = { uuid: randomBytes(4).toString('hex'), password: randomBytes(4).toString('hex') };
    records.set(data.uuid, data);
  } else if (ctx.path === '/desk_user/login') {
    if (!await users.login(body)) ctx.throw(400, 'Incorrect password');
    data = { msg: 'ok' };
  } else if (ctx.path === '/desk_user/link_verify') {
    data = { code: await users.login(body) ? 1 : 2 };
  } else if (ctx.path === '/desk_user/find_receiver_by_uuid') {
    const value = await redis.get(`desk:${ctx.query.uuid}`);
    data = { receiver: value ? JSON.parse(value).value.socket_id : '' };
  } else if (ctx.path === '/desk_user/update_by_uuid' && ctx.method === 'PUT') {
    if (!await users.login(body)) ctx.throw(400, 'Incorrect password');
    records.get(body.uuid).password = body.new_password;
    data = {};
  } else { ctx.throw(404); }
  ctx.body = { code: 200, message: 'ok', data };
});
const server = http.createServer(app.callback());
io.attach(server);
io.engine.use(engineCors(config));
io.use(deskPackets);
io.on('connection', sessions.attach);
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
console.log(`Isolated smoke backend: http://127.0.0.1:${port} (in-memory devices; TURN provider: ${turnConfig.provider}, TTL: ${turnConfig.ttl}s)`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => io.close(() => process.exit(0)));
