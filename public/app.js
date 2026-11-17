'use strict';
/*
 * 화면 편의 기능 (없어도 모든 기능은 그대로 쓸 수 있습니다)
 * - 인쇄 버튼, 글자 크게 (이 브라우저에 기억)
 * - 민원 신청서 임시저장: 쓰는 중인 글을 이 브라우저(localStorage)에만 저장합니다.
 *   서버로 보내지 않으며, 비밀번호·자동입력 방지 숫자·첨부파일은 저장하지 않습니다. 접수되면 지웁니다.
 */
(function () {
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
  var SKIP = { password: 1, password2: 1, captcha: 1, captchaId: 1, _csrf: 1, files: 1 };
  var form = document.querySelector('form[data-draft]');
  if (form) {
    var key = 'ep-draft-' + form.getAttribute('data-draft');
    var note = document.querySelector('[data-draft-note]');
    var hasError = !!document.querySelector('.alert-error');
    var saved = null;
    try { saved = JSON.parse(get(key) || 'null'); } catch (e) { saved = null; }
    if (saved && !hasError && saved.v) {
      var used = false;
      Object.keys(saved.v).forEach(function (name) {
        if (SKIP[name]) return;
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
        if (!el.name || SKIP[el.name] || el.type === 'hidden' || el.type === 'file') continue;
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
