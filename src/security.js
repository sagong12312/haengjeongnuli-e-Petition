'use strict';
/**
 * 국민 화면 보안 (규격 6): 보안 헤더, CSRF, IP별 요청 횟수 제한, 자동입력 방지.
 */
const crypto = require('node:crypto');

/* ------------------------------------------------------------------ 보안 헤더 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/** 이 요청이 암호화된 연결(HTTPS)로 왔는지. 앞단 프록시를 믿기로 했으면 그 프록시가 붙인 X-Forwarded-Proto 를 본다 */
function isSecure(req, trustProxy) {
  if (req.socket && req.socket.encrypted) return true;
  if (trustProxy) {
    const xfp = String(req.headers['x-forwarded-proto'] || '').split(',').pop().trim().toLowerCase();
    return xfp === 'https';
  }
  return false;
}

/** 같은 PC 안에서 온 연결인지 (프록시를 거치지 않은 소켓 주소로만 판단) */
function isLoopback(req) {
  const a = String((req.socket && req.socket.remoteAddress) || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function setSecurityHeaders(res, secure = true) {
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
}

/* ------------------------------------------------------------------ 국민 IP */

/**
 * trustProxy 가 true 이면 앞단 프록시가 붙인 X-Forwarded-For 의 가장 오른쪽 값
 * (= 우리 프록시가 직접 본 주소)을 씁니다. 왼쪽 값은 국민이 마음대로 넣을 수 있어 쓰지 않습니다.
 */
function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && /^[0-9a-fA-F:.]{2,45}$/.test(last)) return last;
    }
  }
  const ra = req.socket.remoteAddress || '';
  return ra.startsWith('::ffff:') ? ra.slice(7) : ra;
}

/* ------------------------------------------------------------------ 요청 횟수 제한 */

class RateLimiter {
  /** @param {{limit:number, windowMs:number}} opts */
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.sweep(), Math.min(windowMs, 60000));
    this.timer.unref();
  }

  /** 허용되면 true. 허용되지 않으면 false */
  take(key, now = Date.now()) {
    let e = this.hits.get(key);
    if (!e || now >= e.reset) {
      e = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, e);
    }
    e.count += 1;
    return e.count <= this.limit;
  }

  retryAfterSec(key, now = Date.now()) {
    const e = this.hits.get(key);
    return e ? Math.max(1, Math.ceil((e.reset - now) / 1000)) : 1;
  }

  sweep(now = Date.now()) {
    for (const [k, e] of this.hits) if (now >= e.reset) this.hits.delete(k);
  }

  stop() { clearInterval(this.timer); }
}

/* ------------------------------------------------------------------ 쿠키 / CSRF */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

const CSRF_COOKIE = 'ep_csrf';

/**
 * 이중 제출 쿠키 방식. 쿠키(HttpOnly, SameSite=Strict)와 양식 숨김 값이 같아야 통과합니다.
 * 서버에 세션을 두지 않으므로 개인정보를 이 서버에 오래 남기지 않습니다.
 */
function csrfToken(req, res, cookieSecure) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[CSRF_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    token = crypto.randomBytes(32).toString('base64url');
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Strict'];
    if (cookieSecure) attrs.push('Secure');
    appendHeader(res, 'Set-Cookie', `${CSRF_COOKIE}=${token}; ${attrs.join('; ')}`);
  }
  return token;
}

function verifyCsrf(req, formToken) {
  const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  if (!cookie || typeof formToken !== 'string' || cookie.length !== formToken.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(formToken))) return false;
  // 브라우저가 Origin 을 보냈다면 같은 호스트여야 합니다.
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch { return false; }
  }
  return true;
}

function appendHeader(res, name, value) {
  const prev = res.getHeader(name);
  if (!prev) res.setHeader(name, value);
  else res.setHeader(name, Array.isArray(prev) ? [...prev, value] : [prev, value]);
}

/* ------------------------------------------------------------------ 자동입력 방지 */

/*
 * 기본 제공 CAPTCHA: 숫자 5자리를 선분으로 그린 SVG (글자를 <text> 로 넣지 않음).
 * 한 번 쓰면 버리고 5분 뒤 만료됩니다. 서버 여러 대로 돌릴 때는 공용 저장소로 바꾸거나
 * 기관에서 쓰는 CAPTCHA(음성 안내 포함, 웹 접근성 기준 충족)로 교체하세요. createApp 의 captcha 옵션으로 바꿀 수 있습니다.
 */

