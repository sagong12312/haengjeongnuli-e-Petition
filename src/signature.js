'use strict';
/**
 * 행정누리 연동 API 요청 서명 (규격 3. 인증)
 *
 *   본문해시   = hex( SHA-256( 요청 본문 바이트 ) )
 *   기준문자열 = 메서드 + "\n" + 경로와쿼리 + "\n" + Timestamp + "\n" + Nonce + "\n" + 본문해시
 *   서명       = hex( HMAC-SHA256( 비밀값(UTF-8), 기준문자열(UTF-8) ) )
 */
const crypto = require('node:crypto');

const EMPTY = Buffer.alloc(0);

function bodyHash(body) {
  return crypto.createHash('sha256').update(body || EMPTY).digest('hex');
}

function canonicalString(method, pathAndQuery, timestamp, nonce, body) {
  return `${String(method).toUpperCase()}\n${pathAndQuery}\n${timestamp}\n${nonce}\n${bodyHash(body)}`;
}

function sign(secret, method, pathAndQuery, timestamp, nonce, body) {
  return crypto
    .createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(canonicalString(method, pathAndQuery, timestamp, nonce, body), 'utf8')
    .digest('hex');
}

/** 영문·숫자 32자 (UUID에서 - 를 뺀 값). 규격: 16~64자, [A-Za-z0-9_-] */
function newNonce() {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * 요청 헤더 세 개를 만듭니다.
 * body 는 실제로 보낼 바이트(Buffer) 그대로 넘겨야 합니다. 서명 뒤에 다시 직렬화하지 마세요.
 */
function signHeaders(secret, method, pathAndQuery, body, nowMs = Date.now(), nonce = newNonce()) {
  const ts = String(Math.floor(nowMs / 1000));
  return {
    'X-EP-Timestamp': ts,
    'X-EP-Nonce': nonce,
    'X-EP-Signature': sign(secret, method, pathAndQuery, ts, nonce, body),
  };
}

/** 길이가 같을 때만 상수 시간 비교 (모의 서버·테스트용) */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { bodyHash, canonicalString, sign, signHeaders, newNonce, safeEqualHex };
