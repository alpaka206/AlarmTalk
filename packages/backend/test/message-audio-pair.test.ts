// **알람 저장과 오디오 내려받기는 같은 답을 낸다** — `messageBelongsToCaller`(쓰기 허용)와
// `GET /tts/messages/:id/audio`(읽기 허용)는 한 쌍이다(CLAUDE.md). 어긋나면 들리는데 저장이 안 되거나, 저장은 되는데
// 받을 수 없는 알람이 생긴다. 목소리 공유를 없앤 뒤(2026-10-20) 허용 갈래는 둘이다 — 내 문구(내 목소리·스톡 목소리)와
// 시스템 스톡 프리셋. 공유 시절에 남은 행(남의 목소리로 만든 내 문구, 남의 프리셋 클립)은 양쪽 모두 막힌다.
//
// 목 DB 로는 두 SQL 이 같은 행을 고르는지 볼 수 없어서, 실제 워커와 실제 libSQL 로 두 라우트를 나란히 부른다.
// 시드한 문구는 음원이 없다 — 허용이면 오디오 라우트가 소유권 게이트를 지나 `MESSAGE_AUDIO_MISSING` 에서 멈춘다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { signAppJwt } from '../src/lib/jwt';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-message-audio-pair-'));
const db: Client = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db, initDB: async () => {} }));

const { default: worker } = await import('../src/index');

const ENV = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
} as unknown as Env;

const V = {
  mine: crypto.randomUUID(),
  other: crypto.randomUUID(),
  draft: crypto.randomUUID(),
  freeClone: crypto.randomUUID(),
};
const M = {
  ownCustom: crypto.randomUUID(),
  ownPreset: crypto.randomUUID(),
  ownOnStock: crypto.randomUUID(),
  stockPreset: crypto.randomUUID(),
  others: crypto.randomUUID(),
  ownOnOthersVoice: crypto.randomUUID(),
  othersPreset: crypto.randomUUID(),
  ownOnDraft: crypto.randomUUID(),
  freeOnOwnClone: crypto.randomUUID(),
};
let stockVoice: string;

