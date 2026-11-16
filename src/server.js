'use strict';
const http = require('node:http');
const https = require('node:https');
const { loadConfig } = require('./config');
const { createNuriClient } = require('./nuriClient');
const { createApp } = require('./app');

function start(env = process.env) {
  const config = loadConfig(env);
  const nuri = createNuriClient({
    baseUrl: config.nuriBaseUrl,
    secret: config.secret,
    timeoutMs: config.nuriTimeoutMs,
    ca: config.nuriCa,
  });
  const app = createApp({ config, nuri });
  const server = config.tls
    ? https.createServer({ ...config.tls, minVersion: 'TLSv1.2' }, app)
    : http.createServer(app);
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  server.keepAliveTimeout = 5_000;

  server.listen(config.port, config.host, () => {
    const addr = server.address();
    console.info(`행정누리 전자민원 시작: ${config.tls ? 'https' : 'http'}://${addr.address}:${addr.port} → 행정누리 ${new URL(config.nuriBaseUrl).origin}`);
    if (!config.tls) console.info('TLS 는 앞단 프록시가 끝낸다고 봅니다. 국민에게는 HTTPS 로만 열어 주세요.');
    if (!config.cookieSecure) console.warn('경고: COOKIE_SECURE=false 입니다. 운영에서는 true 로 두세요.');
  });

  const shutdown = () => {
    server.close(() => { app.close(); nuri.close(); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { start };
