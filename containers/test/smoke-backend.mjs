import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
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
const records = new Map();
const users = { login: async ({ uuid, password }) => records.get(uuid)?.password === password ? { uuid } : null };
const config = { allowedOrigins: new Set(['http://127.0.0.1:5194', 'http://localhost:5194']), allowElectronOrigin: true };
const io = new Server({ maxHttpBufferSize: 1024 * 1024 });
const sessions = createDeskSessions({ io, redis, users, prefixes: { deskUserUuid: 'desk:' } });
const turn = createTurnService({ redis, config: readTurnConfig({
  TURN_PROVIDER: 'coturn', COTURN_AUTH_SECRET: 'fixture-only-not-a-production-secret',
  COTURN_URLS: 'turn:127.0.0.1:3478?transport=udp',
}) });
const app = new Koa();
app.proxy = true;
app.use(errors);
app.use(cors(config));
app.use(bodyParser());
app.use(iceRoute({ sessions, turn, redis }));
app.use(async (ctx) => {
  const body = ctx.request.body || {};
  let data;
  if (ctx.path === '/healthz') { ctx.body = { status: 'ok', fixture: true }; return; }
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
await new Promise((resolve) => server.listen(4300, '127.0.0.1', resolve));
console.log('Isolated fixture backend: http://127.0.0.1:4300 (in-memory devices; TURN credentials are local fixtures)');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => io.close(() => process.exit(0)));
