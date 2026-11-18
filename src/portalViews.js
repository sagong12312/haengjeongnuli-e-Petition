'use strict';
/**
 * 공지사항·자주 묻는 질문·민원 안내·처리 통계·약관, 회원(가입·로그인·내 민원·내 정보) 화면.
 * 바깥에서 온 값은 모두 esc() 로 글자로만 출력합니다.
 */
const {
  esc, dt, layout, complaintDetail, ownerActions, fieldError, aria, errorSummary, captchaField, searchBox, pager, statusBadge,
} = require('./views');

/* ------------------------------------------------------------------ 공지사항 */

/** 올린 지 7일이 안 된 글. 행정누리는 시간대 없이 한국 시각(KST)으로 준다 */
function isNew(at, now = Date.now()) {
  const v = String(at || '').trim().replace(' ', 'T');
  const t = Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v : v + '+09:00');
  return Number.isFinite(t) && now - t >= -60000 && now - t < 7 * 24 * 3600 * 1000;
}

function noticeList(ctx, data, q) {
  const items = Array.isArray(data.items) ? data.items : [];
  const rows = items.map((n) => `<tr>
  <td class="title" data-label="제목">${n.pinned ? '<span class="badge st-progress">고정</span> ' : ''}${isNew(n.createdAt) ? '<span class="badge st-new">새 글</span> ' : ''}<a href="/notices/${encodeURIComponent(String(n.id))}">${esc(n.title)}</a></td>
  <td data-label="올린 날">${dt(n.createdAt).slice(0, 10)}</td>
  <td class="num" data-label="조회">${esc(n.views ?? 0)}</td>
</tr>`).join('');
  return layout(ctx, '공지사항', `
<h1>공지사항</h1>
${searchBox('/notices', q, '제목·내용 검색')}
<p class="count">모두 ${esc(data.total ?? 0)}건</p>
${items.length ? `<div class="table-wrap"><table class="list stack">
<thead><tr><th scope="col">제목</th><th scope="col">올린 날</th><th scope="col">조회</th></tr></thead>
<tbody>${rows}</tbody></table></div>` : '<p class="empty">공지사항이 없습니다.</p>'}
${pager('/notices', data, q)}`, 'notice');
}

function noticeDetail(ctx, n) {
  return layout(ctx, n.title || '공지사항', `
<p><a href="/notices">← 공지사항 목록</a></p>
<h1>${esc(n.title)}</h1>
<dl class="meta">
  <dt>올린 날</dt><dd>${dt(n.createdAt)}</dd>
  ${n.updatedAt ? `<dt>고친 날</dt><dd>${dt(n.updatedAt)}</dd>` : ''}
  <dt>조회</dt><dd>${esc(n.views ?? 0)}</dd>
</dl>
<div class="text">${esc(n.content)}</div>`, 'notice');
}

/* ------------------------------------------------------------------ 자주 묻는 질문 */

function faqPage(ctx, data, q = '') {
  const key = q.toLowerCase();
  const hit = (it) => !key || `${it.question || ''} ${it.answer || ''}`.toLowerCase().includes(key);
  const cats = (Array.isArray(data.categories) ? data.categories : [])
    .map((c) => ({ ...c, items: (Array.isArray(c.items) ? c.items : []).filter(hit) }))
    .filter((c) => c.items.length);
  const found = cats.reduce((n, c) => n + c.items.length, 0);
  const empty = q
    ? `<p class="empty">‘${esc(q)}’에 맞는 질문이 없습니다. <a href="/faq">모든 질문 보기</a> 또는 <a href="/complaints/new">질의민원</a>으로 물어 주세요.</p>`
    : '<p class="empty">올라온 질문이 없습니다. 궁금한 점은 기관에 문의해 주세요.</p>';
  const body = cats.length ? cats.map((c, ci) => `<section>
  <h2 id="faq-${ci}">${esc(c.category)}</h2>
  ${c.items.map((it) => `<details class="faq"${q ? ' open' : ''}>
    <summary>${esc(it.question)}</summary>
    <div class="text">${esc(it.answer)}</div>
  </details>`).join('')}
</section>`).join('') : empty;
  return layout(ctx, '자주 묻는 질문', `
<h1>자주 묻는 질문</h1>
${searchBox('/faq', q, '질문·답 검색 (예: 처리기간)')}
${q && found ? `<p class="count">‘${esc(q)}’ 검색 결과 ${found}건 · <a href="/faq">모두 보기</a></p>` : ''}
<p class="hint">질문을 누르면 답이 펼쳐집니다. 찾는 답이 없으면 <a href="/complaints/new">질의민원</a>으로 물어 주세요.</p>
${body}`, 'faq');
}

