import assets from './assets.mjs';

const COOKIE = 'harugyeol_session';
const TTL = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();
const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, extra = {}) {
  return Response.json(data, { status, headers: { ...headers, ...extra } });
}
function page(name) {
  const asset = assets[name];
  return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type } });
}
function redirect(path) {
  return new Response(null, { status: 303, headers: { ...headers, Location: path } });
}
function stmt(db, sql, ...args) {
  return db.prepare(sql).bind(...args);
}
function seconds() {
  return Math.floor(Date.now() / 1000);
}
function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}
function addDays(day, days) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function hex(data) {
  return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function random(size) {
  return hex(crypto.getRandomValues(new Uint8Array(size)));
}
async function digest(text) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 600_000,
  }, key, 256));
}
function sameHash(left, right) {
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}
function tokenFrom(request) {
  const match = request.headers.get('Cookie')?.match(/(?:^|;\s*)harugyeol_session=([a-f0-9]{64})(?=;|$)/);
  return match?.[1];
}
function sessionCookie(url, value, age) {
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age
    + (url.protocol === 'https:' ? '; Secure' : '');
}
async function session(request, db) {
  const token = tokenFrom(request);
  if (!token) return null;
  const hash = await digest(token);
  return stmt(db, `SELECT u.id, u.username, u.start_day, s.token_hash FROM sessions s
    JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?`, hash, seconds()).first();
}

async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].toLowerCase() !== 'application/json') {
    throw new Problem(415, 'JSON 형식의 요청이 필요합니다.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Problem(400, '입력값을 확인해 주세요.');
  const utf8 = new TextDecoder();
  let text = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 32768) {
      await reader.cancel();
      throw new Problem(413, '입력 내용이 너무 깁니다.');
    }
    text += utf8.decode(value, { stream: true });
  }
  try {
    const value = JSON.parse(text + utf8.decode());
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {}
  throw new Problem(400, '입력값을 확인해 주세요.');
}
function checkOrigin(request, url) {
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if ((origin && origin !== url.origin) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
    throw new Problem(403, '같은 사이트에서 다시 시도해 주세요.');
  }
}
async function limit(db, key, max) {
  const bucket = Math.floor(seconds() / 600);
  const row = await stmt(db, `INSERT INTO rate_limits (key, bucket, count) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN bucket = excluded.bucket THEN count + 1 ELSE 1 END,
    bucket = excluded.bucket RETURNING count`, key, bucket).first();
  if (row.count > max) throw new Problem(429, '요청이 많습니다. 잠시 후 다시 시도해 주세요.');
}
async function authenticate(request, url, db, signup) {
  const input = await body(request);
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const password = input.password;
  if (!/^[a-z0-9_]{3,24}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Problem(400, '아이디는 영문·숫자·밑줄 3~24자, 비밀번호는 12~128자로 입력해 주세요.');
  }
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  await limit(db, await digest('ip:' + ip), 45);
  await limit(db, await digest('user:' + username), 12);
  await stmt(db, 'DELETE FROM rate_limits WHERE bucket < ?', Math.floor(seconds() / 600) - 1).run();
  let id;
  if (signup) {
    const salt = random(16);
    const hash = await passwordHash(password, salt);
    id = crypto.randomUUID();
    const result = await stmt(db, `INSERT INTO users (id, username, salt, password_hash)
      VALUES (?, ?, ?, ?) ON CONFLICT(username) DO NOTHING`, id, username, salt, hash).run();
    if (!result.meta.changes) throw new Problem(409, '이미 사용 중인 아이디입니다.');
  } else {
    const account = await stmt(db, 'SELECT id, salt, password_hash FROM users WHERE username = ?', username).first();
    const actual = await passwordHash(password, account?.salt ?? '0'.repeat(32));
    if (!sameHash(actual, account?.password_hash ?? '0'.repeat(64)) || !account) {
      throw new Problem(401, '아이디 또는 비밀번호를 확인해 주세요.');
    }
    id = account.id;
  }
  const token = random(32);
  const old = tokenFrom(request);
  const operations = [
    stmt(db, 'DELETE FROM sessions WHERE expires_at <= ?', seconds()),
    stmt(db, 'INSERT INTO sessions VALUES (?, ?, ?)', await digest(token), id, seconds() + TTL),
  ];
  if (old) operations.push(stmt(db, 'DELETE FROM sessions WHERE token_hash = ?', await digest(old)));
  await db.batch(operations);
  return json({ username }, signup ? 201 : 200, { 'Set-Cookie': sessionCookie(url, token, TTL) });
}

const diaryFields = 'id, day, title, plan, action, reflection, mood, created_at, updated_at';
function field(value, max, label, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Problem(400, label + ' 입력값을 확인해 주세요.');
  }
  return value.trim();
}
function diaryData(input) {
  const { day, mood } = input;
  const date = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(day);
  if (!date || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== day || day < '2000-01-01' || day > kstDay()) {
    throw new Problem(400, '오늘 또는 지난 날짜를 선택해 주세요.');
  }
  if (!['good', 'steady', 'hard', ''].includes(mood)) throw new Problem(400, '하루의 기분을 확인해 주세요.');
  return [day, field(input.title, 80, '제목'), field(input.plan, 2000, '계획'),
    field(input.action, 2000, '실행', false), field(input.reflection, 2000, '회고', false), mood];
}
function missing() {
  return new Problem(404, '기록을 찾을 수 없습니다.');
}

