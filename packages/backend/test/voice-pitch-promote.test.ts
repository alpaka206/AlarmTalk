// **목소리 높이는 등록 확정 때 한 번 정한다**(스펙 voice-and-message §4-3).
//
// 앱은 등록 미리듣기에서 사용자가 고른 높이를 저장하기(초안 → 정식) 요청에 `pitch_semitones` 로 실어 보낸다.
// 서버는 그 값과 **그때의 합성 모델**을 적고, 그 목소리로 만드는 모든 알람 소리에 굽는다. 지키는 것:
//   1. 고른 값과 모델이 적히고, 응답에 그 값이 돌아온다(앱이 옛 서버를 알아볼 수 있게).
//   2. 보내지 않거나 0 이면 아무것도 적지 않는다 — 이 기능 이전 목소리·값을 모르는 앱(1.2.10)이 그렇다.
//   3. 범위·눈금 밖의 값은 거절한다 — 조용히 0 으로 바꾸면 고른 높이가 사라진다.
//   4. 등록 뒤에는 바꿀 수 없다 — 이미 구운 클립과 어긋난다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { TTS_MODEL_ID } from '../src/lib/tts-model';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-pitch-promote-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
import voiceProfile from '../src/routes/voice-profile';

const USER = '66666666-6666-4666-8666-666666666666';
const VOICE = '77777777-7777-4777-8777-777777777777';