/* ------------------------------------------------------------------ 민원 안내 */

function guidePage(ctx, info) {
  const kinds = Array.isArray(info && info.kinds) ? info.kinds : [];
  const rows = kinds.map((k) => `<tr>
  <th scope="row">${esc(k.label)}</th>
  <td data-label="뜻">${esc(k.description)}</td>
  <td data-label="처리기간">${esc(k.period)}</td>
  <td data-label="신청 방법">${k.online ? '인터넷 신청 가능' : '<a href="https://www.gov.kr" rel="noopener noreferrer">정부24</a>·기관 창구'}</td>
</tr>`).join('');
  return layout(ctx, '민원 안내', `
<h1>민원 안내</h1>
<h2>민원 종류와 처리기간</h2>
<p class="hint">민원 처리에 관한 법률과 같은 법 시행령에 따른 기간입니다. 처리기간은 근무시간·공휴일을 빼고 셉니다.</p>
<div class="table-wrap"><table class="list wide stack">
<thead><tr><th scope="col">종류</th><th scope="col">뜻</th><th scope="col">처리기간</th><th scope="col">신청 방법</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<h2 id="categories">민원 분야</h2>
<p class="hint">민원 종류와 따로, 무슨 일에 관한 민원인지 고릅니다. 담당 부서를 빨리 찾는 데 씁니다.</p>
<div class="table-wrap"><table class="list stack">
<thead><tr><th scope="col">분야</th><th scope="col">예</th></tr></thead>
<tbody>${(Array.isArray(info && info.categories) ? info.categories : []).map((c) => `<tr><th scope="row">${esc(c.label)}</th><td data-label="예">${esc(c.examples)}</td></tr>`).join('')}</tbody></table></div>
<h2>이렇게 진행됩니다</h2>
<ol class="flow">
  <li><strong>신청</strong> — <a href="/complaints/new">민원 신청</a>에서 적어 보냅니다. 접수번호를 받습니다.</li>
  <li><strong>담당 배정</strong> — 기관이 담당 부서·담당자를 정합니다.</li>
  <li><strong>처리</strong> — 필요하면 처리기간을 연장하거나 진행 상황을 알려 드립니다. 처리 중에는 추가 의견을 내거나 민원을 취하할 수 있습니다.</li>
  <li><strong>결과 통지</strong> — 고른 방법(문자·이메일 등)으로 결과를 알려 드립니다. 결과는 <a href="/lookup">처리상황 조회</a>나 <a href="/my">내 민원</a>에서도 봅니다.</li>
  <li><strong>만족도</strong> — 처리가 끝나면 만족도를 남겨 주세요.</li>
</ol>
<h2>알아 두세요</h2>
<ul>
  <li>같은 내용의 민원을 정당한 사유 없이 되풀이해 내면 종결 처리될 수 있습니다 (민원 처리에 관한 법률 제23조).</li>
  <li>민원 내용에 다른 사람의 개인정보를 적지 마세요.</li>
  <li>문의: ${esc(ctx.orgContact)}</li>
</ul>`, 'guide');
}

/* ------------------------------------------------------------------ 처리 통계 */

