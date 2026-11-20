'use strict';
/**
 * 민원인 PC 보안 프로그램 (행정누리 관리자가 정함).
 *  - 강제: 설치하지 않으면 전자민원을 쓰지 못하고 설치 안내 화면으로 간다.
 *  - 권고: 안내만 한다.
 * 웹 화면은 PC 에 무엇이 깔렸는지 직접 알 수 없다. 프로그램에 '설치 확인 주소'(이 PC 의 127.0.0.1)가 있으면
 * 브라우저가 그 주소에 응답이 오는지 본 뒤에만 확인을 보내고, 없으면 민원인의 확인을 받는다.
 * 확인한 항목은 쿠키(id.판)로 기억한다. 관리자가 새 판으로 올리면 다시 확인해야 한다.
 */
const { esc, layout } = require('./views');

const COOKIE = 'ep_sa';
const CACHE_MS = 60_000;

/** 브라우저가 물어볼 수 있는 설치 확인 주소: 이 PC 주소만 */
function safeCheckUrl(u) {
  if (typeof u !== 'string' || u.length > 300) return false;
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) && (x.hostname === '127.0.0.1' || x.hostname === 'localhost') && !x.username && !x.password;
  } catch { return false; }
}

function safeHttpUrl(u) {
  if (typeof u !== 'string' || u.length > 500) return false;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !x.username && !x.password; } catch { return false; }
}

function parseAcked(v) {
  const out = new Set();
  for (const part of String(v || '').split('-').slice(0, 50)) {
    if (/^\d{1,18}\.\d{1,9}$/.test(part)) out.add(part);
  }
  return out;
}

function createSecApps({ nuri, logger = console }) {
  let cache = { at: 0, items: [] };
  let loading = null;

  async function list(ip) {
    if (Date.now() - cache.at < CACHE_MS) return cache.items;
    if (!loading) {
      loading = (async () => {
        try {
          const data = await nuri.securityApps(ip);
          const items = (data && Array.isArray(data.items) ? data.items : []).map((a) => ({
            id: String(a.id), name: String(a.name || ''), purpose: String(a.purpose || ''), guide: a.guide ? String(a.guide) : '',
            url: safeHttpUrl(a.url) ? a.url : '', required: a.required === true, version: Number(a.version) || 1,
            checkUrl: safeCheckUrl(a.checkUrl) ? a.checkUrl : '',
          })).filter((a) => /^\d{1,18}$/.test(a.id));
          cache = { at: Date.now(), items };
        } catch (e) {
          // 행정누리에 닿지 않으면 마지막으로 받은 목록을 그대로 쓴다 (1분 뒤 다시 물음)
          logger.warn?.(`[secapps] 목록을 받지 못했습니다: ${e && e.message}`);
          cache = { at: Date.now(), items: cache.items };
        } finally {
          loading = null;
        }
      })();
    }
    await loading;
    return cache.items;
  }

  function acked(req, parseCookies) {
    return parseAcked(parseCookies(req.headers.cookie)[COOKIE]);
  }

  /** 아직 확인하지 않은 강제 항목 */
  async function missing(req, ip, parseCookies) {
    const items = await list(ip);
    if (!items.some((a) => a.required)) return [];
    const done = acked(req, parseCookies);
    return items.filter((a) => a.required && !done.has(`${a.id}.${a.version}`));
  }

  function setAck(req, res, parseCookies, item, cookieSecure) {
    const done = acked(req, parseCookies);
    for (const k of [...done]) if (k.startsWith(`${item.id}.`)) done.delete(k);
    done.add(`${item.id}.${item.version}`);
    const attrs = [`${COOKIE}=${[...done].join('-')}`, 'Path=/', 'Max-Age=2592000', 'HttpOnly', 'SameSite=Lax'];
    if (cookieSecure) attrs.push('Secure');
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), attrs.join('; ')]);
  }

  /** 설치 확인 주소의 출처 (이 화면의 connect-src 에만 더한다) */
  function checkOrigins(items) {
    return [...new Set(items.filter((a) => a.checkUrl).map((a) => new URL(a.checkUrl).origin))];
  }

  return { list, missing, acked, setAck, checkOrigins, forget() { cache.at = 0; } };
}

/** 휴대폰·태블릿 브라우저 (PC 용 보안 프로그램을 설치할 수 없는 기기) */
function isMobile(req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  return /Android|iPhone|iPad|iPod|Mobile|SamsungBrowser/i.test(ua);
}

/** 같은 사이트 안의 경로만 (다른 사이트로 넘기지 않게) */
function safeNext(v) {
  return typeof v === 'string' && /^\/[A-Za-z0-9/_\-.?=&%]*$/.test(v) && !v.startsWith('//') && v.length <= 200 && !v.startsWith('/security-programs')
    ? v : '/';
}

function page(ctx, { items, done, csrf, next, blocked, message }) {
  const card = (a) => {
    const ok = done.has(`${a.id}.${a.version}`);
    return `<section class="secapp">
  <h2>${esc(a.name)} ${a.required ? '<span class="badge st-new">강제</span>' : '<span class="badge">권고</span>'}
    ${ok ? '<span class="badge st-done">설치 확인</span>' : ''}</h2>
  <p>${esc(a.purpose)}</p>
  ${a.guide ? `<div class="text small">${esc(a.guide)}</div>` : ''}
  <div class="actions">
    ${a.url ? `<a class="btn" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">내려받기 (새 창)</a>` : ''}
    ${ok ? '' : `<form method="post" action="/security-programs" class="inline"${a.checkUrl ? ` data-check-url="${esc(a.checkUrl)}" data-check-name="${esc(a.name)}"` : ''}>
      <input type="hidden" name="_csrf" value="${esc(csrf)}"><input type="hidden" name="id" value="${esc(a.id)}">
      <input type="hidden" name="next" value="${esc(next)}">
      <button type="submit" class="btn primary">설치했습니다</button></form>`}
  </div>
</section>`;
  };
  return layout(ctx, '보안 프로그램 설치', `
<h1>보안 프로그램 설치</h1>
${message ? `<div class="alert alert-ok" role="status"><p>${esc(message)}</p></div>` : ''}
${blocked ? `<div class="alert alert-error" role="alert"><p><strong>강제</strong> 보안 프로그램을 설치해야 전자민원을 쓸 수 있습니다. 설치한 뒤 <strong>설치했습니다</strong>를 누르세요.</p></div>` : ''}
<p class="hint"><strong>강제</strong>: 설치하지 않으면 전자민원을 쓸 수 없습니다. <strong>권고</strong>: 설치를 권하지만 쓰는 데 지장은 없습니다.
설치가 어렵거나 휴대폰에서 설치할 수 없으면 기관(${esc(ctx.orgContact)})에 문의하시거나 창구에서 신청해 주세요.</p>
${items.length ? items.map(card).join('') : '<p class="empty">설치할 보안 프로그램이 없습니다.</p>'}
${!blocked && next !== '/' ? `<p><a class="btn primary" href="${esc(next)}">하던 일로 돌아가기</a></p>` : ''}`);
}

module.exports = { isMobile, createSecApps, page, safeNext, safeCheckUrl, parseAcked, COOKIE };
