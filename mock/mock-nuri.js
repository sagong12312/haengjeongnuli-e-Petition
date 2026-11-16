'use strict';
/**
 * 개발·시험용 행정누리 연동 API 모의 서버 (/api/epetition/v1/**).
 *
 * 실제 행정누리가 아닙니다. 규격의 인증(서명·시각·논스·허용 주소·본문 크기)과 응답 꼴만 흉내 냅니다.
 * - 처리기한은 실제 계산(민원처리법 시행령·근무시간·공휴일)을 하지 않고 대강 더한 값입니다.
 * - 비밀번호는 실제 행정누리처럼 BCrypt 가 아니라 Node 내장 scrypt 로 해시합니다.
 * 운영에 쓰지 마세요.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { sign, safeEqualHex } = require('../src/signature');

const PREFIX = '/api/epetition/v1';
const MAX_BODY = 256 * 1024;
const KIND_LABEL = { QUERY: '질의민원', SUGGESTION: '건의민원', OTHER: '기타민원', GRIEVANCE: '고충민원' };
const NOTIFY = ['문자', '이메일', '팩스', '우편', '방문 수령'];

function kst(d) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 16);
}

function maskName(n) {
  const c = [...n];
  if (c.length <= 1) return n;
  if (c.length === 2) return c[0] + '*';
  return c[0] + '*'.repeat(c.length - 2) + c[c.length - 1];
}

function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: crypto.scryptSync(pw, salt, 32) };
}

function checkPw(pw, rec) {
  return crypto.timingSafeEqual(crypto.scryptSync(pw, rec.salt, 32), rec.hash);
}

function ipInCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const v4 = (s) => s.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
  if (!net.isIPv4(ip) || !net.isIPv4(range)) return ip === range;
  const bits = Number(bitsStr ?? 32);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (v4(ip) & mask) === (v4(range) & mask);
}

function createMockNuri({
  enabled = true,
  secret,
  networks = ['127.0.0.1/32', '::1/128'],
  now = () => Date.now(),
  seed = true,
} = {}) {
  const nonces = new Map(); // nonce → 만료 시각
  const complaints = new Map(); // receiptNo → 기록
  const failures = new Map(); // receiptNo → { count, lockedUntil }
  let seq = 0;
  let nextId = 1;
  const accessLog = [];

  const json = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  const ok = (res, data) => json(res, 200, { ok: true, data });
  const fail = (res, status, error, message) => json(res, status, message ? { ok: false, error, message } : { ok: false, error });

  function addComplaint(input, at = new Date(now())) {
    seq += 1;
    const year = new Date(at.getTime() + 9 * 3600e3).getUTCFullYear();
    const receiptNo = `${year}-${String(seq).padStart(6, '0')}`;
    const add = { QUERY: input.lawInterpretation ? 14 * 24 : 7 * 24, SUGGESTION: 14 * 24, GRIEVANCE: 7 * 24, OTHER: 3 }[input.kind];
    const rec = {
      id: nextId++,
      receiptNo,
      kind: input.kind,
      title: input.title,
      content: input.content,
      name: input.name,
      notifyMethod: input.notifyMethod,
      publicConsent: !!input.publicConsent,
      published: false,
      status: 'RECEIVED',
      receivedAt: kst(at),
      deadlineAt: kst(new Date(at.getTime() + add * 3600e3)),
      dept: null,
      steps: [{ step: '접수', at: kst(at) }],
      result: null,
      pw: hashPw(input.password),
    };
    complaints.set(receiptNo, rec);
    return rec;
  }

  function view(rec, masked) {
    return {
      receiptNo: rec.receiptNo,
      kindLabel: KIND_LABEL[rec.kind],
      title: rec.title,
      content: rec.content,
      name: masked ? maskName(rec.name) : rec.name,
      status: rec.status,
      statusLabel: { RECEIVED: '접수', IN_PROGRESS: '처리 중', DONE: '처리 완료' }[rec.status],
      receivedAt: rec.receivedAt,
      deadlineAt: rec.deadlineAt,
      dept: rec.dept,
      steps: rec.steps,
      ...(rec.result ? { result: rec.result } : {}),
    };
  }

  /** 개발용: 담당 배정 → 처리 완료 → 게시 */
  function complete(receiptNo, { dept = '도로과', type = '답변', text = '처리했습니다.', remedy = null, publish = false } = {}) {
    const rec = complaints.get(receiptNo);
    const t = kst(new Date(now()));
    rec.dept = dept;
    rec.steps.push({ step: '담당 배정', at: t }, { step: '처리 완료', at: t });
    rec.status = 'DONE';
    rec.result = { type, text, remedy, completedAt: t, notifiedBy: rec.notifyMethod || '문자' };
    rec.published = publish && rec.publicConsent;
    return rec;
  }

  const dispositions = [];
  if (seed) {
    const r1 = addComplaint({ kind: 'OTHER', name: '홍길동', title: '가로등 고장', content: '중앙로 가로등이 꺼져 있습니다.', password: 'seed1234pw', publicConsent: true, notifyMethod: '문자' });
    complete(r1.receiptNo, { text: '가로등을 고쳤습니다.', publish: true });
    const r2 = addComplaint({ kind: 'SUGGESTION', name: '김철', title: '공원 <벤치> 설치 건의', content: '어린이공원에 벤치를\n더 놓아 주세요.', password: 'seed1234pw', publicConsent: true, notifyMethod: '이메일' });
    complete(r2.receiptNo, {
      dept: '공원녹지과', type: '일부 수용', text: '벤치 2개를 설치하겠습니다.', publish: true,
      remedy: '예산 사정으로 요청하신 5개 가운데 2개만 설치합니다. 이 처분에 이의가 있으면 처분이 있음을 안 날부터 90일 이내에 행정심판 또는 행정소송을 청구할 수 있습니다.',
    });
    const today = kst(new Date(now())).slice(0, 10);
    dispositions.push({
      decidedOn: today, bizName: '○○식당', bizType: '일반음식점영업', address: '○○시 중앙로 1',
      law: '식품위생법', kind: '영업정지', startDate: today, endDate: today, amount: null,
      violation: '유통기한 경과 제품 보관', basis: '식품위생법 제75조',
    }, {
      decidedOn: today, bizName: '△△미용실', bizType: '미용업', address: '○○시 시장길 7',
      law: '공중위생관리법', kind: '과태료', startDate: null, endDate: null, amount: 500000,
      violation: '영업자 위생교육 미이수', basis: '공중위생관리법 제22조',
    });
  }

  function paginate(list, page) {
    const size = 20;
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    return { total, page, totalPages, items: list.slice((page - 1) * size, page * size) };
  }

  function authenticate(req, rawPath, body) {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (!networks.some((c) => ipInCidr(ip, c))) return [403, 'forbidden_network'];
    const ts = req.headers['x-ep-timestamp'];
    const nonce = req.headers['x-ep-nonce'];
    const sig = req.headers['x-ep-signature'];
    const nowSec = Math.floor(now() / 1000);
    if (!/^\d{1,12}$/.test(ts || '') || Math.abs(nowSec - Number(ts)) > 300) return [401, 'bad_timestamp'];
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce || '')) return [401, 'bad_signature'];
    if (!/^[0-9a-f]{64}$/.test(sig || '')) return [401, 'bad_signature'];
    const expected = sign(secret, req.method, rawPath, ts, nonce, body);
    if (!safeEqualHex(expected, sig)) return [401, 'bad_signature'];
    for (const [n, exp] of nonces) if (exp < nowSec) nonces.delete(n);
    if (nonces.has(nonce)) return [401, 'replayed'];
    nonces.set(nonce, nowSec + 600);
    accessLog.push({ method: req.method, path: rawPath.split('?')[0], clientIp: req.headers['x-ep-client-ip'] || null });
    return null;
  }

  function handleComplaint(res, p) {
    if (!KIND_LABEL[p.kind]) return fail(res, 400, 'invalid_kind', '질의·건의·고충·기타 민원만 접수합니다. 법정민원은 정부24나 창구에서 신청해 주세요.');
    if (p.privacyConsent !== true) return fail(res, 400, 'invalid_input', '개인정보 수집·이용에 동의해야 접수할 수 있습니다.');
    if (typeof p.name !== 'string' || !p.name.trim() || [...p.name].length > 100) return fail(res, 400, 'invalid_input', '이름을 확인해 주세요.');
    if (typeof p.title !== 'string' || !p.title.trim() || [...p.title].length > 300 ||
        typeof p.content !== 'string' || !p.content.trim() || [...p.content].length > 20000) {
      return fail(res, 400, 'invalid_content', '제목과 내용을 확인해 주세요.');
    }
    if (typeof p.password !== 'string' || !/^(?=.*[A-Za-z])(?=.*\d).{8,20}$/.test(p.password)) {
      return fail(res, 400, 'invalid_password', '조회 비밀번호는 영문과 숫자를 섞어 8~20자로 정해 주세요.');
    }
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) return fail(res, 400, 'invalid_input', '이메일 주소를 확인해 주세요.');
    let nm = p.notifyMethod;
    if (nm && !NOTIFY.includes(nm)) return fail(res, 400, 'invalid_input', '통지 방법을 확인해 주세요.');
    if (!nm) nm = p.mobile ? '문자' : '이메일';
    if (nm === '문자' && !p.mobile && !p.homePhone) return fail(res, 400, 'invalid_input', '문자로 통지받으려면 전화번호가 필요합니다.');
    if (nm === '이메일' && !p.email) return fail(res, 400, 'invalid_input', '이메일로 통지받으려면 이메일 주소가 필요합니다.');
    if (nm === '팩스' && !p.fax) return fail(res, 400, 'invalid_input', '팩스로 통지받으려면 팩스 번호가 필요합니다.');
    const rec = addComplaint({ ...p, notifyMethod: nm });
    const nFiles = Array.isArray(p.files) ? p.files.length : 0;
    rec.files = nFiles ? p.files.map((f) => ({ name: f.name, size: Buffer.from(f.contentBase64 || '', 'base64').length })) : [];
    return ok(res, { receiptNo: rec.receiptNo, kind: rec.kind, kindLabel: KIND_LABEL[rec.kind], receivedAt: rec.receivedAt, deadlineAt: rec.deadlineAt, files: nFiles });
  }

  function handleLookup(res, p) {
    const receiptNo = typeof p.receiptNo === 'string' ? p.receiptNo : '';
    const f = failures.get(receiptNo);
    if (f && f.lockedUntil > now()) {
      return fail(res, 423, 'locked', `비밀번호를 5번 틀려 ${kst(new Date(f.lockedUntil)).replace('T', ' ')}까지 조회할 수 없습니다.`);
    }
    const rec = complaints.get(receiptNo);
    if (!rec || typeof p.password !== 'string' || !checkPw(p.password, rec.pw)) {
      if (rec) {
        const cur = f && f.lockedUntil <= now() && f.count >= 5 ? { count: 0, lockedUntil: 0 } : (f || { count: 0, lockedUntil: 0 });
        cur.count += 1;
        if (cur.count >= 5) cur.lockedUntil = now() + 30 * 60 * 1000;
        failures.set(receiptNo, cur);
      }
      return fail(res, 401, 'not_matched', '접수번호 또는 비밀번호가 맞지 않습니다.');
    }
    failures.delete(receiptNo);
    return ok(res, view(rec, false));
  }

  function published() {
    return [...complaints.values()].filter((r) => r.status === 'DONE' && r.publicConsent && r.published).reverse();
  }

  async function handler(req, res) {
    const rawPath = req.url;
    const u = new URL(rawPath, 'http://x');
    if (!enabled || !secret || secret.length < 32 || !u.pathname.startsWith(PREFIX + '/')) {
      res.statusCode = 404;
      return res.end();
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > (req.method === 'POST' && req.url.endsWith('/complaints') ? 21 * 1024 * 1024 : MAX_BODY)) return fail(res, 413, 'body_too_large');
      chunks.push(c);
    }
    const body = Buffer.concat(chunks);
    const authErr = authenticate(req, rawPath, body);
    if (authErr) return fail(res, authErr[0], authErr[1]);

    const p = u.pathname.slice(PREFIX.length);
    let payload = null;
    if (req.method === 'POST') {
      try { payload = JSON.parse(body.toString('utf8')); } catch { return fail(res, 400, 'bad_request', '요청 형식이 올바르지 않습니다.'); }
      if (!payload || typeof payload !== 'object') return fail(res, 400, 'bad_request', '요청 형식이 올바르지 않습니다.');
    }
    const page = Math.max(1, Number.parseInt(u.searchParams.get('page') || '1', 10) || 1);
    const q = (u.searchParams.get('q') || '').slice(0, 100);

    if (req.method === 'POST' && p === '/complaints') return handleComplaint(res, payload);
    if (req.method === 'POST' && p === '/complaints/lookup') return handleLookup(res, payload);
    if (req.method === 'GET' && p === '/consultations') {
      const list = published().filter((r) => !q || r.title.includes(q) || r.content.includes(q)).map((r) => ({
        id: r.id, receiptNo: r.receiptNo, kindLabel: KIND_LABEL[r.kind], title: r.title, name: maskName(r.name),
        receivedAt: r.receivedAt, completedAt: r.result.completedAt, dept: r.dept,
      }));
      return ok(res, paginate(list, page));
    }
    const m = /^\/consultations\/(\d+)$/.exec(p);
    if (req.method === 'GET' && m) {
      const rec = published().find((r) => r.id === Number(m[1]));
      return rec ? ok(res, view(rec, true)) : fail(res, 404, 'not_found', '공개된 상담이 아닙니다.');
    }
    if (req.method === 'GET' && p === '/dispositions') {
      return ok(res, paginate(dispositions.filter((d) => !q || d.bizName.includes(q) || d.address.includes(q)), page));
    }
    return fail(res, 404, 'not_found', '없는 주소입니다.');
  }

  return { handler, complaints, complete, accessLog, dispositions };
}

if (require.main === module) {
  const secret = process.env.EP_SECRET || process.env.APP_EPETITION_SECRET;
  if (!secret || secret.length < 32) {
    console.error('EP_SECRET (32자 이상)을 지정하세요.');
    process.exit(1);
  }
  const mock = createMockNuri({ secret });
  const port = Number(process.env.MOCK_PORT || 9090);
  http.createServer((req, res) => mock.handler(req, res).catch(() => { res.statusCode = 500; res.end(); }))
    .listen(port, '127.0.0.1', () => console.info(`행정누리 모의 서버: http://127.0.0.1:${port}${PREFIX} (개발용)`));
}

module.exports = { createMockNuri, maskName, ipInCidr };
