'use strict';
/**
 * 국내 전화번호 확인과 표기 통일 (010-1234-5678 꼴). 행정누리(PhoneNumbers.java)와 같은 규칙입니다.
 * 띄어쓰기·점·괄호·하이픈은 있어도 없어도 받습니다.
 * 휴대전화 010(8자리)·011·016~019, 지역번호 02·031~064, 인터넷전화 070, 평생·안심번호 0502~0508, 대표번호 15xx·16xx·18xx.
 */
const MOBILE = [/^(010)(\d{4})(\d{4})$/, /^(01[16789])(\d{3,4})(\d{4})$/];
const OTHERS = [
  /^(02)(\d{3,4})(\d{4})$/,
  /^(0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4]))(\d{3,4})(\d{4})$/,
  /^(070)(\d{4})(\d{4})$/,
  /^(050[2-8])(\d{3,4})(\d{4})$/,
];
const REPRESENTATIVE = /^(1[568]\d{2})(\d{4})$/;

function digits(raw) {
  if (typeof raw !== 'string') return null;
  const d = raw.replace(/[\s.()-]/g, '');
  return /^\d{8,12}$/.test(d) ? d : null;
}

function fmt(res, d) {
  for (const re of res) {
    const m = re.exec(d);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

/** 휴대전화만. 맞지 않으면 null */
function normalizeMobile(raw) {
  const d = digits(raw);
  return d ? fmt(MOBILE, d) : null;
}

/** 집·사무실 전화, 팩스 (휴대전화 번호도 받음). 맞지 않으면 null */
function normalizePhone(raw) {
  const d = digits(raw);
  if (!d) return null;
  const f = fmt(MOBILE, d) || fmt(OTHERS, d);
  if (f) return f;
  const m = REPRESENTATIVE.exec(d);
  return m ? `${m[1]}-${m[2]}` : null;
}

module.exports = { normalizeMobile, normalizePhone };
