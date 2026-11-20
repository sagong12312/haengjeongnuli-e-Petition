'use strict';
const zlib = require('node:zlib');
/**
 * 행정누리 전자민원 (국민용) 요청 처리.
 *
 * - 민원 내용·개인정보는 이 서버 DB나 로그에 남기지 않습니다. 접수 결과만 화면에 보여 주고,
 *   조회는 그때마다 행정누리 연동 API 로 합니다 (규격 1).
 * - 요청 본문은 로그에 남기지 않습니다 (규격 6).
 */
const fs = require('node:fs');
const path = require('node:path');
const views = require('./views');
const { validateComplaintForm, validateLookupForm, parseListQuery, CATEGORIES } = require('./validation');
const {
  CSP, parseCookies, setSecurityHeaders, isSecure, isLoopback, clientIp, RateLimiter, csrfToken, verifyCsrf, CaptchaStore,
} = require('./security');
const { NuriApiError } = require('./nuriClient');
const { parseMultipart } = require('./multipart');
const { checkAttachments } = require('./attachments');
const { SessionStore } = require('./session');
const { createPortalRoutes } = require('./portalRoutes');
const secapps = require('./secapps');
const { createExtras } = require('./extras');

const MAX_FORM_BYTES = 256 * 1024;
/** 민원 신청(첨부 5MB × 3개 + 글)만 더 크게 받는다 */
const MAX_MULTIPART_BYTES = 16 * 1024 * 1024;

const STATIC = {
  '/static/style.css': { file: path.join(__dirname, '..', 'public', 'style.css'), type: 'text/css; charset=utf-8' },
  '/static/app.js': { file: path.join(__dirname, '..', 'public', 'app.js'), type: 'text/javascript; charset=utf-8' },
  '/static/icon.svg': { file: path.join(__dirname, '..', 'public', 'icon.svg'), type: 'image/svg+xml' },
  '/static/icon-180.png': { file: path.join(__dirname, '..', 'public', 'icon-180.png'), type: 'image/png' },
  '/static/icon-192.png': { file: path.join(__dirname, '..', 'public', 'icon-192.png'), type: 'image/png' },
  '/static/icon-512.png': { file: path.join(__dirname, '..', 'public', 'icon-512.png'), type: 'image/png' },
  '/sw.js': { file: path.join(__dirname, '..', 'public', 'sw.js'), type: 'text/javascript; charset=utf-8' },
  '/favicon.ico': { file: path.join(__dirname, '..', 'public', 'icon-192.png'), type: 'image/png' },
  '/robots.txt': {
    body: 'User-agent: *\nDisallow: /lookup\nDisallow: /complaints\nDisallow: /captcha/\nDisallow: /my\nDisallow: /login\nDisallow: /signup\nDisallow: /logout\n',
    type: 'text/plain; charset=utf-8',
  },
};

