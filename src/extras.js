'use strict';
/**
 * 도움말·안내 화면과 구독(RSS)·사이트맵.
 *  /help                 도움말 모음
 *  /help/which           어떤 민원으로 신청할지 고르는 도우미
 *  /help/deadline        처리기한 계산기 (주말을 빼고 대략 셈, 정확한 기한은 접수 때 행정누리가 정함)
 *  /help/process         민원 처리 절차
 *  /help/glossary        민원 용어 풀이
 *  /help/checklist       신청 전 확인할 것
 *  /contact              찾아오는 길·운영 시간·전화
 *  /sitemap              전체 메뉴
 *  /en                   English guide
 *  /easy                 쉬운 말 안내
 *  /notices.xml, /consultations.xml  새 글 받아 보기 (RSS 2.0)
 *  /sitemap.xml          검색엔진용 주소 목록
 * 바깥에서 온 값은 모두 esc() 로 글자로만 씁니다.
 */
const { esc, layout } = require('./views');
const { KINDS, CATEGORIES } = require('./validation');

/** 처리기간 글("7일", "14일", "즉시")에서 일수. 즉시면 0 */
function periodDays(period) {
  const m = /(\d{1,3})\s*일/.exec(String(period || ''));
  return m ? Number(m[1]) : 0;
}

/** 오늘부터 근무일(토·일 제외) n일째 되는 날. 공휴일은 모르므로 화면에 '대략'이라고 알린다 */
function addWorkingDays(from, n) {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d;
}

