'use strict';
/**
 * multipart/form-data 해석 (민원 신청 첨부용, 외부 라이브러리 없이).
 * 받은 본문 전체(Buffer)를 나눠 { fields: {이름: 값}, files: [{ field, filename, data }] } 로 돌려줍니다.
 * 같은 이름의 글 칸은 처음 값만 씁니다 (urlencoded 처리와 같게).
 */

function boundaryOf(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  const b = m ? (m[1] || m[2]) : null;
  return b && b.length <= 70 ? b : null;
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function dispositionParam(disposition, key) {
  const m = new RegExp(`(?:^|;)\\s*${key}="((?:[^"\\\\]|\\\\.)*)"`, 'i').exec(disposition)
    || new RegExp(`(?:^|;)\\s*${key}=([^;]+)`, 'i').exec(disposition);
  return m ? m[1].replace(/\\(.)/g, '$1').trim() : null;
}

/**
 * @param {Buffer} body
 * @param {string} contentType
 * @param {{maxParts?: number}} opts
 */
function parseMultipart(body, contentType, { maxParts = 60 } = {}) {
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new Error('no_boundary');
  const delim = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let pos = body.indexOf(delim);
  if (pos < 0) throw new Error('bad_multipart');
  let parts = 0;
  for (;;) {
    pos += delim.length;
    // 끝 표시 "--"
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    // 경계 뒤 줄바꿈
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    const headerEnd = body.indexOf('\r\n\r\n', pos);
    if (headerEnd < 0) throw new Error('bad_multipart');
    const next = body.indexOf(Buffer.concat([Buffer.from('\r\n'), delim]), headerEnd + 4);
    if (next < 0) throw new Error('bad_multipart');
    if (++parts > maxParts) throw new Error('too_many_parts');
    const headers = parseHeaders(body.slice(pos, headerEnd).toString('utf8'));
    const data = body.slice(headerEnd + 4, next);
    const disposition = headers['content-disposition'] || '';
    const name = dispositionParam(disposition, 'name');
    const filename = dispositionParam(disposition, 'filename');
    if (name) {
      if (filename !== null) {
        files.push({ field: name, filename, data });
      } else if (!(name in fields)) {
        fields[name] = data.toString('utf8');
      }
    }
    pos = next + 2;
  }
  return { fields, files };
}

module.exports = { parseMultipart, boundaryOf };