function statsPage(ctx, s) {
  const months = Array.isArray(s.months) ? s.months : [];
  const max = Math.max(1, ...months.map((m) => Math.max(Number(m.received) || 0, Number(m.done) || 0)));
  // 화면 안 style 속성은 보안 정책(CSP)이 막으므로 5% 단위 클래스로 너비를 정한다
  const bar = (v, cls) => `<span class="bar ${cls} w${Math.round((((Number(v) || 0) / max) * 100) / 5) * 5}"></span>`;
  const rows = months.map((m) => `<tr>
  <th scope="row">${esc(m.month)}</th>
  <td class="num" data-label="접수">${esc(m.received)}</td><td class="barcell" aria-hidden="true">${bar(m.received, 'b-rec')}</td>
  <td class="num" data-label="처리">${esc(m.done)}</td><td class="barcell" aria-hidden="true">${bar(m.done, 'b-done')}</td>
</tr>`).join('');
  const kinds = (Array.isArray(s.kinds) ? s.kinds : []).map((k) => `<tr><th scope="row">${esc(k.label)}</th><td class="num" data-label="접수">${esc(k.received)}</td><td class="num" data-label="처리">${esc(k.done)}</td></tr>`).join('');
  const dist = Array.isArray(s.satisfactionDist) ? s.satisfactionDist : [];
  const num = (v, unit) => (v === null || v === undefined ? '—' : `${esc(v)}${unit}`);
  return layout(ctx, '처리 통계', `
<h1>민원 처리 통계</h1>
<p class="hint">${esc(s.from)} ~ ${esc(s.to)} (최근 12개월). 창구·우편·전자민원으로 받은 민원을 모두 셉니다. 개인정보는 들어 있지 않습니다.</p>
<div class="stat-cards">
  <div><span>접수</span><strong>${num(s.received, '건')}</strong></div>
  <div><span>처리 완료</span><strong>${num(s.done, '건')}</strong></div>
  <div><span>평균 처리일</span><strong>${num(s.avgDays, '일')}</strong></div>
  <div><span>기한 안에 처리</span><strong>${num(s.onTimeRate, '%')}</strong></div>
  <div><span>만족도 평균</span><strong>${s.satisfactionAvg == null ? '—' : `${esc(s.satisfactionAvg)}점`}</strong><small>응답 ${esc(s.satisfactionCount ?? 0)}명</small></div>
</div>
<h2>달마다</h2>
<div class="table-wrap"><table class="list stats stack">
<caption class="sr-only">달마다 접수·처리 건수</caption>
<thead><tr><th scope="col">달</th><th scope="col">접수</th><th scope="col"><span class="sr-only">접수 막대</span></th><th scope="col">처리</th><th scope="col"><span class="sr-only">처리 막대</span></th></tr></thead>
<tbody>${rows}</tbody></table></div>
<h2>민원 종류별</h2>
<div class="table-wrap"><table class="list stack"><thead><tr><th scope="col">종류</th><th scope="col">접수</th><th scope="col">처리</th></tr></thead><tbody>${kinds}</tbody></table></div>
${Array.isArray(s.categories) && s.categories.length ? `<h2>분야별</h2>
<div class="table-wrap"><table class="list stack"><thead><tr><th scope="col">분야</th><th scope="col">접수</th><th scope="col">처리</th></tr></thead>
<tbody>${s.categories.map((c) => `<tr><th scope="row">${esc(c.label)}</th><td class="num" data-label="접수">${esc(c.received)}</td><td class="num" data-label="처리">${esc(c.done)}</td></tr>`).join('')}</tbody></table></div>` : ''}
${dist.length === 5 ? `<h2>만족도 응답</h2>
<div class="table-wrap"><table class="list stack"><thead><tr>${[1, 2, 3, 4, 5].map((n) => `<th scope="col">${n}점</th>`).join('')}</tr></thead>
<tbody><tr>${dist.map((v, i) => `<td class="num" data-label="${i + 1}점">${esc(v)}명</td>`).join('')}</tr></tbody></table></div>` : ''}
<p class="hint">취하한 민원 ${esc(s.withdrawn ?? 0)}건은 처리 건수·평균 처리일에서 뺐습니다.</p>`, 'stats');
}

/* ------------------------------------------------------------------ 약관·개인정보 처리방침 */

function termsPage(ctx) {
  return layout(ctx, '이용약관', `
<h1>이용약관</h1>
<ol class="terms">
  <li><strong>목적</strong> — 이 약관은 ${esc(ctx.orgName)}이(가) 운영하는 행정누리 전자민원(이하 “서비스”)의 회원 가입과 이용에 필요한 사항을 정합니다.</li>
  <li><strong>회원 가입</strong> — 아이디·비밀번호·이름을 적고 이 약관과 개인정보 수집·이용에 동의하면 가입됩니다. 실명 확인(본인인증)은 하지 않으므로 다른 사람 이름으로 가입하거나 민원을 내면 안 됩니다.</li>
  <li><strong>회원이 할 수 있는 일</strong> — 민원 신청, 내 민원 처리상황 보기, 추가 의견·취하·만족도 응답, 내 정보 고치기.</li>
  <li><strong>회원의 의무</strong> — 비밀번호를 남에게 알려 주지 말고, 다른 사람의 개인정보나 명예를 해치는 글, 같은 내용을 되풀이하는 민원을 내지 않습니다.</li>
  <li><strong>탈퇴</strong> — 언제든 <a href="/my/withdraw">회원 탈퇴</a>에서 할 수 있으며 회원 정보는 바로 지웁니다. 이미 낸 민원은 민원 기록 보존기간 동안 기관이 보관합니다.</li>
  <li><strong>서비스 중단</strong> — 점검·장애 때에는 서비스를 잠시 멈출 수 있습니다. 급한 민원은 ${esc(ctx.orgContact)}로 문의해 주세요.</li>
</ol>`, 'terms');
}

