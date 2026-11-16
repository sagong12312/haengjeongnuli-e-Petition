'use strict';
const http = require('node:http');
const { createMockNuri } = require('../mock/mock-nuri');
const { createNuriClient } = require('../src/nuriClient');
const { createApp } = require('../src/app');

const SECRET = 'test-secret-0123456789-abcdefghijklmnop';
const quiet = { info() {}, warn() {}, error() {} };

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function startStack({ mockOpts = {}, clientSecret = SECRET, limits } = {}) {
  const mock = createMockNuri({ secret: SECRET, ...mockOpts });
  const m = await listen((req, res) => mock.handler(req, res));
  const nuri = createNuriClient({ baseUrl: m.url, secret: clientSecret, logger: quiet });
  const config = {
    trustProxy: false, cookieSecure: true, orgName: '시험시', orgContact: '민원실 000-0000', privacyRetention: '시험 기간',
  };
  const app = createApp({ config, nuri, logger: quiet, limits });
  const a = await listen(app);
  return {
    mock, nuri, app, mockUrl: m.url, url: a.url,
    async close() {
      app.close(); nuri.close();
      await Promise.all([new Promise((r) => m.server.close(r)), new Promise((r) => a.server.close(r))]);
    },
  };
}

/** 간단한 HTTP 요청 (쿠키 유지) */
function makeAgent(base) {
  const jar = {};
  return async function req(method, path, form, headers = {}) {
    const body = form ? new URLSearchParams(form).toString() : undefined;
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
        ...headers,
      },
      body,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { status: res.status, headers: res.headers, text: await res.text(), cookies: res.headers.getSetCookie() };
  };
}

function hidden(html, name) {
  const m = new RegExp(`name="${name}" value="([^"]*)"`).exec(html);
  return m ? m[1] : null;
}

module.exports = { SECRET, quiet, startStack, makeAgent, hidden, listen };
