'use strict';
/**
 * 로컬 개발용: 행정누리 모의 서버(9090)와 전자민원(8080)을 한 번에 띄웁니다.
 * 비밀값은 실행할 때마다 새로 만듭니다. 운영에 쓰지 마세요.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { createMockNuri } = require('../mock/mock-nuri');
const { start } = require('../src/server');

const secret = crypto.randomBytes(32).toString('hex');
const mockPort = Number(process.env.MOCK_PORT || 9090);
const mock = createMockNuri({ secret });
http.createServer((req, res) => mock.handler(req, res).catch(() => { res.statusCode = 500; res.end(); }))
  .listen(mockPort, '127.0.0.1', () => {
    console.info(`행정누리 모의 서버: http://127.0.0.1:${mockPort}`);
    start({
      ...process.env,
      NURI_BASE_URL: `http://127.0.0.1:${mockPort}`,
      EP_SECRET: secret,
      COOKIE_SECURE: 'false',
      HOST: process.env.HOST || '127.0.0.1',
      PORT: process.env.PORT || '8080',
      ORG_NAME: process.env.ORG_NAME || '○○시',
      ORG_CONTACT: process.env.ORG_CONTACT || '민원실 000-0000',
    });
  });