function privacyPage(ctx) {
  return layout(ctx, '개인정보 처리방침', `
<h1>개인정보 처리방침</h1>
<p>${esc(ctx.orgName)}은(는) 개인정보 보호법에 따라 국민의 개인정보를 보호하고 관련 고충을 처리하기 위해 다음과 같이 처리방침을 둡니다.</p>
<div class="table-wrap"><table class="privacy">
<caption>처리하는 개인정보</caption>
<thead><tr><th scope="col">구분</th><th scope="col">항목</th><th scope="col">목적</th><th scope="col">보유 기간</th></tr></thead>
<tbody>
<tr><th scope="row">민원 신청</th><td>필수: 이름, 민원 내용 / 선택: 휴대전화, 집 전화, 이메일, 주소, 팩스, 첨부파일</td><td>민원 접수·처리, 결과 통지</td><td>${esc(ctx.privacyRetention)}</td></tr>
<tr><th scope="row">회원</th><td>필수: 아이디, 비밀번호(암호화), 이름 / 선택: 휴대전화, 이메일, 주소</td><td>회원 확인, 내 민원 보기, 신청서 미리 채우기</td><td>탈퇴할 때까지 (탈퇴하면 바로 지움)</td></tr>
<tr><th scope="row">자동 수집</th><td>접속 IP, 접속 시각, 요청 주소</td><td>부정 이용 방지, 접속기록 관리</td><td>관계 법령에서 정한 기간</td></tr>
</tbody></table></div>
<ul>
  <li>개인정보는 위 목적 밖으로 쓰거나 제3자에게 주지 않습니다. 다만 법령에 근거가 있으면 예외로 합니다.</li>
  <li>공개 상담에는 민원인이 동의하고 담당 공무원이 확인한 경우에만, 이름을 가리고(예: 홍*동) 연락처·주소를 빼고 게시합니다.</li>
  <li>“도움이 됐어요” 공감은 같은 사람이 여러 번 누르지 못하도록 접속 IP를 되돌릴 수 없게 바꾼 값(해시)으로만 남깁니다.</li>
  <li>회원 로그인 정보는 서버 메모리에만 두며, 30분 동안 쓰지 않으면 로그아웃됩니다.</li>
  <li>열람·정정·삭제·처리정지를 요구하려면 ${esc(ctx.orgContact)}로 문의해 주세요.</li>
</ul>`, 'privacy');
}

/* ------------------------------------------------------------------ 회원가입 */

const PRIVACY_TABLE = (ctx) => `<table class="privacy">
    <caption>회원 개인정보 수집·이용 안내 (개인정보 보호법 제15조)</caption>
    <tbody>
      <tr><th scope="row">수집 항목</th><td>필수: 아이디, 비밀번호, 이름 / 선택: 휴대전화, 이메일, 주소</td></tr>
      <tr><th scope="row">수집·이용 목적</th><td>회원 확인, 내 민원 처리상황 제공, 민원 신청서 미리 채우기</td></tr>
      <tr><th scope="row">보유·이용 기간</th><td>회원 탈퇴 때까지 (탈퇴하면 바로 지움. 이미 낸 민원은 ${esc(ctx.privacyRetention)})</td></tr>
      <tr><th scope="row">동의를 거부할 권리와 불이익</th><td>동의를 거부할 수 있습니다. 다만 동의하지 않으면 가입할 수 없으며, 가입하지 않아도 민원 신청·조회는 할 수 있습니다.</td></tr>
    </tbody>
  </table>`;

function input(v, errors, name, label, attrs = '', hint = '') {
  return `<div class="field">
  <label for="${name}">${label}</label>
  ${hint ? `<p class="hint" id="${name}-hint">${hint}</p>` : ''}
  <input id="${name}" name="${name}" value="${esc(v[name])}" ${attrs}${aria(errors, name)}>
  ${fieldError(errors, name)}
</div>`;
}

