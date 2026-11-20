'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack, makeAgent, hidden } = require('./helpers');

test('도움말·안내 화면이 모두 열린다', async (t) => {
  const s = await startStack();
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  for (const p of ['/help', '/help/which', '/help/deadline', '/help/process', '/help/glossary', '/help/checklist', '/contact',
    '/sitemap', '/en', '/easy', '/offline']) {
    const r = await agent('GET', p);
    assert.equal(r.status, 200, `${p}: ${r.text.slice(0, 200)}`);
    assert.match(r.text, /<h1>/, p);
  }
  // 민원 종류 도우미: 답하면 신청 화면으로 이어진다
  const which = await agent('GET', '/help/which?fee=no&wrong=yes');
  assert.match(which.text, /href="\/complaints\/new\?kind=GRIEVANCE"/);
  assert.match((await agent('GET', '/help/which?fee=yes')).text, /법정민원/);
  // 그 종류가 미리 골라진 신청서
  const form = await agent('GET', '/complaints/new?kind=GRIEVANCE');
  assert.match(form.text, /value="GRIEVANCE" checked/);
  // 이상한 값은 무시
  assert.doesNotMatch((await agent('GET', '/complaints/new?kind=%3Cscript%3E')).text, /<script>/);
});

test('RSS·sitemap.xml·서비스 워커', async (t) => {
  const s = await startStack();
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  s.mock.addNotice('<b>점검</b> & 안내', '내용');
  const rss = await agent('GET', '/notices.xml');
  assert.equal(rss.status, 200);
  assert.match(rss.headers.get('content-type'), /xml/);
  assert.match(rss.text, /<rss/);
  assert.match(rss.text, /&lt;b&gt;점검&lt;\/b&gt; &amp; 안내/, 'XML 특수문자는 바꿔 쓴다');
  assert.equal((await agent('GET', '/consultations.xml')).status, 200);
  const sm = await agent('GET', '/sitemap.xml');
  assert.match(sm.text, /<urlset/);
  assert.match(sm.text, /\/help\/deadline/);
  assert.doesNotMatch(sm.text, /\/my</, '개인 화면은 넣지 않는다');

  const sw = await agent('GET', '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.doesNotMatch(sw.headers.get('cache-control') || '', /immutable/, '서비스 워커는 늘 새로 확인');
  // 연결 끊김 화면은 로그인한 사람 이름을 담지 않는다 (기기에 저장되므로)
  assert.doesNotMatch((await agent('GET', '/offline')).text, /님<\/span>/);
});

test('가입 아이디 확인·로그인 연장·내 민원 제목 찾기', async (t) => {
  const s = await startStack({ limits: { signup: { limit: 100, windowMs: 60000 }, login: { limit: 100, windowMs: 60000 } } });
  t.after(() => s.close());
  const agent = makeAgent(s.url);

  const bad = JSON.parse((await agent('GET', '/signup/check?loginId=1x')).text);
  assert.equal(bad.available, false);
  const ok = JSON.parse((await agent('GET', '/signup/check?loginId=kim_minsu')).text);
  assert.equal(ok.available, true);

  // 로그인 전에는 연장 확인이 401
  assert.equal((await agent('GET', '/session/ping')).status, 401);

  const page = await agent('GET', '/signup');
  const cid = hidden(page.text, 'captchaId');
  const r = await agent('POST', '/signup', {
    _csrf: hidden(page.text, '_csrf'), captchaId: cid, captcha: cid ? s.app.captchas.peek(cid) : undefined,
    loginId: 'kim_minsu', password: 'Blue-River-77', password2: 'Blue-River-77', name: '김민수', mobile: '01012345678',
    email: '', address: '', termsConsent: 'true', privacyConsent: 'true',
  });
  assert.ok(r.status === 303 || r.status === 302, r.text.slice(0, 300));
  const taken = JSON.parse((await agent('GET', '/signup/check?loginId=kim_minsu')).text);
  assert.equal(taken.available, false);

  assert.equal((await agent('GET', '/session/ping')).status, 204);
  const my = await agent('GET', '/my?q=' + encodeURIComponent('가로등'));
  assert.equal(my.status, 200);
  assert.match(my.text, /name="q"[^>]*value="가로등"/);
  assert.match(my.text, /data-session-idle="\d+"/);
});

test('주민등록번호가 들어간 민원은 접수하지 않는다', async (t) => {
  const s = await startStack();
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  const page = await agent('GET', '/complaints/new');
  const cid = hidden(page.text, 'captchaId');
  const r = await agent('POST', '/complaints', {
    _csrf: hidden(page.text, '_csrf'), captchaId: cid, captcha: s.app.captchas.peek(cid),
    kind: 'OTHER', category: 'CLEAN', name: '홍길동', mobile: '010-1234-5678', title: '확인 부탁',
    content: '제 주민번호는 900101-1234567 입니다.', password: 'abc12345', password2: 'abc12345', privacyConsent: 'true',
  });
  assert.equal(r.status, 400);
  assert.match(r.text, /주민등록번호/);

});