/** 행정누리 오류 코드 → 양식 칸 */
const SUBMIT_ERROR_FIELD = { invalid_category: 'category', invalid_kind: 'kind', invalid_password: 'password', invalid_content: 'content', invalid_file: 'files' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * 양식 읽기. 기본은 urlencoded 만, allowMultipart 이면 첨부가 있는 multipart 도 받는다.
 * 돌려주는 값: 글 칸 { 이름: 값 } (multipart 이면 _files 에 [{ field, filename, data }])
 */
function readForm(req, { allowMultipart = false } = {}) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    const multipart = allowMultipart && ct.startsWith('multipart/form-data');
    if (!multipart && !ct.startsWith('application/x-www-form-urlencoded')) {
      reject(new HttpError(415, '지원하지 않는 요청 형식입니다.'));
      req.resume();
      return;
    }
    const max = multipart ? MAX_MULTIPART_BYTES : MAX_FORM_BYTES;
    const declared = Number.parseInt(req.headers['content-length'] || '0', 10);
    if (declared > max) {
      reject(new HttpError(413, multipart ? '첨부파일이 너무 큽니다. 파일 하나에 5MB, 3개까지 붙일 수 있습니다.' : '보낸 내용이 너무 큽니다. 내용을 줄여 주세요.'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > max) {
        done = true;
        reject(new HttpError(413, multipart ? '첨부파일이 너무 큽니다. 파일 하나에 5MB, 3개까지 붙일 수 있습니다.' : '보낸 내용이 너무 큽니다. 내용을 줄여 주세요.'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const body = Buffer.concat(chunks);
      if (multipart) {
        try {
          const { fields, files } = parseMultipart(body, ct);
          resolve({ ...fields, _files: files });
        } catch {
          reject(new HttpError(400, '보낸 양식을 읽을 수 없습니다. 다시 시도해 주세요.'));
        }
        return;
      }
      const params = new URLSearchParams(body.toString('utf8'));
      const form = {};
      for (const [k, v] of params) if (!(k in form)) form[k] = v;
      resolve(form);
    });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function createApp({ config, nuri, logger = console, captcha, limits = {}, sessions: sessionStore }) {
  const ctx = {
    orgName: config.orgName,
    orgContact: config.orgContact,
    orgAddress: config.orgAddress || '',
    orgHours: config.orgHours || '',
    privacyRetention: config.privacyRetention,
  };
  const captchas = captcha || new CaptchaStore();
  const limiters = {
    global: new RateLimiter(limits.global || { limit: 300, windowMs: 60_000 }),
    submit: new RateLimiter(limits.submit || { limit: 5, windowMs: 10 * 60_000 }),
    lookup: new RateLimiter(limits.lookup || { limit: 10, windowMs: 10 * 60_000 }),
    read: new RateLimiter(limits.read || { limit: 60, windowMs: 60_000 }),
    captcha: new RateLimiter(limits.captcha || { limit: 60, windowMs: 60_000 }),
    login: new RateLimiter(limits.login || { limit: 10, windowMs: 10 * 60_000 }),
    signup: new RateLimiter(limits.signup || { limit: 5, windowMs: 60 * 60_000 }),
    idcheck: new RateLimiter(limits.idcheck || { limit: 40, windowMs: 10 * 60_000 }),
    action: new RateLimiter(limits.action || { limit: 30, windowMs: 10 * 60_000 }),
  };
  const sessions = sessionStore || new SessionStore({ cookieSecure: config.cookieSecure });
  const secApps = secapps.createSecApps({ nuri, logger });
  const extras = createExtras({ nuri, send: (res, st, html) => send(res, st, html), ctxOf: (req) => rc(req), logger, isSecure: (req) => isSecure(req, config.trustProxy) });
  let warnedNoTls = false;
  /** 화면에 넘길 값: 로그인했으면 회원 이름도 */
  const rc = (req) => (req && req.member ? { ...ctx, member: req.member, sessionIdleSec: Math.floor(sessions.idleMs / 1000) } : ctx);
  function redirect(res, location) {
    res.statusCode = 303;
    res.setHeader('Location', location);
    res.end();
  }
  const staticCache = new Map();

  /** 휴대폰이 받는 양을 줄인다: 1KB 넘는 글자 응답은 gzip 으로 (받는 쪽이 된다고 할 때만) */
  function wantsGzip(res) {
    const req = res.req;
    return !!(req && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')));
  }

  function send(res, status, html) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Vary', 'Accept-Encoding');
    const buf = Buffer.from(String(html), 'utf8');
    if (buf.length > 1024 && wantsGzip(res)) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.end(zlib.gzipSync(buf, { level: 6 }));
    }
    res.end(buf);
  }

  function tooMany(res, limiter, ip) {
    res.setHeader('Retry-After', String(limiter.retryAfterSec(ip)));
    send(res, 429, views.errorPage(ctx, 429, '잠시 후 다시 시도해 주세요',
      '짧은 시간에 요청이 너무 많았습니다. 잠시 뒤에 다시 시도해 주세요.'));
  }

  function unavailable(res) {
    send(res, 503, views.errorPage(ctx, 503, '잠시 이용할 수 없습니다',
      `지금 행정누리와 연결할 수 없습니다. 잠시 뒤에 다시 시도하시거나 기관(${ctx.orgContact})에 문의해 주세요. 신청 중이던 민원은 접수되지 않았을 수 있으니, 다시 신청하기 전에 문의해 주세요.`));
  }

  function notFound(res) {
    send(res, 404, views.errorPage(ctx, 404, '페이지를 찾을 수 없습니다', '주소를 다시 확인해 주세요.'));
  }

  /* -------------------------------------------------------------- 민원 신청 */

  function showComplaintForm(req, res, status = 200, values = {}, errors = {}, message = '') {
    const safe = { ...values };
    delete safe.password; delete safe.password2; delete safe.captcha;
    send(res, status, views.complaintForm(rc(req), {
      values: safe, errors, message, csrf: csrfToken(req, res, config.cookieSecure), captchaId: captchas.create(),
    }));
  }

  async function submitComplaint(req, res, ip) {
    if (!limiters.submit.take(ip)) return tooMany(res, limiters.submit, ip);
    const form = await readForm(req, { allowMultipart: true });
    if (!verifyCsrf(req, form._csrf)) {
      return showComplaintForm(req, res, 403, form, {}, '화면을 연 지 오래되었거나 잘못된 요청입니다. 다시 입력해 주세요.');
    }
    if (!captchas.verify(form.captchaId, form.captcha)) {
      return showComplaintForm(req, res, 400, form, { captcha: '자동입력 방지 숫자가 맞지 않습니다. 새 그림을 보고 다시 적어 주세요.' });
    }
    const { errors, payload } = validateComplaintForm(form, { member: req.member });
    const attached = checkAttachments(form._files);
    if (attached.error) errors.files = attached.error + ' 파일을 다시 골라 주세요.';
    else if ((form._files || []).some((f) => f.filename && f.data && f.data.length)) {
      // 다른 칸이 틀려 양식을 다시 보여 줄 때는 브라우저가 고른 파일을 지우므로 안내한다
      if (Object.keys(errors).length) errors.files = '다른 칸을 고친 뒤 첨부파일을 다시 골라 주세요.';
    }
    if (Object.keys(errors).length) return showComplaintForm(req, res, 400, form, errors);
    if (attached.payload.length) payload.files = attached.payload;

    try {
      const data = await nuri.submitComplaint(payload, ip);
      return send(res, 200, views.complaintDone(rc(req), data));
    } catch (e) {
      if (e instanceof NuriApiError) {
        const field = SUBMIT_ERROR_FIELD[e.code];
        const msg = e.publicMessage || '입력한 내용을 확인해 주세요.';
        return showComplaintForm(req, res, 400, form, field ? { [field]: msg } : {}, msg);
      }
      throw e;
    }
  }

  /* -------------------------------------------------------------- 처리상황 조회 */

  function showLookupForm(req, res, status = 200, values = {}, errors = {}, message = '') {
    send(res, status, views.lookupForm(rc(req), {
      values: { receiptNo: values.receiptNo }, errors, message,
      csrf: csrfToken(req, res, config.cookieSecure), captchaId: captchas.create(),
    }));
  }

  async function lookup(req, res, ip) {
    if (!limiters.lookup.take(ip)) return tooMany(res, limiters.lookup, ip);
    const form = await readForm(req);
    if (!verifyCsrf(req, form._csrf)) {
      return showLookupForm(req, res, 403, form, {}, '화면을 연 지 오래되었거나 잘못된 요청입니다. 다시 입력해 주세요.');
    }
    if (!captchas.verify(form.captchaId, form.captcha)) {
      return showLookupForm(req, res, 400, form, { captcha: '자동입력 방지 숫자가 맞지 않습니다. 새 그림을 보고 다시 적어 주세요.' });
    }
    const { errors, receiptNo, password } = validateLookupForm(form);
    if (Object.keys(errors).length) return showLookupForm(req, res, 400, form, errors);

    try {
      const data = await nuri.lookupComplaint(receiptNo, password, ip);
      return send(res, 200, views.lookupResult(rc(req), data, csrfToken(req, res, config.cookieSecure)));
    } catch (e) {
      if (e instanceof NuriApiError) {
        if (e.code === 'not_matched') {
          return showLookupForm(req, res, 401, form, {}, '접수번호 또는 비밀번호가 맞지 않습니다.');
        }
        if (e.code === 'too_many_attempts') {
          return showLookupForm(req, res, 429, form, {},
            e.publicMessage || '조회 비밀번호를 여러 번 틀렸습니다. 잠시 뒤 다시 시도해 주세요.');
        }
        if (e.code === 'locked') {
          return showLookupForm(req, res, 423, form, {},
            e.publicMessage || '비밀번호를 여러 번 틀려 잠시 조회할 수 없습니다. 30분 뒤에 다시 시도해 주세요.');
        }
        return showLookupForm(req, res, 400, form, {}, e.publicMessage || '조회할 수 없습니다.');
      }
      throw e;
    }
  }

  /* -------------------------------------------------------------- 첫 화면 · 신청서 */

  async function home(req, res, ip) {
    // 하나가 안 돼도 첫 화면은 보여 준다 (셋을 함께 부른다)
    const [n, pop, st] = await Promise.all([
      nuri.listNotices(1, '', ip).catch((e) => { logger.warn?.(`[home] 공지사항을 가져오지 못했습니다: ${e.code || e.message}`); return null; }),
      nuri.listConsultations(1, '', ip, { sort: 'views' }).catch(() => null),
      homeStats(ip),
    ]);
    const notices = n && Array.isArray(n.items) ? n.items.slice(0, 5) : [];
    const popular = pop && Array.isArray(pop.items) ? pop.items.slice(0, 5) : [];
    send(res, 200, views.home(rc(req), notices, { popular, stats: st }));
  }

  // 첫 화면 숫자는 10분 동안 기억한다 (매번 행정누리에 묻지 않게)
  let statsCache = { at: 0, data: null };
  async function homeStats(ip) {
    if (Date.now() - statsCache.at < 10 * 60_000) return statsCache.data;
    try {
      const s = await nuri.stats(ip);
      statsCache = { at: Date.now(), data: s ? { received: s.received, done: s.done, avgDays: s.avgDays, onTimeRate: s.onTimeRate } : null };
    } catch { statsCache = { at: Date.now(), data: statsCache.data }; }
    return statsCache.data;
  }

  /** 회원이면 이름·연락처를 미리 채운다 */
  async function newComplaint(req, res, ip, url) {
    // /complaints/new?kind=QUERY&category=ROAD 처럼 들어오면 미리 골라 둔다 (도우미·안내 화면에서 넘어올 때)
    const pre = {};
    const k = url && url.searchParams.get('kind');
    const c = url && url.searchParams.get('category');
    if (/^(QUERY|SUGGESTION|GRIEVANCE|OTHER)$/.test(k || '')) pre.kind = k;
    if (c && CATEGORIES[c]) pre.category = c;
    if (!req.member) return showComplaintForm(req, res, 200, pre);
    let values = { ...pre, name: req.member.name };
    try {
      const mem = await nuri.getMember(req.member.memberId, ip);
      values = { ...pre, name: mem.name, mobile: mem.mobile || '', email: mem.email || '', address: mem.address || '' };
    } catch (e) {
      if (e instanceof NuriApiError && e.code === 'member_not_found') {
        sessions.destroy(req, res);
        return redirect(res, '/login');
      }
    }
    return showComplaintForm(req, res, 200, values);
  }

  const portal = createPortalRoutes({
    nuri, config, sessions, captchas, limiters, send, readForm, csrfToken, verifyCsrf, notFound, tooMany, rc, redirect,
  });

  /* -------------------------------------------------------------- 공개 목록 */

  async function consultations(req, res, ip, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const { page, q } = parseListQuery(url.searchParams);
    const kindRaw = url.searchParams.get('kind');
    const sortRaw = url.searchParams.get('sort');
    const kind = /^(QUERY|SUGGESTION|GRIEVANCE|OTHER)$/.test(kindRaw || '') ? kindRaw : '';
    const catRaw = url.searchParams.get('category');
    const category = CATEGORIES[catRaw] ? catRaw : '';
    const sort = /^(recent|views|likes)$/.test(sortRaw || '') ? sortRaw : 'recent';
    const data = await nuri.listConsultations(page, q, ip, { kind: kind || undefined, category: category || undefined, sort: sort === 'recent' ? undefined : sort });
    send(res, 200, views.consultationList(rc(req), data || {}, q, { kind, category, sort }));
  }

  /** 신청서 작성 중: 제목과 비슷한 공개 상담 (제목 낱말 가운데 긴 것 3개로 찾아 많이 겹치는 순) */
  async function similarConsultations(req, res, ip, url) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!limiters.read.take(ip)) { res.statusCode = 429; return res.end('{"items":[]}'); }
    const words = [...new Set(String(url.searchParams.get('q') || '').slice(0, 300)
      .split(/[\s.,!?()[\]{}"'“”‘’·\-~/]+/u).map((w) => w.replace(/(은|는|이|가|을|를|에|의|에서|으로|로|와|과|도)$/u, ''))
      .filter((w) => w.length >= 2))].sort((a, b) => b.length - a.length).slice(0, 3);
    const hits = new Map();
    for (const w of words) {
      let data;
      try { data = await nuri.listConsultations(1, w, ip); } catch { data = null; }
      for (const it of (data && Array.isArray(data.items) ? data.items : []).slice(0, 10)) {
        const cur = hits.get(it.id) || { id: it.id, title: String(it.title || ''), category: String(it.categoryLabel || ''), n: 0 };
        cur.n++;
        hits.set(it.id, cur);
      }
    }
    const items = [...hits.values()].sort((a, b) => b.n - a.n).slice(0, 5)
      .map(({ id, title, category }) => ({ id: String(id), title: title.slice(0, 200), category: category.slice(0, 50) }));
    res.statusCode = 200;
    res.end(JSON.stringify({ items }));
  }

  async function consultation(req, res, ip, id, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    try {
      const data = await nuri.getConsultation(id, ip);
      send(res, 200, views.consultationDetail(rc(req), data || {}, {
        csrf: csrfToken(req, res, config.cookieSecure), id, liked: url.searchParams.get('liked') === '1',
      }));
    } catch (e) {
      if (e instanceof NuriApiError && (e.status === 404 || e.code === 'not_found')) return notFound(res);
      throw e;
    }
  }

  async function dispositions(req, res, ip, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const { page, q } = parseListQuery(url.searchParams);
    const data = await nuri.listDispositions(page, q, ip);
    send(res, 200, views.dispositionList(rc(req), data || {}, q));
  }

  /* -------------------------------------------------------------- 정적 파일 */

  function serveStatic(req, res, entry) {
    let c = staticCache.get(entry);
    if (!c) {
      const raw = entry.body !== undefined ? Buffer.from(entry.body) : fs.readFileSync(entry.file);
      const text = /^(text\/|image\/svg|application\/(json|manifest))/.test(entry.type);
      c = { raw, gz: text && raw.length > 512 ? zlib.gzipSync(raw, { level: 9 }) : null,
        etag: '"' + require('node:crypto').createHash('sha256').update(raw).digest('base64url').slice(0, 16) + '"' };
      staticCache.set(entry, c);
    }
    res.setHeader('Content-Type', entry.type);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', c.etag);
    // 주소에 지문(?v=)이 붙은 파일은 1년 동안 다시 받지 않는다. 지문이 없으면 매번 바뀌었는지만 묻는다
    res.setHeader('Cache-Control', /[?&]v=[0-9a-f]{6,}/.test(String(req.url)) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
    res.removeHeader('Pragma');
    if (req.headers['if-none-match'] === c.etag) {
      res.statusCode = 304;
      return res.end();
    }
    if (c.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      res.setHeader('Content-Encoding', 'gzip');
      return res.end(req.method === 'HEAD' ? undefined : c.gz);
    }
    res.end(req.method === 'HEAD' ? undefined : c.raw);
  }

  /* -------------------------------------------------------------- 보안 프로그램 */

  async function securityPrograms(req, res, ip, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const items = await secApps.list(ip);
    if (req.method === 'POST') {
      const form = await readForm(req);
      if (!verifyCsrf(req, form._csrf)) {
        return send(res, 403, views.errorPage(ctx, 403, '요청을 처리할 수 없습니다', '화면을 새로 고친 뒤 다시 해 주세요.'));
      }
      const item = items.find((a) => a.id === String(form.id || ''));
      const next = secapps.safeNext(form.next);
      if (item) secApps.setAck(req, res, parseCookies, item, config.cookieSecure);
      // 쿠키는 다음 요청부터 보이므로 남은 강제 항목은 방금 확인한 것을 빼고 센다
      const done = secApps.acked(req, parseCookies);
      if (item) done.add(`${item.id}.${item.version}`);
      const left = items.filter((a) => a.required && !done.has(`${a.id}.${a.version}`));
      return redirect(res, left.length ? `/security-programs?next=${encodeURIComponent(next)}&ok=1` : next);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    const done = secApps.acked(req, parseCookies);
    const origins = secApps.checkOrigins(items);
    // 이 화면에서만 설치 확인 주소(이 PC)에 물어볼 수 있게 한다
    if (origins.length) res.setHeader('Content-Security-Policy', `${CSP}; connect-src 'self' ${origins.join(' ')}`);
    send(res, 200, secapps.page(rc(req), {
      items, done, csrf: csrfToken(req, res, config.cookieSecure), next: secapps.safeNext(url.searchParams.get('next')),
      blocked: items.some((a) => a.required && !done.has(`${a.id}.${a.version}`)),
      message: url.searchParams.get('ok') === '1' ? '설치를 확인했습니다.' : '',
    }));
  }

  /* -------------------------------------------------------------- 라우터 */

  async function route(req, res) {
    const secure = isSecure(req, config.trustProxy);
    setSecurityHeaders(res, secure);
    // 와이파이·인터넷에서 http 로 오면 비밀번호·개인정보가 그대로 보이므로 받지 않는다
    if (config.requireHttps && !secure && !(isLoopback(req) && !config.trustProxy)) {
      const host = String(req.headers.host || '');
      // https 로 받을 곳이 있을 때만 넘긴다: 이 서버가 인증서로 켜졌거나(같은 포트) 앞단 프록시가 https 를 받을 때.
      // 둘 다 아니면 넘겨도 아무도 받지 않아 "연결할 수 없음"만 뜨므로, 무엇을 해야 하는지 알려 준다.
      const httpsReady = Boolean(config.tls) || config.trustProxy;
      if (httpsReady && (req.method === 'GET' || req.method === 'HEAD') && /^[A-Za-z0-9.\-[\]:]{1,255}$/.test(host)) {
        res.statusCode = 308;
        res.setHeader('Location', `https://${host.replace(/:\d+$/, (mm) => (config.tls ? mm : ''))}${String(req.url).startsWith('/') ? req.url : '/'}`);
        return res.end();
      }
      if (!httpsReady) {
        if (!warnedNoTls) { warnedNoTls = true; logger.warn?.('[https] 인증서 없이 켜져 있어 다른 기기의 접속을 받을 수 없습니다. scripts\\start-all.bat 로 켜거나 TLS_PFX_FILE 을 주세요.'); }
        return send(res, 403, views.errorPage(ctx, 403, '아직 휴대폰·다른 기기에서는 열 수 없습니다',
          '이 서버가 암호화(HTTPS) 없이 켜져 있어, 개인정보 보호를 위해 이 PC 밖에서 오는 접속을 받지 않습니다. 관리자는 행정누리 폴더의 scripts\\start-all.bat 로 다시 켜 주세요 (HTTPS 인증서를 만들어 켭니다). 그다음 https:// 로 시작하는 주소로 접속하세요.'));
      }
      return send(res, 403, views.errorPage(ctx, 403, '암호화된 연결이 필요합니다',
        '개인정보를 보호하려고 https:// 로 시작하는 주소에서만 받습니다. 주소창의 http:// 를 https:// 로 바꿔 다시 접속하세요.'));
    }
    const ip = clientIp(req, config.trustProxy);
    if (!limiters.global.take(ip)) return tooMany(res, limiters.global, ip);

    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return notFound(res); }
    const p = url.pathname;
    const m = req.method;
    const sess = sessions.get(req);
    req.session = sess;
    req.member = sess ? { memberId: sess.memberId, loginId: sess.loginId, name: sess.name } : null;

    // 강제 보안 프로그램을 설치하지 않았으면 설치 안내로 보낸다 (안내·약관·정적 파일은 그대로)
    const open = p === '/security-programs' || p === '/healthz' || p === '/offline' || p === '/robots.txt' || p === '/manifest.webmanifest'
      || p === '/terms' || p === '/privacy' || STATIC[p] || p.startsWith('/captcha/');
    // 보안 프로그램은 PC 용이다. 휴대폰·태블릿은 설치할 수 없으므로 강제 항목으로 막지 않는다
    if (!open && !secapps.isMobile(req)) {
      const missing = await secApps.missing(req, ip, parseCookies);
      if (missing.length) {
        if (m === 'GET' || m === 'HEAD') return redirect(res, `/security-programs?next=${encodeURIComponent(secapps.safeNext(p + url.search))}`);
        return send(res, 403, views.errorPage(ctx, 403, '보안 프로그램 설치가 필요합니다',
          '강제 보안 프로그램을 설치해야 신청·조회를 할 수 있습니다. 보안 프로그램 설치 화면(/security-programs)에서 설치한 뒤 다시 해 주세요.'));
      }
    }
    if (p === '/security-programs') return securityPrograms(req, res, ip, url);

    if (m === 'GET' || m === 'HEAD') {
      if (p === '/') return home(req, res, ip);
      if (p === '/healthz') { res.setHeader('Content-Type', 'text/plain'); return res.end('ok'); }
      if (STATIC[p]) return serveStatic(req, res, STATIC[p]);
      if (p === '/manifest.webmanifest') {
        // 휴대폰 '홈 화면에 추가' 때 쓰는 이름·아이콘 (개인정보 없음)
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        return res.end(JSON.stringify({
          name: `${ctx.orgName} 행정누리 전자민원`, short_name: '전자민원', lang: 'ko', start_url: '/', scope: '/',
          display: 'standalone', background_color: '#f5f7fb', theme_color: '#0f1f45',
          icons: [
            { src: '/static/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/static/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        }));
      }
      if (p === '/offline') {
        // 서비스 워커가 미리 받아 두는 '연결 끊김' 안내. 누구에게나 같은 내용이어야 하므로 회원 정보를 넣지 않는다
        return send(res, 200, views.offlinePage({ ...ctx, member: null, sessionIdleSec: 0 }));
      }
      if (p === '/complaints/new') return newComplaint(req, res, ip, url);
      if (p === '/lookup') return showLookupForm(req, res);
      if (p === '/consultations') return consultations(req, res, ip, url);
      if (p === '/consultations/similar') return similarConsultations(req, res, ip, url);
      let mm = /^\/consultations\/(\d{1,18})$/.exec(p);
      if (mm) return consultation(req, res, ip, mm[1], url);
      if (p === '/dispositions') return dispositions(req, res, ip, url);
      mm = /^\/captcha\/([0-9a-f]{32})\.svg$/.exec(p);
      if (mm) {
        if (!limiters.captcha.take(ip)) return tooMany(res, limiters.captcha, ip);
        const svg = captchas.svg(mm[1]);
        if (!svg) return notFound(res);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        return res.end(svg);
      }
      if (await portal.get(req, res, ip, url)) return undefined;
      if (await extras.get(req, res, ip, url)) return undefined;
      return notFound(res);
    }

    if (m === 'POST') {
      if (p === '/complaints') return submitComplaint(req, res, ip);
      if (p === '/lookup') return lookup(req, res, ip);
      if (await portal.post(req, res, ip, url)) return undefined;
    }

    res.setHeader('Allow', 'GET, HEAD, POST');
    return send(res, 405, views.errorPage(ctx, 405, '허용하지 않는 요청', '허용하지 않는 요청 방식입니다.'));
  }

  const handler = (req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      // 접속 기록: 경로만 남기고 쿼리·본문은 남기지 않습니다.
      logger.info?.(`${new Date().toISOString()} ${clientIp(req, config.trustProxy)} ${req.method} ${String(req.url).split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
    });
    route(req, res).catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      if (e instanceof HttpError) {
        return send(res, e.status, views.errorPage(ctx, e.status, '요청을 처리할 수 없습니다', e.message));
      }
      if (e && e.name === 'NuriUnavailableError') return unavailable(res);
      if (e instanceof NuriApiError) {
        return send(res, 400, views.errorPage(ctx, 400, '요청을 처리할 수 없습니다', e.publicMessage || '요청을 처리할 수 없습니다.'));
      }
      logger.error(`[app] 처리 중 오류: ${e && e.stack ? e.stack.split('\n')[0] : e}`);
      return send(res, 500, views.errorPage(ctx, 500, '오류가 났습니다', '잠시 뒤에 다시 시도해 주세요.'));
    });
  };

  handler.close = () => {
    Object.values(limiters).forEach((l) => l.stop());
    if (!captcha) captchas.stop();
    if (!sessionStore) sessions.close();
  };
  handler.sessions = sessions;
  handler.captchas = captchas;
  handler.secApps = secApps;
  return handler;
}

module.exports = { createApp };
