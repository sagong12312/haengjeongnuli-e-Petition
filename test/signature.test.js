'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bodyHash, sign, signHeaders, canonicalString } = require('../src/signature');

// 규격 3. "서명 예시 (구현 확인용)" — 행정누리 EPetitionSignatureTest 와 같은 값
test('규격 서명 예시와 같은 값을 만든다', () => {
  const body = Buffer.from('{"receiptNo":"2026-000123","password":"abc12345"}', 'utf8');
  assert.equal(bodyHash(body), 'b656e7a3e15040730d5f10601d863bf9e5772037078b318a548eb2b38e37c42e');
  assert.equal(
    sign('example-secret-0123456789-abcdefghij', 'POST', '/api/epetition/v1/complaints/lookup',
      '1763280000', '3f9c2a7e5b1d4c6f8a0e2b4d6f8a1c3e', body),
    '023b7f4b0d86966d4097b5559e801b09d4d2672414b2d895187bf61945e86a2d',
  );
});

test('본문이 없으면 빈 바이트의 해시를 쓴다', () => {
  assert.equal(bodyHash(Buffer.alloc(0)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.match(canonicalString('get', '/api/epetition/v1/consultations?page=2', '1', 'n', undefined),
    /^GET\n\/api\/epetition\/v1\/consultations\?page=2\n1\nn\ne3b0c442/);
});

test('signHeaders 는 유닉스 초·규격에 맞는 논스·소문자 64자 서명을 만든다', () => {
  const h = signHeaders('x'.repeat(32), 'GET', '/api/epetition/v1/dispositions?page=1', Buffer.alloc(0), 1763280000123);
  assert.equal(h['X-EP-Timestamp'], '1763280000');
  assert.match(h['X-EP-Nonce'], /^[A-Za-z0-9_-]{16,64}$/);
  assert.match(h['X-EP-Signature'], /^[0-9a-f]{64}$/);
  const h2 = signHeaders('x'.repeat(32), 'GET', '/a', Buffer.alloc(0));
  assert.notEqual(h['X-EP-Nonce'], h2['X-EP-Nonce']);
});
