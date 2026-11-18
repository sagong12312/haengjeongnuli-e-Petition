'use strict';
/**
 * 공지사항·자주 묻는 질문·민원 안내·처리 통계·약관, 공개 상담 공감, 민원인이 하는 일(추가 의견·취하·만족도),
 * 회원(가입·로그인·로그아웃·내 민원·내 정보·비밀번호·탈퇴) 요청 처리.
 */
const pv = require('./portalViews');
const views = require('./views');
const { validateSignupForm, validateProfile, memberPasswordProblem, parseListQuery, RECEIPT_RE } = require('./validation');
const { NuriApiError } = require('./nuriClient');

/** 로그인 뒤 돌아갈 주소: 이 사이트 안의 경로만 (//다른곳 막기) */
function safeNext(v) {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//') || v.includes('\\') || v.length > 200) return '';
  if (/^\/(login|logout|signup)\b/.test(v)) return '';
  return v;
}

function createPortalRoutes(h) {
  const {
    nuri, config, sessions, captchas, limiters, send, readForm, csrfToken, verifyCsrf, notFound, tooMany, rc, redirect,
  } = h;
  const csrf = (req, res) => csrfToken(req, res, config.cookieSecure);
  const BAD_CSRF = '화면을 연 지 오래되었거나 잘못된 요청입니다. 다시 해 주세요.';

  function needLogin(req, res, url) {
    if (req.member) return false;
    redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    return true;
  }

  /** 행정누리가 회원 정보를 찾지 못하면(탈퇴 등) 로그아웃시킨다 */
  function memberGone(req, res, e) {
    if (e instanceof NuriApiError && e.code === 'member_not_found') {
      sessions.destroy(req, res);
      redirect(res, '/login');
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ 읽기 화면 */

  async function notices(req, res, ip, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const { page, q } = parseListQuery(url.searchParams);
    send(res, 200, pv.noticeList(rc(req), (await nuri.listNotices(page, q, ip)) || {}, q));
  }

  async function notice(req, res, ip, id) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    try {
      send(res, 200, pv.noticeDetail(rc(req), (await nuri.getNotice(id, ip)) || {}));
    } catch (e) {
      if (e instanceof NuriApiError && e.status === 404) return notFound(res);
      throw e;
    }
  }

  async function faq(req, res, ip) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    send(res, 200, pv.faqPage(rc(req), (await nuri.faqs(ip)) || {}));
  }

  async function guide(req, res, ip) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    send(res, 200, pv.guidePage(rc(req), (await nuri.info(ip)) || {}));
  }

  async function stats(req, res, ip) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    send(res, 200, pv.statsPage(rc(req), (await nuri.stats(ip)) || {}));
  }

  /* ------------------------------------------------------------ 공개 상담 공감 */

  async function like(req, res, ip, id) {
    if (!limiters.action.take(ip)) return tooMany(res, limiters.action, ip);
    const form = await readForm(req);
    if (!verifyCsrf(req, form._csrf)) return send(res, 403, views.errorPage(rc(req), 403, '다시 시도해 주세요', BAD_CSRF));
    try {
      await nuri.likeConsultation(id, ip);
    } catch (e) {
      if (e instanceof NuriApiError && e.status === 404) return notFound(res);
      throw e;
    }
    redirect(res, `/consultations/${encodeURIComponent(id)}?liked=1`);
  }

  /* ------------------------------------------------------------ 민원인이 하는 일 */

  const ACTION_TITLE = { withdraw: '민원을 취하했습니다', addendum: '추가 의견을 보냈습니다', rate: '만족도를 보냈습니다' };

  async function complaintAction(req, res, ip) {
    if (!limiters.action.take(ip)) return tooMany(res, limiters.action, ip);
    const form = await readForm(req);
    const receiptNo = typeof form.receiptNo === 'string' && RECEIPT_RE.test(form.receiptNo) ? form.receiptNo : '';
    const back = form.back === 'my' && req.member && receiptNo ? `/my/complaints/${encodeURIComponent(receiptNo)}` : '/lookup';
    const fail = (status, msg) => send(res, status, views.errorPage(rc(req), status, '처리하지 못했습니다',
      `${msg} ${back === '/lookup' ? '처리상황을 다시 조회해 주세요.' : ''}`.trim()));
    if (!verifyCsrf(req, form._csrf)) return fail(403, BAD_CSRF);
    const token = typeof form.token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(form.token) ? form.token : null;
    if (!token) return fail(400, '잘못된 요청입니다.');
    const action = form.action;
    try {
      if (action === 'withdraw') {
        if (form.confirm !== 'true') return fail(400, '취하하려면 “이 민원을 취하합니다”를 체크해 주세요.');
        await nuri.withdraw(token, String(form.reason || '').slice(0, 500), ip);
        return send(res, 200, pv.actionDone(rc(req), { title: ACTION_TITLE.withdraw, back,
          message: `접수번호 ${receiptNo} 민원을 취하했습니다. 담당자에게 알렸으며 처리를 멈춥니다.` }));
      }
      if (action === 'addendum') {
        const text = String(form.text || '').trim();
        if (!text) return fail(400, '추가 의견을 적어 주세요.');
        if ([...text].length > 1000) return fail(400, '추가 의견은 1,000자 이내로 적어 주세요.');
        await nuri.addendum(token, text, ip);
        return send(res, 200, pv.actionDone(rc(req), { title: ACTION_TITLE.addendum, back,
          message: '담당자에게 추가 의견을 전했습니다. 처리 과정에 기록됩니다.' }));
      }
      if (action === 'rate') {
        const score = Number.parseInt(form.score, 10);
        if (!(score >= 1 && score <= 5)) return fail(400, '만족도를 1~5점 가운데 골라 주세요.');
        await nuri.rate(token, score, String(form.comment || '').slice(0, 1000), ip);
        return send(res, 200, pv.actionDone(rc(req), { title: ACTION_TITLE.rate, back,
          message: '소중한 의견 고맙습니다. 민원 처리를 고치는 데 쓰겠습니다.' }));
      }
      return fail(400, '잘못된 요청입니다.');
    } catch (e) {
      if (e instanceof NuriApiError) {
        if (e.code === 'token_expired') return fail(401, '시간이 지나 처리하지 못했습니다.');
        return fail(e.status >= 400 && e.status < 500 ? e.status : 400, e.publicMessage || '처리하지 못했습니다.');
      }
      throw e;
    }
  }

  /* ------------------------------------------------------------ 회원가입 */

  function showSignup(req, res, status = 200, values = {}, errors = {}, message = '') {
    const safe = { ...values };
    delete safe.password; delete safe.password2; delete safe.captcha;
    send(res, status, pv.signupForm(rc(req), { values: safe, errors, message, csrf: csrf(req, res), captchaId: captchas.create() }));
  }

  async function signup(req, res, ip) {
    if (!limiters.signup.take(ip)) return tooMany(res, limiters.signup, ip);
    const form = await readForm(req);
    if (!verifyCsrf(req, form._csrf)) return showSignup(req, res, 403, form, {}, BAD_CSRF);
    if (!captchas.verify(form.captchaId, form.captcha)) {
      return showSignup(req, res, 400, form, { captcha: '자동입력 방지 숫자가 맞지 않습니다. 새 그림을 보고 다시 적어 주세요.' });
    }
    const { errors, payload } = validateSignupForm(form);
    if (Object.keys(errors).length) return showSignup(req, res, 400, form, errors);
    let m;
    try {
      m = await nuri.signup(payload, ip);
    } catch (e) {
      if (e instanceof NuriApiError) {
        const field = { login_id_taken: 'loginId', invalid_login_id: 'loginId', invalid_password: 'password', consent_required: 'privacyConsent' }[e.code];
        const msg = e.publicMessage || '가입하지 못했습니다.';
        return showSignup(req, res, e.status === 409 ? 409 : 400, form, field ? { [field]: msg } : {}, msg);
      }
      throw e;
    }
    sessions.create(req, res, { memberId: m.memberId, loginId: m.loginId, name: m.name });
    redirect(res, '/my?welcome=1');
  }

  /* ------------------------------------------------------------ 로그인 · 로그아웃 */

  function showLogin(req, res, status = 200, values = {}, errors = {}, message = '', next = '', notice = '') {
    send(res, status, pv.loginForm(rc(req), { values: { loginId: values.loginId }, errors, message, csrf: csrf(req, res), next, notice }));
  }

  async function login(req, res, ip) {
    if (!limiters.login.take(ip)) return tooMany(res, limiters.login, ip);
    const form = await readForm(req);
    const next = safeNext(form.next);
    if (!verifyCsrf(req, form._csrf)) return showLogin(req, res, 403, form, {}, BAD_CSRF, next);
    const loginId = typeof form.loginId === 'string' ? form.loginId.trim().toLowerCase() : '';
    const password = typeof form.password === 'string' ? form.password : '';
    if (!loginId || !password) return showLogin(req, res, 400, form, {}, '아이디와 비밀번호를 적어 주세요.', next);
    let m;
    try {
      m = await nuri.login(loginId, password, ip);
    } catch (e) {
      if (e instanceof NuriApiError) {
        if (e.code === 'locked') return showLogin(req, res, 423, form, {}, e.publicMessage || '잠시 로그인할 수 없습니다.', next);
        if (e.code === 'too_many_attempts') {
          return showLogin(req, res, 429, form, {}, e.publicMessage || '로그인을 여러 번 틀렸습니다. 잠시 뒤 다시 시도해 주세요.', next);
        }
        return showLogin(req, res, 401, form, {}, '아이디 또는 비밀번호가 맞지 않습니다.', next);
      }
      throw e;
    }
    sessions.create(req, res, { memberId: m.memberId, loginId: m.loginId, name: m.name, previousLoginAt: m.previousLoginAt });
    redirect(res, next || '/my');
  }

  async function logout(req, res) {
    const form = await readForm(req);
    if (!verifyCsrf(req, form._csrf)) return send(res, 403, views.errorPage(rc(req), 403, '다시 시도해 주세요', BAD_CSRF));
    sessions.destroy(req, res);
    redirect(res, '/login?bye=1');
  }

  /* ------------------------------------------------------------ 내 민원 */

  async function myList(req, res, ip, url) {
    if (needLogin(req, res, url)) return;
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const { page } = parseListQuery(url.searchParams);
    let data;
    try {
      data = await nuri.memberComplaints(req.member.memberId, page, ip);
    } catch (e) {
      if (memberGone(req, res, e)) return;
      throw e;
    }
    let notice = '';
    if (url.searchParams.get('welcome') === '1') notice = `${req.member.name}님, 가입을 환영합니다. 이제 민원을 신청하면 여기에서 볼 수 있습니다.`;
    else if (req.session.previousLoginAt && !req.session.shownPrev) {
      notice = `지난 로그인: ${String(req.session.previousLoginAt).replace('T', ' ')}. 본인이 아니면 비밀번호를 바꿔 주세요.`;
      req.session.shownPrev = true;
    }
    send(res, 200, pv.myList(rc(req), data || {}, notice));
  }

  async function myComplaint(req, res, ip, url, receiptNo) {
    if (needLogin(req, res, url)) return;
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    if (!RECEIPT_RE.test(receiptNo)) return notFound(res);
    try {
      const d = await nuri.memberComplaint(req.member.memberId, receiptNo, ip);
      send(res, 200, pv.myComplaint(rc(req), d || {}, csrf(req, res)));
    } catch (e) {
      if (memberGone(req, res, e)) return;
      if (e instanceof NuriApiError && e.status === 404) return notFound(res);
      throw e;
    }
  }

  /* ------------------------------------------------------------ 내 정보 */

  async function profile(req, res, ip, url) {
    if (needLogin(req, res, url)) return;
    try {
      const m = await nuri.getMember(req.member.memberId, ip);
      send(res, 200, pv.profileForm(rc(req), { values: m || {}, csrf: csrf(req, res),
        notice: url.searchParams.get('saved') === '1' ? '저장했습니다.' : url.searchParams.get('pw') === '1' ? '비밀번호를 바꿨습니다.' : '' }));
    } catch (e) {
      if (memberGone(req, res, e)) return;
      throw e;
    }
  }

  async function saveProfile(req, res, ip, url) {
    if (needLogin(req, res, url)) return;
    if (!limiters.action.take(ip)) return tooMany(res, limiters.action, ip);
    const form = await readForm(req);
    const current = await nuri.getMember(req.member.memberId, ip).catch((e) => { if (memberGone(req, res, e)) return null; throw e; });
    if (!current) return;
    const values = { ...current, name: form.name, mobile: form.mobile, email: form.email, address: form.address };
    if (!verifyCsrf(req, form._csrf)) return send(res, 403, pv.profileForm(rc(req), { values, message: BAD_CSRF, csrf: csrf(req, res) }));
    const errors = {};
    const p = validateProfile(form, errors);
    if (Object.keys(errors).length) return send(res, 400, pv.profileForm(rc(req), { values, errors, csrf: csrf(req, res) }));
    try {
      const m = await nuri.updateMember(req.member.memberId, p, ip);
      req.session.name = m.name;
    } catch (e) {
      if (memberGone(req, res, e)) return;
      if (e instanceof NuriApiError) {
        return send(res, 400, pv.profileForm(rc(req), { values, message: e.publicMessage || '저장하지 못했습니다.', csrf: csrf(req, res) }));
      }
      throw e;
    }
    redirect(res, '/my/profile?saved=1');
  }

  function showPassword(req, res, url) {
    if (needLogin(req, res, url)) return;
    send(res, 200, pv.passwordForm(rc(req), { csrf: csrf(req, res) }));
  }

  async function changePassword(req, res, ip, url) {
    if (needLogin(req, res, url)) return;
    if (!limiters.login.take(ip)) return tooMany(res, limiters.login, ip);
    const form = await readForm(req);
    const again = (status, errors, message = '') => send(res, status, pv.passwordForm(rc(req), { errors, message, csrf: csrf(req, res) }));
    if (!verifyCsrf(req, form._csrf)) return again(403, {}, BAD_CSRF);
    const errors = {};
    const bad = memberPasswordProblem(form.password, req.member.loginId);
    if (!form.currentPassword) errors.currentPassword = '지금 비밀번호를 적어 주세요.';
    if (bad) errors.password = bad;
    else if (form.password !== form.password2) errors.password2 = '새 비밀번호 확인이 같지 않습니다.';
    if (Object.keys(errors).length) return again(400, errors);
    try {
      await nuri.changeMemberPassword(req.member.memberId, form.currentPassword, form.password, ip);
    } catch (e) {
      if (memberGone(req, res, e)) return;
      if (e instanceof NuriApiError) {
        const field = e.code === 'wrong_password' ? 'currentPassword' : 'password';
        return again(400, { [field]: e.publicMessage || '바꾸지 못했습니다.' });
      }
      throw e;
    }
    // 비밀번호를 바꾸면 다른 기기의 로그인을 끊고, 이 기기도 세션 번호를 새로 (훔친 세션은 못 쓰게)
    sessions.destroyMember(req.member.memberId);
    sessions.create(req, res, { memberId: req.member.memberId, loginId: req.member.loginId, name: req.member.name });
    redirect(res, '/my/profile?pw=1');
  }

  function showWithdraw(req, res, url) {
    if (needLogin(req, res, url)) return;
    send(res, 200, pv.withdrawForm(rc(req), { csrf: csrf(req, res) }));
  }

  async function withdrawMember(req, res, ip, url) {
    if (needLogin(req, res, url)) return;
    if (!limiters.login.take(ip)) return tooMany(res, limiters.login, ip);
    const form = await readForm(req);
    const again = (status, errors, message = '') => send(res, status, pv.withdrawForm(rc(req), { errors, message, csrf: csrf(req, res) }));
    if (!verifyCsrf(req, form._csrf)) return again(403, {}, BAD_CSRF);
    const errors = {};
    if (!form.password) errors.password = '비밀번호를 적어 주세요.';
    if (form.confirm !== 'true') errors.confirm = '탈퇴하려면 확인란을 체크해 주세요.';
    if (Object.keys(errors).length) return again(400, errors);
    try {
      await nuri.deleteMember(req.member.memberId, form.password, ip);
    } catch (e) {
      if (memberGone(req, res, e)) return;
      if (e instanceof NuriApiError) return again(400, { password: e.publicMessage || '탈퇴하지 못했습니다.' });
      throw e;
    }
    sessions.destroyMember(req.member.memberId);
    sessions.destroy(req, res);
    send(res, 200, pv.actionDone({ ...rc(req), member: null }, { title: '탈퇴했습니다', back: '/',
      message: '회원 정보를 지웠습니다. 그동안 이용해 주셔서 고맙습니다.' }).replace('처리상황 다시 조회', '첫 화면으로'));
  }

  /* ------------------------------------------------------------ 길 찾기 */

  async function get(req, res, ip, url) {
    const p = url.pathname;
    if (p === '/notices') return (await notices(req, res, ip, url), true);
    let mm = /^\/notices\/(\d{1,18})$/.exec(p);
    if (mm) return (await notice(req, res, ip, mm[1]), true);
    if (p === '/faq') return (await faq(req, res, ip), true);
    if (p === '/guide') return (await guide(req, res, ip), true);
    if (p === '/stats') return (await stats(req, res, ip), true);
    if (p === '/terms') return (await send(res, 200, pv.termsPage(rc(req))), true);
    if (p === '/privacy') return (await send(res, 200, pv.privacyPage(rc(req))), true);
    if (p === '/signup') {
      if (req.member) return (await redirect(res, '/my'), true);
      return (await showSignup(req, res), true);
    }
    if (p === '/login') {
      if (req.member) return (await redirect(res, '/my'), true);
      return showLogin(req, res, 200, {}, {}, '', safeNext(url.searchParams.get('next')),
        url.searchParams.get('bye') === '1' ? '로그아웃했습니다.' : ''), true;
    }
    if (p === '/logout') {
      if (!req.member) return (await redirect(res, '/'), true);
      return (await send(res, 200, pv.logoutConfirm(rc(req), csrf(req, res))), true);
    }
    if (p === '/my') return (await myList(req, res, ip, url), true);
    mm = /^\/my\/complaints\/([0-9-]{6,20})$/.exec(p);
    if (mm) return (await myComplaint(req, res, ip, url, mm[1]), true);
    if (p === '/my/profile') return (await profile(req, res, ip, url), true);
    if (p === '/my/password') return (await showPassword(req, res, url), true);
    if (p === '/my/withdraw') return (await showWithdraw(req, res, url), true);
    return false;
  }

  async function post(req, res, ip, url) {
    const p = url.pathname;
    const mm = /^\/consultations\/(\d{1,18})\/like$/.exec(p);
    if (mm) return (await like(req, res, ip, mm[1]), true);
    if (p === '/complaints/action') return (await complaintAction(req, res, ip), true);
    if (p === '/signup') return (await signup(req, res, ip), true);
    if (p === '/login') return (await login(req, res, ip), true);
    if (p === '/logout') return (await logout(req, res), true);
    if (p === '/my/profile') return (await saveProfile(req, res, ip, url), true);
    if (p === '/my/password') return (await changePassword(req, res, ip, url), true);
    if (p === '/my/withdraw') return (await withdrawMember(req, res, ip, url), true);
    return false;
  }

  return { get, post };
}

module.exports = { createPortalRoutes, safeNext };
