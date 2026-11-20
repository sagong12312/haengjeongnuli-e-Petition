'use strict';
/**
 * 행정누리 내부 시스템 연동 API (/api/epetition/v1/**) 호출기.
 *
 * - 서버 대 서버 호출만 합니다. 국민 브라우저는 행정누리에 직접 붙지 않습니다.
 * - 서명한 바이트와 보내는 바이트가 같도록 본문을 한 번만 직렬화하고,
 *   경로와 쿼리도 직접 만든 문자열을 그대로 요청 줄에 씁니다 (라이브러리 재인코딩 방지).
 * - 요청·응답 본문은 로그에 남기지 않습니다 (비밀번호·연락처 포함).
 */
const http = require('node:http');
const https = require('node:https');
const { signHeaders } = require('./signature');

const API_PREFIX = '/api/epetition/v1';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** 연동 자체가 잘못된 경우 (국민에게 원인을 보여 주지 않음) */
const INTEGRATION_ERRORS = new Set([
  'forbidden_network', 'bad_timestamp', 'bad_signature', 'replayed', 'body_too_large', 'https_required',
]);

/** 행정누리가 돌려준 업무 오류 (message 는 국민에게 보여 줄 수 있는 안내) */
class NuriApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.name = 'NuriApiError';
    this.status = status;
    this.code = code;
    this.publicMessage = message || null;
  }
}

/** 행정누리에 닿지 않거나 연동 설정이 틀린 경우 */
class NuriUnavailableError extends Error {
  constructor(reason, status) {
    super(reason);
    this.name = 'NuriUnavailableError';
    this.status = status || 0;
    this.reason = reason;
  }
}

