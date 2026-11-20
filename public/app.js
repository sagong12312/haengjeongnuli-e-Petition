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

/*
 * 입력 도우미·휴대폰 편의 (모두 이 브라우저 안에서만 동작하고, 없어도 서버가 다시 확인합니다)
 */
(function () {
  var d = document;
  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  function el(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function after(ref, node) { ref.parentNode.insertBefore(node, ref.nextSibling); return node; }
  var store = null;
  try { store = window.localStorage; store.getItem('x'); } catch (e) { store = null; }
  function get(k) { try { return store ? store.getItem(k) : null; } catch (e) { return null; } }
  function set(k, v) { try { if (store) store.setItem(k, v); } catch (e) { /* 무시 */ } }
  function del(k) { try { if (store) store.removeItem(k); } catch (e) { /* 무시 */ } }

  // 1) 글자 수 세기: 제목·내용 등 maxlength 가 있는 글칸
  $$('form textarea[maxlength], form input#title[maxlength]').forEach(function (f) {
    var max = Number(f.getAttribute('maxlength'));
    if (!max) return;
    var c = after(f, el('p', 'counter hint'));
    c.setAttribute('aria-live', 'polite');
    function upd() {
      var n = f.value.length;
      c.textContent = n.toLocaleString('ko-KR') + ' / ' + max.toLocaleString('ko-KR') + '자';
      c.classList.toggle('warn', n > max * 0.9);
    }
    f.addEventListener('input', upd);
    upd();
  });

  // 2) 개인정보 경고: 주민등록번호·카드번호·계좌번호처럼 보이는 숫자
  var PII = [
    [/\d{6}\s*-\s*[1-8]\d{6}/, '주민등록번호'],
    [/\b(?:\d{4}[- ]){3}\d{4}\b/, '카드번호'],
    [/여권\s*번호|[MSROD]\d{8}\b/, '여권번호'],
  ];
  $$('#title, #content').forEach(function (f) {
    var w = after(f, el('p', 'pii-warn', ''));
    w.hidden = true;
    w.setAttribute('role', 'alert');
    f.addEventListener('input', function () {
      var hit = null;
      for (var i = 0; i < PII.length; i++) if (PII[i][0].test(f.value)) { hit = PII[i][1]; break; }
      w.hidden = !hit;
      w.textContent = hit ? hit + '로 보이는 숫자가 있습니다. 공개되면 위험하니 지워 주세요. (주민등록번호는 접수되지 않습니다)' : '';
    });
  });

  // 3) 첨부파일 미리 확인: 3개, 하나에 5MB, 허용 형식
  var files = $('#files');
  if (files) {
    var fmsg = after(files, el('ul', 'file-list'));
    files.addEventListener('change', function () {
      while (fmsg.firstChild) fmsg.removeChild(fmsg.firstChild);
      var list = Array.prototype.slice.call(files.files || []);
      var bad = [];
      if (list.length > 3) bad.push('파일은 3개까지 붙일 수 있습니다.');
      list.forEach(function (f) {
        var ok = /\.(jpe?g|png|pdf|hwpx?)$/i.test(f.name);
        var mb = f.size / 1048576;
        var li = el('li', null, f.name + ' (' + (mb < 0.1 ? '0.1' : mb.toFixed(1)) + 'MB)');
        if (!ok) bad.push(f.name + ': 붙일 수 없는 형식입니다.');
        if (mb > 5) bad.push(f.name + ': 5MB 를 넘습니다.');
        fmsg.appendChild(li);
      });
      bad.forEach(function (b) { var li = el('li', 'err', b); li.setAttribute('role', 'alert'); fmsg.appendChild(li); });
      files.setCustomValidity(bad.length ? bad[0] : '');
    });
  }

  // 4) 필수 항목 진행 표시 + 5) 보내기 전 확인 + 6) 두 번 눌림 막기 + 7) 나가기 경고
  var cform = $('form[data-draft]');
  if (cform) {
    var req = $$('[required]', cform).filter(function (x) { return x.type !== 'hidden'; });
    var bar = el('div', 'progress no-print');
    var meter = el('progress');
    meter.max = req.length || 1;
    var label = el('span', 'hint');
    bar.appendChild(meter); bar.appendChild(label);
    cform.insertBefore(bar, cform.firstChild);
    function filled(x) {
      if (x.type === 'radio') return !!cform.querySelector('input[name="' + x.name + '"]:checked');
      if (x.type === 'checkbox') return x.checked;
      return !!String(x.value || '').trim();
    }
    function prog() {
      var n = req.filter(filled).length;
      meter.value = n;
      label.textContent = '필수 항목 ' + req.length + '개 가운데 ' + n + '개를 채웠습니다.';
    }
    cform.addEventListener('input', prog);
    cform.addEventListener('change', prog);
    prog();

    var dirty = false;
    cform.addEventListener('input', function () { dirty = true; });
    window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

    // 미리 보기
    var pv = el('button', 'btn no-print', '미리 보기');
    pv.type = 'button';
    var box = el('section', 'preview');
    box.hidden = true;
    box.setAttribute('aria-live', 'polite');
    var submit = $('button[type=submit]', cform);
    if (submit) { submit.parentNode.insertBefore(pv, submit); submit.parentNode.insertBefore(box, pv); }
    pv.addEventListener('click', function () {
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el('h2', null, '이렇게 접수됩니다'));
      var dl = el('dl');
      [['kind', '민원 종류'], ['category', '분야'], ['name', '이름'], ['mobile', '휴대전화'], ['title', '제목'], ['content', '내용']].forEach(function (p) {
        var v = '';
        var f = cform.elements[p[0]];
        if (!f) return;
        if (f.length !== undefined && !f.tagName) { var c = cform.querySelector('input[name="' + p[0] + '"]:checked'); v = c ? (c.closest('label') || c).textContent.trim() : ''; }
        else if (f.tagName === 'SELECT') v = f.selectedIndex > 0 ? f.options[f.selectedIndex].text : '';
        else v = f.value;
        dl.appendChild(el('dt', null, p[1]));
        dl.appendChild(el('dd', p[0] === 'content' ? 'pre' : null, v || '(비어 있음)'));
      });
      var fl = files && files.files ? files.files.length : 0;
      dl.appendChild(el('dt', null, '첨부파일')); dl.appendChild(el('dd', null, fl ? fl + '개' : '없음'));
      box.appendChild(dl);
      box.hidden = false;
      box.scrollIntoView({ block: 'start' });
    });

    // 내용 예시 넣기 (비어 있을 때만)
    var content = $('#content', cform);
    if (content) {
      var ex = el('button', 'btn small no-print', '내용 쓰는 틀 넣기');
      ex.type = 'button';
      content.parentNode.insertBefore(ex, content);
      ex.addEventListener('click', function () {
        if (content.value.trim() && !confirm('이미 쓴 내용 뒤에 틀을 붙일까요?')) return;
        content.value = (content.value ? content.value + '\n\n' : '') + '언제: \n어디서: \n무엇이 문제인지: \n바라는 처리: ';
        content.dispatchEvent(new Event('input', { bubbles: true }));
        content.focus();
      });
    }
    cform.addEventListener('submit', function () { dirty = false; });
  }
  // 모든 신청·저장 버튼: 두 번 눌러 두 번 접수되지 않게
  d.addEventListener('submit', function (e) {
    var f = e.target;
    if (e.defaultPrevented || f.method.toLowerCase() !== 'post' || f.hasAttribute('data-check-url')) return;
    if (f.getAttribute('data-sent')) { e.preventDefault(); return; }
    f.setAttribute('data-sent', '1');
    $$('button[type=submit]', f).forEach(function (b) { b.setAttribute('aria-disabled', 'true'); b.classList.add('busy'); });
    setTimeout(function () { f.removeAttribute('data-sent'); $$('button.busy', f).forEach(function (b) { b.classList.remove('busy'); b.removeAttribute('aria-disabled'); }); }, 8000);
  });
  // 확인이 필요한 버튼 (탈퇴·취하 등)
  d.addEventListener('submit', function (e) {
    var m = e.target.getAttribute('data-confirm');
    if (m && !confirm(m)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // 8) 전화번호 자동 하이픈
  function hyphen(v) {
    var n = v.replace(/\D/g, '').slice(0, 11);
    if (/^02/.test(n)) return n.length < 3 ? n : n.length < 6 ? n.slice(0, 2) + '-' + n.slice(2) : n.length < 10 ? n.slice(0, 2) + '-' + n.slice(2, 5) + '-' + n.slice(5) : n.slice(0, 2) + '-' + n.slice(2, 6) + '-' + n.slice(6, 10);
    if (n.length < 4) return n;
    if (n.length < 8) return n.slice(0, 3) + '-' + n.slice(3);
    if (n.length < 11) return n.slice(0, 3) + '-' + n.slice(3, 6) + '-' + n.slice(6);
    return n.slice(0, 3) + '-' + n.slice(3, 7) + '-' + n.slice(7);
  }
  $$('input[type=tel]').forEach(function (f) {
    f.addEventListener('blur', function () { if (f.value) f.value = hyphen(f.value); });
  });

  // 9) 이메일 오타 알려 주기
  var TYPO = { 'gmial.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'naver.co': 'naver.com', 'navre.com': 'naver.com',
    'nave.com': 'naver.com', 'daum.ent': 'daum.net', 'duam.net': 'daum.net', 'hanmail.ent': 'hanmail.net', 'hanmil.net': 'hanmail.net', 'kakao.co': 'kakao.com' };
  $$('input[type=email]').forEach(function (f) {
    var tip = after(f, el('p', 'hint tip'));
    tip.hidden = true;
    f.addEventListener('blur', function () {
      var m = /@(.+)$/.exec(f.value.trim().toLowerCase());
      var fix = m && TYPO[m[1]];
      tip.hidden = !fix;
      while (tip.firstChild) tip.removeChild(tip.firstChild);
      if (!fix) return;
      var b = el('button', 'linkish', f.value.replace(/@.+$/, '@' + fix));
      b.type = 'button';
      tip.appendChild(d.createTextNode('혹시 '));
      tip.appendChild(b);
      tip.appendChild(d.createTextNode(' 인가요?'));
      b.addEventListener('click', function () { f.value = b.textContent; tip.hidden = true; f.focus(); });
    });
  });

  // 10) 비밀번호 보기·숨기기, 11) Caps Lock 알림, 12) 세기, 13) 확인 일치
  $$('input[type=password]').forEach(function (f) {
    var wrap = el('span', 'pw-tools no-print');
    var show = el('button', 'linkish', '비밀번호 보기');
    show.type = 'button';
    show.setAttribute('aria-pressed', 'false');
    show.setAttribute('aria-controls', f.id);
    var caps = el('span', 'caps', 'Caps Lock 이 켜져 있습니다');
    caps.hidden = true;
    wrap.appendChild(show); wrap.appendChild(caps);
    after(f, wrap);
    show.addEventListener('click', function () {
      var on = f.type === 'password';
      f.type = on ? 'text' : 'password';
      show.textContent = on ? '비밀번호 숨기기' : '비밀번호 보기';
      show.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    f.addEventListener('keyup', function (e) { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); });
    f.addEventListener('blur', function () { caps.hidden = true; });
  });
  var pw = $('input#password[autocomplete=new-password]');
  if (pw) {
    var st = after(pw, el('p', 'strength hint'));
    st.setAttribute('aria-live', 'polite');
    pw.addEventListener('input', function () {
      var v = pw.value;
      var kinds = (/[a-zA-Z]/.test(v) ? 1 : 0) + (/\d/.test(v) ? 1 : 0) + (/[^a-zA-Z0-9]/.test(v) ? 1 : 0);
      var score = !v ? 0 : v.length >= 12 && kinds >= 3 ? 3 : (v.length >= 10 && kinds >= 2) || (v.length >= 8 && kinds >= 3) ? 2 : 1;
      if (/(.)\1\1/.test(v) || /0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf/i.test(v)) score = Math.min(score, 1);
      st.className = 'strength hint s' + score;
      st.textContent = ['', '비밀번호 세기: 약함', '비밀번호 세기: 보통', '비밀번호 세기: 강함'][score];
    });
  }
  var pw2 = $('input#password2');
  if (pw2 && pw) {
    var mt = after(pw2, el('p', 'match hint'));
    mt.setAttribute('aria-live', 'polite');
    function cmp() {
      if (!pw2.value) { mt.textContent = ''; return; }
      var ok = pw.value === pw2.value;
      mt.textContent = ok ? '두 비밀번호가 같습니다.' : '두 비밀번호가 다릅니다.';
      mt.className = 'match hint ' + (ok ? 'ok' : 'bad');
    }
    pw.addEventListener('input', cmp); pw2.addEventListener('input', cmp);
  }

  // 14) 가입할 때 아이디 바로 확인
  var lid = $('form[action="/signup"] #loginId');
  if (lid && window.fetch) {
    var lm = after(lid, el('p', 'hint idcheck'));
    lm.setAttribute('aria-live', 'polite');
    var lt = null;
    lid.addEventListener('input', function () {
      clearTimeout(lt);
      lid.value = lid.value.toLowerCase();
      var v = lid.value.trim();
      if (v.length < 5) { lm.textContent = ''; return; }
      lt = setTimeout(function () {
        fetch('/signup/check?loginId=' + encodeURIComponent(v), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (lid.value.trim() !== v) return;
            lm.textContent = j.reason || '';
            lm.className = 'hint idcheck ' + (j.available === true ? 'ok' : j.available === false ? 'bad' : '');
          }).catch(function () {});
      }, 600);
    });
  }

  // 15) 접수번호 모양 맞추기, 16) 최근 조회한 접수번호 (원할 때만 이 기기에 저장)
  var rno = $('form[action="/lookup"] #receiptNo');
  if (rno) {
    rno.setAttribute('inputmode', 'numeric');
    rno.addEventListener('blur', function () {
      var n = rno.value.replace(/\D/g, '');
      if (n.length > 4 && n.length <= 10) rno.value = n.slice(0, 4) + '-' + ('000000' + n.slice(4)).slice(-6);
    });
    var lf = rno.form;
    var KEY = 'ep-recent-receipts';
    var recent = [];
    try { recent = JSON.parse(get(KEY) || '[]'); } catch (e) { recent = []; }
    if (!Array.isArray(recent)) recent = [];
    var rememberWrap = el('p', 'hint no-print');
    var cb = el('input'); cb.type = 'checkbox'; cb.id = 'rememberNo';
    var lb = el('label', null, ' 이 기기에 접수번호 기억 (비밀번호는 저장하지 않음, 여러 사람이 쓰는 PC 에서는 켜지 마세요)');
    lb.setAttribute('for', 'rememberNo');
    cb.checked = recent.length > 0;
    rememberWrap.appendChild(cb); rememberWrap.appendChild(lb);
    var submitBtn = $('button[type=submit]', lf);
    if (submitBtn) submitBtn.parentNode.insertBefore(rememberWrap, submitBtn);
    if (recent.length) {
      var rl = el('p', 'recent no-print');
      rl.appendChild(d.createTextNode('최근 조회: '));
      recent.forEach(function (no) {
        if (!/^\d{4}-\d{6}$/.test(no)) return;
        var b = el('button', 'btn small', no); b.type = 'button';
        b.addEventListener('click', function () { rno.value = no; var p = $('#password', lf); if (p) p.focus(); });
        rl.appendChild(b);
      });
      var clr = el('button', 'linkish', '지우기'); clr.type = 'button';
      clr.addEventListener('click', function () { del(KEY); rl.remove(); cb.checked = false; });
      rl.appendChild(clr);
      after(rno, rl);
    }
    lf.addEventListener('submit', function () {
      if (!cb.checked) { del(KEY); return; }
      var no = rno.value.trim();
      if (!/^\d{4}-\d{6}$/.test(no)) return;
      recent = [no].concat(recent.filter(function (x) { return x !== no; })).slice(0, 5);
      set(KEY, JSON.stringify(recent));
    });
  }

  // 17) 글 화면: 주소 복사·공유, 목록으로
  var m = /^\/(consultations|notices)\/\d+$/.exec(location.pathname);
  var h1 = $('main h1');
  if (m && h1) {
    var bar2 = el('p', 'share no-print');
    var back = el('a', 'btn small', '목록으로');
    back.href = '/' + m[1];
    bar2.appendChild(back);
    if (navigator.share) {
      var sh = el('button', 'btn small', '공유'); sh.type = 'button';
      sh.addEventListener('click', function () { navigator.share({ title: h1.textContent, url: location.href }).catch(function () {}); });
      bar2.appendChild(sh);
    } else if (navigator.clipboard) {
      var cp = el('button', 'btn small', '주소 복사'); cp.type = 'button';
      cp.addEventListener('click', function () { navigator.clipboard.writeText(location.href).then(function () { cp.textContent = '복사했습니다'; }); });
      bar2.appendChild(cp);
    }
    var pr = el('button', 'btn small', '인쇄'); pr.type = 'button'; pr.setAttribute('data-print', '');
    bar2.appendChild(pr);
    after(h1, bar2);
  }

  // 18) 글칸 높이 자동
  $$('textarea').forEach(function (t) {
    function grow() { if (t.scrollHeight > t.clientHeight && t.clientHeight < 600) t.style.height = Math.min(600, t.scrollHeight + 4) + 'px'; }
    t.addEventListener('input', grow);
  });

  // 19) '/' 키로 검색칸 바로 가기
  d.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    var a = d.activeElement;
    if (a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
    var q = $('main input[type=search], main input[name=q]');
    if (q) { e.preventDefault(); q.focus(); }
  });

  // 20) 맨 위로 버튼 (스크롤했을 때만)
  var top = $('[data-to-top]');
  if (top) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () { top.hidden = window.scrollY < 600; ticking = false; });
    }, { passive: true });
    top.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo(0, 0); var mm = $('#main'); if (mm) mm.focus({ preventScroll: true }); });
  }

  // 21) 고대비 (이 브라우저에 기억)
  var root = d.documentElement;
  function contrast(on) {
    root.classList.toggle('hc', on);
    $$('[data-contrast-toggle]').forEach(function (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  }
  contrast(get('ep-contrast') === 'on');
  d.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-contrast-toggle]');
    if (!b) return;
    var on = !root.classList.contains('hc');
    set('ep-contrast', on ? 'on' : 'off');
    contrast(on);
  });

  // 22) 자동 로그아웃 남은 시간 (누르면 연장)
  var sl = $('[data-session-idle]');
  if (sl) {
    var idle = Number(sl.getAttribute('data-session-idle')) || 0;
    var left = $('[data-left]', sl);
    var until = Date.now() + idle * 1000;
    var warned = false;
    var tick = function () {
      var s = Math.max(0, Math.round((until - Date.now()) / 1000));
      left.textContent = s >= 120 ? Math.floor(s / 60) + '분' : s + '초';
      sl.classList.toggle('warn', s < 120);
      if (s < 120 && !warned) { warned = true; sl.setAttribute('aria-live', 'assertive'); }
      if (s === 0) { clearInterval(iv); location.href = '/login?expired=1&next=' + encodeURIComponent(location.pathname); }
    };
    var iv = setInterval(tick, 15000);
    tick();
    sl.addEventListener('click', function () {
      fetch('/session/ping', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        if (r.status === 204) { until = Date.now() + idle * 1000; warned = false; sl.removeAttribute('aria-live'); tick(); }
        else location.href = '/login';
      }).catch(function () {});
    });
    // 남은 시간이 짧으면 1초마다
    setInterval(function () { if (until - Date.now() < 120000) tick(); }, 1000);
  }

  // 23) 인터넷 끊김 알림
  var off = el('div', 'offline-bar no-print', '인터넷 연결이 끊겼습니다. 다시 연결되면 이어서 할 수 있습니다.');
  off.setAttribute('role', 'status');
  off.hidden = navigator.onLine !== false;
  d.body.appendChild(off);
  window.addEventListener('offline', function () { off.hidden = false; });
  window.addEventListener('online', function () { off.hidden = true; });

  // 24) 휴대폰 신호가 약할 때: 서비스 워커 (화면 꾸밈 파일만 저장, 민원 화면은 저장하지 않음)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  // 25) 빠른 메뉴(하단) 현재 위치 표시
  $$('.tabbar a').forEach(function (a) {
    var hp = a.getAttribute('href');
    if (hp === location.pathname || (hp !== '/' && location.pathname.indexOf(hp + '/') === 0)) a.setAttribute('aria-current', 'page');
  });
})();
