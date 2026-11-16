'use strict';
/**
 * 민원 첨부파일 확인 (행정누리 규격 5-1 files 와 같은 기준).
 * 사진(jpg·jpeg·png)·PDF·한글(hwp·hwpx)만, 3개까지, 하나에 5MB까지.
 * 확장자뿐 아니라 파일 머리(실제 형식)도 확인합니다. 행정누리도 다시 확인합니다.
 */
const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const SIGNATURES = {
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  hwp: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
  hwpx: [[0x50, 0x4b, 0x03, 0x04]],
};

function startsWith(buf, sig) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

/** 경로·제어 문자를 뺀 파일 이름 */
function cleanName(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
}

/**
 * @param {{filename: string, data: Buffer}[]} files 빈 칸(파일을 고르지 않음)은 건너뜁니다
 * @returns {{ error: string|null, payload: {name: string, contentBase64: string}[] }}
 */
function checkAttachments(files) {
  const real = (files || []).filter((f) => f.filename && f.data && f.data.length > 0);
  if (real.length > MAX_FILES) return { error: `첨부파일은 ${MAX_FILES}개까지 붙일 수 있습니다.`, payload: [] };
  const payload = [];
  for (const f of real) {
    const name = cleanName(f.filename);
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!name || !SIGNATURES[ext]) {
      return { error: `사진(jpg·png), PDF, 한글(hwp·hwpx) 파일만 붙일 수 있습니다: ${name || '이름 없음'}`, payload: [] };
    }
    if (f.data.length > MAX_FILE_BYTES) {
      return { error: `첨부파일은 하나에 5MB까지입니다: ${name}`, payload: [] };
    }
    if (!SIGNATURES[ext].some((sig) => startsWith(f.data, sig))) {
      return { error: `파일 내용이 확장자(${ext})와 맞지 않습니다: ${name}`, payload: [] };
    }
    payload.push({ name, contentBase64: f.data.toString('base64') });
  }
  return { error: null, payload };
}

module.exports = { checkAttachments, MAX_FILES, MAX_FILE_BYTES, cleanName };
