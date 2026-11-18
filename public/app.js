'use strict';
/*
 * 화면 편의 기능 (없어도 모든 기능은 그대로 쓸 수 있습니다)
 * - 인쇄 버튼, 글자 크게 (이 브라우저에 기억)
 * - 민원 신청서 임시저장: 쓰는 중인 민원 종류·분야·제목·내용만 이 브라우저(localStorage)에 저장합니다.
 *   여러 사람이 쓰는 PC를 생각해 이름·연락처·주소·비밀번호·첨부파일은 저장하지 않으며,
 *   24시간이 지나거나 접수되면 지웁니다. 서버로 보내지 않습니다.
 */
(function () {
  // 스크립트가 도는 것을 CSS 에 알린다 (휴대폰 메뉴를 접는 것은 이때만)
  document.documentElement.classList.add('js');

  // 휴대폰 메뉴 펼치기·접기
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('[data-menu-toggle]');
    if (!b) return;
    var header = b.closest('header');
    var open = !header.classList.contains('nav-open');
    header.classList.toggle('nav-open', open);
    b.setAttribute('aria-expanded', open ? 'true' : 'false');
    b.textContent = open ? '닫기' : '메뉴';
    if (open) {
      var first = header.querySelector('.menu-panel a');
      if (first) first.focus();
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    var h = document.querySelector('header.site.nav-open');
    if (!h) return;
    h.classList.remove('nav-open');
    var b = h.querySelector('[data-menu-toggle]');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = '메뉴';
    b.focus();
  });

  // 접수번호 복사
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('[data-copy]');
    if (!b || !navigator.clipboard) return;
    navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
      var s = document.querySelector('[data-copy-status]');
      if (s) s.textContent = '접수번호를 복사했습니다.';
    }, function () { /* 복사를 못 하면 그냥 둔다 */ });
  });

  var store = null;
  try { store = window.localStorage; store.getItem('x'); } catch (e) { store = null; }
  function get(k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } }
  function set(k, v) { try { if (store) store.setItem(k, v); } catch (e) { /* 저장 공간이 없으면 넘어간다 */ } }
  function del(k) { try { if (store) store.removeItem(k); } catch (e) { /* 무시 */ } }

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t && t.closest && t.closest('[data-print]')) { ev.preventDefault(); window.print(); }
  });

  // 글자 크게
  var root = document.documentElement;
  function applyFont(big) {
    root.classList.toggle('big', big);
    var b = document.querySelectorAll('[data-font-toggle]');
    for (var i = 0; i < b.length; i++) {
      b[i].setAttribute('aria-pressed', big ? 'true' : 'false');
      b[i].textContent = big ? '글자 보통' : '글자 크게';
    }
  }
  applyFont(get('ep-font') === 'big');
  document.addEventListener('click', function (ev) {
    var t = ev.target && ev.target.closest && ev.target.closest('[data-font-toggle]');
    if (!t) return;
    var big = !root.classList.contains('big');
    set('ep-font', big ? 'big' : 'normal');
    applyFont(big);
  });

  // 신청서 임시저장
  // 저장하는 칸 (개인정보가 아닌 것만)
  var KEEP = { kind: 1, category: 1, lawInterpretation: 1, title: 1, content: 1 };
  var SKIP = { password: 1, password2: 1, captcha: 1, captchaId: 1, _csrf: 1, files: 1 };
  var MAX_AGE = 24 * 3600 * 1000;
  var form = document.querySelector('form[data-draft]');
  if (form) {
    var key = 'ep-draft-' + form.getAttribute('data-draft');
    var note = document.querySelector('[data-draft-note]');
    var hasError = !!document.querySelector('.alert-error');
    var saved = null;
    try { saved = JSON.parse(get(key) || 'null'); } catch (e) { saved = null; }
    if (saved && (!saved.at || Date.now() - saved.at > MAX_AGE)) { del(key); saved = null; }
    if (saved && !hasError && saved.v) {
      var used = false;
      Object.keys(saved.v).forEach(function (name) {
        if (SKIP[name] || !KEEP[name]) return;
        var els = form.elements[name];
        if (!els) return;
        var list = els.length !== undefined && !els.tagName ? els : [els];
        for (var i = 0; i < list.length; i++) {
          var el = list[i];
          if (el.type === 'radio' || el.type === 'checkbox') {
            var on = saved.v[name] === el.value || (Array.isArray(saved.v[name]) && saved.v[name].indexOf(el.value) >= 0);
            if (on && !el.checked) { el.checked = true; used = true; }
          } else if (!el.value && saved.v[name]) { el.value = saved.v[name]; used = true; }
        }
      });
      if (used && note) note.hidden = false;
    }
    var timer = null;
    var save = function () {
      var v = {};
      for (var i = 0; i < form.elements.length; i++) {
        var el = form.elements[i];
        if (!el.name || SKIP[el.name] || !KEEP[el.name] || el.type === 'hidden' || el.type === 'file') continue;
        if (el.type === 'radio' || el.type === 'checkbox') { if (el.checked) v[el.name] = el.value; continue; }
        if (el.value) v[el.name] = el.value;
      }
      set(key, JSON.stringify({ at: Date.now(), v: v }));
    };
    form.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(save, 400); });
    form.addEventListener('change', save);
    var clear = document.querySelector('[data-draft-clear]');
    if (clear) clear.addEventListener('click', function () { del(key); window.location.reload(); });
  }
  var done = document.querySelector('[data-draft-done]');
  if (done) del('ep-draft-' + done.getAttribute('data-draft-done'));
})();