function createNuriClient({ baseUrl, secret, timeoutMs = 10000, ca, logger = console }) {
  const base = new URL(baseUrl);
  const transport = base.protocol === 'https:' ? https : http;
  const pathPrefix = base.pathname.replace(/\/+$/, '');
  const agent = new transport.Agent({ keepAlive: true, maxSockets: 50, ...(ca ? { ca } : {}) });

  function request(method, apiPathAndQuery, payload, clientIp) {
    const body = payload === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(payload), 'utf8');
    const pathAndQuery = pathPrefix + API_PREFIX + apiPathAndQuery;
    const headers = {
      ...signHeaders(secret, method, pathAndQuery, body),
      Accept: 'application/json',
    };
    if (body.length > 0) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      headers['Content-Length'] = String(body.length);
    }
    if (clientIp) headers['X-EP-Client-IP'] = clientIp;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          protocol: base.protocol,
          hostname: base.hostname,
          port: base.port || undefined,
          method,
          path: pathAndQuery,
          headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > MAX_RESPONSE_BYTES) {
              res.destroy();
              reject(new NuriUnavailableError('response_too_large', res.statusCode));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* 아래에서 처리 */ }
            const status = res.statusCode;
            if (status === 200 && json && json.ok === true) {
              resolve(json.data);
              return;
            }
            const code = json && typeof json.error === 'string' ? json.error : null;
            if (code && INTEGRATION_ERRORS.has(code)) {
              logger.error(`[nuri] 연동 인증 실패 status=${status} error=${code} ${method} ${apiPathAndQuery.split('?')[0]}` +
                (code === 'bad_timestamp' ? ' (서버 시각 동기화(NTP)를 확인하세요)' : ''));
              reject(new NuriUnavailableError(code, status));
              return;
            }
            if (status >= 400 && status < 500 && json && json.ok === false && code) {
              reject(new NuriApiError(status, code, typeof json.message === 'string' ? json.message : null));
              return;
            }
            logger.error(`[nuri] 예상하지 못한 응답 status=${status} error=${code || '-'} ${method} ${apiPathAndQuery.split('?')[0]}` +
              (status === 404 && !json ? ' (행정누리 APP_EPETITION_ENABLED/SECRET 설정을 확인하세요)' : ''));
            reject(new NuriUnavailableError(code || `http_${status}`, status));
          });
          res.on('error', () => reject(new NuriUnavailableError('response_error')));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => {
        logger.error(`[nuri] 연결 실패 ${method} ${apiPathAndQuery.split('?')[0]}: ${e.code || e.message}`);
        reject(new NuriUnavailableError(e.message === 'timeout' ? 'timeout' : 'connect_error'));
      });
      req.end(body);
    });
  }

  function pageQuery(page, q) {
    let qs = `?page=${encodeURIComponent(String(page))}`;
    if (q) qs += `&q=${encodeURIComponent(q)}`;
    return qs;
  }

  return {
    /** 5-1 민원 접수 */
    submitComplaint(complaint, clientIp) {
      return request('POST', '/complaints', complaint, clientIp);
    },
    /** 5-2 처리상황 조회 (비밀번호가 주소·로그에 남지 않도록 POST) */
    lookupComplaint(receiptNo, password, clientIp) {
      return request('POST', '/complaints/lookup', { receiptNo, password }, clientIp);
    },
    /** 5-3 공개 상담 목록 (kind: QUERY 등, sort: recent·views·likes) */
    listConsultations(page, q, clientIp, { kind, category, sort } = {}) {
      let qs = pageQuery(page, q);
      if (kind) qs += `&kind=${encodeURIComponent(kind)}`;
      if (category) qs += `&category=${encodeURIComponent(category)}`;
      if (sort) qs += `&sort=${encodeURIComponent(sort)}`;
      return request('GET', '/consultations' + qs, undefined, clientIp);
    },
    /** 공개 상담 "도움이 됐어요" (같은 사람은 한 번) */
    likeConsultation(id, clientIp) {
      return request('POST', `/consultations/${encodeURIComponent(String(id))}/like`, {}, clientIp);
    },
    /** 5-4 공개 상담 한 건 */
    getConsultation(id, clientIp) {
      return request('GET', `/consultations/${encodeURIComponent(String(id))}`, undefined, clientIp);
    },
    /** 5-5 행정처분 공개 */
    listDispositions(page, q, clientIp) {
      return request('GET', '/dispositions' + pageQuery(page, q), undefined, clientIp);
    },
    /* ---------------- 안내·통계·공지·자주 묻는 질문 */
    info(clientIp) { return request('GET', '/info', undefined, clientIp); },
    stats(clientIp) { return request('GET', '/stats', undefined, clientIp); },
    listNotices(page, q, clientIp) { return request('GET', '/notices' + pageQuery(page, q), undefined, clientIp); },
    getNotice(id, clientIp) { return request('GET', `/notices/${encodeURIComponent(String(id))}`, undefined, clientIp); },
    faqs(clientIp) { return request('GET', '/faqs', undefined, clientIp); },
    securityApps(clientIp) { return request('GET', '/security-apps', undefined, clientIp); },

    /* ---------------- 민원인이 하는 일 (조회 때 받은 actionToken) */
    withdraw(token, reason, clientIp) { return request('POST', '/complaints/withdraw', { token, reason }, clientIp); },
    addendum(token, text, clientIp) { return request('POST', '/complaints/addendum', { token, text }, clientIp); },
    rate(token, score, comment, clientIp) { return request('POST', '/complaints/satisfaction', { token, score, comment }, clientIp); },

    /* ---------------- 회원 */
    signup(member, clientIp) { return request('POST', '/members', member, clientIp); },
    login(loginId, password, clientIp) { return request('POST', '/members/login', { loginId, password }, clientIp); },
    checkLoginId(loginId, clientIp) { return request('GET', `/members/check?loginId=${encodeURIComponent(loginId)}`, undefined, clientIp); },
    getMember(memberId, clientIp) { return request('GET', `/members/${encodeURIComponent(String(memberId))}`, undefined, clientIp); },
    updateMember(memberId, profile, clientIp) {
      return request('POST', `/members/${encodeURIComponent(String(memberId))}/profile`, profile, clientIp);
    },
    changeMemberPassword(memberId, currentPassword, newPassword, clientIp) {
      return request('POST', `/members/${encodeURIComponent(String(memberId))}/password`, { currentPassword, newPassword }, clientIp);
    },
    deleteMember(memberId, password, clientIp) {
      return request('POST', `/members/${encodeURIComponent(String(memberId))}/delete`, { password }, clientIp);
    },
    memberComplaints(memberId, page, clientIp, status, q) {
      const st = status === 'open' || status === 'done' ? `&status=${status}` : '';
      const qs = q ? `&q=${encodeURIComponent(String(q).slice(0, 50))}` : '';
      return request('GET', `/members/${encodeURIComponent(String(memberId))}/complaints?page=${encodeURIComponent(String(page))}${st}${qs}`, undefined, clientIp);
    },
    memberComplaint(memberId, receiptNo, clientIp) {
      return request('GET', `/members/${encodeURIComponent(String(memberId))}/complaints/${encodeURIComponent(receiptNo)}`, undefined, clientIp);
    },
    close() { agent.destroy(); },
  };
}

module.exports = { createNuriClient, NuriApiError, NuriUnavailableError, API_PREFIX };