function signupForm(ctx, { values = {}, errors = {}, message = '', csrf, captchaId }) {
  const v = values;
  return layout(ctx, '회원가입', `
<h1>회원가입</h1>
<p class="hint">가입하지 않아도 민원을 신청하고 조회할 수 있습니다. 가입하면 접수번호·조회 비밀번호 없이 <strong>내 민원</strong>에서 처리 상황을 보고, 신청서에 이름·연락처가 미리 채워집니다.</p>
${errorSummary(errors, message)}
<form method="post" action="/signup" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<fieldset>
  <legend>로그인 정보</legend>
  ${input(v, errors, 'loginId', '아이디 <span class="req">(필수)</span>', 'maxlength="20" autocomplete="username" autocapitalize="none" spellcheck="false" required', '영문 소문자로 시작, 영문 소문자·숫자·밑줄(_) 5~20자')}
  <div class="field">
    <label for="password">비밀번호 <span class="req">(필수)</span></label>
    <p class="hint" id="password-hint">영문·숫자·특수문자 가운데 2종류 이상이면 10자 이상, 3종류이면 8자 이상 (아이디가 들어가면 안 됩니다)</p>
    <input id="password" name="password" type="password" minlength="8" maxlength="64" autocomplete="new-password" required aria-describedby="password-hint"${errors.password ? ' aria-invalid="true"' : ''}>
    ${fieldError(errors, 'password')}
  </div>
  <div class="field">
    <label for="password2">비밀번호 확인 <span class="req">(필수)</span></label>
    <input id="password2" name="password2" type="password" minlength="8" maxlength="64" autocomplete="new-password" required${aria(errors, 'password2')}>
    ${fieldError(errors, 'password2')}
  </div>
</fieldset>
<fieldset>
  <legend>회원 정보</legend>
  ${input(v, errors, 'name', '이름 <span class="req">(필수)</span>', 'maxlength="100" autocomplete="name" required')}
  ${input(v, errors, 'mobile', '휴대전화', 'type="tel" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678"')}
  ${input(v, errors, 'email', '이메일', 'type="email" maxlength="200" autocomplete="email"')}
  ${input(v, errors, 'address', '주소', 'maxlength="500" autocomplete="street-address"')}
</fieldset>
<fieldset>
  <legend>약관 동의 <span class="req">(필수)</span></legend>
  <p><a href="/terms">이용약관 전문 보기</a></p>
  <label class="check"><input type="checkbox" name="termsConsent" value="true"${v.termsConsent === 'true' ? ' checked' : ''}${aria(errors, 'termsConsent')}> 이용약관에 동의합니다.</label>
  ${fieldError(errors, 'termsConsent')}
  ${PRIVACY_TABLE(ctx)}
  <label class="check"><input type="checkbox" name="privacyConsent" value="true"${v.privacyConsent === 'true' ? ' checked' : ''}${aria(errors, 'privacyConsent')}> 위 개인정보 수집·이용에 동의합니다.</label>
  ${fieldError(errors, 'privacyConsent')}
</fieldset>
${captchaField(captchaId, errors)}
<div class="actions"><button type="submit" class="btn primary">가입하기</button></div>
</form>
<p>이미 회원이면 <a href="/login">로그인</a>하세요.</p>`, 'signup');
}

/* ------------------------------------------------------------------ 로그인 */

function loginForm(ctx, { values = {}, errors = {}, message = '', csrf, next = '', notice = '' }) {
  return layout(ctx, '로그인', `
<h1>로그인</h1>
${notice ? `<div class="alert alert-ok" role="status"><p>${esc(notice)}</p></div>` : ''}
${errorSummary(errors, message)}
<form method="post" action="/login" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<input type="hidden" name="next" value="${esc(next)}">
<div class="field">
  <label for="loginId">아이디</label>
  <input id="loginId" name="loginId" value="${esc(values.loginId)}" maxlength="30" autocomplete="username" autocapitalize="none" spellcheck="false" required${aria(errors, 'loginId')}>
  ${fieldError(errors, 'loginId')}
</div>
<div class="field">
  <label for="password">비밀번호</label>
  <input id="password" name="password" type="password" maxlength="64" autocomplete="current-password" required${aria(errors, 'password')}>
  ${fieldError(errors, 'password')}
</div>
<div class="actions"><button type="submit" class="btn primary">로그인</button></div>
</form>
<p class="hint">비밀번호를 5번 틀리면 30분 동안 로그인할 수 없습니다. 30분 동안 아무것도 하지 않으면 자동으로 로그아웃됩니다.</p>
<p>회원이 아니면 <a href="/signup">회원가입</a>하세요. 아이디·비밀번호를 잊었으면 기관(${esc(ctx.orgContact)})에 문의해 주세요.</p>`, 'login');
}

