'use strict';
/**
 * 회원 로그인 세션 (서버 메모리).
 * - 쿠키에는 무작위 세션 번호만 넣고(HttpOnly, SameSite=Lax), 회원 번호·이름은 서버 메모리에만 둡니다.
 * - 30분 동안 아무것도 안 하면, 또는 로그인하고 8시간이 지나면 로그아웃됩니다.
 * - 서버를 다시 켜면 모두 로그아웃됩니다 (여러 대로 운영하면 앞단에서 한 대로 고정하세요).
 */
const crypto = require('node:crypto');
const { parseCookies } = require('./security');

const COOKIE = 'ep_sid';

class SessionStore {
  constructor({ idleMs = 30 * 60_000, maxMs = 8 * 3600_000, cookieSecure = true, now = () => Date.now() } = {}) {
    this.idleMs = idleMs;
    this.maxMs = maxMs;
    this.cookieSecure = cookieSecure;
    this.now = now;
    this.sessions = new Map();
    this.timer = setInterval(() => this.sweep(), 60_000);
    this.timer.unref();
  }

  sweep() {
    const t = this.now();
    for (const [k, s] of this.sessions) if (this.expired(s, t)) this.sessions.delete(k);
  }

  expired(s, t) {
    return t - s.lastSeen > this.idleMs || t - s.created > this.maxMs;
  }

  cookie(value, maxAgeSec) {
    const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (this.cookieSecure) attrs.push('Secure');
    if (maxAgeSec !== undefined) attrs.push(`Max-Age=${maxAgeSec}`);
    return `${COOKIE}=${value}; ${attrs.join('; ')}`;
  }

  /** 로그인: 예전 세션은 버리고 새 번호를 준다 (세션 고정 공격 막기) */
  create(req, res, data) {
    this.destroy(req, res, false);
    if (this.sessions.size > 100_000) this.sweep();
    const id = crypto.randomBytes(32).toString('base64url');
    const t = this.now();
    this.sessions.set(id, { ...data, created: t, lastSeen: t });
    appendSetCookie(res, this.cookie(id));
    return id;
  }

  /** 지금 로그인한 회원 (없으면 null) */
  get(req) {
    const id = parseCookies(req.headers.cookie)[COOKIE];
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    const t = this.now();
    if (this.expired(s, t)) { this.sessions.delete(id); return null; }
    s.lastSeen = t;
    return s;
  }

  destroy(req, res, clearCookie = true) {
    const id = parseCookies(req.headers.cookie)[COOKIE];
    if (id) this.sessions.delete(id);
    if (clearCookie) appendSetCookie(res, this.cookie('', 0));
  }

  close() { clearInterval(this.timer); }
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) res.setHeader('Set-Cookie', value);
  else res.setHeader('Set-Cookie', Array.isArray(prev) ? [...prev, value] : [prev, value]);
}

module.exports = { SessionStore, SESSION_COOKIE: COOKIE };
