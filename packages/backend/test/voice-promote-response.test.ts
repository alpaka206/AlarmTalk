// **저장하기(승격) 응답에는 이름이 반드시 실린다**(2026-09-19 실기기).
//
// 예전에는 "이번 요청이 바꾼 필드" 만 돌려줬다. 승격은 `is_draft` 만 보내므로 응답에
// `name` 이 없었고, iOS `VoiceProfile.name` 은 필수라 해석에 실패했다 — 서버는 200 인데
// 화면에는 「처리 중 오류가 발생했어요」 가 떴다(목소리는 저장돼 있는데 실패로 보인다).
// 교체 갈래는 프로필 전체를 돌려줘 이 문제가 없었으므로 **첫 등록에서만** 났다.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-promote-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
import voiceProfile from '../src/routes/voice-profile';

const USER = '44444444-4444-4444-8444-444444444444';
const VOICE = '55555555-5555-4555-8555-555555555555';

async function patch(body: Record<string, unknown>) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', USER); c.set('userIdPK', USER); await next(); });
  app.route('/voice', voiceProfile);
  return app.request(`/voice/${VOICE}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, {});
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  // 자식 행부터 지운다 — users 를 먼저 지우면 외래키가 막는다.
  for (const table of ['user_consents', 'subscriptions', 'voice_profiles', 'users']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute({
    sql: `INSERT INTO users (id,email,name,plan) VALUES (?,?,?,?)`,
    args: [USER, 'p@example.test', 'p', 'plus'],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles (id,user_id,name,status,is_draft,previewed_at)
          VALUES (?,?,?,?,1,datetime('now'))`,
    args: [VOICE, USER, '엄마 목소리', 'ready'],
  });
  // 승격은 **민감 동의**도 있어야 열린다(`SENSITIVE_REQUIRED_CONSENTS`).
  for (const type of ['voice_biometric', 'overseas_transfer']) {
    await db.execute({
      sql: `INSERT INTO user_consents (id,user_id,consent_type,agreed,policy_version,agreed_at)
            VALUES (?,?,?,1,'5',datetime('now'))`,
      args: [`c-${type}`, USER, type],
    });
  }
  // 승격은 유료 등급에서만 열린다 — 개인 플랜 구독을 하나 깔아 둔다.
  await db.execute({
    sql: `INSERT INTO subscriptions (id,user_id,plan_id,status,starts_at,expires_at)
          VALUES (?,?,?,'active',datetime('now'),datetime('now','+30 days'))`,
    args: ['sub-1', USER, '70000000-0000-4000-8000-000000000002'],
  });
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('PATCH /voice/:id 응답', () => {
  it('이름을 안 보낸 승격 요청에도 현재 이름을 돌려준다', async () => {
    const res = await patch({ is_draft: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile?: { id?: string; name?: string } };
    expect(body.profile?.id).toBe(VOICE);
    // 앱의 `VoiceProfile.name` 은 필수다 — 비면 해석이 통째로 실패한다.
    expect(body.profile?.name).toBe('엄마 목소리');
  });

  it('이름을 바꾸는 요청은 바꾼 이름을 돌려준다', async () => {
    const res = await patch({ name: '아빠 목소리' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profile?: { name?: string } };
    expect(body.profile?.name).toBe('아빠 목소리');
  });
});
