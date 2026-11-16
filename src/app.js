'use strict';
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
const { validateComplaintForm, validateLookupForm, parseListQuery } = require('./validation');
const {
  setSecurityHeaders, clientIp, RateLimiter, csrfToken, verifyCsrf, CaptchaStore,
} = require('./security');
const { NuriApiError } = require('./nuriClient');

const MAX_FORM_BYTES = 256 * 1024;

const STATIC = {
  '/static/style.css': { file: path.join(__dirname, '..', 'public', 'style.css'), type: 'text/css; charset=utf-8' },
  '/robots.txt': { body: 'User-agent: *\nDisallow: /lookup\nDisallow: /complaints\nDisallow: /captcha/\n', type: 'text/plain; charset=utf-8' },
};

/** 행정누리 오류 코드 → 양식 칸 */
const SUBMIT_ERROR_FIELD = { invalid_kind: 'kind', invalid_password: 'password', invalid_content: 'content' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    const ct = String(req.headers['content-type'] || '');
    if (!ct.startsWith('application/x-www-form-urlencoded')) {
      reject(new HttpError(415, '지원하지 않는 요청 형식입니다.'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_FORM_BYTES) {
        done = true;
        reject(new HttpError(413, '보낸 내용이 너무 큽니다. 내용을 줄여 주세요.'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const form = {};
      for (const [k, v] of params) if (!(k in form)) form[k] = v;
      resolve(form);
    });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function createApp({ config, nuri, logger = console, captcha, limits = {} }) {
  const ctx = {
    orgName: config.orgName,
    orgContact: config.orgContact,
    privacyRetention: config.privacyRetention,
    demoNotice: config.demoNotice === true,
  };
  const captchas = captcha || new CaptchaStore();
  const limiters = {
    global: new RateLimiter(limits.global || { limit: 300, windowMs: 60_000 }),
    submit: new RateLimiter(limits.submit || { limit: 5, windowMs: 10 * 60_000 }),
    lookup: new RateLimiter(limits.lookup || { limit: 10, windowMs: 10 * 60_000 }),
    read: new RateLimiter(limits.read || { limit: 60, windowMs: 60_000 }),
    captcha: new RateLimiter(limits.captcha || { limit: 60, windowMs: 60_000 }),
  };
  const staticCache = new Map();

  function send(res, status, html) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
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
    send(res, status, views.complaintForm(ctx, {
      values: safe, errors, message, csrf: csrfToken(req, res, config.cookieSecure), captchaId: captchas.create(),
    }));
  }

  async function submitComplaint(req, res, ip) {
    if (!limiters.submit.take(ip)) return tooMany(res, limiters.submit, ip);
    const form = await readForm(req);
    if (!verifyCsrf(req, form._csrf)) {
      return showComplaintForm(req, res, 403, form, {}, '화면을 연 지 오래되었거나 잘못된 요청입니다. 다시 입력해 주세요.');
    }
    if (!captchas.verify(form.captchaId, form.captcha)) {
      return showComplaintForm(req, res, 400, form, { captcha: '자동입력 방지 숫자가 맞지 않습니다. 새 그림을 보고 다시 적어 주세요.' });
    }
    const { errors, payload } = validateComplaintForm(form);
    if (Object.keys(errors).length) return showComplaintForm(req, res, 400, form, errors);

    try {
      const data = await nuri.submitComplaint(payload, ip);
      return send(res, 200, views.complaintDone(ctx, data));
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
    send(res, status, views.lookupForm(ctx, {
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
      return send(res, 200, views.lookupResult(ctx, data));
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

  /* -------------------------------------------------------------- 공개 목록 */

  async function consultations(req, res, ip, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const { page, q } = parseListQuery(url.searchParams);
    const data = await nuri.listConsultations(page, q, ip);
    send(res, 200, views.consultationList(ctx, data || {}, q));
  }

  async function consultation(req, res, ip, id) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    try {
      const data = await nuri.getConsultation(id, ip);
      send(res, 200, views.consultationDetail(ctx, data || {}));
    } catch (e) {
      if (e instanceof NuriApiError && (e.status === 404 || e.code === 'not_found')) return notFound(res);
      throw e;
    }
  }

  async function dispositions(req, res, ip, url) {
    if (!limiters.read.take(ip)) return tooMany(res, limiters.read, ip);
    const { page, q } = parseListQuery(url.searchParams);
    const data = await nuri.listDispositions(page, q, ip);
    send(res, 200, views.dispositionList(ctx, data || {}, q));
  }

  /* -------------------------------------------------------------- 정적 파일 */

  function serveStatic(res, entry) {
    let body = staticCache.get(entry);
    if (!body) {
      body = entry.body !== undefined ? Buffer.from(entry.body) : fs.readFileSync(entry.file);
      staticCache.set(entry, body);
    }
    res.setHeader('Content-Type', entry.type);
    res.end(body);
  }

  /* -------------------------------------------------------------- 라우터 */

  async function route(req, res) {
    setSecurityHeaders(res);
    const ip = clientIp(req, config.trustProxy);
    if (!limiters.global.take(ip)) return tooMany(res, limiters.global, ip);

    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return notFound(res); }
    const p = url.pathname;
    const m = req.method;

    if (m === 'GET' || m === 'HEAD') {
      if (p === '/') return send(res, 200, views.home(ctx));
      if (p === '/healthz') { res.setHeader('Content-Type', 'text/plain'); return res.end('ok'); }
      if (STATIC[p]) return serveStatic(res, STATIC[p]);
      if (p === '/complaints/new') return showComplaintForm(req, res);
      if (p === '/lookup') return showLookupForm(req, res);
      if (p === '/consultations') return consultations(req, res, ip, url);
      let mm = /^\/consultations\/(\d{1,18})$/.exec(p);
      if (mm) return consultation(req, res, ip, mm[1]);
      if (p === '/dispositions') return dispositions(req, res, ip, url);
      mm = /^\/captcha\/([0-9a-f]{32})\.svg$/.exec(p);
      if (mm) {
        if (!limiters.captcha.take(ip)) return tooMany(res, limiters.captcha, ip);
        const svg = captchas.svg(mm[1]);
        if (!svg) return notFound(res);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        return res.end(svg);
      }
      return notFound(res);
    }

    if (m === 'POST') {
      if (p === '/complaints') return submitComplaint(req, res, ip);
      if (p === '/lookup') return lookup(req, res, ip);
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
  };
  handler.captchas = captchas;
  return handler;
}

module.exports = { createApp };
