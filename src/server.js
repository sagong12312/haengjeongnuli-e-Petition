'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { loadConfig } = require('./config');
const { createNuriClient } = require('./nuriClient');
const { createApp } = require('./app');

/**
 * HTTPS 포트 하나로 http:// 로 들어온 접속도 받아 https:// 로 돌려보낸다.
 * (주소창에 http:// 로 넣거나 예전 즐겨찾기로 와도 "Bad Request" 대신 암호화된 주소로 넘어가게)
 * 첫 바이트가 0x16(TLS 인사)이면 HTTPS 로, 아니면 안내만 하는 HTTP 로 넘긴다. 개인정보는 http 로 오가지 않는다.
 */
function dualPortServer(config, app) {
  const tlsServer = https.createServer({ ...config.tls, minVersion: 'TLSv1.2' }, app);
  const redirect = http.createServer((req, res) => {
    const host = String(req.headers.host || '');
    const safe = /^[A-Za-z0-9.\-[\]:]{1,255}$/.test(host) ? host : `localhost:${config.port}`;
    const url = String(req.url || '/').startsWith('/') ? req.url : '/';
    res.statusCode = 308;
    res.setHeader('Location', `https://${safe}${url}`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('https:// 주소로 접속하세요.');
  });
  const server = net.createServer((socket) => {
    socket.once('error', () => socket.destroy());
    socket.setTimeout(20_000, () => socket.destroy());
    socket.once('data', (buf) => {
      socket.setTimeout(0);
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 ? tlsServer : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
  });
  server.inner = [tlsServer, redirect];
  const close = server.close.bind(server);
  server.close = (cb) => { tlsServer.close(); redirect.close(); return close(cb); };
  return server;
}

function start(env = process.env) {
  const config = loadConfig(env);
  const nuri = createNuriClient({
    baseUrl: config.nuriBaseUrl,
    secret: config.secret,
    timeoutMs: config.nuriTimeoutMs,
    ca: config.nuriCa,
  });
  const app = createApp({ config, nuri });
  const server = config.tls ? dualPortServer(config, app) : http.createServer(app);
  for (const s of server.inner || [server]) {
    s.headersTimeout = 20_000;
    s.requestTimeout = 60_000;
    s.keepAliveTimeout = 5_000;
  }

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

module.exports = { start, dualPortServer };
