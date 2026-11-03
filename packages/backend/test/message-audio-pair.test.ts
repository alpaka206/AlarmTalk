// **오디오 내려받기(`GET /tts/messages/:id/audio`)의 허용 갈래.** 목소리 공유를 없앤 뒤(2026-10-20) 허용 갈래는 둘이다 —
// 내 문구(내 목소리·스톡 목소리)와 시스템 스톡 프리셋. 공유 시절에 남은 행(남의 목소리로 만든 내 문구, 남의 프리셋 클립)과
// 초안 목소리 문구는 막힌다. 내 목소리 문구는 개인 목소리 권한(계산값)이 있어야 한다.
//
// 예전에는 알람 저장의 쓰기 허용(`messageBelongsToCaller`)과 한 쌍으로 같은 답을 내는지 봤다. 서버 알람 사본을 지운 뒤(#147)
// `POST/PATCH /alarm` 은 아무것도 저장하지 않는 옛 앱 호환 자리라(`alarm-compat.test.ts`) 막을 쓰기가 없다 — 남은 문은
// 이 라우트 하나다.
//
// 실제 워커와 실제 libSQL 로 부른다. 시드한 문구는 음원이 없다 — 허용이면 오디오 라우트가 소유권 게이트를 지나
// `MESSAGE_AUDIO_MISSING` 에서 멈춘다.
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

  await db.execute(`INSERT INTO users (id, email, plan) VALUES
    ('me','me@t.test','plus'), ('other','other@t.test','plus'), ('freeu','free@t.test','free')`);
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

describe('문구 — 오디오 내려받기의 허용 갈래', () => {
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
    const audio = await downloadAudio('me', M[key]);
    if (allowed) {
      expect([audio.status, audio.json.error_code]).toEqual([404, 'MESSAGE_AUDIO_MISSING']);
    } else {
      expect([audio.status, audio.json.error_code]).toEqual([404, 'MESSAGE_NOT_FOUND']);
    }
  });

  it('무료 계정의 자기 클론 문구는 유료 게이트에 막힌다', async () => {
    const audio = await downloadAudio('freeu', M.freeOnOwnClone);
    expect([audio.status, audio.json.error_code]).toEqual([403, 'VOICE_LOCKED_FREE_PLAN']);
  });

  it('무료 계정도 시스템 스톡 프리셋은 내려받는다', async () => {
    const audio = await downloadAudio('freeu', M.stockPreset);
    expect([audio.status, audio.json.error_code]).toEqual([404, 'MESSAGE_AUDIO_MISSING']);
  });
});
