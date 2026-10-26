// **옛 앱이 보내는 요청** — 커플·가족 요금제와 가족 알람·목소리 공유를 없앤 뒤(2026-10-20)에도 스토어에 남은 옛 앱의
// 요청이 실제 워커(인증·동의 미들웨어 포함)와 실제 libSQL 위에서 기대하던 모양의 답을 받는지 본다. 옛 앱은 실패한
// 응답을 재시도·경고·디코더 실패로 다루므로, 기능을 없앤 자리도 응답의 모양은 지킨다(강제 업데이트가 끝나면 지운다).
//
// 라우트 단위 확인(목 DB)은 `alarm-query`·`code`·`billing-query`·`voice-profile` 테스트에 있다. 여기서는 그것들이
// 실제 체인에서도 같은지, 그리고 옛 앱이 함께 싣는 옛 칸(`target_user_id`·`is_shared`)이 아무것도 바꾸지 않는지 본다.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { signAppJwt } from '../src/lib/jwt';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';
import { notifyVoicePrerenderComplete } from '../src/lib/stock-clips';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-old-app-compat-'));
const db: Client = createClient({ url: `file:${join(directory, 'test.db')}` });

/** 워커가 DB 에 보낸 SQL(트랜잭션 안 포함) — 응답이 DB 를 어디까지 보는지 확인한다. */
const statements: string[] = [];
function sqlOf(stmt: InStatement | string): string {
  return typeof stmt === 'string' ? stmt : stmt.sql;
}
function traced<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop);
      if (typeof value !== 'function') return value;
      if (prop === 'execute') {
        return (stmt: InStatement | string, args?: unknown) => {
          statements.push(sqlOf(stmt));
          return value.call(obj, stmt, args);
        };
      }
      if (prop === 'batch') {
        return (stmts: Array<InStatement | string>, mode?: unknown) => {
          for (const stmt of stmts) statements.push(sqlOf(stmt));
          return value.call(obj, stmts, mode);
        };
      }
      if (prop === 'transaction') {
        return async (mode?: unknown) => traced(await value.call(obj, mode));
      }
      return value.bind(obj);
    },
  });
}
vi.mock('../src/lib/db', () => ({ getDB: () => traced(db), initDB: async () => {} }));
vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: () => ({ client_email: 'push@example.test', private_key: 'test' }),
  getGoogleAccessToken: async () => 'test-access-token',
}));

const { default: worker } = await import('../src/index');

const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
  FIREBASE_PROJECT_ID: 'alarmtalk-test',
  FIREBASE_SERVICE_ACCOUNT_JSON: '{}',
} as unknown as Env;

const FUTURE = new Date(Date.now() + 30 * 86400_000).toISOString();
const V_ME = crypto.randomUUID();
const P1_DRAFT = crypto.randomUUID();
const P2_DRAFT = crypto.randomUUID();
const V_REP = crypto.randomUUID();
const V_REP_DRAFT = crypto.randomUUID();
const M_REP_CUSTOM = crypto.randomUUID();
const M_REP_PRESET = crypto.randomUUID();
const A_REP_CUSTOM = crypto.randomUUID();
const A_REP_PRESET = crypto.randomUUID();

/** 실제로 나간 FCM 메시지(토큰·데이터). 그 밖의 바깥 호출은 실패시켜 드러낸다. */
const fcmSent: Array<{ token: string; data: Record<string, string> }> = [];

async function call(method: string, path: string, user: string, body?: unknown) {
  const token = await signAppJwt({ sub: user, email: `${user}@t.test` }, ENV.JWT_SECRET);
  const background: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (task: Promise<unknown>) => void background.push(task),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ENV,
    ctx,
  );
  // 커밋 뒤에 미뤄 둔 알림까지 끝난 다음에 본다.
  await Promise.all(background);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json: json as Record<string, any> };
}

async function scalar(sql: string, args: Array<string | number> = []): Promise<unknown> {
  const res = await db.execute({ sql, args });
  return res.rows[0]?.[res.columns[0]!];
}