function logoutConfirm(ctx, csrf) {
  return layout(ctx, '로그아웃', `
<h1>로그아웃</h1>
<form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}">
<p>로그아웃할까요? 여러 사람이 쓰는 컴퓨터라면 꼭 로그아웃하세요.</p>
<div class="actions"><button type="submit" class="btn primary">로그아웃</button> <a class="btn" href="/my">취소</a></div></form>`);
}

/* ------------------------------------------------------------------ 내 민원 */

function myList(ctx, data, notice = '', status = '') {
  const items = Array.isArray(data.items) ? data.items : [];
  const rows = items.map((c) => `<tr>
  <td class="title" data-label="제목"><a href="/my/complaints/${encodeURIComponent(c.receiptNo)}">${esc(c.title)}</a></td>
  <td data-label="상태">${statusBadge(c.statusLabel === '취하' ? '' : c.status, c.statusLabel)}</td>
  <td data-label="접수번호">${esc(c.receiptNo)}</td>
  <td data-label="종류">${esc(c.kindLabel)}</td>
  <td data-label="접수">${dt(c.receivedAt)}</td>
  <td data-label="${c.completedAt ? '처리 완료' : '처리기한'}">${c.completedAt ? dt(c.completedAt) : dt(c.deadlineAt) + ' 까지'}</td>
</tr>`).join('');
  return layout(ctx, '내 민원', `
<h1>내 민원</h1>
${notice ? `<div class="alert alert-ok" role="status"><p>${esc(notice)}</p></div>` : ''}
<nav class="tabs" aria-label="처리 상태로 거르기">
  <a href="/my"${status ? '' : ' aria-current="page"'}>모두</a>
  <a href="/my?status=open"${status === 'open' ? ' aria-current="page"' : ''}>처리 중</a>
  <a href="/my?status=done"${status === 'done' ? ' aria-current="page"' : ''}>처리 완료</a>
</nav>
<p class="count">${status === 'open' ? '처리 중 ' : status === 'done' ? '처리 완료 ' : '모두 '}${esc(data.total ?? 0)}건 · <a href="/complaints/new">새 민원 신청</a></p>
${items.length ? `<div class="table-wrap"><table class="list stack">
<thead><tr><th scope="col">제목</th><th scope="col">상태</th><th scope="col">접수번호</th><th scope="col">종류</th><th scope="col">접수</th><th scope="col">처리 완료 / 기한</th></tr></thead>
<tbody>${rows}</tbody></table></div>` : status ? '<p class="empty">이 상태의 민원이 없습니다.</p>' : '<p class="empty">회원으로 신청한 민원이 없습니다. 가입하기 전에 낸 민원은 <a href="/lookup">처리상황 조회</a>에서 접수번호로 보세요.</p>'}
${pager('/my', data, '', status ? `&amp;status=${status}` : '')}`, 'my');
}

function myComplaint(ctx, d, csrf) {
  return layout(ctx, '내 민원', `
<p class="no-print"><a href="/my">← 내 민원 목록</a></p>
<h1>내 민원</h1>
${complaintDetail(d)}
${ownerActions(d, csrf, 'my')}
<p class="no-print"><button type="button" class="btn" data-print>인쇄</button></p>`, 'my');
}

/* ------------------------------------------------------------------ 민원인이 한 일 결과 */

function actionDone(ctx, { title, message, back }) {
  return layout(ctx, title, `
<h1>${esc(title)}</h1>
<div class="alert alert-ok" role="status"><p>${esc(message)}</p></div>
<p><a class="btn primary" href="${esc(back)}">${back.startsWith('/my') ? '내 민원으로' : '처리상황 다시 조회'}</a></p>`);
}

/* ------------------------------------------------------------------ 내 정보 */

