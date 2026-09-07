const assert = require('node:assert/strict');

// Load the production dependency graph without opening ports or connecting to a database.
Object.assign(process.env, {
  NODE_ENV: 'production', NODE_APP_RELEASE_PROJECT_ENV: 'prod',
  NODE_APP_RELEASE_PROJECT_NAME: 'palmdesk-server', NODE_APP_RELEASE_PROJECT_PORT: '4300',
  PUBLIC_ORIGIN: 'https://build.invalid', MYSQL_DATABASE: 'palmdesk', MYSQL_USER: 'palmdesk',
  MYSQL_PASSWORD: 'a'.repeat(64), REDIS_PASSWORD: 'b'.repeat(64), JWT_SECRET: 'c'.repeat(64),
});
require('../dist/init/alias');
const mysql = require('../dist/config/mysql');
require('../dist/init/initDb').loadAllModel();
require('../dist/model/relation');
const redis = require('../dist/config/redis');
const router = require('../dist/router/deskUser.router').default;
const websocket = require('../dist/config/websocket');
assert.equal(typeof mysql.connectMysql, 'function');
assert.equal(typeof redis.connectRedis, 'function');
assert.equal(typeof websocket.connectWebSocket, 'function');
assert.ok(router.stack.some((route) => route.path === '/desk_user/create'));
assert.ok(router.stack.some((route) => route.path === '/desk_user/update_by_uuid'));
assert.ok(mysql.default.models.desk_user);
console.log('Production imports and desk routes verified without starting services.');
