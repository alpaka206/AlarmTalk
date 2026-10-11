// **이번 달 등록을 이미 썼으면 초안부터 만들지 않는다**(스펙 voice-and-message §4-1 「월 등록 한도」 ①).
//
// 2026-10-10 prod: 이번 달 등록을 마친 유료 사용자가 초안을 또 만들 수 있었고, 그 초안의 저장이
// 429 로 일곱 번 거절됐다(ALARMTALK-ANDROID-Q). `POST /voice/clone` 이 등록 원장을 아예 읽지
// 않았기 때문이다 — 저장할 수 없는 초안이 provider 보이스 하나를 쓰고, 사용자는 녹음·생성·
// 미리듣기를 다 마친 마지막 단계에서 막혔다.
//
// `voice-profile.test.ts` 의 순서 큐 목은 "무엇을 부르지 않는가" 만 본다(집계 결과를 테스트가
// 지어 준다). **어떤 원장 줄이 세어지는가** — 이번 달의 실패하지 않은 줄만, 그 계정의 것만 — 는
// SQL 이 정하므로 진짜 SQLite 로 돌린다. 지키는 것:
//   1. 이번 달(KST)의 `succeeded`·`reserved` 줄 → 429. provider 호출 0, 전사(Scribe) 호출 0, 한 줄도 쓰지
//      않는다(초안 행·초안 시도 집계·옛 초안 정리·삭제 큐).
//   2. `failed` 줄뿐 → 만든다(실패로 끝난 등록은 세지 않는다).
//   3. 지난달 줄 → 만든다.
//   4. 다른 계정의 줄 → 만든다.
//   5. 전사 전의 읽기 전용 선검사를 지난 뒤(전사하는 사이) 다른 기기가 등록을 마치면 → 예약 트랜잭션 맨 앞의
//      확인이 막는다(429, 한 줄도 쓰지 않음). 선검사는 전사 값을 아끼는 것일 뿐 이 확인을 대신하지 않는다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-clone-monthly-gate-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
const mockCreateInstantClone = vi.fn();
const mockSpeechToText = vi.fn();

vi.mock('../src/lib/db', () => ({ getDB: () => db }));
// provider 는 목이다 — 이 테스트는 외부를 부르지 않는다. "부르지 않았다" 가 단언의 절반이다.
vi.mock('../src/lib/elevenlabs', () => ({
  ElevenLabsClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.createInstantClone = mockCreateInstantClone;
    this.speechToText = mockSpeechToText;
    this.deleteVoice = vi.fn();
  }),
}));

import voiceProfile from '../src/routes/voice-profile';

const USER = '88888888-8888-4888-8888-888888888888';
const OTHER_USER = '99999999-9999-4999-8999-999999999999';
const OLD_DRAFT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ENV: Env = {
  ELEVENLABS_API_KEY: 'test-key',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

const THIS_KST_MONTH = "strftime('%Y-%m', 'now', '+9 hours')";
// '-1 month' 는 31일에 다음 달로 넘칠 수 있다(2월 31일 → 3월) — 이번 달 1일의 하루 전으로 잡는다.
const LAST_KST_MONTH = "strftime('%Y-%m', 'now', '+9 hours', 'start of month', '-1 day')";

async function clone() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', USER);
    c.set('userIdPK', USER);
    await next();
  });
  app.route('/voice', voiceProfile);
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'sample.wav');
  form.append('name', '새 목소리');
  form.append('durationMs', '90000');
  form.append('isDraft', 'true');
  return app.request('/voice/clone', { method: 'POST', body: form }, ENV);
}

async function addLedgerRow(owner: string, monthSql: string, status: string) {
  await db.execute({
    sql: `INSERT INTO voice_profile_change_ledger (id, owner_user_id, change_month, change_type, status)
          VALUES (?, ?, ${monthSql}, 'official_voice', ?)`,
    args: [crypto.randomUUID(), owner, status],
  });
}

async function count(sql: string): Promise<number> {
  return Number((await db.execute(sql)).rows[0]!.n);
}

beforeAll(async () => {
  await runMigrations(db);
});

