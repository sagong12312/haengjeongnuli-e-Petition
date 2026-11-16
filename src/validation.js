'use strict';
/**
 * 민원 접수 입력값 확인 (규격 5-1).
 * 행정누리도 다시 확인하지만, 국민이 바로 고칠 수 있게 여기서 먼저 알려 줍니다.
 */

const KINDS = {
  QUERY: '질의민원',
  SUGGESTION: '건의민원',
  GRIEVANCE: '고충민원',
  OTHER: '기타민원',
};

const NOTIFY_METHODS = ['문자', '이메일', '팩스', '우편', '방문 수령'];

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const PHONE_RE = /^0\d{1,2}-?\d{3,4}-?\d{4}$/;
const MOBILE_RE = /^01[016789]-?\d{3,4}-?\d{4}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d!@#$%^&*()_+\-=[\]{};':",.<>/?~`|\\]{8,20}$/;
const RECEIPT_RE = /^\d{4}-\d{6,10}$/;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function opt(v) {
  const s = str(v);
  return s === '' ? null : s;
}

/** 문자 수 (서로게이트 쌍을 한 글자로) */
function len(s) {
  return s ? [...s].length : 0;
}

/**
 * 양식 값 → { errors: {필드: 안내}, payload: 행정누리로 보낼 JSON }
 */
function validateComplaintForm(f) {
  const errors = {};
  const kind = str(f.kind);
  const name = str(f.name);
  const mobile = opt(f.mobile);
  const homePhone = opt(f.homePhone);
  const email = opt(f.email);
  const address = opt(f.address);
  const fax = opt(f.fax);
  let notifyMethod = opt(f.notifyMethod);
  const title = str(f.title);
  const content = typeof f.content === 'string' ? f.content.replace(/\r\n/g, '\n').trim() : '';
  const password = typeof f.password === 'string' ? f.password : '';
  const password2 = typeof f.password2 === 'string' ? f.password2 : '';
  const lawInterpretation = kind === 'QUERY' && f.lawInterpretation === 'true';
  const publicConsent = f.publicConsent === 'true';
  const privacyConsent = f.privacyConsent === 'true';

  if (kind === 'LEGAL') errors.kind = '법정민원은 구비서류와 수수료가 있어 정부24 또는 기관 민원 창구에서 신청해 주세요.';
  else if (!KINDS[kind]) errors.kind = '민원 종류를 골라 주세요.';

  if (!name) errors.name = '이름을 적어 주세요.';
  else if (len(name) > 100) errors.name = '이름은 100자 이내로 적어 주세요.';

  if (mobile && !MOBILE_RE.test(mobile)) errors.mobile = '휴대전화 번호를 010-1234-5678 꼴로 적어 주세요.';
  if (homePhone && !PHONE_RE.test(homePhone)) errors.homePhone = '전화번호를 지역번호부터 02-123-4567 꼴로 적어 주세요.';
  if (email && (!EMAIL_RE.test(email) || len(email) > 200)) errors.email = '이메일 주소를 확인해 주세요 (200자 이내).';
  if (fax && !PHONE_RE.test(fax)) errors.fax = '팩스 번호를 지역번호부터 02-123-4567 꼴로 적어 주세요.';
  if (address && len(address) > 500) errors.address = '주소는 500자 이내로 적어 주세요.';

  if (notifyMethod && !NOTIFY_METHODS.includes(notifyMethod)) {
    errors.notifyMethod = '통지 방법을 다시 골라 주세요.';
  } else if (notifyMethod === '문자' && !mobile && !homePhone) {
    errors.notifyMethod = '문자 통지를 받으려면 휴대전화 번호를 적어 주세요.';
  } else if (notifyMethod === '이메일' && !email) {
    errors.email = '이메일로 통지받으려면 이메일 주소를 적어 주세요.';
  } else if (notifyMethod === '팩스' && !fax) {
    errors.fax = '팩스로 통지받으려면 팩스 번호를 적어 주세요.';
  } else if (notifyMethod === '우편' && !address) {
    errors.address = '우편으로 통지받으려면 주소를 적어 주세요.';
  }
  if (!notifyMethod && !mobile && !email) {
    errors.notifyMethod = '결과를 받을 수 있도록 휴대전화 번호나 이메일을 적거나, 통지 방법을 골라 주세요.';
  }
  if (!notifyMethod) notifyMethod = null; // 비우면 행정누리가 정합니다 (휴대전화 → 문자, 없으면 이메일)

  if (!title) errors.title = '제목을 적어 주세요.';
  else if (len(title) > 300) errors.title = '제목은 300자 이내로 적어 주세요.';

  if (!content) errors.content = '내용을 적어 주세요.';
  else if (len(content) > 20000) errors.content = '내용은 20,000자 이내로 적어 주세요.';

  if (!PASSWORD_RE.test(password)) errors.password = '조회 비밀번호는 영문과 숫자를 섞어 8~20자로 정해 주세요.';
  else if (password !== password2) errors.password2 = '비밀번호 확인이 같지 않습니다.';

  if (!privacyConsent) errors.privacyConsent = '개인정보 수집·이용에 동의해야 민원을 접수할 수 있습니다.';

  const payload = {
    kind,
    lawInterpretation,
    name,
    mobile,
    homePhone,
    email,
    address,
    fax,
    notifyMethod,
    title,
    content,
    password,
    publicConsent,
    privacyConsent,
  };
  return { errors, payload };
}

function validateLookupForm(f) {
  const errors = {};
  const receiptNo = str(f.receiptNo);
  const password = typeof f.password === 'string' ? f.password : '';
  if (!RECEIPT_RE.test(receiptNo)) errors.receiptNo = '접수번호를 2026-000123 꼴로 적어 주세요.';
  if (!password || password.length > 20) errors.password = '조회 비밀번호를 적어 주세요.';
  return { errors, receiptNo, password };
}

/** page: 1 이상 정수, q: 100자 이내 */
function parseListQuery(searchParams) {
  let page = Number.parseInt(searchParams.get('page') || '1', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > 100000) page = 100000;
  let q = (searchParams.get('q') || '').trim();
  if (len(q) > 100) q = [...q].slice(0, 100).join('');
  return { page, q };
}

module.exports = {
  KINDS, NOTIFY_METHODS, validateComplaintForm, validateLookupForm, parseListQuery, PASSWORD_RE, RECEIPT_RE,
};
