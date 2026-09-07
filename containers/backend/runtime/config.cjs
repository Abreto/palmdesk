function required(env, key) {
  const value = env[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`);
  return value;
}

function secret(env, key) {
  const value = required(env, key);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(value)) {
    throw new Error(`${key} must contain at least 32 letters, digits, underscores or hyphens`);
  }
  return value;
}

function origin(value, httpsOnly = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid origin URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || (httpsOnly && url.protocol !== 'https:') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Origin must be an HTTP(S) origin without a path, credentials, query or fragment; PUBLIC_ORIGIN requires HTTPS');
  }
  return url.origin;
}

function port(value, fallback) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 65535) throw new Error('Invalid port');
  return result;
}

function readConfig(env = process.env) {
  const publicOrigin = origin(required(env, 'PUBLIC_ORIGIN'), true);
  const extraOrigins = (env.EXTRA_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean).map((value) => origin(value));
  const electron = env.ALLOW_ELECTRON_ORIGIN ?? 'true';
  if (!['true', 'false'].includes(electron)) throw new Error('ALLOW_ELECTRON_ORIGIN must be true or false');
  const database = required(env, 'MYSQL_DATABASE');
  const username = required(env, 'MYSQL_USER');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(database)) throw new Error('Invalid MYSQL_DATABASE');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(username) || username === 'root') throw new Error('MYSQL_USER must be a dedicated non-root user');
  return {
    publicOrigin,
    allowedOrigins: new Set([publicOrigin, ...extraOrigins]),
    allowElectronOrigin: electron === 'true',
    port: port(env.NODE_APP_RELEASE_PROJECT_PORT, 4300),
    jwtSecret: secret(env, 'JWT_SECRET'),
    mysql: {
      host: env.MYSQL_HOST || 'mysql',
      port: port(env.MYSQL_PORT, 3306),
      database, username, password: secret(env, 'MYSQL_PASSWORD'),
    },
    redis: {
      host: env.REDIS_HOST || 'redis',
      port: port(env.REDIS_PORT, 6379),
      password: secret(env, 'REDIS_PASSWORD'),
    },
  };
}

function isAllowedOrigin(value, config) {
  return value === undefined || value === '' ||
    (value === 'null' && config.allowElectronOrigin) || config.allowedOrigins.has(value);
}

module.exports = { readConfig, isAllowedOrigin, origin, port, secret };