async function call(method: string, path: string, user: string, body?: unknown) {
  const token = await signAppJwt({ sub: user, email: `${user}@t.test` }, ENV.JWT_SECRET);
  const res = await worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ENV,
    { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
  );
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const saveAlarm = (user: string, fields: Record<string, unknown>) =>
  call('POST', '/api/alarm', user, { time: '07:00', repeat_days: [], timezone: 'Asia/Seoul', ...fields });
const downloadAudio = (user: string, messageId: string) =>
  call('GET', `/api/tts/messages/${messageId}/audio`, user);

beforeAll(async () => {
  await runMigrations(db);
  const stock = await db.execute(
    `SELECT id, user_id FROM voice_profiles
     WHERE COALESCE(is_system, 0) = 1 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
  );
  stockVoice = String(stock.rows[0]!.id);
  const stockOwner = String(stock.rows[0]!.user_id);

  await db.execute(`INSERT INTO users (id, email, name, plan) VALUES
    ('me','me@t.test','나','plus'), ('other','other@t.test','남','plus'), ('freeu','free@t.test','무료','free')`);
  for (const user of ['me', 'other', 'freeu']) {
    for (const type of ['terms', 'privacy', 'age14', 'overseas_transfer', 'voice_biometric']) {
      await db.execute({
        sql: `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed) VALUES (?, ?, ?, ?, 1)`,
        args: [crypto.randomUUID(), user, type, CURRENT_POLICY_VERSION],
      });
    }
  }
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status, is_draft, previewed_at) VALUES
      (?, 'me', '내 목소리', 'el-mine', 'ready', 0, NULL),
      (?, 'other', '남 목소리', 'el-other', 'ready', 0, NULL),
      (?, 'me', '초안', 'el-draft', 'ready', 1, datetime('now')),
      (?, 'freeu', '무료 클론', 'el-free', 'ready', 0, NULL)`,
    args: [V.mine, V.other, V.draft, V.freeClone],
  });
  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset) VALUES
      (?, 'me', ?, '내 직접 입력', 'custom', 0),
      (?, 'me', ?, '내 프리셋', 'greeting', 1),
      (?, 'me', ?, '스톡 목소리 내 문구', 'custom', 0),
      (?, ?, ?, '스톡 프리셋', 'weather', 1),
      (?, 'other', ?, '남의 문구', 'custom', 0),
      (?, 'me', ?, '남의 목소리로 만든 내 문구', 'custom', 0),
      (?, 'other', ?, '남의 프리셋', 'weather', 1),
      (?, 'me', ?, '초안 목소리 문구', 'custom', 0),
      (?, 'freeu', ?, '무료 클론 문구', 'custom', 0)`,
    args: [
      M.ownCustom, V.mine,
      M.ownPreset, V.mine,
      M.ownOnStock, stockVoice,
      M.stockPreset, stockOwner, stockVoice,
      M.others, V.other,
      M.ownOnOthersVoice, V.other,
      M.othersPreset, V.other,
      M.ownOnDraft, V.draft,
      M.freeOnOwnClone, V.freeClone,
    ],
  });
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('문구 — 알람 저장과 오디오 내려받기가 같은 답을 낸다', () => {
  it.each([
    ['내 문구·내 목소리', true, 'ownCustom'],
    ['내 프리셋·내 목소리', true, 'ownPreset'],
    ['내 문구·스톡 목소리', true, 'ownOnStock'],
    ['시스템 스톡 프리셋', true, 'stockPreset'],
    ['남의 문구', false, 'others'],
    ['남의 목소리로 만든 내 문구(공유 시절 행)', false, 'ownOnOthersVoice'],
    ['남의 프리셋 클립(공유 시절 갈래)', false, 'othersPreset'],
    ['초안 목소리 문구', false, 'ownOnDraft'],
  ] as const)('%s → 허용 %s', async (_label, allowed, key) => {
    const save = await saveAlarm('me', { message_id: M[key], mode: 'tts' });
    const audio = await downloadAudio('me', M[key]);
    if (allowed) {
      expect(save.status).toBe(201);
      expect([audio.status, audio.json.error_code]).toEqual([404, 'MESSAGE_AUDIO_MISSING']);
    } else {
      expect([save.status, save.json.error_code]).toEqual([404, 'MESSAGE_NOT_FOUND']);
      expect([audio.status, audio.json.error_code]).toEqual([404, 'MESSAGE_NOT_FOUND']);
    }
  });

  it('무료 계정의 자기 클론 문구는 저장도 내려받기도 유료 게이트에 막힌다', async () => {
    const save = await saveAlarm('freeu', { message_id: M.freeOnOwnClone, mode: 'tts' });
    const audio = await downloadAudio('freeu', M.freeOnOwnClone);
    expect([save.status, save.json.error_code]).toEqual([403, 'VOICE_FEATURE_REQUIRES_PAID_PLAN']);
    expect([audio.status, audio.json.error_code]).toEqual([403, 'VOICE_LOCKED_FREE_PLAN']);
  });

  it('무료 계정도 시스템 스톡 프리셋은 저장하고 내려받는다', async () => {
    const save = await saveAlarm('freeu', {
      message_id: M.stockPreset,
      voice_profile_id: stockVoice,
      mode: 'tts',
    });
    const audio = await downloadAudio('freeu', M.stockPreset);
    expect(save.status).toBe(201);
    expect([audio.status, audio.json.error_code]).toEqual([404, 'MESSAGE_AUDIO_MISSING']);
  });
});

describe('목소리 — 알람에 걸 수 있는 것은 내 정식 목소리와 스톡 목소리뿐이다', () => {
  it.each([
    ['내 목소리', 201, 'mine'],
    ['남의 목소리', 404, 'other'],
    ['내 초안', 404, 'draft'],
  ] as const)('%s → %i', async (_label, status, key) => {
    const res = await saveAlarm('me', { voice_profile_id: V[key], mode: 'tts' });
    expect(res.status).toBe(status);
    if (status === 404) expect(res.json.error_code).toBe('VOICE_PROFILE_NOT_FOUND');
  });

  it('스톡 목소리 → 201', async () => {
    expect((await saveAlarm('me', { voice_profile_id: stockVoice, mode: 'tts' })).status).toBe(201);
  });
});

// PATCH 는 문구·목소리가 저장된 값에서 **바뀔 때만** 소유권을 본다 — 안드로이드 동기화는 토글마다 두 값을 그대로 보낸다.
// 그대로 보낸 값은 새 참조가 아니다. 공유 시절에 남은 행도 켜고 끌 수 있어야 하고, 막힌 클립의 재생은 오디오 라우트가 막는다.
describe('PATCH /alarm — 그대로 보낸 문구·목소리는 다시 보지 않고, 바꾸는 값만 본다', () => {
  async function legacyAlarm(): Promise<string> {
    const id = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, message_id, voice_profile_id, time, mode, is_active)
            VALUES (?, 'me', ?, ?, '06:30', 'tts', 1)`,
      args: [id, M.ownOnOthersVoice, V.other],
    });
    return id;
  }

  it('공유 시절 행을 같은 값 그대로 실어 끄면 200', async () => {
    const id = await legacyAlarm();
    const res = await call('PATCH', `/api/alarm/${id}`, 'me', {
      is_active: false,
      message_id: M.ownOnOthersVoice,
      voice_profile_id: V.other,
      time: '06:30',
    });
    expect(res.status).toBe(200);
    expect(res.json.alarm).toMatchObject({ id, is_active: false });
    expect(res.json.alarm).not.toHaveProperty('target_user_id');
  });

  it.each([
    ['남의 문구로 바꾸면', 'MESSAGE_NOT_FOUND', { message_id: M.others }],
    ['초안 목소리로 바꾸면', 'VOICE_PROFILE_NOT_FOUND', { voice_profile_id: V.draft }],
  ] as const)('%s 404 %s — 행은 그대로다', async (_label, code, change) => {
    const id = await legacyAlarm();
    const res = await call('PATCH', `/api/alarm/${id}`, 'me', change);
    expect([res.status, res.json.error_code]).toEqual([404, code]);
    const row = await db.execute({ sql: 'SELECT message_id, voice_profile_id FROM alarms WHERE id = ?', args: [id] });
    expect(row.rows[0]).toMatchObject({ message_id: M.ownOnOthersVoice, voice_profile_id: V.other });
  });

  it('내 문구·목소리로 바꾸면 200', async () => {
    const id = await legacyAlarm();
    const res = await call('PATCH', `/api/alarm/${id}`, 'me', {
      message_id: M.ownCustom,
      voice_profile_id: V.mine,
    });
    expect(res.status).toBe(200);
    expect(res.json.alarm).toMatchObject({ message_id: M.ownCustom, voice_profile_id: V.mine });
  });

  it('남의 알람은 고칠 수 없다 — 404 ALARM_NOT_FOUND', async () => {
    const id = await legacyAlarm();
    const res = await call('PATCH', `/api/alarm/${id}`, 'other', { is_active: false });
    expect([res.status, res.json.error_code]).toEqual([404, 'ALARM_NOT_FOUND']);
  });
});
