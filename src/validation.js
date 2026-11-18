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

/** 민원 분야 (행정누리 CivilCategory 와 같은 값). 담당 부서를 빨리 찾는 데 씁니다 */
const CATEGORIES = {
  ROAD: ['도로·교통', '도로 파손, 신호등·가로등, 교통 시설'],
  PARKING: ['주차', '불법 주정차, 공영주차장'],
  TRANSIT: ['대중교통', '버스 노선·정류장, 택시'],
  CLEAN: ['환경·청소', '생활 쓰레기, 무단 투기, 소음·악취'],
  WATER: ['상하수도', '수돗물, 누수, 하수구 막힘'],
  PARK: ['공원·녹지', '공원 시설, 가로수, 산림'],
  BUILDING: ['주택·건축', '건축 허가·신고, 공동주택, 불법 건축물'],
  LAND: ['도시계획·토지', '도시계획, 지적, 토지 이용'],
  WELFARE: ['복지', '기초생활보장, 노인·장애인·아동 복지'],
  HEALTH: ['보건·위생', '보건소, 감염병, 식품·공중위생 업소'],
  TAX: ['세무', '지방세 부과·납부, 세외수입'],
  SAFETY: ['안전·재난', '재난·재해, 시설물 안전, 민방위'],
  CULTURE: ['문화·체육·관광', '도서관, 체육시설, 축제·관광'],
  ECONOMY: ['경제·일자리', '일자리, 소상공인, 전통시장'],
  ANIMAL: ['동물', '반려동물 등록, 유기동물, 동물 피해'],
  ADMIN: ['행정·민원 서비스', '증명 발급, 공무원 친절, 행정 절차'],
  ETC: ['기타', '위 분야에 없는 일'],
};