async function diaries(request, db, user, id) {
  const method = request.method;
  if (!id && method === 'GET') {
    const { results } = await stmt(db, `SELECT ${diaryFields} FROM diaries
      WHERE user_id = ? ORDER BY day DESC`, user.id).all();
    return json({ entries: results });
  }
  if (!id && method === 'POST') {
    const data = diaryData(await body(request));
    const now = new Date().toISOString();
    const entry = crypto.randomUUID();
    const results = await db.batch([
      stmt(db, `INSERT INTO diaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, day) DO NOTHING`, entry, user.id, ...data, now, now),
      stmt(db, 'UPDATE users SET start_day = ? WHERE id = ? AND start_day IS NULL', kstDay(), user.id),
    ]);
    if (!results[0].meta.changes) throw new Problem(409, '해당 날짜의 기록이 이미 있습니다.');
    return json({ id: entry }, 201);
  }
  if (!id) throw missing();
  if (method === 'GET') {
    const entry = await stmt(db, `SELECT ${diaryFields} FROM diaries WHERE id = ? AND user_id = ?`, id, user.id).first();
    if (!entry) throw missing();
    return json(entry);
  }
  if (method === 'PUT') {
    const exists = await stmt(db, 'SELECT id FROM diaries WHERE id = ? AND user_id = ?', id, user.id).first();
    if (!exists) throw missing();
    const data = diaryData(await body(request));
    const result = await stmt(db, `UPDATE OR IGNORE diaries SET day = ?, title = ?, plan = ?, action = ?,
      reflection = ?, mood = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ...data, new Date().toISOString(), id, user.id).run();
    if (!result.meta.changes) {
      if (!await stmt(db, 'SELECT id FROM diaries WHERE id = ? AND user_id = ?', id, user.id).first()) throw missing();
      throw new Problem(409, '해당 날짜의 기록이 이미 있습니다.');
    }
    return json({ id });
  }
  if (method === 'DELETE') {
    const result = await stmt(db, 'DELETE FROM diaries WHERE id = ? AND user_id = ?', id, user.id).run();
    if (!result.meta.changes) throw missing();
    return json({ deleted: true });
  }
  throw new Problem(405, '지원하지 않는 요청입니다.');
}

async function rules(request, db, user) {
  const rule = await stmt(db, 'SELECT original, created_at, revised, reason, revised_at FROM rules WHERE user_id = ?', user.id).first();
  const deadline = user.start_day ? addDays(user.start_day, 2) : null;
  if (request.method === 'GET') return json({ rule, deadline, today: kstDay() });
  if (!['POST', 'PUT'].includes(request.method)) throw new Problem(405, '지원하지 않는 요청입니다.');
  const input = await body(request);
  const value = field(input.value, 300, '규칙');
  const now = new Date().toISOString();
  if (request.method === 'POST') {
    const result = await stmt(db, 'INSERT INTO rules (user_id, original, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      user.id, value, now).run();
    if (!result.meta.changes) throw new Problem(409, '최초 규칙이 이미 있습니다.');
    return json({ saved: true }, 201);
  }
  const reason = field(input.reason, 500, '변경 이유');
  if (!rule || rule.revised || !deadline || kstDay() >= deadline || rule.original === value) {
    throw new Problem(409, '첫 기록을 저장한 뒤 3일차가 시작되기 전까지 규칙을 한 번 변경할 수 있습니다.');
  }
  const result = await stmt(db, `UPDATE rules SET revised = ?, reason = ?, revised_at = ?
    WHERE user_id = ? AND revised_at IS NULL`, value, reason, now, user.id).run();
  if (!result.meta.changes) throw new Problem(409, '규칙이 이미 변경되었습니다.');
  return json({ saved: true });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const db = env.DB;
      const method = request.method;
      if (method === 'GET' && path === '/assets/style.css') return page('style.css');
      if (method === 'GET' && path === '/assets/main.js') return page('main.js');
      if (method === 'GET' && ['/','/login','/diary'].includes(path)) {
        const user = await session(request, db);
        if (path === '/diary') return user ? page('diary.html') : redirect('/login');
        return user ? redirect('/diary') : page('login.html');
      }
      if (!path.startsWith('/api/')) return json({ error: '페이지를 찾을 수 없습니다.' }, 404);
      if (method !== 'GET') checkOrigin(request, url);
      if (method === 'POST' && ['/api/signup', '/api/login'].includes(path)) {
        return await authenticate(request, url, db, path === '/api/signup');
      }
      const user = await session(request, db);
      if (!user) throw new Problem(401, '로그인이 필요합니다.');
      if (path === '/api/logout' && method === 'POST') {
        await stmt(db, 'DELETE FROM sessions WHERE token_hash = ?', user.token_hash).run();
        return json({ signedOut: true }, 200, { 'Set-Cookie': sessionCookie(url, '', 0) });
      }
      if (path === '/api/me' && method === 'GET') return json({ username: user.username, startDay: user.start_day });
      if (path === '/api/rules') return await rules(request, db, user);
      const item = path.match(/^\/api\/diaries(?:\/([0-9a-f-]{36}))?$/);
      if (item) return await diaries(request, db, user, item[1]);
      throw missing();
    } catch (error) {
      if (error instanceof Problem) return json({ error: error.message }, error.status);
      console.error('Diary request failed:', error.name);
      return json({ error: '잠시 후 다시 시도해 주세요.' }, 500);
    }
  },
};