beforeEach(async () => {
  mockCreateInstantClone.mockReset();
  mockCreateInstantClone.mockResolvedValue({ voice_id: 'elv-new' });
  // 말소리 확인을 통과하는 전사 — 막히는 쪽은 `voice-clone-speech-gate.test.ts`.
  mockSpeechToText.mockReset();
  mockSpeechToText.mockResolvedValue('오늘도 또박또박 소리 내어 읽은 등록 녹음의 전사입니다');
  for (const table of [
    'voice_profile_change_ledger',
    'voice_draft_attempt_usage',
    'pending_external_deletions',
    'voice_uploads',
    'user_consents',
    'voice_profiles',
    'users',
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
  for (const [id, email] of [
    [USER, 'gate@example.test'],
    [OTHER_USER, 'other@example.test'],
  ] as const) {
    await db.execute({
      sql: 'INSERT INTO users (id, email, name, plan) VALUES (?, ?, ?, ?)',
      args: [id, email, 'g', 'plus'],
    });
  }
  for (const type of ['voice_biometric', 'overseas_transfer']) {
    await db.execute({
      sql: `INSERT INTO user_consents (id, user_id, consent_type, agreed, policy_version, agreed_at)
            VALUES (?, ?, ?, 1, ?, datetime('now'))`,
      args: [`c-${type}`, USER, type, CURRENT_POLICY_VERSION],
    });
  }
  // 앱이 죽어 남은 옛 초안 — 평소의 새 등록은 이걸 버린다. 거절은 건드리지 않아야 한다.
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_draft, elevenlabs_voice_id)
          VALUES (?, ?, ?, 'ready', 1, ?)`,
    args: [OLD_DRAFT, USER, '옛 초안', 'elv-old'],
  });
});

afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('POST /voice/clone — 월 등록 자격 확인', () => {
  it.each(['succeeded', 'reserved'])(
    '이번 달 원장에 %s 줄이 있으면 429 — provider 를 부르지 않고 한 줄도 쓰지 않는다',
    async (status) => {
      await addLedgerRow(USER, THIS_KST_MONTH, status);

      const res = await clone();

      expect(res.status).toBe(429);
      // 확정(승격·교체)의 거절과 같은 코드·같은 몸통이다.
      expect(await res.json()).toEqual({
        error: '목소리는 한 달에 1번만 변경할 수 있습니다.',
        error_code: 'VOICE_MONTHLY_CHANGE_LIMIT_REACHED',
      });
      expect(mockCreateInstantClone).not.toHaveBeenCalled();
      // 다 쓴 달은 전사 값도 치르지 않는다 — 읽기 전용 선검사가 말소리 확인보다 앞이다(2026-10-11).
      expect(mockSpeechToText).not.toHaveBeenCalled();
      // 초안 행을 만들지 않았다 — 남아 있던 옛 초안 하나뿐이고, 그것도 그대로다.
      expect(await count('SELECT COUNT(*) AS n FROM voice_profiles')).toBe(1);
      const oldDraft = await db.execute({
        sql: 'SELECT deleted_at, is_draft, status, elevenlabs_voice_id FROM voice_profiles WHERE id = ?',
        args: [OLD_DRAFT],
      });
      expect(oldDraft.rows[0]).toMatchObject({
        deleted_at: null,
        is_draft: 1,
        status: 'ready',
        elevenlabs_voice_id: 'elv-old',
      });
      // 초안 시도 집계도, 외부 자원 삭제 예약도 없다.
      expect(await count('SELECT COUNT(*) AS n FROM voice_draft_attempt_usage')).toBe(0);
      expect(await count('SELECT COUNT(*) AS n FROM pending_external_deletions')).toBe(0);
      // 원장도 그대로다 — 자격 확인은 읽기만 한다.
      expect(await count('SELECT COUNT(*) AS n FROM voice_profile_change_ledger')).toBe(1);
    },
  );

  it('failed 줄뿐이면 만든다 — 실패로 끝난 등록은 세지 않는다', async () => {
    await addLedgerRow(USER, THIS_KST_MONTH, 'failed');

    const res = await clone();

    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM voice_profiles WHERE is_draft = 1 AND deleted_at IS NULL AND status = 'ready'",
      ),
    ).toBe(1);
    // 초안은 한도를 깎지 않는다 — 원장에는 아무것도 더해지지 않았다.
    expect(await count('SELECT COUNT(*) AS n FROM voice_profile_change_ledger')).toBe(1);
  });

  it('지난달(KST)에 쓴 등록은 이번 달을 막지 않는다', async () => {
    await addLedgerRow(USER, LAST_KST_MONTH, 'succeeded');

    const res = await clone();

    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
  });

  it('다른 계정의 등록은 세지 않는다', async () => {
    await addLedgerRow(OTHER_USER, THIS_KST_MONTH, 'succeeded');

    const res = await clone();

    expect(res.status).toBe(201);
    expect(mockCreateInstantClone).toHaveBeenCalledOnce();
  });

  it('전사하는 사이 다른 기기가 등록을 마치면 예약 트랜잭션 맨 앞이 막는다 — 429, 한 줄도 쓰지 않는다', async () => {
    // 선검사(원장 0줄)를 지난 뒤, 말소리 확인의 전사가 도는 동안 다른 기기의 확정이 원장에 들어온다.
    mockSpeechToText.mockImplementation(async () => {
      await addLedgerRow(USER, THIS_KST_MONTH, 'succeeded');
      return '오늘도 또박또박 소리 내어 읽은 등록 녹음의 전사입니다';
    });

    const res = await clone();

    expect(res.status).toBe(429);
    expect((await res.json()).error_code).toBe('VOICE_MONTHLY_CHANGE_LIMIT_REACHED');
    expect(mockSpeechToText).toHaveBeenCalledOnce();
    expect(mockCreateInstantClone).not.toHaveBeenCalled();
    expect(await count('SELECT COUNT(*) AS n FROM voice_profiles')).toBe(1);
    const oldDraft = await db.execute({
      sql: 'SELECT deleted_at FROM voice_profiles WHERE id = ?',
      args: [OLD_DRAFT],
    });
    expect(oldDraft.rows[0]!.deleted_at).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM voice_draft_attempt_usage')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM pending_external_deletions')).toBe(0);
    // 다른 기기가 쓴 한 줄뿐이다.
    expect(await count('SELECT COUNT(*) AS n FROM voice_profile_change_ledger')).toBe(1);
  });

  it('원장이 비어 있으면 만든다(첫 등록)', async () => {
    const res = await clone();

    expect(res.status).toBe(201);
    // 평소의 새 등록은 옛 초안을 버린다 — 위 429 가 이 갈래에 닿지 않았다는 대조군이다.
    const oldDraft = await db.execute({
      sql: 'SELECT deleted_at FROM voice_profiles WHERE id = ?',
      args: [OLD_DRAFT],
    });
    expect(oldDraft.rows[0]!.deleted_at).not.toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM voice_draft_attempt_usage')).toBe(1);
  });
});