beforeAll(async () => {
  await runMigrations(db);
  await db.execute(`INSERT INTO users (id, email, name, plan, deletion_status) VALUES
    ('me','me@t.test','나','plus','active'),
    ('other','other@t.test','남','plus','active'),
    ('leaving','leaving@t.test','떠나는 사람','plus','pending_deletion'),
    ('p1','p1@t.test','등록1','plus','active'),
    ('p2','p2@t.test','등록2','plus','active'),
    ('rep','rep@t.test','교체','plus','active')`);
  for (const user of ['me', 'other', 'leaving', 'p1', 'p2', 'rep']) {
    for (const type of ['terms', 'privacy', 'age14', 'overseas_transfer', 'voice_biometric']) {
      await db.execute({
        sql: `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed) VALUES (?, ?, ?, ?, 1)`,
        args: [crypto.randomUUID(), user, type, CURRENT_POLICY_VERSION],
      });
    }
  }
  await db.execute({
    sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
          SELECT 'sub-me', 'me', id, 'active', datetime('now'), ? FROM plans WHERE key = 'personal'`,
    args: [FUTURE],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_draft, previewed_at) VALUES
      (?, 'me', '내 목소리', 'el-me', 'ready', 0, NULL),
      (?, 'p1', '초안', 'el-p1', 'ready', 1, datetime('now')),
      (?, 'p2', '초안', 'el-p2', 'ready', 1, datetime('now')),
      (?, 'rep', '옛 목소리', 'el-rep-old', 'ready', 0, NULL),
      (?, 'rep', '새 목소리', 'el-rep-new', 'ready', 1, datetime('now'))`,
    args: [V_ME, P1_DRAFT, P2_DRAFT, V_REP, V_REP_DRAFT],
  });
  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset) VALUES
      (?, 'rep', ?, '내가 쓴 문구', 'custom', 0),
      (?, 'rep', ?, '기본 인사', 'greeting', 1)`,
    args: [M_REP_CUSTOM, V_REP, M_REP_PRESET, V_REP],
  });
  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, message_id, voice_profile_id, time, mode) VALUES
      (?, 'rep', ?, ?, '07:00', 'tts'),
      (?, 'rep', ?, ?, '07:30', 'tts')`,
    args: [A_REP_CUSTOM, M_REP_CUSTOM, V_REP, A_REP_PRESET, M_REP_PRESET, V_REP],
  });
  await db.execute(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES
    ('pt-rep','rep','tok-rep','android'), ('pt-other','other','tok-other','android')`);
});
beforeEach(() => {
  statements.length = 0;
  fcmSent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://fcm.googleapis.com/')) {
        const message = JSON.parse(String(init?.body)).message;
        fcmSent.push({ token: message.token, data: message.data });
        return new Response('{}', { status: 200 });
      }
      throw new Error(`unexpected network call: ${url}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

// 강제 업데이트(안드로이드 36·iOS 14 — `lib/app-version.ts`)로 그 화면이 있는 옛 앱을 막은 뒤 지운 호환 응답(2026-10-26).
// 이제 다른 없는 경로와 똑같이 코드가 있는 404 다 — 지금 두 앱은 이 경로를 부르지 않는다.
describe('강제 업데이트 뒤 지운 호환 응답 — 이제 코드가 있는 404', () => {
  const ALARM_ID = '11111111-1111-4111-8111-111111111111';
  it.each([
    ['GET', '/api/family/groups/current', undefined],
    ['GET', '/api/billing/vouchers', undefined],
    ['GET', '/api/voice/family', undefined],
    ['GET', '/api/alarm?pagination=cursor&limit=50', undefined],
    ['GET', '/api/alarm/declined?since=2026-10-01T00:00:00Z', undefined],
    ['POST', `/api/alarm/${ALARM_ID}/decline`, undefined],
    ['POST', '/api/code/register', { code: 'INV-AAAA-BBBB-CCCC' }],
  ] as const)('%s %s', async (method, path, body) => {
    const res = await call(method, path, 'me', body);
    expect(res.status).toBe(404);
    expect(typeof (res.json as { error_code?: unknown }).error_code).toBe('string');
  });

  it('GET /billing/subscription 은 plan.max_members 를 싣지 않는다 — 정원 칸은 DB 에서도 없다', async () => {
    const res = await call('GET', '/api/billing/subscription', 'me');
    expect(res.status).toBe(200);
    expect(res.json.subscription).toMatchObject({ id: 'sub-me', status: 'active' });
    expect(res.json.plan).toMatchObject({ key: 'personal', plan_type: 'personal' });
    expect(res.json.plan).not.toHaveProperty('max_members');
  });
});

describe('옛 앱이 싣는 가족 알람 칸(target_user_id)', () => {
  it.each(['other', 'no-such-account'])(
    'POST /alarm 이 남(%s)을 가리키면 403 NOT_CONNECTED — 알람 행이 생기지 않는다',
    async (target) => {
      const before = await scalar('SELECT COUNT(*) FROM alarms');
      const res = await call('POST', '/api/alarm', 'me', {
        time: '07:00',
        repeat_days: [],
        target_user_id: target,
        timezone: 'Asia/Seoul',
      });
      expect(res.status).toBe(403);
      expect(res.json.error_code).toBe('NOT_CONNECTED');
      expect(await scalar('SELECT COUNT(*) FROM alarms')).toBe(before);
    },
  );

  it('자기 자신을 가리키면 내 알람으로 만들고 응답에 그 칸을 싣지 않는다', async () => {
    const res = await call('POST', '/api/alarm', 'me', {
      time: '07:10',
      repeat_days: [],
      target_user_id: 'me',
      timezone: 'Asia/Seoul',
    });
    expect(res.status).toBe(201);
    expect(res.json.alarm).not.toHaveProperty('target_user_id');
    expect(await scalar('SELECT user_id FROM alarms WHERE id = ?', [res.json.alarm.id])).toBe('me');
  });
});

describe('옛 앱이 싣는 목소리 공유 칸(is_shared)은 읽지 않는다', () => {
  it('PATCH /voice/:id 에 is_shared 만 오면 빈 본문과 같다 — 400 INVALID_NAME_LENGTH', async () => {
    const res = await call('PATCH', `/api/voice/${V_ME}`, 'me', { is_shared: true });
    expect(res.status).toBe(400);
    expect(res.json.error_code).toBe('INVALID_NAME_LENGTH');
  });

  it('이름과 함께 오면 이름만 바꾸고 응답에 공유 칸이 없다', async () => {
    const res = await call('PATCH', `/api/voice/${V_ME}`, 'me', {
      name: '새 이름',
      is_shared: true,
      isShared: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.profile).toEqual({ id: V_ME, name: '새 이름' });
    expect(statements.filter((sql) => /is_shared/i.test(sql))).toEqual([]);
  });

  it('등록 확정에 is_shared 를 실어도 싣지 않은 것과 같은 결과다 — 공유 칸을 건드리는 SQL 이 없다', async () => {
    const withShare = await call('PATCH', `/api/voice/${P1_DRAFT}`, 'p1', {
      is_draft: false,
      is_shared: true,
      isShared: true,
    });
    const withShareSql = statements.filter((sql) => /is_shared/i.test(sql));
    const plain = await call('PATCH', `/api/voice/${P2_DRAFT}`, 'p2', { is_draft: false });

    expect(withShare).toEqual({
      status: 200,
      json: { profile: { id: P1_DRAFT, name: '초안', is_draft: false }, pitch_semitones: 0 },
    });
    expect(plain).toEqual({
      status: 200,
      json: { profile: { id: P2_DRAFT, name: '초안', is_draft: false }, pitch_semitones: 0 },
    });
    expect(withShareSql).toEqual([]);
    for (const id of [P1_DRAFT, P2_DRAFT]) {
      expect(await scalar('SELECT is_draft FROM voice_profiles WHERE id = ?', [id])).toBe(0);
      expect(await scalar('SELECT COUNT(*) FROM voice_prerender_queue WHERE voice_profile_id = ?', [id])).toBe(1);
    }
  });
});

describe('제자리 교체 — 옛 앱처럼 is_shared 를 실어도 알림은 목소리 주인에게만 간다', () => {
  it('직접 입력 알람을 내리고 voice_access_revoked(custom_messages)를, 클립 게시가 끝나면 voice_share_changed 를 주인 기기에만 보낸다', async () => {
    const res = await call('PATCH', `/api/voice/${V_REP_DRAFT}`, 'rep', {
      is_draft: false,
      replace_existing: true,
      is_shared: true,
      isShared: true,
      language: 'ko',
    });
    expect(res.status).toBe(200);
    expect(res.json.replaced).toBe(true);
    expect(res.json.profile.id).toBe(V_REP);
    expect(res.json.profile).not.toHaveProperty('is_shared');
    const generation = res.json.profile.custom_audio_invalidated_at;
    expect(generation).toEqual(expect.any(String));

    // 직접 입력 알람만 기본 알람음으로 내리고, 프리셋 알람은 새 목소리로 다시 굽힐 때까지 그대로 둔다.
    const alarms = await db.execute({
      sql: 'SELECT id, mode, message_id FROM alarms WHERE id IN (?, ?) ORDER BY time',
      args: [A_REP_CUSTOM, A_REP_PRESET],
    });
    expect(alarms.rows.map((row) => [row.id, row.mode, row.message_id])).toEqual([
      [A_REP_CUSTOM, 'sound-only', null],
      [A_REP_PRESET, 'tts', M_REP_PRESET],
    ]);
    expect(fcmSent).toEqual([
      {
        token: 'tok-rep',
        data: {
          type: 'voice_access_revoked',
          voiceProfileId: V_REP,
          scope: 'custom_messages',
          invalidatedAt: generation,
        },
      },
    ]);

    // 새 클립 게시가 끝나면(사전렌더 크론) 주인 기기가 매니페스트를 다시 받는다 — 다른 사람에게는 가지 않는다.
    fcmSent.length = 0;
    await notifyVoicePrerenderComplete(db, ENV, 'rep');
    expect(fcmSent).toEqual([{ token: 'tok-rep', data: { type: 'voice_share_changed' } }]);
  });
});
