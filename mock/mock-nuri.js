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
const { CATEGORIES } = require('../src/validation');

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
  const notices = [];
  const faqs = [];
  const tokens = new Map(); // actionToken → { receiptNo, exp }
  const likes = new Set(); // id:ip
  const members = new Map(); // memberId → 회원
  let nextMemberId = 1;
  const issueToken = (rec) => {
    const t = crypto.randomBytes(24).toString('base64url');
    tokens.set(t, { receiptNo: rec.receiptNo, exp: now() + 20 * 60e3 });
    return t;
  };
  const byToken = (t) => {
    const e = tokens.get(t);
    return e && e.exp > now() ? complaints.get(e.receiptNo) : null;
  };

  const json = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
    return true;
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
      category: CATEGORIES[input.category] ? input.category : 'ETC',
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
      pw: hashPw(input.password || crypto.randomBytes(12).toString('hex')),
      memberId: input.memberId || null,
      views: 0,
      likes: 0,
      addenda: 0,
      satisfaction: null,
    };
    complaints.set(receiptNo, rec);
    return rec;
  }

  function ownerView(rec) {
    const done = rec.status === 'DONE';
    const withdrawn = rec.result && rec.result.type === '취하';
    return {
      ...view(rec, false),
      actionToken: issueToken(rec),
      canWithdraw: !done,
      canAddendum: !done && rec.addenda < 5,
      canRate: done && !withdrawn && !rec.satisfaction,
      ...(rec.satisfaction ? { satisfaction: rec.satisfaction } : {}),
    };
  }

  function memberView(m) {
    const { pw, fails, lockedUntil, ...rest } = m;
    return rest;
  }

  function view(rec, masked) {
    return {
      receiptNo: rec.receiptNo,
      kindLabel: KIND_LABEL[rec.kind],
      category: rec.category,
      categoryLabel: CATEGORIES[rec.category][0],
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
    const r1 = addComplaint({ kind: 'OTHER', category: 'ROAD', name: '홍길동', title: '가로등 고장', content: '중앙로 가로등이 꺼져 있습니다.', password: 'seed1234pw', publicConsent: true, notifyMethod: '문자' });
    complete(r1.receiptNo, { text: '가로등을 고쳤습니다.', publish: true });
    const r2 = addComplaint({ kind: 'SUGGESTION', category: 'PARK', name: '김철', title: '공원 <벤치> 설치 건의', content: '어린이공원에 벤치를\n더 놓아 주세요.', password: 'seed1234pw', publicConsent: true, notifyMethod: '이메일' });
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
    if (p.category !== undefined && p.category !== null && !CATEGORIES[p.category]) return fail(res, 422, 'invalid_category', '민원 분야를 다시 골라 주세요.');
    if (p.privacyConsent !== true) return fail(res, 400, 'invalid_input', '개인정보 수집·이용에 동의해야 접수할 수 있습니다.');
    if (typeof p.name !== 'string' || !p.name.trim() || [...p.name].length > 100) return fail(res, 400, 'invalid_input', '이름을 확인해 주세요.');
    if (typeof p.title !== 'string' || !p.title.trim() || [...p.title].length > 300 ||
        typeof p.content !== 'string' || !p.content.trim() || [...p.content].length > 20000) {
      return fail(res, 400, 'invalid_content', '제목과 내용을 확인해 주세요.');
    }
    if (p.memberId !== undefined && !members.has(p.memberId)) return fail(res, 404, 'member_not_found', '회원 정보를 찾을 수 없습니다.');
    if (!(p.memberId && p.password === undefined) && (typeof p.password !== 'string' || !/^(?=.*[A-Za-z])(?=.*\d).{8,20}$/.test(p.password))) {
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
    return ok(res, ownerView(rec));
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
      const kind = u.searchParams.get('kind');
      const cat = u.searchParams.get('category');
      const sort = u.searchParams.get('sort');
      let src = published().filter((r) => (!q || r.title.includes(q) || r.content.includes(q)) && (!kind || r.kind === kind) && (!cat || r.category === cat));
      if (sort === 'views') src = [...src].sort((a, b) => b.views - a.views);
      if (sort === 'likes') src = [...src].sort((a, b) => b.likes - a.likes);
      const list = src.map((r) => ({
        id: r.id, receiptNo: r.receiptNo, kind: r.kind, kindLabel: KIND_LABEL[r.kind], category: r.category, categoryLabel: CATEGORIES[r.category][0], title: r.title, name: maskName(r.name),
        receivedAt: r.receivedAt, completedAt: r.result.completedAt, dept: r.dept, views: r.views, likes: r.likes,
      }));
      return ok(res, paginate(list, page));
    }
    const m = /^\/consultations\/(\d+)$/.exec(p);
    if (req.method === 'GET' && m) {
      const rec = published().find((r) => r.id === Number(m[1]));
      if (!rec) return fail(res, 404, 'not_found', '공개된 상담이 아닙니다.');
      rec.views += 1;
      const ip = req.headers['x-ep-client-ip'] || '';
      const related = published().filter((r) => r.kind === rec.kind && r.id !== rec.id).slice(0, 5)
        .map((r) => ({ id: r.id, title: r.title, completedAt: r.result.completedAt }));
      return ok(res, { ...view(rec, true), views: rec.views, likes: rec.likes, liked: likes.has(`${rec.id}:${ip}`), related });
    }
    const portal = handlePortal(req, res, p, payload, page, q, u, req.headers['x-ep-client-ip'] || '');
    if (portal !== undefined) return portal;
    if (req.method === 'GET' && p === '/dispositions') {
      return ok(res, paginate(dispositions.filter((d) => !q || d.bizName.includes(q) || d.address.includes(q)), page));
    }
    return fail(res, 404, 'not_found', '없는 주소입니다.');
  }

  /** 공지·자주 묻는 질문·안내·통계·공감·민원인이 하는 일·회원. 처리하지 않으면 undefined */
  function handlePortal(req, res, p, b, page, q, u, ip) {
    const G = req.method === 'GET';
    const P = req.method === 'POST';
    if (G && p === '/info') {
      return ok(res, { kinds: Object.entries(KIND_LABEL).map(([kind, label]) => ({ kind, label, description: `${label} 설명`, period: '7일', online: true }))
        .concat([{ kind: 'LEGAL', label: '법정민원', description: '인허가 등', period: '민원별', online: false }]),
        categories: Object.entries(CATEGORIES).map(([category, [label, examples]]) => ({ category, label, examples })), maxAddenda: 5 });
    }
    if (G && p === '/stats') {
      const all = [...complaints.values()];
      const done = all.filter((r) => r.status === 'DONE' && r.result.type !== '취하');
      const sat = done.filter((r) => r.satisfaction);
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now()); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i);
        months.push({ month: d.toISOString().slice(0, 7), received: i === 0 ? all.length : 0, done: i === 0 ? done.length : 0 });
      }
      return ok(res, {
        from: months[0].month, to: months[11].month, received: all.length, done: done.length,
        withdrawn: all.filter((r) => r.result && r.result.type === '취하').length, online: all.length,
        avgDays: done.length ? 1.5 : null, onTimeRate: done.length ? 100 : null, satisfactionCount: sat.length,
        satisfactionAvg: sat.length ? sat.reduce((a, r) => a + r.satisfaction.score, 0) / sat.length : null,
        satisfactionDist: [1, 2, 3, 4, 5].map((n) => sat.filter((r) => r.satisfaction.score === n).length), months,
        kinds: Object.entries(KIND_LABEL).map(([kind, label]) => ({ kind, label, received: all.filter((r) => r.kind === kind).length, done: done.filter((r) => r.kind === kind).length })),
      });
    }
    if (G && p === '/notices') {
      const list = notices.filter((n) => !q || n.title.includes(q) || n.content.includes(q))
        .map(({ content, ...n }) => n).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.id - a.id);
      return ok(res, paginate(list, page));
    }
    let m = /^\/notices\/(\d+)$/.exec(p);
    if (G && m) {
      const n = notices.find((x) => x.id === Number(m[1]));
      if (!n) return fail(res, 404, 'not_found', '공지사항을 찾을 수 없습니다.');
      n.views += 1;
      return ok(res, n);
    }
    if (G && p === '/security-apps') return ok(res, { items: securityApps.filter((a) => a.use) });
    if (G && p === '/faqs') {
      const groups = new Map();
      for (const f of faqs) { if (!groups.has(f.category)) groups.set(f.category, []); groups.get(f.category).push({ id: f.id, question: f.question, answer: f.answer }); }
      return ok(res, { categories: [...groups].map(([category, items]) => ({ category, items })) });
    }
    m = /^\/consultations\/(\d+)\/like$/.exec(p);
    if (P && m) {
      const rec = published().find((r) => r.id === Number(m[1]));
      if (!rec) return fail(res, 404, 'not_found', '공개된 상담이 아닙니다.');
      const k = `${rec.id}:${ip}`;
      const added = !likes.has(k);
      if (added) { likes.add(k); rec.likes += 1; }
      return ok(res, { added, likes: rec.likes });
    }
    if (P && ['/complaints/withdraw', '/complaints/addendum', '/complaints/satisfaction'].includes(p)) {
      const rec = byToken(b.token);
      if (!rec) return fail(res, 401, 'token_expired', '조회한 지 오래되었습니다. 처리상황을 다시 조회해 주세요.');
      const t = kst(new Date(now()));
      if (p === '/complaints/withdraw') {
        if (rec.status === 'DONE') return fail(res, 409, 'already_done', '처리가 끝난 민원은 취하할 수 없습니다.');
        rec.status = 'DONE';
        rec.result = { type: '취하', text: '민원인이 전자민원으로 민원을 취하했습니다.', remedy: null, completedAt: t, notifiedBy: '전자민원' };
        rec.steps.push({ step: '민원 취하', at: t, text: b.reason || '취하' });
        return ok(res, { receiptNo: rec.receiptNo, withdrawnAt: t });
      }
      if (p === '/complaints/addendum') {
        if (rec.status === 'DONE') return fail(res, 409, 'already_done', '처리가 끝난 민원에는 의견을 덧붙일 수 없습니다.');
        if (rec.addenda >= 5) return fail(res, 409, 'too_many', '추가 의견은 5번까지 낼 수 있습니다.');
        if (typeof b.text !== 'string' || !b.text.trim()) return fail(res, 422, 'invalid_input', '추가 의견을 적어 주세요.');
        rec.addenda += 1;
        rec.steps.push({ step: '민원인 추가 의견', at: t, text: b.text });
        return ok(res, { receiptNo: rec.receiptNo, count: rec.addenda });
      }
      if (!(b.score >= 1 && b.score <= 5)) return fail(res, 422, 'invalid_input', '만족도를 1~5점 가운데 골라 주세요.');
      if (rec.status !== 'DONE' || rec.satisfaction || rec.result.type === '취하') return fail(res, 409, 'cannot_rate', '처리가 끝난 민원에만, 한 번만 응답할 수 있습니다.');
      rec.satisfaction = { score: b.score, comment: b.comment || null, at: t };
      return ok(res, { receiptNo: rec.receiptNo, score: b.score });
    }
    // 회원
    if (G && p === '/members/check') {
      const id = u.searchParams.get('loginId') || '';
      const taken = [...members.values()].some((x) => x.loginId === id);
      return ok(res, { available: !taken, reason: taken ? '이미 쓰고 있는 아이디입니다.' : '' });
    }
    if (P && p === '/members') {
      if (b.termsConsent !== true || b.privacyConsent !== true) return fail(res, 422, 'consent_required', '이용약관과 개인정보 수집·이용에 동의해야 가입할 수 있습니다.');
      if (!/^[a-z][a-z0-9_]{4,19}$/.test(b.loginId || '')) return fail(res, 422, 'invalid_login_id', '아이디 규칙을 확인하세요.');
      if (typeof b.password !== 'string' || b.password.length < 8) return fail(res, 422, 'invalid_password', '비밀번호 규칙을 확인하세요.');
      if ([...members.values()].some((x) => x.loginId === b.loginId)) return fail(res, 409, 'login_id_taken', '이미 쓰고 있는 아이디입니다. 다른 아이디를 정하세요.');
      const mem = { memberId: nextMemberId++, loginId: b.loginId, name: b.name, mobile: b.mobile || null, email: b.email || null,
        address: b.address || null, createdAt: kst(new Date(now())), pwChangedAt: kst(new Date(now())), pw: hashPw(b.password), fails: 0, lockedUntil: 0 };
      members.set(mem.memberId, mem);
      return ok(res, memberView(mem));
    }
    if (P && p === '/members/login' && b.loginId === 'blocked_ip') {
      return fail(res, 429, 'too_many_attempts', '로그인을 여러 번 틀렸습니다. 10분 뒤 다시 시도해 주세요.');
    }
    if (P && p === '/members/login') {
      const mem = [...members.values()].find((x) => x.loginId === b.loginId);
      if (!mem) return fail(res, 401, 'not_matched', '아이디 또는 비밀번호가 맞지 않습니다.');
      if (mem.lockedUntil > now()) return fail(res, 423, 'locked', '비밀번호를 여러 번 틀려 잠시 로그인할 수 없습니다.');
      if (typeof b.password !== 'string' || !checkPw(b.password, mem.pw)) {
        mem.fails += 1;
        if (mem.fails >= 5) { mem.fails = 0; mem.lockedUntil = now() + 30 * 60e3; }
        return fail(res, 401, 'not_matched', '아이디 또는 비밀번호가 맞지 않습니다.');
      }
      mem.fails = 0;
      const prev = mem.lastLoginAt || null;
      mem.lastLoginAt = kst(new Date(now()));
      return ok(res, { ...memberView(mem), previousLoginAt: prev });
    }
    m = /^\/members\/(\d+)(\/.*)?$/.exec(p);
    if (m) {
      const mem = members.get(Number(m[1]));
      if (!mem) return fail(res, 404, 'member_not_found', '회원 정보를 찾을 수 없습니다. 다시 로그인해 주세요.');
      const rest = m[2] || '';
      if (G && rest === '') return ok(res, memberView(mem));
      if (P && rest === '/profile') {
        if (!b.name) return fail(res, 422, 'invalid_input', '이름을 적으세요.');
        Object.assign(mem, { name: b.name, mobile: b.mobile || null, email: b.email || null, address: b.address || null });
        return ok(res, memberView(mem));
      }
      if (P && rest === '/password') {
        if (typeof b.currentPassword !== 'string' || !checkPw(b.currentPassword, mem.pw)) return fail(res, 422, 'wrong_password', '지금 비밀번호가 맞지 않습니다.');
        mem.pw = hashPw(b.newPassword);
        mem.pwChangedAt = kst(new Date(now()));
        return ok(res, { changed: true });
      }
      if (P && rest === '/delete') {
        if (typeof b.password !== 'string' || !checkPw(b.password, mem.pw)) return fail(res, 422, 'wrong_password', '비밀번호가 맞지 않습니다.');
        let n = 0;
        for (const r of complaints.values()) if (r.memberId === mem.memberId) { r.memberId = null; n += 1; }
        members.delete(mem.memberId);
        return ok(res, { deleted: true, complaints: n });
      }
      const mine = [...complaints.values()].filter((r) => r.memberId === mem.memberId).reverse();
      if (G && rest === '/complaints') {
        const st = u.searchParams.get('status');
        const q = (u.searchParams.get('q') || '').trim();
        const pick = mine.filter((r) => (st === 'open' ? r.status !== 'DONE' : st === 'done' ? r.status === 'DONE' : true) && (!q || r.title.includes(q)));
        return ok(res, paginate(pick.map((r) => ({ receiptNo: r.receiptNo, kindLabel: KIND_LABEL[r.kind], title: r.title, status: r.status,
          statusLabel: r.result && r.result.type === '취하' ? '취하' : { RECEIVED: '접수', IN_PROGRESS: '처리 중', DONE: '처리 완료' }[r.status],
          receivedAt: r.receivedAt, deadlineAt: r.deadlineAt, completedAt: r.result ? r.result.completedAt : null })), page));
      }
      const mm = /^\/complaints\/(\d{4}-\d{6})$/.exec(rest);
      if (G && mm) {
        const rec = mine.find((r) => r.receiptNo === mm[1]);
        return rec ? ok(res, ownerView(rec)) : fail(res, 404, 'not_found', '내 민원 가운데 그 접수번호가 없습니다.');
      }
    }
    return undefined;
  }

  /** 개발용: 공지·자주 묻는 질문 넣기 */
  function addNotice(title, content, pinned = false) {
    const n = { id: notices.length + 1, title, content, pinned, views: 0, createdAt: kst(new Date(now())), updatedAt: null };
    notices.push(n);
    return n;
  }
  const securityApps = [];
  function addSecurityApp(a) {
    const app = { id: securityApps.length + 1, version: 1, use: true, required: false, purpose: '', guide: '', url: null, checkUrl: null, ...a };
    securityApps.push(app);
    return app;
  }
  function addFaq(category, question, answer) {
    faqs.push({ id: faqs.length + 1, category, question, answer });
  }
  if (seed) {
    addNotice('전자민원 이용 안내', '질의·건의·고충·기타 민원을 인터넷으로 신청할 수 있습니다.', true);
    addFaq('민원 신청', '첨부파일은 몇 개까지 붙일 수 있나요?', '3개까지, 하나에 5MB까지입니다.');
  }

  return { handler, complaints, complete, accessLog, dispositions, notices, faqs, members, addNotice, addFaq, securityApps, addSecurityApp };
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
