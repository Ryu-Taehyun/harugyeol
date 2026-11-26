import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase, d1 } from './local.mjs';

const { default: worker } = await import('../dist/server/index.js');
const origin = 'https://diary.test';
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

test('계정, 세션, 소유권, 계획 규칙', async (t) => {
  const database = await openDatabase(':memory:');
  t.after(() => database.close());
  const env = { DB: d1(database) };

  async function request(label, method, path, { cookie, data, from } = {}) {
    const headers = new Headers();
    if (cookie) headers.set('Cookie', cookie);
    if (from) headers.set('Origin', from);
    if (data) headers.set('Content-Type', 'application/json');
    const response = await worker.fetch(new Request(origin + path, {
      method, headers, body: data && JSON.stringify(data),
    }), env);
    const type = response.headers.get('Content-Type') ?? '';
    const value = type.includes('application/json') ? await response.json() : null;
    const session = response.headers.get('Set-Cookie');
    const safe = value ? JSON.stringify(value) : response.headers.get('Location') ?? 'HTML';
    const maskedPath = path.replace(/[0-9a-f-]{36}$/i, '[기록 ID]');
    const maskedBody = safe.replace(/[0-9a-f-]{36}/gi, '[기록 ID]').replace(/"entries":\[.+\]/, '"entries":[내 기록]');
    t.diagnostic(label + ' | ' + method + ' ' + maskedPath + (cookie ? ' Cookie=[마스킹]' : '')
      + ' | ' + response.status + ' ' + maskedBody + (session ? ' Set-Cookie=[마스킹]' : ''));
    return { status: response.status, value, headers: response.headers, cookie: session?.split(';')[0] };
  }

  const data = { day: today, title: 'A의 검증 기록', plan: '계획', action: '실행', reflection: '회고', mood: 'steady' };
  const pw = () => randomBytes(24).toString('base64url');
  const a = { username: 'qa_account_a', password: pw() };
  const b = { username: 'qa_account_b', password: pw() };

  assert.equal((await request('첫 화면', 'GET', '/')).status, 200);
  const locked = await request('비로그인 화면', 'GET', '/diary');
  assert.equal(locked.status, 303);
  assert.equal(locked.headers.get('Location'), '/login');
  assert.equal((await request('비로그인 API', 'GET', '/api/diaries')).status, 401);
  const signA = await request('A 회원가입', 'POST', '/api/signup', { data: a });
  const signB = await request('B 회원가입', 'POST', '/api/signup', { data: b });
  assert.equal(signA.status, 201);
  assert.equal(signB.status, 201);
  const cookieHeader = signA.headers.get('Set-Cookie');
  for (const attribute of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Max-Age=604800']) assert.ok(cookieHeader.includes(attribute));
  const stored = database.prepare('SELECT salt, password_hash FROM users WHERE username = ?').get(a.username);
  assert.equal(stored.salt.length, 32);
  assert.match(stored.password_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.password_hash, a.password);
  assert.notEqual(database.prepare('SELECT token_hash FROM sessions LIMIT 1').get().token_hash, signA.cookie.split('=')[1]);
  t.diagnostic('DB 저장값 검증 | 비밀번호 원문과 불일치, 무작위 salt 16바이트, 해시 32바이트, 세션 토큰 다이제스트 저장');
  assert.equal((await request('잘못된 비밀번호', 'POST', '/api/login', { data: { ...a, password: pw() } })).status, 401);
  const login = await request('A 로그인 및 세션 회전', 'POST', '/api/login', { cookie: signA.cookie, data: a });
  assert.equal(login.status, 200);
  assert.notEqual(login.cookie, signA.cookie);
  assert.equal((await request('회전 이전 세션', 'GET', '/api/me', { cookie: signA.cookie })).status, 401);
  const cookieA = login.cookie;
  const cookieB = signB.cookie;
  assert.equal((await request('A 보호 화면', 'GET', '/diary', { cookie: cookieA })).status, 200);
  assert.equal((await request('최초 규칙', 'POST', '/api/rules', { cookie: cookieA, data: { value: '10분 집중' } })).status, 201);
  const madeA = await request('A 기록 생성', 'POST', '/api/diaries', { cookie: cookieA, data });
  const madeB = await request('B 기록 생성', 'POST', '/api/diaries', { cookie: cookieB, data: { ...data, title: 'B의 검증 기록' } });
  assert.equal(madeA.status, 201);
  assert.equal(madeB.status, 201);
  const idA = madeA.value.id, idB = madeB.value.id;
  assert.equal((await request('같은 날짜 중복 생성', 'POST', '/api/diaries', { cookie: cookieA, data })).status, 409);
  assert.equal((await request('A 규칙 1회 변경', 'PUT', '/api/rules', { cookie: cookieA, data: { value: '15분 집중', reason: '할 일 단위 조정' } })).status, 200);
  assert.equal((await request('A 규칙 2회차 변경', 'PUT', '/api/rules', { cookie: cookieA, data: { value: '20분 집중', reason: '추가 조정' } })).status, 409);
  const savedRule = await request('A 규칙 이력', 'GET', '/api/rules', { cookie: cookieA });
  assert.equal(savedRule.value.rule.original, '10분 집중');
  assert.equal(savedRule.value.rule.revised, '15분 집중');
  assert.equal((await request('B의 규칙 조회', 'GET', '/api/rules', { cookie: cookieB })).value.rule, null);
  await request('B 최초 규칙 저장', 'POST', '/api/rules', { cookie: cookieB, data: { value: '계획 세우기' } });
  database.prepare("UPDATE users SET start_day = '2000-01-01' WHERE username = ?").run(b.username);
  assert.equal((await request('B 3일차 이후 변경 (테스트용 날짜)', 'PUT', '/api/rules', { cookie: cookieB, data: { value: '회고하기', reason: '마감 검증' } })).status, 409);

  for (const [label, cookie, own, foreign] of [['A → B', cookieA, idA, idB], ['B → A', cookieB, idB, idA]]) {
    const list = await request(label + ' 목록', 'GET', '/api/diaries', { cookie });
    assert.deepEqual(list.value.entries.map((entry) => entry.id), [own]);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const result = await request(label + ' 타인 기록 차단', method, '/api/diaries/' + foreign, { cookie, data: method === 'PUT' ? data : undefined });
      assert.equal(result.status, 404);
      assert.deepEqual(result.value, { error: '기록을 찾을 수 없습니다.' });
    }
  }
  const readA = await request('A 자기 기록 읽기', 'GET', '/api/diaries/' + idA, { cookie: cookieA });
  assert.equal(readA.value.title, data.title);
  assert.equal((await request('B 자기 기록 읽기', 'GET', '/api/diaries/' + idB, { cookie: cookieB })).value.title, 'B의 검증 기록');
  assert.equal((await request('타 사이트 출처 변경 차단', 'PUT', '/api/diaries/' + idA, { cookie: cookieA, data, from: 'https://other.test' })).status, 403);
  assert.equal((await request('A 자기 기록 수정', 'PUT', '/api/diaries/' + idA, { cookie: cookieA, data: { ...data, title: '수정된 제목' } })).status, 200);
  assert.equal((await request('A 자기 기록 삭제', 'DELETE', '/api/diaries/' + idA, { cookie: cookieA })).status, 200);
  assert.equal((await request('B 로그아웃', 'POST', '/api/logout', { cookie: cookieB })).status, 200);
  assert.equal((await request('B 로그아웃 전 쿠키로 재요청', 'GET', '/api/diaries', { cookie: cookieB })).status, 401);
});
