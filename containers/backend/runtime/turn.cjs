const { createHash, createHmac, randomBytes } = require('node:crypto');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const failure = (status, message) => Object.assign(new Error(message), { status });

function iceUrl(value) {
  if (typeof value !== 'string' || !/^(stun|turn)s?:/.test(value)) throw new Error('Invalid ICE URL');
  const parsed = new URL(value.replace(/^((?:stun|turn)s?):/, '$1://'));
  if (!parsed.hostname || parsed.username || parsed.password || parsed.hash ||
      parsed.pathname ||
      [...parsed.searchParams.keys()].some((key) => key !== 'transport') ||
      (parsed.search && !['udp', 'tcp'].includes(parsed.searchParams.get('transport')))) {
    throw new Error('Invalid ICE URL');
  }
  return parsed;
}

function readTurnConfig(env) {
  const provider = env.TURN_PROVIDER || 'none';
  if (!['none', 'cloudflare', 'coturn'].includes(provider)) throw new Error('Invalid TURN_PROVIDER');
  const ttl = Number(env.TURN_CREDENTIAL_TTL || 3600);
  if (!Number.isInteger(ttl) || ttl < 600 || ttl > 172800) throw new Error('TURN_CREDENTIAL_TTL must be 600..172800 seconds');
  const hostname = env.TURN_HOSTNAME || '';
  if (hostname && !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) {
    throw new Error('Invalid TURN_HOSTNAME');
  }
  const config = { provider, ttl, hostname };
  if (provider === 'cloudflare') {
    config.keyId = env.CLOUDFLARE_TURN_KEY_ID;
    config.apiToken = env.CLOUDFLARE_TURN_API_TOKEN;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(config.keyId || '') ||
        !config.apiToken || /\s/.test(config.apiToken)) throw new Error('Cloudflare TURN key ID and API token are required');
  }
  if (provider === 'coturn') {
    config.secret = env.COTURN_AUTH_SECRET;
    if (!config.secret || config.secret.length < 32) throw new Error('COTURN_AUTH_SECRET must contain at least 32 characters');
    config.urls = (env.COTURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
    if (!config.urls.length || !config.urls.every((url) => iceUrl(url).protocol.startsWith('turn'))) {
      throw new Error('COTURN_URLS must contain TURN URLs');
    }
  }
  return config;
}

// Atomic fixed windows also work when HTTP requests reach different processes.
async function rateLimit(redis, scope, subject, limit, seconds = 60) {
  const count = await redis.eval(
    "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
    { keys: [`palmdesk:limit:${scope}:${hash(subject)}`], arguments: [String(seconds)] }
  );
  if (Number(count) > limit) throw failure(429, 'Too many requests');
}

function normalizeCloudflare(body, hostname) {
  if (!Array.isArray(body?.iceServers)) throw new Error('Invalid TURN response');
  const result = body.iceServers.map((server) => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).flatMap((value) => {
      const url = iceUrl(value);
      if (!['turn.cloudflare.com', 'stun.cloudflare.com'].includes(url.hostname)) throw new Error('Unexpected TURN hostname');
      if (url.port === '53') return [];
      if (hostname && !url.protocol.endsWith('s:')) url.hostname = hostname;
      return [`${url.protocol}${url.host}${url.search}`];
    });
    if (!urls.length) return null;
    const relay = urls.some((url) => url.startsWith('turn'));
    if (relay && (typeof server.username !== 'string' || !server.username ||
        typeof server.credential !== 'string' || !server.credential)) throw new Error('Missing TURN credentials');
    return relay ? { urls, username: server.username, credential: server.credential } : { urls };
  }).filter(Boolean);
  if (!result.some((server) => server.credential)) throw new Error('Missing TURN servers');
  return result;
}

function createTurnService({ config, redis, fetch: request = global.fetch, now = Date.now }) {
  const pending = new Map();
  async function generate() {
    const issuedAt = Math.floor(now() / 1000) * 1000;
    let iceServers = [];
    if (config.provider === 'cloudflare') {
      try {
        const response = await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${config.keyId}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: config.ttl }),
          signal: AbortSignal.timeout(5000),
        });
        if (response.status !== 201) throw new Error('TURN upstream failed');
        iceServers = normalizeCloudflare(await response.json(), config.hostname);
      } catch {
        throw failure(503, 'TURN is temporarily unavailable');
      }
    } else if (config.provider === 'coturn') {
      const username = `${Math.floor(issuedAt / 1000) + config.ttl}:${randomBytes(16).toString('hex')}`;
      iceServers = [{ urls: config.urls, username, credential: createHmac('sha1', config.secret).update(username).digest('base64') }];
    }
    const expiresAt = issuedAt + config.ttl * 1000;
    return { iceServers, expiresAt, refreshAfter: expiresAt - Math.min(300, config.ttl / 5) * 1000 };
  }
  async function get(session) {
    const key = `palmdesk:ice:${session.id}:${session.socketId}`;
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      const value = await redis.get(key);
      const cached = value ? JSON.parse(value) : null;
      if (cached && cached.refreshAfter > now()) return cached;
      try {
        await rateLimit(redis, 'turn-session', session.id, 6);
        await rateLimit(redis, 'turn-device', session.device, 12);
        const generated = await generate();
        await redis.set(key, JSON.stringify(generated), { PX: Math.max(1, generated.expiresAt - now()) });
        return generated;
      } catch (error) {
        if (error.status === 503 && cached?.expiresAt > now() + 10000) {
          return { ...cached, refreshAfter: Math.min(now() + 15000, cached.expiresAt - 5000) };
        }
        throw error;
      }
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  return { get };
}

function iceRoute({ sessions, turn, redis }) {
  return async (ctx, next) => {
    if (ctx.path !== '/webrtc/ice-servers') return next();
    if (ctx.method !== 'POST') {
      ctx.set('Allow', 'POST');
      throw failure(405, 'Method not allowed');
    }
    ctx.set('Cache-Control', 'no-store');
    await rateLimit(redis, 'turn-ip', ctx.ip, 60);
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(ctx.get('Authorization'))?.[1];
    if (!token) throw failure(401, 'A remote session is required');
    const session = await sessions.authorize(token);
    const data = await turn.get(session);
    await sessions.authorize(token);
    ctx.body = { code: 200, message: 'ok', data };
  };
}

module.exports = { readTurnConfig, createTurnService, iceRoute, rateLimit, failure, hash, normalizeCloudflare };
