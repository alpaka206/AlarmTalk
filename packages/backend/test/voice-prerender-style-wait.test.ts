// **말투 분석이 끝나기 전에는 사전렌더를 굽지 않는다**(Codex #802).
//
// 결을 '자동' 으로 둔 클론은 결이 등록 녹음 전사 분석(`speech_style.energy`)에서만 온다. 분석은
// 등록 응답 뒤 `waitUntil` 로 도는데, 승격이 그보다 빠르면 사전렌더가 빈 말투로 21개를 게시하고
// 뒤늦은 분석은 그걸 되돌리지 못한다(같은 provider 보이스라 교체 회차도 '이미 있다' 로 센다).
// 그래서 소유자 주도 전진과 cron claim 둘 다 분석이 도는 동안은 기다린다 — 단 상한(10분)을
// 넘긴 'pending' 은 죽은 분석으로 보고 굽는다(영영 안 굽는 것보다 낫다).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { claimPendingPrerenderVoices, enqueuePrerender } from '../src/lib/stock-clips';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-style-wait-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));
import voiceProfile from '../src/routes/voice-profile';

const USER = '66666666-6666-4666-8666-666666666666';
const VOICE = '77777777-7777-4777-8777-777777777777';

async function advance() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => { c.set('userId', USER); c.set('userIdPK', USER); await next(); });
  app.route('/voice', voiceProfile);
  return app.request(`/voice/${VOICE}/prerender/advance`, { method: 'POST' }, {});
}

async function setAnalysis(status: string | null, updatedAgo: string) {
  await db.execute({
    sql: `UPDATE voice_profiles SET speech_style_status = ?, updated_at = datetime('now', ?) WHERE id = ?`,
    args: [status, updatedAgo, VOICE],
  });
}

beforeAll(async () => { await runMigrations(db); });
beforeEach(async () => {
  for (const table of ['voice_prerender_queue', 'user_consents', 'voice_profiles', 'users']) {
    await db.execute(`DELETE FROM ${table}`);
  }
  await db.execute({
    sql: `INSERT INTO users (id,email,name,plan) VALUES (?,?,?,?)`,
    args: [USER, 'w@example.test', 'w', 'plus'],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles
            (id,user_id,name,status,is_draft,elevenlabs_voice_id,preview_language,speech_style_status)
          VALUES (?,?,?,'ready',0,'el-1','ko','pending')`,
    args: [VOICE, USER, '엄마 목소리'],
  });
  for (const type of ['voice_biometric', 'overseas_transfer']) {
    await db.execute({
      sql: `INSERT INTO user_consents (id,user_id,consent_type,agreed,policy_version,agreed_at)
            VALUES (?,?,?,1,'5',datetime('now'))`,
      args: [`c-${type}`, USER, type],
    });
  }
});
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

describe('사전렌더는 말투 분석을 기다린다', () => {
  it('전진: 분석 중이면 굽지 않고 claim_stuck 으로 잠깐 뒤 다시 오라고 답한다', async () => {
    await setAnalysis('pending', '-5 seconds');
    const res = await advance();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // 두 앱은 claim_stuck 을 '무진전' 으로 세지 않고 retry_after_ms 만큼 기다렸다가 다시 민다.
    expect(body).toMatchObject({ done: false, generated: 0, claim_stuck: true });
    expect(Number(body.retry_after_ms)).toBeGreaterThan(0);
    // 큐는 살려 두되 이 호출은 클레임을 잡지 않는다 — 분석 뒤 cron 도 이어받을 수 있어야 한다.
    const queue = await db.execute({
      sql: 'SELECT status, claim_token FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [VOICE],
    });
    expect(String(queue.rows[0]!.status)).toBe('pending');
    expect(queue.rows[0]!.claim_token).toBeNull();
  });

  it('cron: 분석 중인 목소리는 claim 하지 않고, 분석이 끝나면 claim 한다', async () => {
    await enqueuePrerender(db, VOICE, USER, 'ko');
    await setAnalysis('pending', '-5 seconds');
    expect(await claimPendingPrerenderVoices(db, 5)).toEqual([]);

    await setAnalysis('done', '-1 seconds');
    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
  });

  it('cron: 실패했거나 대상이 아닌 분석은 기다리지 않는다', async () => {
    await enqueuePrerender(db, VOICE, USER, 'ko');
    await setAnalysis('failed', '-1 seconds');
    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);

    await db.execute(`UPDATE voice_prerender_queue SET claimed_at = NULL, claim_token = NULL`);
    await setAnalysis(null, '-1 seconds');
    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
  });

  // `waitUntil` 이 잘리면 상태가 'pending' 인 채 영영 남는다 — 그 목소리를 영영 굽지 않으면 안 된다.
  it('cron: 상한(10분)을 넘긴 pending 은 죽은 분석으로 보고 claim 한다', async () => {
    await enqueuePrerender(db, VOICE, USER, 'ko');
    await setAnalysis('pending', '-11 minutes');
    expect(await claimPendingPrerenderVoices(db, 5)).toHaveLength(1);
  });
});