// 신청서 작성 중 제목과 비슷한 공개 상담을 보여 준다 (이미 답이 있으면 신청하지 않아도 되도록)
(function () {
  var box = document.querySelector('[data-similar-for]');
  if (!box || !window.fetch) return;
  var input = document.getElementById(box.getAttribute('data-similar-for'));
  if (!input) return;
  var timer = null;
  var last = '';
  function render(items) {
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!items.length) { box.hidden = true; return; }
    var p = document.createElement('p');
    p.textContent = '비슷한 공개 상담이 있습니다. 먼저 읽어 보세요 (새 창):';
    box.appendChild(p);
    var ul = document.createElement('ul');
    items.forEach(function (it) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '/consultations/' + encodeURIComponent(it.id);
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = it.title + (it.category ? ' (' + it.category + ')' : '');
      li.appendChild(a);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.hidden = false;
  }
  function look() {
    var q = input.value.trim();
    if (q.length < 4 || q === last) return;
    last = q;
    fetch('/consultations/similar?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (d) { if (input.value.trim() === q) render(Array.isArray(d.items) ? d.items : []); })
      .catch(function () {});
  }
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(look, 700); });
  input.addEventListener('change', look);
  if (input.value) look();
})();

// 보안 프로그램: 설치 확인 주소가 있으면 이 PC 에서 프로그램이 응답하는지 본 뒤에만 '설치했습니다'를 보낸다
(function () {
  var forms = document.querySelectorAll('form[data-check-url]');
  Array.prototype.forEach.call(forms, function (form) {
    var url = form.getAttribute('data-check-url');
    var checked = false;
    form.addEventListener('submit', function (e) {
      if (checked || !window.fetch) return;
      e.preventDefault();
      var btn = form.querySelector('button');
      if (btn) { btn.disabled = true; btn.textContent = '설치 확인 중…'; }
      var done = false;
      function fail() {
        if (done) return; done = true;
        if (btn) { btn.disabled = false; btn.textContent = '설치했습니다'; }
        alert((form.getAttribute('data-check-name') || '보안 프로그램') + '이(가) 이 기기에서 실행 중이 아닙니다. 설치하고 실행한 뒤 다시 눌러 주세요.');
      }
      var timer = setTimeout(fail, 4000);
      fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
        .then(function () { if (done) return; done = true; clearTimeout(timer); checked = true; form.submit(); })
        .catch(function () { clearTimeout(timer); fail(); });
    });
  });
})();
