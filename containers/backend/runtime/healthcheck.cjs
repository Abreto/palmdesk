const http = require('node:http');

const request = http.get('http://127.0.0.1:4300/healthz', { timeout: 3500 }, (response) => {
  response.resume();
  process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('timeout', () => request.destroy());
request.on('error', () => { process.exitCode = 1; });
