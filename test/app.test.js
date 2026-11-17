'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack, makeAgent, hidden } = require('./helpers');

const form = {
  kind: 'OTHER', category: 'ROAD', name: '홍길동', mobile: '010-1234-5678', email: '', title: '가로등 고장',
  content: '중앙로 가로등이 꺼져 있습니다. <script>alert(1)</script>',
  password: 'abc12345', password2: 'abc12345', privacyConsent: 'true', publicConsent: 'true',
};

async function openForm(s, agent, path) {
  const page = await agent('GET', path);
  assert.equal(page.status, 200);
  const captchaId = hidden(page.text, 'captchaId');
  return { csrf: hidden(page.text, '_csrf'), captchaId, captcha: s.app.captchas.peek(captchaId), page };
}

test('국민 화면', async (t) => {
  const s = await startStack({ limits: { lookup: { limit: 100, windowMs: 60000 } } });
  t.after(() => s.close());

  await t.test('보안 헤더: no-store, HSTS, CSP, 쿠키 Secure·HttpOnly·SameSite', async () => {
    const agent = makeAgent(s.url);
    const r = await agent('GET', '/complaints/new');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.match(r.cookies[0], /HttpOnly/);
    assert.match(r.cookies[0], /Secure/);
    assert.match(r.cookies[0], /SameSite=Strict/);
    assert.match(r.text, /개인정보 수집·이용 안내/);
    assert.match(r.text, /동의를 거부할 권리와 불이익/);
  });

  let receiptNo;
  await t.test('민원 신청 → 접수번호·처리기한·비밀번호 안내', async () => {
    const agent = makeAgent(s.url);
    const f = await openForm(s, agent, '/complaints/new');
    const r = await agent('POST', '/complaints', { ...form, _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
    assert.equal(r.status, 200, r.text);
    receiptNo = /class="big">([^<]+)</.exec(r.text)[1];
    assert.match(receiptNo, /^\d{4}-\d{6}$/);
    assert.match(r.text, /처리기한/);
    assert.match(r.text, /비밀번호를 잊으면 인터넷으로 조회할 수 없으니 기관/);
    assert.ok(!r.text.includes('abc12345'), '비밀번호가 화면에 나오면 안 됨');

    // 같은 자동입력 방지 값으로 다시 보내면(새로 고침 등) 거절 → 이중 접수 방지
    const again = await agent('POST', '/complaints', { ...form, _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
    assert.equal(again.status, 400);
    assert.match(again.text, /자동입력 방지 숫자가 맞지 않습니다/);
    assert.ok(!again.text.includes('value="abc12345"'), '다시 그린 양식에 비밀번호를 채우지 않음');
  });

  await t.test('CSRF 값이 없으면 접수하지 않는다', async () => {
    const agent = makeAgent(s.url);
    const f = await openForm(s, agent, '/complaints/new');
    const before = s.mock.complaints.size;
    const r = await agent('POST', '/complaints', { ...form, _csrf: 'x'.repeat(43), captchaId: f.captchaId, captcha: f.captcha });
    assert.equal(r.status, 403);
    assert.equal(s.mock.complaints.size, before);
  });

  await t.test('입력 오류는 칸마다 안내하고 값은 남긴다', async () => {
    const agent = makeAgent(s.url);
    const f = await openForm(s, agent, '/complaints/new');
    const r = await agent('POST', '/complaints', { ...form, privacyConsent: '', notifyMethod: '팩스', _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
    assert.equal(r.status, 400);
    assert.match(r.text, /개인정보 수집·이용에 동의해야/);
    assert.match(r.text, /팩스로 통지받으려면/);
    assert.match(r.text, /value="가로등 고장"/);
    assert.match(r.text, /&lt;script&gt;/);
  });

  await t.test('처리상황 조회: 결과·거부 이유(구제절차) 표시, 내용은 글자로만', async () => {
    s.mock.complete(receiptNo, { type: '불수용', text: '예산이 없어 <b>어렵습니다</b>.', remedy: '행정심판 또는 행정소송을 청구할 수 있습니다.' });
    const agent = makeAgent(s.url);
    const f = await openForm(s, agent, '/lookup');
    const r = await agent('POST', '/lookup', { receiptNo, password: 'abc12345', _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
    assert.equal(r.status, 200, r.text);
    assert.match(r.text, /처리 완료/);
    assert.match(r.text, /거부 이유와 구제절차 안내/);
    assert.match(r.text, /행정심판 또는 행정소송/);
    assert.match(r.text, /&lt;b&gt;어렵습니다&lt;\/b&gt;/);
    assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.ok(!r.text.includes('<script>alert'));
  });

  await t.test('조회 비밀번호 5번 틀리면 423 잠김 안내', async () => {
    const agent = makeAgent(s.url);
    let last;
    for (let i = 0; i < 6; i++) {
      const f = await openForm(s, agent, '/lookup');
      last = await agent('POST', '/lookup', { receiptNo, password: 'wrong1234', _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
      if (i < 4) { assert.equal(last.status, 401); assert.match(last.text, /접수번호 또는 비밀번호가 맞지 않습니다/); }
    }
    assert.equal(last.status, 423);
    assert.match(last.text, /조회할 수 없습니다/);
  });

  await t.test('공개 상담 목록·상세: 이름 가림, HTML 해석 안 함', async () => {
    const agent = makeAgent(s.url);
    const list = await agent('GET', '/consultations?q=' + encodeURIComponent('벤치'));
    assert.equal(list.status, 200);
    assert.match(list.text, /김\*/);
    assert.match(list.text, /공원 &lt;벤치&gt; 설치 건의/);
    const id = /href="\/consultations\/(\d+)"/.exec(list.text)[1];
    const one = await agent('GET', `/consultations/${id}`);
    assert.equal(one.status, 200);
    assert.match(one.text, /거부 이유와 구제절차 안내/);
    assert.ok(!one.text.includes('김철'));
    assert.equal((await agent('GET', '/consultations/999999')).status, 404);
  });

  await t.test('행정처분 공개', async () => {
    const r = await makeAgent(s.url)('GET', '/dispositions?q=' + encodeURIComponent('식당'));
    assert.equal(r.status, 200);
    assert.match(r.text, /○○식당/);
    assert.match(r.text, /영업정지/);
    assert.ok(!r.text.includes('미용실'));
  });

  await t.test('자동입력 방지 그림은 SVG 이고 숫자를 글자로 넣지 않는다', async () => {
    const agent = makeAgent(s.url);
    const f = await openForm(s, agent, '/lookup');
    const r = await agent('GET', `/captcha/${f.captchaId}.svg`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /image\/svg\+xml/);
    assert.ok(!r.text.includes('<text'));
    assert.ok(!r.text.includes(f.captcha));
  });
});

test('행정누리에 닿지 않으면 503 안내', async (t) => {
  const s = await startStack({ clientSecret: 'z'.repeat(40) });
  t.after(() => s.close());
  const r = await makeAgent(s.url)('GET', '/consultations');
  assert.equal(r.status, 503);
  assert.match(r.text, /행정누리와 연결할 수 없습니다/);
});

test('접수는 국민 IP별로 횟수를 제한한다', async (t) => {
  const s = await startStack({ limits: { submit: { limit: 2, windowMs: 60000 } } });
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await agent('POST', '/complaints', { _csrf: 'x' })).status);
  assert.deepEqual(codes, [403, 403, 429]);
});
