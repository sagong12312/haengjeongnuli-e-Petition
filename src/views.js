'use strict';
/**
 * 화면 HTML. 민원 내용·처리 결과 등 바깥에서 온 값은 모두 esc() 로 글자로만 출력합니다 (XSS 방지, 규격 6).
 */
const { KINDS, NOTIFY_METHODS } = require('./validation');

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "2026-11-16T10:05" → "2026-11-16 10:05" */
function dt(v) {
  return v ? esc(String(v).replace('T', ' ')) : '-';
}

function layout(ctx, title, body, active = '') {
  const nav = [
    ['/complaints/new', '민원 신청', 'new'],
    ['/lookup', '처리상황 조회', 'lookup'],
    ['/consultations', '공개 상담', 'consult'],
    ['/dispositions', '행정처분 공개', 'disp'],
  ].map(([href, label, key]) =>
    `<li><a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(ctx.orgName)} 행정누리 전자민원</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<a class="skip" href="#main">본문 바로가기</a>
<header class="site">
  <div class="wrap">
    <a class="brand" href="/"><span class="org">${esc(ctx.orgName)}</span> 행정누리 전자민원</a>
    <nav aria-label="주 메뉴"><ul>${nav}</ul></nav>
  </div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="site">
  <div class="wrap">
    <p>${esc(ctx.orgName)} · 문의 ${esc(ctx.orgContact)}</p>
    <p>법정민원(구비서류·수수료가 있는 민원)은 <a href="https://www.gov.kr" rel="noopener noreferrer">정부24</a> 또는 기관 민원 창구에서 신청하세요.</p>
  </div>
</footer>
</body>
</html>`;
}

function fieldError(errors, key) {
  return errors && errors[key] ? `<p class="err" id="${key}-err">${esc(errors[key])}</p>` : '';
}

function aria(errors, key) {
  return errors && errors[key] ? ` aria-invalid="true" aria-describedby="${key}-err"` : '';
}

function errorSummary(errors, message) {
  const items = Object.values(errors || {});
  if (!items.length && !message) return '';
  return `<div class="alert alert-error" role="alert">
  <p><strong>${esc(message || '입력한 내용을 확인해 주세요.')}</strong></p>
  ${items.length ? `<ul>${items.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
</div>`;
}

function captchaField(captchaId, errors) {
  return `<div class="field captcha">
  <label for="captcha">자동입력 방지 <span class="req">(필수)</span></label>
  <p class="hint">그림에 보이는 숫자 5자리를 적어 주세요. 잘 안 보이면 <a href="?refresh=${Date.now()}">새 그림 받기</a>를 누르세요.</p>
  <img src="/captcha/${esc(captchaId)}.svg" alt="자동입력 방지 숫자 그림" width="200" height="64">
  <input type="hidden" name="captchaId" value="${esc(captchaId)}">
  <input id="captcha" name="captcha" inputmode="numeric" autocomplete="off" maxlength="5" required${aria(errors, 'captcha')}>
  ${fieldError(errors, 'captcha')}
</div>`;
}

/* ------------------------------------------------------------------ 첫 화면 */

function home(ctx) {
  return layout(ctx, '첫 화면', `
<section class="hero">
  <h1>${esc(ctx.orgName)} 행정누리 전자민원</h1>
  <p>질의·건의·고충·기타 민원을 인터넷으로 신청하고, 처리 상황을 확인할 수 있습니다.</p>
</section>
<div class="cards">
  <a class="card" href="/complaints/new"><h2>민원 신청</h2><p>질의·건의·고충·기타 민원을 글로 접수합니다.</p></a>
  <a class="card" href="/lookup"><h2>처리상황 조회</h2><p>접수번호와 조회 비밀번호로 처리 상황과 결과를 봅니다.</p></a>
  <a class="card" href="/consultations"><h2>공개 상담</h2><p>민원인이 공개에 동의한 처리 사례를 찾아봅니다.</p></a>
  <a class="card" href="/dispositions"><h2>행정처분 공개</h2><p>식품위생법·공중위생관리법 위반 업소 행정처분을 봅니다.</p></a>
</div>
<div class="notice">
  <h2>알아 두세요</h2>
  <ul>
    <li>구비서류나 수수료가 있는 <strong>법정민원</strong>은 이곳에서 받지 않습니다. <a href="https://www.gov.kr" rel="noopener noreferrer">정부24</a> 또는 기관 민원 창구를 이용해 주세요.</li>
    <li>지금은 <strong>글로만</strong> 접수합니다. 첨부할 서류가 있으면 기관에 문의해 주세요.</li>
    <li>처리기한은 민원 처리에 관한 법률 시행령 기준으로 행정누리가 근무시간·공휴일을 따져 정합니다.</li>
  </ul>
</div>`);
}

/* ------------------------------------------------------------------ 민원 신청 */

function complaintForm(ctx, { values = {}, errors = {}, message = '', csrf, captchaId }) {
  const v = values;
  const kindOpts = Object.entries(KINDS).map(([k, label]) =>
    `<label class="radio"><input type="radio" name="kind" value="${k}"${v.kind === k ? ' checked' : ''} required> ${label}</label>`).join('');
  const notifyOpts = ['<option value="">자동 (휴대전화가 있으면 문자, 없으면 이메일)</option>']
    .concat(NOTIFY_METHODS.map((m) => `<option value="${esc(m)}"${v.notifyMethod === m ? ' selected' : ''}>${esc(m)}</option>`)).join('');
  const input = (name, label, attrs = '', hint = '') => `<div class="field">
  <label for="${name}">${label}</label>
  ${hint ? `<p class="hint">${hint}</p>` : ''}
  <input id="${name}" name="${name}" value="${esc(v[name])}" ${attrs}${aria(errors, name)}>
  ${fieldError(errors, name)}
</div>`;

  return layout(ctx, '민원 신청', `
<h1>민원 신청</h1>
${errorSummary(errors, message)}
<form method="post" action="/complaints" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">

<fieldset>
  <legend>민원 종류 <span class="req">(필수)</span></legend>
  <div class="radios">${kindOpts}</div>
  ${fieldError(errors, 'kind')}
  <p class="hint">질의민원은 법령 해석을 묻는 경우 처리기간이 14일, 제도·절차를 묻는 경우 7일입니다.</p>
  <label class="check"><input type="checkbox" name="lawInterpretation" value="true"${v.lawInterpretation === 'true' ? ' checked' : ''}> (질의민원만) 법령 해석을 묻는 질의입니다</label>
  <p class="hint">구비서류·수수료가 있는 법정민원은 <a href="https://www.gov.kr" rel="noopener noreferrer">정부24</a>나 기관 민원 창구에서 신청해 주세요.</p>
</fieldset>

<fieldset>
  <legend>신청인</legend>
  ${input('name', '이름 <span class="req">(필수)</span>', 'maxlength="100" autocomplete="name" required')}
  ${input('mobile', '휴대전화', 'type="tel" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678"')}
  ${input('homePhone', '집 전화', 'type="tel" maxlength="20" inputmode="tel" placeholder="02-123-4567"', '휴대전화가 없으면 적어 주세요.')}
  ${input('email', '이메일', 'type="email" maxlength="200" autocomplete="email"')}
  ${input('address', '주소', 'maxlength="500" autocomplete="street-address"', '우편으로 통지받으려면 꼭 적어 주세요.')}
  ${input('fax', '팩스', 'type="tel" maxlength="20" inputmode="tel" placeholder="02-123-4567"', '팩스로 통지받으려면 지역번호부터 적어 주세요.')}
  <div class="field">
    <label for="notifyMethod">처리 결과 통지 방법</label>
    <select id="notifyMethod" name="notifyMethod"${aria(errors, 'notifyMethod')}>${notifyOpts}</select>
    ${fieldError(errors, 'notifyMethod')}
  </div>
</fieldset>

<fieldset>
  <legend>민원 내용</legend>
  ${input('title', '제목 <span class="req">(필수)</span>', 'maxlength="300" required')}
  <div class="field">
    <label for="content">내용 <span class="req">(필수)</span></label>
    <p class="hint">20,000자 이내. 주민등록번호 등 꼭 필요하지 않은 개인정보는 적지 마세요.</p>
    <textarea id="content" name="content" rows="12" maxlength="20000" required${aria(errors, 'content')}>${esc(v.content)}</textarea>
    ${fieldError(errors, 'content')}
  </div>
</fieldset>

<fieldset>
  <legend>처리상황 조회 비밀번호</legend>
  <p class="hint">영문과 숫자를 섞어 8~20자. 이 비밀번호는 전자민원에 저장하지 않으며, <strong>잊으면 인터넷으로 조회할 수 없습니다</strong>.</p>
  <div class="field">
    <label for="password">비밀번호 <span class="req">(필수)</span></label>
    <input id="password" name="password" type="password" minlength="8" maxlength="20" autocomplete="new-password" required${aria(errors, 'password')}>
    ${fieldError(errors, 'password')}
  </div>
  <div class="field">
    <label for="password2">비밀번호 확인 <span class="req">(필수)</span></label>
    <input id="password2" name="password2" type="password" minlength="8" maxlength="20" autocomplete="new-password" required${aria(errors, 'password2')}>
    ${fieldError(errors, 'password2')}
  </div>
</fieldset>

<fieldset>
  <legend>개인정보 수집·이용 동의 <span class="req">(필수)</span></legend>
  <table class="privacy">
    <caption>개인정보 수집·이용 안내 (개인정보 보호법 제15조)</caption>
    <tbody>
      <tr><th scope="row">수집 항목</th><td>필수: 이름, 민원 내용 / 선택: 휴대전화, 집 전화, 이메일, 주소, 팩스 (통지 방법에 따라 해당 항목은 필수)</td></tr>
      <tr><th scope="row">수집·이용 목적</th><td>민원 접수·처리, 처리 상황 및 결과 통지</td></tr>
      <tr><th scope="row">보유·이용 기간</th><td>${esc(ctx.privacyRetention)}</td></tr>
      <tr><th scope="row">동의를 거부할 권리와 불이익</th><td>동의를 거부할 수 있습니다. 다만 동의하지 않으면 인터넷으로 민원을 접수할 수 없으며, 기관 민원 창구·우편 등 다른 방법으로 신청하실 수 있습니다.</td></tr>
    </tbody>
  </table>
  <label class="check"><input type="checkbox" name="privacyConsent" value="true"${v.privacyConsent === 'true' ? ' checked' : ''}${aria(errors, 'privacyConsent')}> 위 개인정보 수집·이용에 동의합니다.</label>
  ${fieldError(errors, 'privacyConsent')}
</fieldset>

<fieldset>
  <legend>공개 상담 게시 동의 (선택)</legend>
  <p class="hint">처리가 끝난 뒤 민원 내용과 처리 결과를 공개 상담으로 다른 분들이 볼 수 있게 해도 되는지 묻습니다. 동의하셔도 담당 공무원이 개인정보를 확인한 뒤 게시하며, 이름은 가리고(예: 홍*동) 연락처·주소는 공개하지 않습니다.</p>
  <label class="check"><input type="checkbox" name="publicConsent" value="true"${v.publicConsent === 'true' ? ' checked' : ''}> 공개 상담 게시에 동의합니다.</label>
</fieldset>

${captchaField(captchaId, errors)}

<div class="actions"><button type="submit" class="btn primary">민원 신청</button></div>
</form>`, 'new');
}

function complaintDone(ctx, data) {
  return layout(ctx, '접수 완료', `
<h1>민원이 접수되었습니다</h1>
<div class="receipt" role="status">
  <dl>
    <dt>접수번호</dt><dd class="big">${esc(data.receiptNo)}</dd>
    <dt>민원 종류</dt><dd>${esc(data.kindLabel)}</dd>
    <dt>접수 일시</dt><dd>${dt(data.receivedAt)}</dd>
    <dt>처리기한</dt><dd>${dt(data.deadlineAt)}</dd>
  </dl>
</div>
<div class="alert alert-warn">
  <p><strong>접수번호를 꼭 적어 두세요.</strong> 처리 상황은 접수번호와 신청할 때 정한 조회 비밀번호로 확인합니다.</p>
  <p><strong>비밀번호를 잊으면 인터넷으로 조회할 수 없으니 기관(${esc(ctx.orgContact)})에 문의하세요.</strong></p>
  <p>이 화면은 다시 열 수 없습니다. 필요하면 지금 인쇄하거나 화면을 저장해 두세요.</p>
</div>
<p><a class="btn" href="/lookup">처리상황 조회로 가기</a></p>`, 'new');
}

/* ------------------------------------------------------------------ 처리상황 조회 */

function lookupForm(ctx, { values = {}, errors = {}, message = '', csrf, captchaId }) {
  return layout(ctx, '처리상황 조회', `
<h1>처리상황 조회</h1>
${errorSummary(errors, message)}
<form method="post" action="/lookup" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<div class="field">
  <label for="receiptNo">접수번호 <span class="req">(필수)</span></label>
  <input id="receiptNo" name="receiptNo" value="${esc(values.receiptNo)}" placeholder="2026-000123" maxlength="15" autocomplete="off" required${aria(errors, 'receiptNo')}>
  ${fieldError(errors, 'receiptNo')}
</div>
<div class="field">
  <label for="password">조회 비밀번호 <span class="req">(필수)</span></label>
  <input id="password" name="password" type="password" maxlength="20" autocomplete="current-password" required${aria(errors, 'password')}>
  ${fieldError(errors, 'password')}
</div>
${captchaField(captchaId, errors)}
<div class="actions"><button type="submit" class="btn primary">조회</button></div>
</form>
<p class="hint">비밀번호를 5번 틀리면 30분 동안 조회할 수 없습니다. 비밀번호를 잊었다면 기관(${esc(ctx.orgContact)})에 문의하세요.</p>`, 'lookup');
}

function statusBadge(status, label) {
  const cls = { RECEIVED: 'st-received', IN_PROGRESS: 'st-progress', DONE: 'st-done' }[status] || '';
  return `<span class="badge ${cls}">${esc(label || status)}</span>`;
}

/** 5-2 / 5-4 공통 상세 */
function complaintDetail(d, { showName = true } = {}) {
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const r = d.result;
  const result = r ? `
<section class="result">
  <h2>처리 결과</h2>
  <dl class="meta">
    <dt>결과</dt><dd>${esc(r.type)}</dd>
    <dt>처리 완료</dt><dd>${dt(r.completedAt)}</dd>
    ${r.notifiedBy ? `<dt>통지 방법</dt><dd>${esc(r.notifiedBy)}</dd>` : ''}
  </dl>
  <div class="text">${esc(r.text)}</div>
  ${r.remedy ? `
  <div class="remedy" role="note">
    <h3>거부 이유와 구제절차 안내</h3>
    <p class="hint">민원 처리에 관한 법률 제27조 제3항에 따라 알려 드립니다.</p>
    <div class="text">${esc(r.remedy)}</div>
  </div>` : ''}
</section>` : '';

  return `
<dl class="meta">
  <dt>접수번호</dt><dd>${esc(d.receiptNo)}</dd>
  <dt>민원 종류</dt><dd>${esc(d.kindLabel)}</dd>
  ${showName ? `<dt>신청인</dt><dd>${esc(d.name)}</dd>` : ''}
  ${d.status ? `<dt>처리 상태</dt><dd>${statusBadge(d.status, d.statusLabel)}</dd>` : ''}
  <dt>접수 일시</dt><dd>${dt(d.receivedAt)}</dd>
  ${d.deadlineAt ? `<dt>처리기한</dt><dd>${dt(d.deadlineAt)}</dd>` : ''}
  <dt>담당 부서</dt><dd>${esc(d.dept) || '배정 전'}</dd>
</dl>
<section>
  <h2>${esc(d.title)}</h2>
  <div class="text">${esc(d.content)}</div>
</section>
${steps.length ? `
<section>
  <h2>처리 과정</h2>
  <ol class="steps">${steps.map((s) => `<li><span class="step">${esc(s.step)}</span> <time>${dt(s.at)}</time></li>`).join('')}</ol>
</section>` : ''}
${result}`;
}

function lookupResult(ctx, d) {
  return layout(ctx, '처리상황', `
<h1>처리상황</h1>
${complaintDetail(d)}
<p><a class="btn" href="/lookup">다른 민원 조회</a></p>`, 'lookup');
}

/* ------------------------------------------------------------------ 목록 공통 */

function searchBox(action, q, placeholder) {
  return `<form class="search" method="get" action="${action}" role="search">
  <label for="q" class="sr-only">검색어</label>
  <input id="q" name="q" value="${esc(q)}" maxlength="100" placeholder="${esc(placeholder)}">
  <button type="submit" class="btn">검색</button>
</form>`;
}

function pager(base, data, q) {
  const page = Number(data.page) || 1;
  const total = Number(data.totalPages) || 1;
  if (total <= 1) return '';
  const href = (p) => `${base}?page=${p}${q ? `&amp;q=${encodeURIComponent(q)}` : ''}`;
  const from = Math.max(1, page - 4);
  const to = Math.min(total, from + 9);
  let out = '<nav class="pager" aria-label="쪽 이동"><ul>';
  if (page > 1) out += `<li><a href="${href(page - 1)}">이전</a></li>`;
  for (let p = from; p <= to; p++) {
    out += p === page ? `<li><span aria-current="page">${p}</span></li>` : `<li><a href="${href(p)}">${p}</a></li>`;
  }
  if (page < total) out += `<li><a href="${href(page + 1)}">다음</a></li>`;
  return out + '</ul></nav>';
}

/* ------------------------------------------------------------------ 공개 상담 */

function consultationList(ctx, data, q) {
  const items = Array.isArray(data.items) ? data.items : [];
  const rows = items.map((it) => `<tr>
  <td>${esc(it.receiptNo)}</td>
  <td>${esc(it.kindLabel)}</td>
  <td class="title"><a href="/consultations/${encodeURIComponent(String(it.id))}">${esc(it.title)}</a></td>
  <td>${esc(it.name)}</td>
  <td>${esc(it.dept)}</td>
  <td>${dt(it.completedAt)}</td>
</tr>`).join('');
  return layout(ctx, '공개 상담', `
<h1>공개 상담</h1>
<p class="hint">처리가 끝났고, 민원인이 공개에 동의했으며, 담당 공무원이 게시한 민원만 보입니다.</p>
${searchBox('/consultations', q, '제목·내용 검색')}
<p class="count">모두 ${esc(data.total ?? 0)}건${q ? ` · “${esc(q)}” 검색 결과` : ''}</p>
${items.length ? `<div class="table-wrap"><table class="list">
<thead><tr><th scope="col">접수번호</th><th scope="col">종류</th><th scope="col">제목</th><th scope="col">신청인</th><th scope="col">담당 부서</th><th scope="col">처리 완료</th></tr></thead>
<tbody>${rows}</tbody></table></div>` : '<p class="empty">찾은 상담이 없습니다.</p>'}
${pager('/consultations', data, q)}`, 'consult');
}

function consultationDetail(ctx, d) {
  return layout(ctx, d.title || '공개 상담', `
<p><a href="/consultations">← 공개 상담 목록</a></p>
<h1>공개 상담</h1>
${complaintDetail(d)}`, 'consult');
}

/* ------------------------------------------------------------------ 행정처분 공개 */

function dispositionList(ctx, data, q) {
  const items = Array.isArray(data.items) ? data.items : [];
  const period = (it) => (it.startDate || it.endDate) ? `${esc(it.startDate || '')} ~ ${esc(it.endDate || '')}` : '-';
  const amount = (a) => (a === null || a === undefined || a === '') ? '-' : `${esc(Number(a).toLocaleString('ko-KR'))}원`;
  const rows = items.map((it) => `<tr>
  <td>${esc(it.decidedOn)}</td>
  <td>${esc(it.bizName)}</td>
  <td>${esc(it.bizType)}</td>
  <td>${esc(it.address)}</td>
  <td>${esc(it.law)}</td>
  <td>${esc(it.kind)}</td>
  <td>${period(it)}</td>
  <td>${amount(it.amount)}</td>
  <td>${esc(it.violation)}</td>
  <td>${esc(it.basis)}</td>
</tr>`).join('');
  return layout(ctx, '행정처분 공개', `
<h1>행정처분 공개</h1>
<p class="hint">식품위생법·공중위생관리법 위반 업소 가운데 공개하기로 한 유효한 처분을 처분일부터 1년 동안 공개합니다.</p>
${searchBox('/dispositions', q, '상호 또는 주소 검색')}
<p class="count">모두 ${esc(data.total ?? 0)}건${q ? ` · “${esc(q)}” 검색 결과` : ''}</p>
${items.length ? `<div class="table-wrap"><table class="list wide">
<thead><tr><th scope="col">처분일</th><th scope="col">업소명</th><th scope="col">업종</th><th scope="col">소재지</th><th scope="col">근거 법률</th><th scope="col">처분 종류</th><th scope="col">처분 기간</th><th scope="col">금액</th><th scope="col">위반 내용</th><th scope="col">처분 근거</th></tr></thead>
<tbody>${rows}</tbody></table></div>` : '<p class="empty">공개된 행정처분이 없습니다.</p>'}
${pager('/dispositions', data, q)}`, 'disp');
}

/* ------------------------------------------------------------------ 오류 */

function errorPage(ctx, status, title, message) {
  return layout(ctx, title, `
<h1>${esc(title)}</h1>
<div class="alert alert-error" role="alert"><p>${esc(message)}</p></div>
<p><a class="btn" href="/">첫 화면으로</a></p>`);
}

module.exports = {
  esc, dt, layout, home, complaintForm, complaintDone, lookupForm, lookupResult,
  consultationList, consultationDetail, dispositionList, errorPage,
};
