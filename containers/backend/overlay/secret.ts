import * as defaults from './secretTemp';

const { readConfig } = require('../../runtime/config.cjs');
const config = readConfig(process.env);

export * from './secretTemp';
export const JWT_SECRET = config.jwtSecret;
export const MYSQL_CONFIG = {
  ...defaults.MYSQL_CONFIG,
  host: config.mysql.host,
  port: config.mysql.port,
  database: config.mysql.database,
  username: config.mysql.username,
  password: config.mysql.password,
};
export const REDIS_CONFIG = {
  ...defaults.REDIS_CONFIG,
  database: 0,
  socket: { host: config.redis.host, port: config.redis.port },
  username: 'default',
  password: config.redis.password,
};