async function patch(body: Record<string, unknown>) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', USER); c.set('userIdPK', USER); await next(); });
  app.route('/voice', voiceProfile);
  return app.request(`/voice/${VOICE}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, {});
}

async function voiceRow() {
  const res = await db.execute({
    sql: 'SELECT is_draft, pitch_semitones, pitch_model_id FROM voice_profiles WHERE id = ?',
    args: [VOICE],
  });
  return res.rows[0]!;
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  // 월 1회 등록 원장(`voice_profile_change_ledger`)을 비운다 — 앞 테스트의 등록이 다음 테스트를 429 로 막는다.
  await db.execute('DELETE FROM voice_profile_change_ledger').catch(() => undefined);
  for (const table of ['user_consents', 'subscriptions', 'voice_profiles', 'users']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute({
    sql: `INSERT INTO users (id,email,name,plan) VALUES (?,?,?,?)`,
    args: [USER, 'pitch@example.test', 'p', 'plus'],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles (id,user_id,name,status,is_draft,previewed_at)
          VALUES (?,?,?,?,1,datetime('now'))`,
    args: [VOICE, USER, '엄마 목소리', 'ready'],
  });
  for (const type of ['voice_biometric', 'overseas_transfer']) {
    await db.execute({
      sql: `INSERT INTO user_consents (id,user_id,consent_type,agreed,policy_version,agreed_at)
            VALUES (?,?,?,1,'5',datetime('now'))`,
      args: [`c-${type}`, USER, type],
    });
  }
  await db.execute({
    sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
          VALUES (?,?,?,'active',datetime('now'),datetime('now','+30 days'))`,
    args: ['sub-1', USER, '70000000-0000-4000-8000-000000000002'],
  });
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('등록 확정 — 목소리 높이', () => {
  it('고른 높이와 그때의 모델을 적고, 응답에 그 값을 돌려준다', async () => {
    const res = await patch({ is_draft: false, pitch_semitones: -1.5 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pitch_semitones?: number };
    expect(body.pitch_semitones).toBe(-1.5);
    const row = await voiceRow();
    expect(Number(row.is_draft)).toBe(0);
    expect(Number(row.pitch_semitones)).toBe(-1.5);
    expect(String(row.pitch_model_id)).toBe(TTS_MODEL_ID);
  });

  it('camelCase 로 보내도 같다', async () => {
    const res = await patch({ isDraft: false, pitchSemitones: 2.5 });
    expect(res.status).toBe(200);
    expect(Number((await voiceRow()).pitch_semitones)).toBe(2.5);
  });

  it('보내지 않거나 0 이면 아무것도 적지 않는다(원래 소리)', async () => {
    const res = await patch({ is_draft: false });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pitch_semitones?: number }).pitch_semitones).toBe(0);
    let row = await voiceRow();
    expect(row.pitch_semitones).toBeNull();
    expect(row.pitch_model_id).toBeNull();

    await db.execute({ sql: 'UPDATE voice_profiles SET is_draft = 1 WHERE id = ?', args: [VOICE] });
    await db.execute('DELETE FROM voice_profile_change_ledger');
    const zero = await patch({ is_draft: false, pitch_semitones: 0 });
    expect(zero.status).toBe(200);
    row = await voiceRow();
    expect(Number(row.is_draft)).toBe(0);
    expect(row.pitch_semitones).toBeNull();
    expect(row.pitch_model_id).toBeNull();
  });

  it('범위·눈금 밖이면 거절하고 등록하지 않는다', async () => {
    for (const value of [-6.5, 3.5, -1.25, '-1', true]) {
      const res = await patch({ is_draft: false, pitch_semitones: value });
      expect(res.status, String(value)).toBe(400);
      expect(((await res.json()) as { error_code?: string }).error_code).toBe('INVALID_VOICE_PITCH');
    }
    const row = await voiceRow();
    expect(Number(row.is_draft)).toBe(1);
    expect(row.pitch_semitones).toBeNull();
  });

  // 등록은 커밋됐는데 응답만 잃으면 같은 요청이 다시 온다 — 그때는 이미 정식이다. 막으면 등록은 됐는데 앱이 실패를 띄운다.
  it('같은 높이로 다시 온 등록 확정(응답을 잃은 재시도)은 200 이고 값을 돌려준다', async () => {
    expect((await patch({ is_draft: false, pitch_semitones: -1.5 })).status).toBe(200);

    const retry = await patch({ is_draft: false, pitch_semitones: -1.5 });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { pitch_semitones?: number }).pitch_semitones).toBe(-1.5);
    expect(Number((await voiceRow()).pitch_semitones)).toBe(-1.5);

    // 다른 값이면 바꾸려는 것이다.
    const change = await patch({ is_draft: false, pitch_semitones: -1 });
    expect(change.status).toBe(409);
    expect(((await change.json()) as { error_code?: string }).error_code).toBe('VOICE_PITCH_LOCKED');
    expect(Number((await voiceRow()).pitch_semitones)).toBe(-1.5);
  });

  it('높이 없이 등록한 목소리에 0 으로 다시 온 재시도도 200 이다', async () => {
    expect((await patch({ is_draft: false })).status).toBe(200);
    const retry = await patch({ is_draft: false, pitch_semitones: 0 });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { pitch_semitones?: number }).pitch_semitones).toBe(0);
    expect((await voiceRow()).pitch_semitones).toBeNull();
    // 0 이 아닌 값으로 '재시도' 할 수는 없다 — 등록 뒤에 높이를 다는 것이다.
    expect((await patch({ is_draft: false, pitch_semitones: 1 })).status).toBe(409);
  });

  // 교체 등록은 새 목소리다 — 라우트가 고른 높이를 교체에 넘기고 응답에 싣는다(빠뜨리면 옛 높이가 지워진 채
  // 프리셋이 원래 소리로 영구히 다시 구워진다).
  it('교체 등록은 고른 높이를 기존 프로필에 덮어쓰고 응답에 싣는다', async () => {
    const OLD = '88888888-8888-4888-8888-888888888888';
    await db.execute({
      sql: `INSERT INTO voice_profiles (id,user_id,name,status,is_draft,elevenlabs_voice_id,pitch_semitones,pitch_model_id)
            VALUES (?,?,?,?,0,'el-old',-3,?)`,
      args: [OLD, USER, '옛 목소리', 'ready', TTS_MODEL_ID],
    });
    await db.execute({ sql: "UPDATE voice_profiles SET elevenlabs_voice_id = 'el-new' WHERE id = ?", args: [VOICE] });

    const res = await patch({ is_draft: false, replace_existing: true, pitch_semitones: -2 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { replaced?: boolean; pitch_semitones?: number; profile?: { id?: string } };
    expect(body.replaced).toBe(true);
    expect(body.pitch_semitones).toBe(-2);
    expect(body.profile?.id).toBe(OLD);
    const old = await db.execute({
      sql: 'SELECT elevenlabs_voice_id, pitch_semitones, pitch_model_id FROM voice_profiles WHERE id = ?',
      args: [OLD],
    });
    expect(String(old.rows[0]!.elevenlabs_voice_id)).toBe('el-new');
    expect(Number(old.rows[0]!.pitch_semitones)).toBe(-2);
    expect(String(old.rows[0]!.pitch_model_id)).toBe(TTS_MODEL_ID);
  });

  it('등록 확정이 아닌 요청에는 높이를 받지 않는다', async () => {
    // 이름만 바꾸는 요청에 높이를 실으면 거절한다.
    const rename = await patch({ name: '새 이름', pitch_semitones: -1 });
    expect(rename.status).toBe(409);
    expect(((await rename.json()) as { error_code?: string }).error_code).toBe('VOICE_PITCH_LOCKED');

    // 이미 정식인 목소리는 높이를 바꿀 수 없다 — 이미 구운 클립과 어긋난다.
    await db.execute({
      sql: 'UPDATE voice_profiles SET is_draft = 0, pitch_semitones = -2, pitch_model_id = ? WHERE id = ?',
      args: [TTS_MODEL_ID, VOICE],
    });
    const later = await patch({ is_draft: false, pitch_semitones: 1 });
    expect(later.status).toBe(409);
    expect(((await later.json()) as { error_code?: string }).error_code).toBe('VOICE_PITCH_LOCKED');
    expect(Number((await voiceRow()).pitch_semitones)).toBe(-2);

    // 높이만 보낸 요청도 같다.
    const pitchOnly = await patch({ pitch_semitones: 1 });
    expect(pitchOnly.status).toBe(409);
  });
});