const { normalizeMobile, normalizePhone } = require('./phone');

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
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
/** opts.member: 로그인한 회원이면 조회 비밀번호를 정하지 않아도 된다 */
function validateComplaintForm(f, opts = {}) {
  const errors = {};
  const kind = str(f.kind);
  const category = str(f.category);
  const name = str(f.name);
  const mobileRaw = opt(f.mobile);
  const homeRaw = opt(f.homePhone);
  const faxRaw = opt(f.fax);
  // 행정누리와 같은 꼴(010-1234-5678)로 바꿔 보낸다
  const mobile = mobileRaw ? normalizeMobile(mobileRaw) : null;
  const homePhone = homeRaw ? normalizePhone(homeRaw) : null;
  const fax = faxRaw ? normalizePhone(faxRaw) : null;
  const email = opt(f.email);
  const address = opt(f.address);
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

  if (!CATEGORIES[category]) errors.category = '민원 분야를 골라 주세요. 잘 모르면 “기타”를 고르세요.';

  if (!name) errors.name = '이름을 적어 주세요.';
  else if (len(name) > 100) errors.name = '이름은 100자 이내로 적어 주세요.';

  if (mobileRaw && !mobile) errors.mobile = '휴대전화 번호를 010-1234-5678 꼴로 적어 주세요.';
  if (homeRaw && !homePhone) errors.homePhone = '전화번호를 지역번호부터 02-123-4567 꼴로 적어 주세요.';
  if (email && (!EMAIL_RE.test(email) || len(email) > 200)) errors.email = '이메일 주소를 확인해 주세요 (200자 이내).';
  if (faxRaw && !fax) errors.fax = '팩스 번호를 지역번호부터 02-123-4567 꼴로 적어 주세요 (0505 번호도 됩니다).';
  if (address && len(address) > 500) errors.address = '주소는 500자 이내로 적어 주세요.';

  if (notifyMethod && !NOTIFY_METHODS.includes(notifyMethod)) {
    errors.notifyMethod = '통지 방법을 다시 골라 주세요.';
  } else if (notifyMethod === '문자' && !mobile) {
    // 집 전화로는 문자를 받을 수 없다 (행정누리도 같은 이유로 거절)
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

  if (opts.member && !password && !password2) {
    // 회원은 '내 민원'에서 보므로 비워도 된다
  } else if (!PASSWORD_RE.test(password)) errors.password = '조회 비밀번호는 영문과 숫자를 섞어 8~20자로 정해 주세요.';
  else if (password !== password2) errors.password2 = '비밀번호 확인이 같지 않습니다.';

  if (!privacyConsent) errors.privacyConsent = '개인정보 수집·이용에 동의해야 민원을 접수할 수 있습니다.';

  const payload = {
    kind,
    category,
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
  if (opts.member) {
    payload.memberId = opts.member.memberId;
    if (!password) delete payload.password;
  }
  return { errors, payload };
}

/* ------------------------------------------------------------------ 회원 */

const LOGIN_ID_RE = /^[a-z][a-z0-9_]{4,19}$/;

/** 행정누리와 같은 규칙: 2종류 이상이면 10자 이상, 3종류이면 8자 이상, 64자까지 */
function memberPasswordProblem(pw, loginId) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 64) return '비밀번호는 8~64자로 정해 주세요.';
  const kinds = (/[A-Za-z]/.test(pw) ? 1 : 0) + (/\d/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
  if (!(kinds >= 3 || (kinds >= 2 && pw.length >= 10))) {
    return '영문·숫자·특수문자 가운데 2종류 이상이면 10자 이상, 3종류이면 8자 이상으로 정해 주세요.';
  }
  if (loginId && pw.toLowerCase().includes(loginId.toLowerCase())) return '비밀번호에 아이디를 넣을 수 없습니다.';
  if (/(.)\1\1\1/.test(pw)) return '같은 글자를 4번 넘게 잇달아 쓸 수 없습니다.';
  const low = pw.toLowerCase();
  const common = COMMON_WORDS.find((w) => low.includes(w));
  if (common) return `'${common}'처럼 흔한 낱말이 들어간 비밀번호는 쓸 수 없습니다.`;
  let up = 1; let down = 1;
  for (let i = 1; i < pw.length; i++) {
    const a = pw.charCodeAt(i - 1); const b = pw.charCodeAt(i);
    const digits = a >= 48 && a <= 57 && b >= 48 && b <= 57;
    up = digits && b - a === 1 ? up + 1 : 1;
    down = digits && a - b === 1 ? down + 1 : 1;
    if (up >= 4 || down >= 4) return '1234·4321처럼 4자리 넘게 이어지는 숫자는 쓸 수 없습니다.';
  }
  return null;
}

/** 행정누리 PasswordPolicy.COMMON 과 같은 목록 */
const COMMON_WORDS = ['password', 'passwd', 'qwerty', 'qwer', 'asdf', 'zxcv', '1q2w3e', 'q1w2e3', 'admin', 'welcome', 'iloveyou',
  'letmein', 'abcd', 'korea', 'seoul', 'dragon', 'monkey', 'master', 'login', 'test', 'guest', 'haengjeong', 'nuri'];

/** 이름·휴대전화·이메일·주소 (가입·내 정보 고치기 공통) */
function validateProfile(f, errors) {
  const name = str(f.name);
  const mobileRaw = opt(f.mobile);
  const mobile = mobileRaw ? normalizeMobile(mobileRaw) : null;
  const email = opt(f.email);
  const address = opt(f.address);
  if (!name) errors.name = '이름을 적어 주세요.';
  else if (len(name) > 100) errors.name = '이름은 100자 이내로 적어 주세요.';
  if (mobileRaw && !mobile) errors.mobile = '휴대전화 번호를 010-1234-5678 꼴로 적어 주세요.';
  if (email && (!EMAIL_RE.test(email) || len(email) > 200)) errors.email = '이메일 주소를 확인해 주세요 (200자 이내).';
  if (address && len(address) > 500) errors.address = '주소는 500자 이내로 적어 주세요.';
  return { name, mobile, email, address };
}

function validateSignupForm(f) {
  const errors = {};
  const loginId = str(f.loginId);
  const password = typeof f.password === 'string' ? f.password : '';
  const password2 = typeof f.password2 === 'string' ? f.password2 : '';
  if (!LOGIN_ID_RE.test(loginId)) errors.loginId = '아이디는 영문 소문자로 시작하고 영문 소문자·숫자·밑줄(_)로 5~20자입니다.';
  const pwBad = memberPasswordProblem(password, loginId);
  if (pwBad) errors.password = pwBad;
  else if (password !== password2) errors.password2 = '비밀번호 확인이 같지 않습니다.';
  const profile = validateProfile(f, errors);
  const termsConsent = f.termsConsent === 'true';
  const privacyConsent = f.privacyConsent === 'true';
  if (!termsConsent) errors.termsConsent = '이용약관에 동의해야 가입할 수 있습니다.';
  if (!privacyConsent) errors.privacyConsent = '개인정보 수집·이용에 동의해야 가입할 수 있습니다.';
  return { errors, payload: { loginId, password, ...profile, termsConsent, privacyConsent } };
}

module.exports.validateSignupForm = validateSignupForm;

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
  ...module.exports,
  KINDS, CATEGORIES, NOTIFY_METHODS, validateComplaintForm, validateLookupForm, parseListQuery, PASSWORD_RE, RECEIPT_RE,
  LOGIN_ID_RE, memberPasswordProblem, validateProfile,
};