function profileForm(ctx, { values = {}, errors = {}, message = '', notice = '', csrf }) {
  const v = values;
  return layout(ctx, '내 정보', `
<h1>내 정보</h1>
${notice ? `<div class="alert alert-ok" role="status"><p>${esc(notice)}</p></div>` : ''}
${errorSummary(errors, message)}
<dl class="meta"><dt>아이디</dt><dd>${esc(v.loginId)}</dd><dt>가입한 날</dt><dd>${dt(v.createdAt).slice(0, 10)}</dd>
<dt>비밀번호 바꾼 날</dt><dd>${dt(v.pwChangedAt).slice(0, 10)}</dd></dl>
<form method="post" action="/my/profile" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">
${input(v, errors, 'name', '이름 <span class="req">(필수)</span>', 'maxlength="100" autocomplete="name" required')}
${input(v, errors, 'mobile', '휴대전화', 'type="tel" maxlength="20" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678"')}
${input(v, errors, 'email', '이메일', 'type="email" maxlength="200" autocomplete="email"')}
${input(v, errors, 'address', '주소', 'maxlength="500" autocomplete="street-address"')}
<div class="actions"><button type="submit" class="btn primary">저장</button></div>
</form>
<ul class="links"><li><a href="/my/password">비밀번호 바꾸기</a></li><li><a href="/my/withdraw">회원 탈퇴</a></li></ul>`, 'my');
}

function passwordForm(ctx, { errors = {}, message = '', csrf }) {
  return layout(ctx, '비밀번호 바꾸기', `
<h1>비밀번호 바꾸기</h1>
${errorSummary(errors, message)}
<form method="post" action="/my/password" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<div class="field"><label for="currentPassword">지금 비밀번호</label>
  <input id="currentPassword" name="currentPassword" type="password" maxlength="64" autocomplete="current-password" required${aria(errors, 'currentPassword')}>
  ${fieldError(errors, 'currentPassword')}</div>
<div class="field"><label for="password">새 비밀번호</label>
  <p class="hint" id="password-hint">영문·숫자·특수문자 가운데 2종류 이상이면 10자 이상, 3종류이면 8자 이상</p>
  <input id="password" name="password" type="password" minlength="8" maxlength="64" autocomplete="new-password" required aria-describedby="password-hint"${errors.password ? ' aria-invalid="true"' : ''}>
  ${fieldError(errors, 'password')}</div>
<div class="field"><label for="password2">새 비밀번호 확인</label>
  <input id="password2" name="password2" type="password" minlength="8" maxlength="64" autocomplete="new-password" required${aria(errors, 'password2')}>
  ${fieldError(errors, 'password2')}</div>
<div class="actions"><button type="submit" class="btn primary">바꾸기</button> <a class="btn" href="/my/profile">취소</a></div>
</form>`, 'my');
}

function withdrawForm(ctx, { errors = {}, message = '', csrf }) {
  return layout(ctx, '회원 탈퇴', `
<h1>회원 탈퇴</h1>
${errorSummary(errors, message)}
<div class="alert alert-warn"><p>탈퇴하면 아이디·이름·연락처 등 <strong>회원 정보를 바로 지우며 되돌릴 수 없습니다.</strong></p>
<p>이미 낸 민원은 기관이 민원 기록 보존기간 동안 보관하며, 조회 비밀번호를 정해 둔 민원은 처리상황 조회에서 계속 볼 수 있습니다.</p></div>
<form method="post" action="/my/withdraw" novalidate>
<input type="hidden" name="_csrf" value="${esc(csrf)}">
<div class="field"><label for="password">비밀번호 확인</label>
  <input id="password" name="password" type="password" maxlength="64" autocomplete="current-password" required${aria(errors, 'password')}>
  ${fieldError(errors, 'password')}</div>
<label class="check"><input type="checkbox" name="confirm" value="true" required${aria(errors, 'confirm')}> 위 내용을 확인했으며 탈퇴합니다.</label>
${fieldError(errors, 'confirm')}
<div class="actions"><button type="submit" class="btn danger">탈퇴하기</button> <a class="btn" href="/my/profile">취소</a></div>
</form>`, 'my');
}

module.exports = {
  isNew,
  noticeList, noticeDetail, faqPage, guidePage, statsPage, termsPage, privacyPage,
  signupForm, loginForm, logoutConfirm, myList, myComplaint, actionDone, profileForm, passwordForm, withdrawForm,
};
