'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack, listen, quiet, SECRET } = require('./helpers');
const { createNuriClient, NuriApiError, NuriUnavailableError } = require('../src/nuriClient');

test('행정누리 연동 API 클라이언트', async (t) => {
  const s = await startStack();
  t.after(() => s.close());

  await t.test('접수 → 조회 (서명·논스·국민 IP 전달)', async () => {
    const d = await s.nuri.submitComplaint({
      kind: 'QUERY', lawInterpretation: true, name: '이순신', mobile: '010-1111-2222', homePhone: null, email: null,
      address: null, fax: null, notifyMethod: null, title: '제목', content: '내용입니다', password: 'pass1234',
      publicConsent: false, privacyConsent: true,
    }, '203.0.113.7');
    assert.match(d.receiptNo, /^\d{4}-\d{6}$/);
    assert.equal(d.kindLabel, '질의민원');
    const r = await s.nuri.lookupComplaint(d.receiptNo, 'pass1234', '203.0.113.7');
    assert.equal(r.status, 'RECEIVED');
    assert.equal(r.name, '이순신');
    assert.equal(s.mock.accessLog.at(-1).clientIp, '203.0.113.7');
  });

  await t.test('한글 검색어는 퍼센트 인코딩한 그대로 서명된다', async () => {
    const d = await s.nuri.listConsultations(1, '가로등');
    assert.equal(d.total, 1);
    assert.equal(d.items[0].name, '홍*동');
    const none = await s.nuri.listDispositions(1, '없는상호 & ?=');
    assert.equal(none.total, 0);
  });

  await t.test('업무 오류는 NuriApiError (code·message)', async () => {
    await assert.rejects(s.nuri.lookupComplaint('2026-999999', 'pass1234'),
      (e) => e instanceof NuriApiError && e.status === 401 && e.code === 'not_matched');
    await assert.rejects(s.nuri.getConsultation(99999),
      (e) => e instanceof NuriApiError && e.code === 'not_found');
  });

  await t.test('비밀값이 틀리면 연동 오류(NuriUnavailableError bad_signature)', async () => {
    const bad = createNuriClient({ baseUrl: s.mockUrl, secret: 'w'.repeat(40), logger: quiet });
    await assert.rejects(bad.listDispositions(1, ''), (e) => e instanceof NuriUnavailableError && e.reason === 'bad_signature');
    bad.close();
  });

  await t.test('연동이 꺼져 있으면(404) 이용 불가', async () => {
    const { createMockNuri } = require('../mock/mock-nuri');
    const off = createMockNuri({ secret: SECRET, enabled: false });
    const m = await listen((q, r) => off.handler(q, r));
    const c = createNuriClient({ baseUrl: m.url, secret: SECRET, logger: quiet });
    await assert.rejects(c.listConsultations(1, ''), (e) => e instanceof NuriUnavailableError && e.status === 404);
    c.close();
    await new Promise((r) => m.server.close(r));
  });

  await t.test('허용하지 않은 서버 주소 → forbidden_network', async () => {
    const { createMockNuri } = require('../mock/mock-nuri');
    const fenced = createMockNuri({ secret: SECRET, networks: ['10.20.30.40/32'] });
    const m = await listen((q, r) => fenced.handler(q, r));
    const c = createNuriClient({ baseUrl: m.url, secret: SECRET, logger: quiet });
    await assert.rejects(c.listConsultations(1, ''), (e) => e.reason === 'forbidden_network');
    c.close();
    await new Promise((r) => m.server.close(r));
  });

  await t.test('시계가 300초 넘게 어긋나면 bad_timestamp', async () => {
    const { createMockNuri } = require('../mock/mock-nuri');
    const skew = createMockNuri({ secret: SECRET, now: () => Date.now() + 301_000 });
    const m = await listen((q, r) => skew.handler(q, r));
    const c = createNuriClient({ baseUrl: m.url, secret: SECRET, logger: quiet });
    await assert.rejects(c.listConsultations(1, ''), (e) => e.reason === 'bad_timestamp');
    c.close();
    await new Promise((r) => m.server.close(r));
  });

  await t.test('행정누리에 닿지 않으면 connect_error', async () => {
    const c = createNuriClient({ baseUrl: 'http://127.0.0.1:1', secret: SECRET, logger: quiet });
    await assert.rejects(c.listConsultations(1, ''), (e) => e instanceof NuriUnavailableError);
    c.close();
  });
});
