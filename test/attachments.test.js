'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMultipart } = require('../src/multipart');
const { checkAttachments } = require('../src/attachments');
const { startStack, makeAgent, hidden } = require('./helpers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const PDF = Buffer.from('%PDF-1.4\n%test\n');

function multipartBody(boundary, fields, files) {
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

test('multipart: 글 칸과 파일(한글 이름, 이진 내용)을 나눈다', () => {
  const b = '----시험경계x'.replace('시험', 'ab');
  const body = multipartBody(b, { title: '가로등 고장', content: '줄1\r\n줄2' }, [{ name: '현장 사진.png', data: PNG }, { name: '', data: Buffer.alloc(0) }]);
  const r = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.equal(r.fields.title, '가로등 고장');
  assert.equal(r.fields.content, '줄1\r\n줄2');
  assert.equal(r.files.length, 2);
  assert.equal(r.files[0].filename, '현장 사진.png');
  assert.ok(r.files[0].data.equals(PNG));
  assert.throws(() => parseMultipart(Buffer.from('xx'), 'multipart/form-data; boundary=zz'));
});

test('첨부 확인: 형식·개수·크기·실제 내용', () => {
  assert.equal(checkAttachments([{ filename: 'a.png', data: PNG }, { filename: 'b.pdf', data: PDF }]).payload.length, 2);
  assert.equal(checkAttachments([{ filename: '', data: Buffer.alloc(0) }]).payload.length, 0); // 고르지 않은 칸
  assert.match(checkAttachments([{ filename: 'a.exe', data: PNG }]).error, /사진/);
  assert.match(checkAttachments([{ filename: 'a.png', data: Buffer.from('MZ fake') }]).error, /맞지 않습니다/);
  assert.match(checkAttachments(Array(4).fill({ filename: 'a.pdf', data: PDF })).error, /3개/);
  assert.match(checkAttachments([{ filename: 'big.pdf', data: Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]) }]).error, /5MB/);
  assert.equal(checkAttachments([{ filename: '..\\..\\x.png', data: PNG }]).payload[0].name, 'x.png');
});

test('화면: 첨부해서 신청하면 행정누리로 함께 간다, 형식이 틀리면 접수하지 않는다', async (t) => {
  const s = await startStack();
  t.after(() => s.close());
  const page = await makeAgent(s.url)('GET', '/complaints/new');
  assert.match(page.text, /enctype="multipart\/form-data"/);
  const base = { kind: 'OTHER', category: 'ROAD', name: '홍길동', mobile: '010-1234-5678', title: '첨부 민원', content: '사진 붙임',
    password: 'abc12345', password2: 'abc12345', privacyConsent: 'true' };
  // makeAgent 는 urlencoded 만 보내므로 직접 fetch 로 보낸다
  const jar = {};
  const post = async (files) => {
    const page = await fetch(s.url + '/complaints/new');
    for (const c of page.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    const html = await page.text();
    const id = hidden(html, 'captchaId');
    const b = 'ep' + Math.random().toString(16).slice(2);
    const body = multipartBody(b, { ...base, _csrf: hidden(html, '_csrf'), captchaId: id, captcha: s.app.captchas.peek(id) }, files);
    const r = await fetch(s.url + '/complaints', { method: 'POST', body,
      headers: { 'Content-Type': `multipart/form-data; boundary=${b}`, Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    return { status: r.status, text: await r.text() };
  };
  const before = s.mock.complaints.size;
  let r = await post([{ name: '현장.png', data: Buffer.from('MZ not png') }]);
  assert.equal(r.status, 400);
  assert.match(r.text, /맞지 않습니다/);
  assert.equal(s.mock.complaints.size, before);
  r = await post([{ name: '현장 사진.png', data: PNG }, { name: '도면.pdf', data: PDF }]);
  assert.equal(r.status, 200, r.text.slice(0, 300));
  assert.match(r.text, /첨부파일<\/dt><dd>2개/);
  const rec = [...s.mock.complaints.values()].pop();
  assert.deepEqual(rec.files.map((f) => f.name), ['현장 사진.png', '도면.pdf']);
});
