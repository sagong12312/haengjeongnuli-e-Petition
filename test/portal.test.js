'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startStack, makeAgent, hidden } = require('./helpers');

async function open(s, agent, path) {
  const page = await agent('GET', path);
  assert.equal(page.status, 200, page.text);
  const captchaId = hidden(page.text, 'captchaId');
  return { csrf: hidden(page.text, '_csrf'), captchaId, captcha: captchaId ? s.app.captchas.peek(captchaId) : undefined, page };
}

const member = {
  loginId: 'hong_gildong', password: 'Blue-River-77', password2: 'Blue-River-77', name: '홍길동',
  mobile: '01012345678', email: 'hong@example.com', address: '', termsConsent: 'true', privacyConsent: 'true',
};

const complaint = {
  kind: 'OTHER', name: '홍길동', mobile: '010-1234-5678', email: '', title: '회원 민원', content: '내용입니다.',
  password: '', password2: '', privacyConsent: 'true',
};

test('공지·자주 묻는 질문·안내·통계·약관', async (t) => {
  const s = await startStack();
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  s.mock.addNotice('<b>설 연휴</b> 안내', '1월 28일~30일은\n쉽니다.');

  const home = await agent('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.text, /전자민원 이용 안내/);
  assert.match(home.text, /&lt;b&gt;설 연휴&lt;\/b&gt; 안내/, '공지 제목은 글자로만');
  assert.match(home.text, /href="\/signup"/);

  const list = await agent('GET', '/notices');
  assert.match(list.text, /고정/);
  const detail = await agent('GET', '/notices/2');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /쉽니다/);
  assert.equal((await agent('GET', '/notices/999')).status, 404);

  const faq = await agent('GET', '/faq');
  assert.match(faq.text, /<details class="faq">/);
  assert.match(faq.text, /첨부파일은 몇 개까지/);

  const guide = await agent('GET', '/guide');
  assert.match(guide.text, /질의민원/);
  assert.match(guide.text, /정부24/);

  const stats = await agent('GET', '/stats');
  assert.match(stats.text, /민원 처리 통계/);
  assert.match(stats.text, /평균 처리일/);

  assert.match((await agent('GET', '/terms')).text, /이용약관/);
  assert.match((await agent('GET', '/privacy')).text, /개인정보 처리방침/);
  assert.match((await agent('GET', '/robots.txt')).text, /Disallow: \/my/);
  const js = await agent('GET', '/static/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('공개 상담: 종류·정렬, 공감은 한 번, 비슷한 상담', async (t) => {
  const s = await startStack();
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  const list = await agent('GET', '/consultations?kind=SUGGESTION&sort=likes');
  assert.match(list.text, /공원 &lt;벤치&gt; 설치 건의/);
  assert.ok(!list.text.includes('가로등 고장'));
  assert.match(list.text, /<option value="likes" selected>/);
  assert.equal(s.mock.accessLog.at(-1).path, '/api/epetition/v1/consultations');

  const d = await open(s, agent, '/consultations/1');
  assert.match(d.page.text, /도움이 됐어요/);
  const r = await agent('POST', '/consultations/1/like', { _csrf: d.csrf });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/consultations/1?liked=1');
  const after = await agent('GET', '/consultations/1');
  assert.match(after.text, /공감 <strong>1<\/strong>/);
  assert.match(after.text, /도움이 됐다고 알려 주셨습니다/);
  await agent('POST', '/consultations/1/like', { _csrf: d.csrf });
  assert.equal([...s.mock.complaints.values()][0].likes, 1, '같은 사람은 한 번만');
  // CSRF 없이는 안 된다
  assert.equal((await agent('POST', '/consultations/2/like', { _csrf: 'x'.repeat(43) })).status, 403);
});

test('처리상황 조회 뒤 추가 의견·취하·만족도', async (t) => {
  const s = await startStack({ limits: { lookup: { limit: 100, windowMs: 60000 } } });
  t.after(() => s.close());
  const agent = makeAgent(s.url);
  const f = await open(s, agent, '/complaints/new');
  const done = await agent('POST', '/complaints', { ...complaint, password: 'abc12345', password2: 'abc12345', _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
  assert.equal(done.status, 200, done.text);
  assert.match(done.text, /data-draft-done="complaint"/, '접수되면 임시저장을 지운다');
  assert.match(done.text, /접수증 인쇄/);
  const no = /class="big">([^<]+)</.exec(done.text)[1];

  async function look() {
    const l = await open(s, agent, '/lookup');
    return agent('POST', '/lookup', { receiptNo: no, password: 'abc12345', _csrf: l.csrf, captchaId: l.captchaId, captcha: l.captcha });
  }
  let r = await look();
  assert.match(r.text, /추가 의견 내기/);
  assert.match(r.text, /민원 취하/);
  assert.ok(!r.text.includes('만족하시나요'));
  const token = hidden(r.text, 'token');
  const csrf = hidden(r.text, '_csrf');
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);

  r = await agent('POST', '/complaints/action', { _csrf: csrf, token, receiptNo: no, back: 'lookup', action: 'addendum', text: '<b>사진</b> 위치는 1번 출구' });
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /추가 의견을 보냈습니다/);
  r = await look();
  assert.match(r.text, /민원인 추가 의견/);
  assert.match(r.text, /&lt;b&gt;사진&lt;\/b&gt;/);

  // 취하는 확인란이 있어야
  r = await agent('POST', '/complaints/action', { _csrf: csrf, token, receiptNo: no, back: 'lookup', action: 'withdraw' });
  assert.equal(r.status, 400);
  r = await agent('POST', '/complaints/action', { _csrf: csrf, token, receiptNo: no, back: 'lookup', action: 'withdraw', confirm: 'true', reason: '해결됨' });
  assert.match(r.text, /취하했습니다/);
  r = await look();
  assert.match(r.text, /취하/);
  assert.ok(!r.text.includes('민원 취하</h2>'), '취하한 뒤에는 취하 양식이 없다');
  // 잘못된 표
  r = await agent('POST', '/complaints/action', { _csrf: csrf, token: 'A'.repeat(32), receiptNo: no, back: 'lookup', action: 'addendum', text: 'x' });
  assert.equal(r.status, 401);

  // 만족도: 처리 완료된 민원
  s.mock.complete('2026-000001');
  const seedPw = 'seed1234pw';
  const l = await open(s, agent, '/lookup');
  const seedNo = [...s.mock.complaints.keys()][0];
  r = await agent('POST', '/lookup', { receiptNo: seedNo, password: seedPw, _csrf: l.csrf, captchaId: l.captchaId, captcha: l.captcha });
  assert.match(r.text, /처리 결과에 만족하시나요/);
  const t2 = hidden(r.text, 'token');
  r = await agent('POST', '/complaints/action', { _csrf: csrf, token: t2, receiptNo: seedNo, back: 'lookup', action: 'rate', score: '9' });
  assert.equal(r.status, 400);
  r = await agent('POST', '/complaints/action', { _csrf: csrf, token: t2, receiptNo: seedNo, back: 'lookup', action: 'rate', score: '5', comment: '고맙습니다' });
  assert.match(r.text, /만족도를 보냈습니다/);
  r = await agent('POST', '/complaints/action', { _csrf: csrf, token: t2, receiptNo: seedNo, back: 'lookup', action: 'rate', score: '4' });
  assert.equal(r.status, 409);
});

test('회원: 가입 → 내 민원 → 정보 고치기 → 비밀번호 → 로그아웃 → 로그인 → 탈퇴', async (t) => {
  const s = await startStack({ limits: { signup: { limit: 100, windowMs: 60000 }, login: { limit: 100, windowMs: 60000 } } });
  t.after(() => s.close());
  const agent = makeAgent(s.url);

  // 로그인하지 않으면 내 민원은 로그인으로
  let r = await agent('GET', '/my');
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/login?next=%2Fmy');

  // 가입: 규칙 확인
  let f = await open(s, agent, '/signup');
  assert.match(f.page.text, /이용약관/);
  r = await agent('POST', '/signup', { ...member, loginId: 'Hong', password: 'short', _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
  assert.equal(r.status, 400);
  assert.match(r.text, /아이디는 영문 소문자로 시작/);
  assert.match(r.text, /2종류 이상이면 10자 이상/);
  assert.ok(!r.text.includes('value="short"'), '비밀번호를 다시 채우지 않음');
  f = await open(s, agent, '/signup');
  r = await agent('POST', '/signup', { ...member, _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
  assert.equal(r.status, 303, r.text);
  assert.equal(r.headers.get('location'), '/my?welcome=1');
  assert.ok(r.cookies.some((c) => /^ep_sid=[A-Za-z0-9_-]{43};.*HttpOnly.*SameSite=Lax/.test(c)), r.cookies.join('\n'));
  assert.equal(s.mock.members.get(1).mobile, '010-1234-5678');
  r = await agent('GET', '/my?welcome=1');
  assert.match(r.text, /가입을 환영합니다/);
  assert.match(r.text, /홍길동님/);

  // 같은 아이디는 다시 가입할 수 없다
  const other = makeAgent(s.url);
  f = await open(s, other, '/signup');
  r = await other('POST', '/signup', { ...member, _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
  assert.equal(r.status, 409);
  assert.match(r.text, /이미 쓰고 있는 아이디/);

  // 회원 신청: 이름·연락처가 채워지고, 조회 비밀번호 없이도 된다
  f = await open(s, agent, '/complaints/new');
  assert.match(f.page.text, /value="홍길동"/);
  assert.match(f.page.text, /회원은 선택/);
  r = await agent('POST', '/complaints', { ...complaint, _csrf: f.csrf, captchaId: f.captchaId, captcha: f.captcha });
  assert.equal(r.status, 200, r.text);
  assert.match(r.text, /내 민원으로 가기/);
  const no = /class="big">([^<]+)</.exec(r.text)[1];
  assert.equal(s.mock.complaints.get(no).memberId, 1);

  r = await agent('GET', '/my');
  assert.match(r.text, new RegExp(no));
  r = await agent('GET', `/my/complaints/${no}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /회원 민원/);
  assert.match(r.text, /추가 의견 내기/);
  assert.equal((await agent('GET', '/my/complaints/2026-999999')).status, 404);
  // 내 민원에서 추가 의견 → 내 민원으로 돌아가는 단추
  r = await agent('POST', '/complaints/action', { _csrf: hidden(r.text, '_csrf'), token: hidden(r.text, 'token'), receiptNo: no, back: 'my', action: 'addendum', text: '덧붙임' });
  assert.match(r.text, new RegExp(`href="/my/complaints/${no}"`));

  // 내 정보 고치기
  f = await open(s, agent, '/my/profile');
  r = await agent('POST', '/my/profile', { _csrf: f.csrf, name: '홍길순', mobile: '123', email: '', address: '' });
  assert.equal(r.status, 400);
  r = await agent('POST', '/my/profile', { _csrf: f.csrf, name: '홍길순', mobile: '', email: 'new@example.com', address: '시청로 1' });
  assert.equal(r.status, 303);
  r = await agent('GET', '/my/profile?saved=1');
  assert.match(r.text, /저장했습니다/);
  assert.match(r.text, /홍길순님/, '머리말 이름도 바뀐다');

  // 비밀번호 바꾸기 → 세션 번호도 새로
  f = await open(s, agent, '/my/password');
  r = await agent('POST', '/my/password', { _csrf: f.csrf, currentPassword: 'wrong-pass-1', password: 'New-River-2026', password2: 'New-River-2026' });
  assert.match(r.text, /지금 비밀번호가 맞지 않습니다/);
  r = await agent('POST', '/my/password', { _csrf: f.csrf, currentPassword: member.password, password: 'New-River-2026', password2: 'New-River-2026' });
  assert.equal(r.status, 303);
  assert.ok(r.cookies.some((c) => c.startsWith('ep_sid=')));

  // 로그아웃 (POST + CSRF)
  f = await open(s, agent, '/logout');
  r = await agent('POST', '/logout', { _csrf: f.csrf });
  assert.equal(r.status, 303);
  assert.equal((await agent('GET', '/my')).status, 303);

  // 로그인: 틀리면 같은 답, next 는 이 사이트 안만
  f = await open(s, agent, '/login?next=https://evil.example');
  assert.match(f.page.text, /name="next" value=""/);
  r = await agent('POST', '/login', { _csrf: f.csrf, loginId: 'hong_gildong', password: member.password, next: '' });
  assert.equal(r.status, 401);
  assert.match(r.text, /아이디 또는 비밀번호가 맞지 않습니다/);
  r = await agent('POST', '/login', { _csrf: f.csrf, loginId: 'HONG_GILDONG', password: 'New-River-2026', next: '//evil.example' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/my');
  r = await agent('GET', '/my');
  assert.equal(r.status, 200);

  // 탈퇴
  f = await open(s, agent, '/my/withdraw');
  r = await agent('POST', '/my/withdraw', { _csrf: f.csrf, password: 'New-River-2026' });
  assert.equal(r.status, 400, '확인란 없이 안 됨');
  r = await agent('POST', '/my/withdraw', { _csrf: f.csrf, password: 'New-River-2026', confirm: 'true' });
  assert.equal(r.status, 200);
  assert.match(r.text, /회원 정보를 지웠습니다/);
  assert.equal(s.mock.members.size, 0);
  assert.equal(s.mock.complaints.get(no).memberId, null, '민원은 남고 연결만 끊긴다');
  assert.equal((await agent('GET', '/my')).status, 303);
});

test('세션: 오래 쓰지 않으면 로그아웃', async () => {
  const { SessionStore } = require('../src/session');
  let t = 0;
  const store = new SessionStore({ idleMs: 1000, maxMs: 5000, cookieSecure: true, now: () => t });
  const headers = {};
  const res = { getHeader: (k) => headers[k], setHeader: (k, v) => { headers[k] = v; } };
  const id = store.create({ headers: {} }, res, { memberId: 1, name: '홍' });
  const req = { headers: { cookie: `ep_sid=${id}` } };
  t = 900; assert.ok(store.get(req));
  t = 1800; assert.ok(store.get(req), '쓰면 시간이 늘어난다');
  t = 3000; assert.equal(store.get(req), null);
  store.close();
});
