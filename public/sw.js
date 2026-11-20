'use strict';
/*
 * 휴대폰에서 신호가 약할 때를 위한 서비스 워커.
 *  - 화면 꾸밈(CSS·JS·아이콘)만 기기에 저장해 다시 받지 않는다.
 *  - 민원·회원 화면(개인정보가 있을 수 있는 HTML)은 저장하지 않는다. 늘 서버에서 받고,
 *    인터넷이 끊겼을 때만 미리 받아 둔 '연결 끊김 안내'(/offline)를 보여 준다.
 *  - GET 이 아닌 요청(신청·로그인 등)은 손대지 않는다.
 */
var CACHE = 'ep-static-v1';
var OFFLINE = '/offline';

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll([OFFLINE, '/static/icon-192.png']);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 화면 꾸밈 파일: 판(?v=)이 붙어 있으면 내용이 바뀌지 않으므로 저장본을 먼저 쓴다
  if (url.pathname.indexOf('/static/') === 0) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok && /[?&]v=/.test(url.search)) c.put(req, res.clone());
          return res;
        });
      });
    }));
    return;
  }

  // 화면 이동: 늘 서버에서 받고, 끊겼을 때만 안내 화면
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(function () {
      return caches.match(OFFLINE).then(function (r) {
        return r || new Response('인터넷 연결이 끊겼습니다. 연결되면 다시 해 주세요.', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      });
    }));
  }
});