// 7-세그먼트 좌표 (가로 0~10, 세로 0~20)
const SEG = {
  a: [[1, 0], [9, 0]], b: [[10, 1], [10, 9]], c: [[10, 11], [10, 19]], d: [[1, 20], [9, 20]],
  e: [[0, 11], [0, 19]], f: [[0, 1], [0, 9]], g: [[1, 10], [9, 10]],
};
const DIGIT_SEGS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];

function rnd(min, max) { return min + crypto.randomInt(0, 10000) / 10000 * (max - min); }

function renderCaptchaSvg(text) {
  const W = 200, H = 64;
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(`<path d="M${rnd(0, W).toFixed(1)} ${rnd(0, H).toFixed(1)} Q${rnd(0, W).toFixed(1)} ${rnd(0, H).toFixed(1)} ${rnd(0, W).toFixed(1)} ${rnd(0, H).toFixed(1)}" stroke="#8a94a6" stroke-width="${rnd(0.8, 1.8).toFixed(1)}" fill="none"/>`);
  }
  [...text].forEach((ch, i) => {
    const segs = DIGIT_SEGS[Number(ch)];
    const x0 = 18 + i * 34 + rnd(-3, 3), y0 = 14 + rnd(-4, 4);
    const sx = rnd(1.5, 1.9), sy = rnd(1.5, 1.8), rot = rnd(-14, 14), skew = rnd(-10, 10);
    let d = '';
    for (const s of segs) {
      const [[x1, y1], [x2, y2]] = SEG[s];
      d += `M${(x1 + rnd(-0.6, 0.6)).toFixed(2)} ${(y1 + rnd(-0.6, 0.6)).toFixed(2)}L${(x2 + rnd(-0.6, 0.6)).toFixed(2)} ${(y2 + rnd(-0.6, 0.6)).toFixed(2)}`;
    }
    parts.push(`<path transform="translate(${x0.toFixed(1)} ${y0.toFixed(1)}) rotate(${rot.toFixed(1)} 5 10) skewX(${skew.toFixed(1)}) scale(${sx.toFixed(2)} ${sy.toFixed(2)})" d="${d}" stroke="#1d2b4f" stroke-width="${rnd(1.4, 2).toFixed(2)}" stroke-linecap="round" fill="none"/>`);
  });
  for (let i = 0; i < 40; i++) {
    parts.push(`<circle cx="${rnd(0, W).toFixed(1)}" cy="${rnd(0, H).toFixed(1)}" r="${rnd(0.5, 1.6).toFixed(1)}" fill="#5b6478"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#eef1f6"/>${parts.join('')}</svg>`;
}

class CaptchaStore {
  constructor({ ttlMs = 5 * 60 * 1000, max = 20000 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.items = new Map();
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref();
  }

  create(now = Date.now()) {
    if (this.items.size >= this.max) this.items.delete(this.items.keys().next().value);
    const id = crypto.randomBytes(16).toString('hex');
    const answer = Array.from({ length: 5 }, () => crypto.randomInt(0, 10)).join('');
    this.items.set(id, { answer, exp: now + this.ttlMs });
    return id;
  }

  svg(id, now = Date.now()) {
    const e = this.items.get(id);
    if (!e || now > e.exp) return null;
    return renderCaptchaSvg(e.answer);
  }

  /** 한 번만 확인할 수 있습니다 (맞든 틀리든 버림) */
  verify(id, answer, now = Date.now()) {
    if (typeof id !== 'string' || typeof answer !== 'string') return false;
    const e = this.items.get(id);
    if (!e) return false;
    this.items.delete(id);
    if (now > e.exp) return false;
    const a = answer.replace(/\s+/g, '');
    return a.length === e.answer.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(e.answer));
  }

  /** 테스트용 */
  peek(id) { return this.items.get(id)?.answer; }

  sweep(now = Date.now()) {
    for (const [k, e] of this.items) if (now > e.exp) this.items.delete(k);
  }

  stop() { clearInterval(this.timer); }
}

module.exports = {
  setSecurityHeaders, isSecure, isLoopback, clientIp, RateLimiter, parseCookies, csrfToken, verifyCsrf, CaptchaStore, renderCaptchaSvg,
};