function ymd(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function helpHub(ctx) {
  return layout(ctx, '도움말', `
<h1>도움말</h1>
<div class="cards">
  <a class="card" href="/help/which"><h2>어떤 민원으로 신청하나요?</h2><p>질문 몇 개로 알맞은 민원 종류를 찾아 드립니다.</p></a>
  <a class="card" href="/help/deadline"><h2>처리기한 계산기</h2><p>오늘 신청하면 언제쯤 답을 받는지 봅니다.</p></a>
  <a class="card" href="/help/process"><h2>처리 절차</h2><p>접수부터 결과 통지까지 순서를 봅니다.</p></a>
  <a class="card" href="/help/checklist"><h2>신청 전 확인</h2><p>빠뜨리기 쉬운 것을 미리 확인합니다.</p></a>
  <a class="card" href="/help/glossary"><h2>용어 풀이</h2><p>민원에서 쓰는 말을 쉽게 풀었습니다.</p></a>
  <a class="card" href="/contact"><h2>찾아오는 길·문의</h2><p>기관 주소, 운영 시간, 전화번호입니다.</p></a>
  <a class="card" href="/easy"><h2>쉬운 말 안내</h2><p>전자민원을 쉬운 말로 설명합니다.</p></a>
  <a class="card" href="/en"><h2>English</h2><p>A short guide in English.</p></a>
</div>`, 'help');
}

/** 어떤 민원 종류인지: 질문에 답하면(GET 으로) 추천을 보여 준다. 스크립트 없이도 된다 */
function whichPage(ctx, q) {
  const asks = [
    ['fee', '구비서류를 내거나 수수료를 내야 하는 일인가요? (예: 등본, 인감, 허가 신청)'],
    ['ask', '법령·제도·절차가 궁금해서 묻는 것인가요?'],
    ['suggest', '행정 제도나 운영을 이렇게 바꾸면 좋겠다는 제안인가요?'],
    ['wrong', '행정기관의 처분·불친절·부당한 일로 권리가 침해되었거나 불편을 겪었나요?'],
  ];
  let result = '';
  if (q.fee === 'yes') {
    result = `<div class="alert alert-warn" role="status"><p><strong>법정민원</strong>입니다. 이곳에서는 받지 않습니다. <a href="https://www.gov.kr" rel="noopener noreferrer">정부24</a>나 기관 민원 창구에서 신청해 주세요.</p></div>`;
  } else if (q.fee === 'no') {
    const kind = q.wrong === 'yes' ? 'GRIEVANCE' : q.ask === 'yes' ? 'QUERY' : q.suggest === 'yes' ? 'SUGGESTION' : 'OTHER';
    result = `<div class="alert alert-ok" role="status"><p><strong>${esc(KINDS[kind])}</strong>으로 신청하시면 됩니다.</p>
<p><a class="btn primary" href="/complaints/new?kind=${kind}">${esc(KINDS[kind])} 신청하기</a></p></div>`;
  }
  const radios = (name, label) => `<fieldset class="ask"><legend>${esc(label)}</legend>
  <label class="radio"><input type="radio" name="${name}" value="yes"${q[name] === 'yes' ? ' checked' : ''}> 예</label>
  <label class="radio"><input type="radio" name="${name}" value="no"${q[name] === 'no' ? ' checked' : ''}> 아니요</label></fieldset>`;
  return layout(ctx, '어떤 민원으로 신청하나요?', `
<p><a href="/help">← 도움말</a></p>
<h1>어떤 민원으로 신청하나요?</h1>
${result}
<form method="get" action="/help/which">
${asks.map(([n, l]) => radios(n, l)).join('')}
<div class="actions"><button type="submit" class="btn primary">알아보기</button></div>
</form>`, 'help');
}

function deadlinePage(ctx, info, kind, now = new Date()) {
  const kinds = (Array.isArray(info && info.kinds) ? info.kinds : []).filter((k) => k.online !== false);
  const pick = kinds.find((k) => k.kind === kind);
  let result = '';
  if (pick) {
    const days = periodDays(pick.period);
    const due = days ? addWorkingDays(now, days) : now;
    result = `<div class="alert alert-ok" role="status"><p><strong>${esc(pick.label)}</strong> 처리기간은 <strong>${esc(pick.period)}</strong>입니다.</p>
<p>오늘(${ymd(now)}) 신청하면 대략 <strong>${ymd(due)} (${WEEK[due.getDay()]})</strong>까지 답을 받습니다.</p>
<p class="hint">토·일요일만 빼고 센 대략의 날짜입니다. 공휴일·근무시간 밖 접수·보완 요청·연장이 있으면 늦어질 수 있고, 정확한 처리기한은 접수할 때 알려 드립니다.</p></div>`;
  }
  return layout(ctx, '처리기한 계산기', `
<p><a href="/help">← 도움말</a></p>
<h1>처리기한 계산기</h1>
${result}
<form method="get" action="/help/deadline">
<div class="field"><label for="dk">민원 종류</label>
<select id="dk" name="kind" required><option value="">골라 주세요</option>
${kinds.map((k) => `<option value="${esc(k.kind)}"${k.kind === kind ? ' selected' : ''}>${esc(k.label)} (${esc(k.period)})</option>`).join('')}
</select></div>
<div class="actions"><button type="submit" class="btn primary">계산</button></div>
</form>`, 'help');
}

function processPage(ctx) {
  const steps = [
    ['신청', '전자민원에서 민원을 적어 보냅니다. 접수번호와 처리기한이 바로 나옵니다.'],
    ['접수', '기관 민원 창구에서 접수를 확인하고 담당 부서를 정합니다.'],
    ['배정', '담당 부서의 담당자가 정해집니다. 처리상황 조회에서 담당 부서를 볼 수 있습니다.'],
    ['처리', '담당자가 내용을 검토하고 필요하면 현장 확인·관계 부서 협의를 합니다. 보완이 필요하면 연락드립니다.'],
    ['연장(필요할 때)', '부득이하게 처리기간을 늘려야 하면 그 이유와 새 기한을 알려 드립니다.'],
    ['결과 통지', '처리 결과를 고르신 방법(문자·이메일·우편 등)으로 알려 드립니다. 전자민원에서도 볼 수 있습니다.'],
    ['만족도·이의', '결과에 대한 만족도를 남길 수 있습니다. 거부 결정에는 이의 신청·행정심판 등 구제 절차가 함께 안내됩니다.'],
  ];
  return layout(ctx, '처리 절차', `
<p><a href="/help">← 도움말</a></p>
<h1>민원 처리 절차</h1>
<ol class="process">${steps.map(([t, d]) => `<li><strong>${esc(t)}</strong><p>${esc(d)}</p></li>`).join('')}</ol>
<p><a class="btn primary" href="/complaints/new">민원 신청하기</a> <a class="btn" href="/lookup">처리상황 조회</a></p>`, 'help');
}

const GLOSSARY = [
  ['민원', '행정기관에 특정한 행위를 요구하는 것. 이 누리집에서는 질의·건의·고충·기타 민원을 받습니다.'],
  ['법정민원', '법령에서 정한 서류를 내고 허가·등록·증명 등을 받는 민원. 구비서류와 수수료가 있습니다.'],
  ['질의민원', '법령·제도·절차를 묻는 민원.'],
  ['건의민원', '행정 제도나 운영을 개선해 달라고 제안하는 민원.'],
  ['고충민원', '행정기관의 처분이나 불합리한 제도 때문에 권리가 침해되거나 불편을 겪어 해결을 구하는 민원.'],
  ['기타민원', '단순한 행정 절차·형식 요건을 묻거나 불편 사항을 알리는 민원.'],
  ['접수번호', '민원을 접수하면 받는 번호(예: 2026-000123). 처리상황을 볼 때 씁니다.'],
  ['처리기한', '민원을 처리해야 하는 마지막 날. 근무일·근무시간 기준으로 셉니다.'],
  ['보완', '민원 내용이 모자라거나 분명하지 않을 때 더 알려 달라고 요청하는 것.'],
  ['이송', '다른 기관이 처리할 민원을 그 기관으로 보내는 것.'],
  ['취하', '민원인이 낸 민원을 거둬들이는 것. 처리 완료 전까지만 할 수 있습니다.'],
  ['공개 상담', '민원인이 공개에 동의한 민원과 처리 결과를 다른 사람도 볼 수 있게 올린 것. 이름은 가려집니다.'],
  ['행정심판', '행정기관의 위법·부당한 처분에 대해 행정심판위원회에 다시 판단해 달라고 청구하는 절차.'],
];

function glossaryPage(ctx) {
  return layout(ctx, '용어 풀이', `
<p><a href="/help">← 도움말</a></p>
<h1>민원 용어 풀이</h1>
<dl class="glossary">${GLOSSARY.map(([t, d]) => `<dt id="g-${esc(t)}">${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`, 'help');
}

function checklistPage(ctx) {
  const items = [
    '구비서류·수수료가 있는 법정민원이 아닌지 (법정민원은 정부24·창구에서)',
    '같은 내용으로 이미 낸 민원이 없는지 (처리상황 조회·내 민원에서 확인)',
    '비슷한 공개 상담에 이미 답이 있는지',
    '언제·어디서·무엇이 문제인지 구체적으로 적었는지 (주소·장소를 정확히)',
    '처리 결과를 받을 연락처(휴대전화·이메일)가 맞는지',
    '주민등록번호·계좌번호 등 필요 없는 개인정보를 적지 않았는지',
    '사진·서류는 3개까지, 하나에 5MB까지인지',
    '조회 비밀번호를 적어 두었는지 (잊으면 인터넷으로 조회할 수 없음)',
  ];
  return layout(ctx, '신청 전 확인', `
<p><a href="/help">← 도움말</a></p>
<h1>신청 전 확인할 것</h1>
<ul class="checklist">${items.map((t, i) => `<li><label class="check"><input type="checkbox" id="ck${i}"> ${esc(t)}</label></li>`).join('')}</ul>
<p class="hint">체크는 이 화면에서만 쓰며 저장하지 않습니다.</p>
<p><a class="btn primary" href="/complaints/new">민원 신청하기</a></p>`, 'help');
}

function contactPage(ctx) {
  const tel = String(ctx.orgContact || '').match(/0\d{1,2}-?\d{3,4}-?\d{4}|1\d{3}-?\d{4}/);
  return layout(ctx, '찾아오는 길·문의', `
<p><a href="/help">← 도움말</a></p>
<h1>찾아오는 길·문의</h1>
<dl class="meta">
  <dt>기관</dt><dd>${esc(ctx.orgName)}</dd>
  <dt>문의</dt><dd>${esc(ctx.orgContact)}${tel ? ` <a class="btn small" href="tel:${esc(tel[0].replace(/-/g, ''))}">전화 걸기</a>` : ''}</dd>
  ${ctx.orgAddress ? `<dt>주소</dt><dd>${esc(ctx.orgAddress)}</dd>` : ''}
  <dt>민원실 운영 시간</dt><dd>${esc(ctx.orgHours || '평일 09:00~18:00 (토·일·공휴일 쉼)')}</dd>
</dl>
<p class="hint">전자민원은 언제든 신청할 수 있지만, 근무시간 밖에 신청한 민원은 다음 근무일부터 처리기간을 셉니다.</p>`, 'help');
}

function sitemapPage(ctx) {
  const groups = [
    ['민원', [['/complaints/new', '민원 신청'], ['/lookup', '처리상황 조회'], ['/consultations', '공개 상담'], ['/dispositions', '행정처분 공개']]],
    ['알림·안내', [['/notices', '공지사항'], ['/faq', '자주 묻는 질문'], ['/guide', '민원 안내'], ['/stats', '처리 통계'], ['/security-programs', '보안 프로그램']]],
    ['도움말', [['/help', '도움말 모음'], ['/help/which', '민원 종류 찾기'], ['/help/deadline', '처리기한 계산기'], ['/help/process', '처리 절차'],
      ['/help/checklist', '신청 전 확인'], ['/help/glossary', '용어 풀이'], ['/contact', '찾아오는 길·문의'], ['/easy', '쉬운 말 안내'], ['/en', 'English']]],
    ['회원', [['/login', '로그인'], ['/signup', '회원가입'], ['/my', '내 민원'], ['/my/profile', '내 정보']]],
    ['정책', [['/terms', '이용약관'], ['/privacy', '개인정보 처리방침']]],
  ];
  return layout(ctx, '전체 메뉴', `
<h1>전체 메뉴</h1>
<div class="sitemap">${groups.map(([g, links]) => `<section><h2>${esc(g)}</h2><ul>${links.map(([h, t]) => `<li><a href="${h}">${esc(t)}</a></li>`).join('')}</ul></section>`).join('')}</div>`);
}

function englishPage(ctx) {
  return layout(ctx, 'English guide', `
<div lang="en">
<h1>e-Petition: a short guide in English</h1>
<p>You can file a civil petition (question, suggestion, grievance or other request) to ${esc(ctx.orgName)} online, any time.</p>
<ol>
  <li><a href="/complaints/new">File a petition</a>: choose the type, write your name, contact and the details. You will get a receipt number.</li>
  <li><a href="/lookup">Check the status</a> with your receipt number and the password you set.</li>
  <li>The answer is sent by text message, e-mail or post, as you chose.</li>
</ol>
<p>Applications that need documents or fees (certificates, permits) are not accepted here. Please use <a href="https://www.gov.kr" rel="noopener noreferrer">Gov24</a> or visit the office.</p>
<p>Questions: ${esc(ctx.orgContact)}. You may write your petition in English; it may take longer to answer.</p>
</div>`, 'help');
}

function easyPage(ctx) {
  return layout(ctx, '쉬운 말 안내', `
<p><a href="/help">← 도움말</a></p>
<h1>쉬운 말 안내</h1>
<div class="easy">
<p>전자민원은 <strong>기관에 하고 싶은 말을 인터넷으로 보내는 곳</strong>입니다.</p>
<p>궁금한 것, 바라는 것, 불편한 것을 적어 보내면 기관이 읽고 답을 줍니다.</p>
<h2>1. 보내기</h2>
<p><a href="/complaints/new">민원 신청</a>을 누르고 이름, 전화번호, 하고 싶은 말을 적습니다.</p>
<p>비밀번호를 정합니다. <strong>비밀번호는 꼭 적어 두세요.</strong></p>
<h2>2. 번호 받기</h2>
<p>보내면 <strong>접수번호</strong>가 나옵니다. 이 번호도 적어 두세요.</p>
<h2>3. 답 보기</h2>
<p>며칠 뒤 문자나 이메일로 답이 옵니다. <a href="/lookup">처리상황 조회</a>에서 번호와 비밀번호를 넣어도 볼 수 있습니다.</p>
<h2>어려우면</h2>
<p>${esc(ctx.orgContact)}로 전화하세요.</p>
</div>`, 'help');
}

/* ------------------------------------------------------------------ RSS · 사이트맵 */

function xmlEsc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function rfc822(v) {
  const t = Date.parse(String(v || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v || '')) ? '' : '+09:00'));
  return Number.isFinite(t) ? new Date(t).toUTCString() : new Date().toUTCString();
}

function rss({ title, link, description, items }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${xmlEsc(title)}</title><link>${xmlEsc(link)}</link><description>${xmlEsc(description)}</description><language>ko</language>
${items.map((i) => `<item><title>${xmlEsc(i.title)}</title><link>${xmlEsc(i.link)}</link><guid isPermaLink="true">${xmlEsc(i.link)}</guid><pubDate>${rfc822(i.date)}</pubDate></item>`).join('\n')}
</channel></rss>`;
}

function sitemapXml(base) {
  const paths = ['/', '/complaints/new', '/lookup', '/consultations', '/dispositions', '/notices', '/faq', '/guide', '/stats', '/help',
    '/help/which', '/help/deadline', '/help/process', '/help/checklist', '/help/glossary', '/contact', '/easy', '/en', '/sitemap', '/terms', '/privacy'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `<url><loc>${xmlEsc(base + p)}</loc></url>`).join('\n')}
</urlset>`;
}

/** 요청의 Host 로 절대 주소의 앞부분 (글자를 좁게 확인) */
function baseOf(req, secure) {
  const host = String(req.headers.host || '');
  return (secure ? 'https://' : 'http://') + (/^[A-Za-z0-9.\-[\]:]{1,255}$/.test(host) ? host : 'localhost');
}

function createExtras({ nuri, send, ctxOf, logger = console, isSecure }) {
  function xml(res, body, type = 'application/rss+xml') {
    res.statusCode = 200;
    res.setHeader('Content-Type', `${type}; charset=utf-8`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.removeHeader('Pragma');
    res.end(body);
  }

  /** GET 만. 처리했으면 true */
  async function get(req, res, ip, url) {
    const p = url.pathname;
    const ctx = ctxOf(req);
    const q = Object.fromEntries([...url.searchParams].map(([k, v]) => [k, String(v).slice(0, 20)]));
    if (p === '/help') return (send(res, 200, helpHub(ctx)), true);
    if (p === '/help/which') return (send(res, 200, whichPage(ctx, q)), true);
    if (p === '/help/process') return (send(res, 200, processPage(ctx)), true);
    if (p === '/help/glossary') return (send(res, 200, glossaryPage(ctx)), true);
    if (p === '/help/checklist') return (send(res, 200, checklistPage(ctx)), true);
    if (p === '/contact') return (send(res, 200, contactPage(ctx)), true);
    if (p === '/sitemap') return (send(res, 200, sitemapPage(ctx)), true);
    if (p === '/en') return (send(res, 200, englishPage(ctx)), true);
    if (p === '/easy') return (send(res, 200, easyPage(ctx)), true);
    if (p === '/help/deadline') {
      let info = null;
      try { info = await nuri.info(ip); } catch (e) { logger.warn?.(`[help] 민원 안내를 가져오지 못했습니다: ${e.code || e.message}`); }
      const kind = /^(QUERY|SUGGESTION|GRIEVANCE|OTHER)$/.test(q.kind || '') ? q.kind : '';
      return (send(res, 200, deadlinePage(ctx, info, kind)), true);
    }
    const base = baseOf(req, isSecure(req));
    if (p === '/notices.xml') {
      const d = await nuri.listNotices(1, '', ip).catch(() => null);
      const items = (d && Array.isArray(d.items) ? d.items : []).slice(0, 20)
        .map((n) => ({ title: n.title, link: `${base}/notices/${encodeURIComponent(String(n.id))}`, date: n.createdAt }));
      return (xml(res, rss({ title: `${ctx.orgName} 전자민원 공지사항`, link: `${base}/notices`, description: '공지사항 새 글', items })), true);
    }
    if (p === '/consultations.xml') {
      const d = await nuri.listConsultations(1, '', ip).catch(() => null);
      const items = (d && Array.isArray(d.items) ? d.items : []).slice(0, 20)
        .map((c) => ({ title: c.title, link: `${base}/consultations/${encodeURIComponent(String(c.id))}`, date: c.completedAt || c.receivedAt }));
      return (xml(res, rss({ title: `${ctx.orgName} 전자민원 공개 상담`, link: `${base}/consultations`, description: '공개 상담 새 글', items })), true);
    }
    if (p === '/sitemap.xml') return (xml(res, sitemapXml(base), 'application/xml'), true);
    return false;
  }

  return { get };
}

module.exports = { createExtras, periodDays, addWorkingDays, ymd, rss, sitemapXml, GLOSSARY, CATEGORIES };
