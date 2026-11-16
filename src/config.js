'use strict';
const fs = require('node:fs');

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

function int(v, dflt) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * 환경변수에서 설정을 읽습니다. 잘못되면 시작하지 않도록 오류를 던집니다.
 * 서명 비밀값은 환경변수로만 받습니다 (규격 2·6).
 */
function loadConfig(env = process.env) {
  const errors = [];

  const nuriBaseUrl = env.NURI_BASE_URL || '';
  let parsed;
  try {
    parsed = new URL(nuriBaseUrl);
    if (!/^https?:$/.test(parsed.protocol)) errors.push('NURI_BASE_URL 은 http(s) 주소여야 합니다.');
    if (parsed.search || parsed.hash) errors.push('NURI_BASE_URL 에 ? 또는 # 를 넣지 마세요.');
  } catch {
    errors.push('NURI_BASE_URL 이 없거나 올바른 주소가 아닙니다.');
  }

  const secret = env.EP_SECRET || '';
  if (secret.length < 32 || !/^[\x21-\x7E]+$/.test(secret)) {
    errors.push('EP_SECRET 은 영문·숫자·기호로 32자 이상이어야 합니다 (한글 X, 행정누리 APP_EPETITION_SECRET 과 같은 값).');
  }
  // 이름·연락처·조회 비밀번호가 오가므로 행정누리와는 HTTPS로만 (내 PC 시험만 EP_ALLOW_HTTP=true)
  if (parsed && parsed.protocol === 'http:' && !bool(env.EP_ALLOW_HTTP, false)) {
    errors.push('NURI_BASE_URL 은 https:// 로 시작해야 합니다. 내 PC에서 시험할 때만 EP_ALLOW_HTTP=true 를 함께 주세요.');
  }

  let nuriCa;
  if (env.NURI_CA_FILE) {
    try { nuriCa = fs.readFileSync(env.NURI_CA_FILE); } catch { errors.push('NURI_CA_FILE 을 읽을 수 없습니다.'); }
  }

  let tls;
  if (env.TLS_CERT_FILE || env.TLS_KEY_FILE) {
    try {
      tls = { cert: fs.readFileSync(env.TLS_CERT_FILE), key: fs.readFileSync(env.TLS_KEY_FILE) };
    } catch {
      errors.push('TLS_CERT_FILE / TLS_KEY_FILE 을 읽을 수 없습니다.');
    }
  }

  if (errors.length) {
    const err = new Error('설정 오류:\n - ' + errors.join('\n - '));
    err.configErrors = errors;
    throw err;
  }

  return {
    nuriBaseUrl,
    secret,
    nuriCa,
    nuriTimeoutMs: int(env.NURI_TIMEOUT_MS, 10000),
    host: env.HOST || '0.0.0.0',
    port: int(env.PORT, 8080),
    tls,
    trustProxy: bool(env.TRUST_PROXY, false),
    cookieSecure: bool(env.COOKIE_SECURE, true),
    orgName: env.ORG_NAME || '○○기관',
    orgContact: env.ORG_CONTACT || '기관 민원실',
    // 시험 운영 중 안내 띠 (실제 개인정보를 넣지 않게)
    demoNotice: bool(env.EP_DEMO_NOTICE, false),
    privacyRetention:
      env.PRIVACY_RETENTION || '행정누리 민원 기록 보존기간과 같은 기간 (기관 기록관리 기준)',
  };
}

module.exports = { loadConfig };
