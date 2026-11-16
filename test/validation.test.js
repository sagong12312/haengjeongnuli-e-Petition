'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateComplaintForm, validateLookupForm, parseListQuery } = require('../src/validation');

const base = {
  kind: 'OTHER', name: '홍길동', mobile: '010-1234-5678', title: '가로등 고장',
  content: '중앙로 가로등이 꺼져 있습니다.', password: 'abc12345', password2: 'abc12345', privacyConsent: 'true',
};

test('올바른 입력은 규격 5-1 JSON 꼴로 바뀐다', () => {
  const { errors, payload } = validateComplaintForm({ ...base, publicConsent: 'true' });
  assert.deepEqual(errors, {});
  assert.deepEqual(payload, {
    kind: 'OTHER', lawInterpretation: false, name: '홍길동', mobile: '010-1234-5678', homePhone: null,
    email: null, address: null, fax: null, notifyMethod: null, title: '가로등 고장',
    content: '중앙로 가로등이 꺼져 있습니다.', password: 'abc12345', publicConsent: true, privacyConsent: true,
  });
});

test('법정민원(LEGAL)은 받지 않는다', () => {
  assert.ok(validateComplaintForm({ ...base, kind: 'LEGAL' }).errors.kind.includes('정부24'));
});

test('lawInterpretation 은 질의민원일 때만 true', () => {
  assert.equal(validateComplaintForm({ ...base, lawInterpretation: 'true' }).payload.lawInterpretation, false);
  assert.equal(validateComplaintForm({ ...base, kind: 'QUERY', lawInterpretation: 'true' }).payload.lawInterpretation, true);
});

test('개인정보 동의가 없으면 접수하지 않는다', () => {
  assert.ok(validateComplaintForm({ ...base, privacyConsent: undefined }).errors.privacyConsent);
});

test('비밀번호 규칙: 영문+숫자 8~20자', () => {
  for (const pw of ['abcdefgh', '12345678', 'ab1', 'a1'.repeat(11)]) {
    assert.ok(validateComplaintForm({ ...base, password: pw, password2: pw }).errors.password, pw);
  }
  assert.ok(validateComplaintForm({ ...base, password2: 'abc12346' }).errors.password2);
});

test('통지 방법별 필수 연락처', () => {
  assert.ok(validateComplaintForm({ ...base, notifyMethod: '이메일' }).errors.email);
  assert.ok(validateComplaintForm({ ...base, notifyMethod: '팩스' }).errors.fax);
  assert.ok(validateComplaintForm({ ...base, mobile: '', notifyMethod: '문자' }).errors.notifyMethod);
  assert.deepEqual(validateComplaintForm({ ...base, mobile: '', homePhone: '02-123-4567', notifyMethod: '문자' }).errors, {});
  assert.ok(validateComplaintForm({ ...base, notifyMethod: '전보' }).errors.notifyMethod);
});

test('길이 제한', () => {
  assert.ok(validateComplaintForm({ ...base, name: '가'.repeat(101) }).errors.name);
  assert.ok(validateComplaintForm({ ...base, title: '가'.repeat(301) }).errors.title);
  assert.ok(validateComplaintForm({ ...base, content: '가'.repeat(20001) }).errors.content);
  assert.deepEqual(validateComplaintForm({ ...base, content: '가'.repeat(20000) }).errors, {});
});

test('조회 양식', () => {
  assert.deepEqual(validateLookupForm({ receiptNo: '2026-000123', password: 'abc12345' }).errors, {});
  assert.ok(validateLookupForm({ receiptNo: '2026-12', password: 'x' }).errors.receiptNo);
});

test('목록 쿼리: page 는 1 이상, q 는 100자까지', () => {
  assert.deepEqual(parseListQuery(new URLSearchParams('page=-3&q=' + 'a'.repeat(150))), { page: 1, q: 'a'.repeat(100) });
  assert.deepEqual(parseListQuery(new URLSearchParams('page=2&q=%20가로등%20')), { page: 2, q: '가로등' });
});
