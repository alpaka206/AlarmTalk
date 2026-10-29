// 응원 변주·짧은 기상 인사(스펙 `docs/spec/voice-and-message.md` §5-4) — 실제 libsql 에 마이그레이션을 올리고 돌린다.
//
//  - 공개 표식(`stock_content_releases`, #143)이 매니페스트 목록·`expected_variants`·표지를 **한 회차에** 정한다.
//  - 옛 응원(`cheer` 0..2)은 그대로 나가고 새로 고르는 목록에서만 빠진다(`selectable: false`).
//  - 옛 앱의 알람 올리기는 '다양하게 / 이 문구로 고정' 을 그대로 되돌려 받는다(서버는 저장하지 않는다 — #147).
//    모르는 값은 400 `INVALID_CHEER_SETTING` 이다.
//  - 클론은 **응원을 고른 것만** 보충한다 — 앱이 `POST /voice/:id/content-supplement` 로 알린다(알람 올리기는 보충을
//    열지 않는다). 보충 회차는 우선순위 맨 뒤이고, 진행 조회는 그 목소리를 막지 않는다.
//  - 비용 dry-run 은 합성하지 않는다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const directory = mkdtempSync(join(tmpdir(), 'alarmtalk-cheer-variants-'));
const db = createClient({ url: `file:${join(directory, 'test.db')}` });
vi.mock('../src/lib/db', () => ({ getDB: () => db }));

import tts from '../src/routes/tts';
import voiceProfile from '../src/routes/voice-profile';
import alarm from '../src/routes/alarm';
import {
  claimPendingPrerenderVoices,
  markPrerenderFailed,
  releasedStockContentSets,
  requestCloneContentSupplement,
} from '../src/lib/stock-clips';
import { formatStockContentCost, stockContentCost, SYSTEM_VOICE_NAMES } from '../scripts/stock-content-cost';
import { stockContentSet } from '@alarmtalk/shared';

const USER = '14300000-0000-4000-9000-000000000001';
const SYSTEM_USER = '70000000-0000-4000-9000-000000000001';
const SYSTEM_VOICE = '14300000-0000-4000-9000-000000000101';
const CLONE = '14300000-0000-4000-9000-000000000201';
const OTHER_CLONE = '14300000-0000-4000-9000-000000000202';
const OTHER_USER = '14300000-0000-4000-9000-000000000002';

const ENV = {
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
} satisfies Env;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', USER);
    c.set('userIdPK', USER);
    c.set('userLoginId', USER);
    c.set('sentry', { captureException: vi.fn(), setTag: vi.fn(), setTags: vi.fn() } as never);
    await next();
  });
  app.route('/tts', tts);
  app.route('/voice', voiceProfile);
  app.route('/alarm', alarm);
  return app;
}

async function addPreset(voice: string, owner: string, category: string, variant: number, language = 'ko') {
  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
                                category, language, variant, is_preset, audio_url)
          VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, ?)`,
    args: [
      crypto.randomUUID(), owner, voice, `${category}-${variant}`, `${category}-${variant}`,
      category, language, variant, `r2://x/${voice}-${category}-${language}-${variant}.mp3`,
    ],
  });
}

interface ManifestClip {
  category: string;
  variant: number;
  voice_profile_id: string;
  theme: string;
  content_id: string | null;
  selectable: boolean;
}
interface Manifest {
  clips: ManifestClip[];
  expected_variants: { system: Record<string, number>; clone: Record<string, number> };
}

async function manifest(): Promise<Manifest> {
  const res = await buildApp().request('/tts/stock-clips', {}, ENV);
  expect(res.status).toBe(200);
  return (await res.json()) as Manifest;
}

beforeAll(async () => {
  await runMigrations(db);
  await db.execute({
    sql: `INSERT INTO users (id, google_id, email, plan) VALUES (?, ?, 'cheer@test', 'plus')`,
    args: [USER, USER],
  });
  await db.execute({
    sql: `INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, 'system@test')`,
    args: [SYSTEM_USER, SYSTEM_USER],
  });
  await db.execute({
    sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system, elevenlabs_voice_id)
          VALUES (?, ?, '미나', 'ready', 1, 'el-system')`,
    args: [SYSTEM_VOICE, SYSTEM_USER],
  });
  for (const id of [CLONE, OTHER_CLONE]) {
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system, elevenlabs_voice_id)
            VALUES (?, ?, '엄마', 'ready', 0, ?)`,
      args: [id, USER, `el-${id}`],
    });
  }
  // 기본 목소리: 옛 응원 3개 · 새 응원 14개 · 기상 인사 3개가 **게시는 됐지만 공개 전**이다.
  for (let v = 0; v < 3; v += 1) await addPreset(SYSTEM_VOICE, SYSTEM_USER, 'cheer', v);
  for (let v = 0; v < 14; v += 1) await addPreset(SYSTEM_VOICE, SYSTEM_USER, 'cheer_v2', v);
  for (let v = 0; v < 3; v += 1) await addPreset(SYSTEM_VOICE, SYSTEM_USER, 'wake', v);
  // 클론: 기본 세트 응원 3개(다 굽힌 큐).
  for (let v = 0; v < 3; v += 1) await addPreset(CLONE, USER, 'cheer', v);
  await db.execute({
    sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language, status, refresh_existing)
          VALUES (?, ?, 'ko', 'done', 1)`,
    args: [CLONE, USER],
  });
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('공개 표식 — 매니페스트·expected_variants·표지를 한 회차에 묶는다', () => {
  it('공개 전에는 새 묶음의 행이 매니페스트에 없고 개수표에도 없다(지금과 같다)', async () => {
    const before = await manifest();
    const categories = new Set(before.clips.map((clip) => clip.category));
    expect(categories.has('cheer_v2')).toBe(false);
    expect(categories.has('wake')).toBe(false);
    expect(before.expected_variants.system.cheer_v2).toBeUndefined();
    expect(before.expected_variants.system.wake).toBeUndefined();
    expect(before.expected_variants.system.cheer).toBe(3);
    // 클론은 언제나 기본 세트만 — 보충은 완전성에 들지 않는다.
    expect(before.expected_variants.clone.cheer).toBe(3);
    expect(before.expected_variants.clone.cheer_v2).toBeUndefined();
  });

  it('옛 응원은 그대로 나가되 새로 고르는 목록에서는 빠진다 — 옛 ID 재생이 깨지지 않는다', async () => {
    const legacy = (await manifest()).clips.filter((clip) => clip.category === 'cheer' && clip.voice_profile_id === SYSTEM_VOICE);
    expect(legacy.map((clip) => clip.variant)).toEqual([0, 1, 2]);
    expect(legacy.map((clip) => clip.content_id)).toEqual(['cheer_v1_01', 'cheer_v1_02', 'cheer_v1_03']);
    expect(legacy.every((clip) => clip.theme === 'cheer' && clip.selectable === false)).toBe(true);
  });

  it('공개하면 같은 응답에서 목록·개수표·표지가 함께 나온다', async () => {
    await db.execute({ sql: `INSERT INTO stock_content_releases (content_set) VALUES ('cheer_v2'), ('wake_v1')`, args: [] });
    expect([...(await releasedStockContentSets(db))].sort()).toEqual(['cheer_v1', 'cheer_v2', 'wake_v1']);
    const after = await manifest();
    const v2 = after.clips.filter((clip) => clip.category === 'cheer_v2');
    expect(v2).toHaveLength(14);
    expect(v2.every((clip) => clip.theme === 'cheer' && clip.selectable)).toBe(true);
    expect(v2[4]!.content_id).toBe('cheer_v2_05');
    const wake = after.clips.filter((clip) => clip.category === 'wake');
    expect(wake.map((clip) => [clip.theme, clip.content_id])).toEqual([
      ['wake', 'wake_v1_01'],
      ['wake', 'wake_v1_02'],
      ['wake', 'wake_v1_03'],
    ]);
    expect(after.expected_variants.system.cheer_v2).toBe(14);
    expect(after.expected_variants.system.wake).toBe(3);
    expect(after.expected_variants.clone.cheer_v2).toBeUndefined();
    // 날씨처럼 묶음이 없는 카테고리는 표지가 없다.
    expect(after.clips.filter((clip) => clip.category === 'cheer').every((clip) => clip.theme === 'cheer')).toBe(true);
  });
});

describe('옛 앱의 알람 올리기 — 응원 저장값', () => {
  it('다양하게 / 고정을 응답에 되돌려 준다 — 서버에는 저장하지 않는다', async () => {
    const app = buildApp();
    const created = await app.request(
      '/alarm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          time: '07:00',
          bucket_id: 'cheer',
          voice_profile_id: SYSTEM_VOICE,
          cheer_mode: 'pinned',
          cheer_pinned_content_id: 'cheer_v2_05',
        }),
      },
      ENV,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { alarm: { id: string; cheer_mode: string; cheer_pinned_content_id: string } };
    expect(body.alarm.cheer_mode).toBe('pinned');
    expect(body.alarm.cheer_pinned_content_id).toBe('cheer_v2_05');

    const patched = await app.request(
      `/alarm/${body.alarm.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cheer_mode: 'vary', cheer_pinned_content_id: null }),
      },
      ENV,
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { alarm: Record<string, unknown> };
    expect(patchedBody.alarm.cheer_mode).toBe('vary');
    expect(patchedBody.alarm.cheer_pinned_content_id).toBeNull();
  });

  it('기상 인사(`wake`)는 버킷으로 받고, 새 응원 카테고리(`cheer_v2`)는 버킷이 아니다', async () => {
    const app = buildApp();
    const wake = await app.request(
      '/alarm',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ time: '07:00', bucket_id: 'wake', voice_profile_id: SYSTEM_VOICE }) },
      ENV,
    );
    expect(wake.status).toBe(201);
    const v2 = await app.request(
      '/alarm',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ time: '07:00', bucket_id: 'cheer_v2' }) },
      ENV,
    );
    expect(v2.status).toBe(400);
    expect(((await v2.json()) as { error_code: string }).error_code).toBe('INVALID_BUCKET_ID');
  });

  it.each([
    [{ cheer_mode: 'random' }],
    [{ cheer_pinned_content_id: 'wake_v1_01' }],
    [{ cheer_pinned_content_id: 'cheer_v9_01' }],
    [{ cheer_pinned_content_id: 42 }],
  ])('모르는 값은 400 INVALID_CHEER_SETTING — %j', async (fields) => {
    const res = await buildApp().request(
      '/alarm',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ time: '07:00', bucket_id: 'cheer', ...fields }) },
      ENV,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('INVALID_CHEER_SETTING');
  });
});

function requestSupplement(voiceProfileId: string, body: unknown = { theme: 'cheer' }) {
  return buildApp().request(
    `/voice/${voiceProfileId}/content-supplement`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    ENV,
  );
}

async function cloneQueue() {
  return (
    await db.execute({
      sql: 'SELECT status, supplement, refresh_existing, attempts, content_sets FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [CLONE],
    })
  ).rows[0];
}

// 앱이 그 클론으로 응원 알람을 **저장한 뒤** 부른다(서버 알람 사본을 지운 뒤로는 알람 올리기가 이 일을 하지 않는다 — #147).
// 막힌 요청은 큐를 건드리지 않는다.
describe('POST /voice/:id/content-supplement — 막히는 요청', () => {
  it('id 형식이 틀리면 400 INVALID_VOICE_PROFILE_ID', async () => {
    const res = await requestSupplement('not-a-uuid');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('INVALID_VOICE_PROFILE_ID');
  });

  it.each([[{ theme: 'wake' }], [{ theme: 'weather' }], [{ theme: 'cheer_v2' }], [{}], [{ theme: 1 }]])(
    '응원이 아닌 테마는 400 INVALID_BUCKET_ID — %j',
    async (body) => {
      const res = await requestSupplement(CLONE, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('INVALID_BUCKET_ID');
      expect(await cloneQueue()).toMatchObject({ status: 'done', supplement: 0 });
    },
  );

  it('개인 목소리 권한이 없으면 403 VOICE_FEATURE_REQUIRES_PAID_PLAN', async () => {
    await db.execute({ sql: `UPDATE users SET plan = 'free' WHERE id = ?`, args: [USER] });
    try {
      const res = await requestSupplement(CLONE);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('VOICE_FEATURE_REQUIRES_PAID_PLAN');
      expect(await cloneQueue()).toMatchObject({ status: 'done', supplement: 0 });
    } finally {
      await db.execute({ sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [USER] });
    }
  });

  it('내 확정·ready 클론이 아니면 404 VOICE_PROFILE_NOT_FOUND — 남의 클론·기본 목소리·초안·준비 중·지운 목소리', async () => {
    const foreign = crypto.randomUUID();
    const draft = crypto.randomUUID();
    const processing = crypto.randomUUID();
    const deleted = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, plan) VALUES (?, ?, 'other@test', 'plus')`,
      args: [OTHER_USER, OTHER_USER],
    });
    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_system, is_draft, elevenlabs_voice_id, deleted_at) VALUES
              (?, ?, '남의 클론', 'ready', 0, 0, 'el-foreign', NULL),
              (?, ?, '초안', 'ready', 0, 1, 'el-draft', NULL),
              (?, ?, '준비 중', 'processing', 0, 0, NULL, NULL),
              (?, ?, '지운 목소리', 'ready', 0, 0, 'el-deleted', datetime('now'))`,
      args: [foreign, OTHER_USER, draft, USER, processing, USER, deleted, USER],
    });
    // 남의 클론에 끝난 큐가 있어도 열리지 않는다.
    await db.execute({
      sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language, status) VALUES (?, ?, 'ko', 'done')`,
      args: [foreign, OTHER_USER],
    });
    for (const id of [foreign, SYSTEM_VOICE, draft, processing, deleted, crypto.randomUUID()]) {
      const res = await requestSupplement(id);
      expect(res.status, id).toBe(404);
      expect(((await res.json()) as { error_code: string }).error_code).toBe('VOICE_PROFILE_NOT_FOUND');
    }
    const foreignQueue = await db.execute({
      sql: 'SELECT status, supplement FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [foreign],
    });
    expect(foreignQueue.rows[0]).toMatchObject({ status: 'done', supplement: 0 });
    await db.execute({ sql: 'DELETE FROM voice_prerender_queue WHERE voice_profile_id = ?', args: [foreign] });
    expect(await cloneQueue()).toMatchObject({ status: 'done', supplement: 0 });
  });
});

describe('클론은 응원을 고른 것만 보충한다', () => {
  it('내 클론의 응원 보충을 요청하면 끝난 큐가 보충 회차로 다시 열린다 — 직접 입력 장부는 그대로다', async () => {
    const usageBefore = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM manual_tts_usage', args: [] });
    const res = await requestSupplement(CLONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'queued' });
    const queue = await db.execute({
      sql: 'SELECT status, supplement, refresh_existing, attempts, content_sets FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [CLONE],
    });
    expect(queue.rows[0]).toMatchObject({ status: 'pending', supplement: 1, refresh_existing: 0, attempts: 0 });
    expect(JSON.parse(String(queue.rows[0]!.content_sets))).toEqual(['cheer_v2']);
    const usageAfter = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM manual_tts_usage', args: [] });
    expect(usageAfter.rows[0]!.n).toBe(usageBefore.rows[0]!.n);

    // 다시 불러도 회차를 새로 열지 않는다 — 대기 중인 회차에 묶음만 적는다.
    const again = await requestSupplement(CLONE);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ result: 'requested' });
    expect(await cloneQueue()).toMatchObject({ status: 'pending', supplement: 1 });
  });

  it('보충 회차는 진행 조회에서 done 이고 개수는 기본 세트만 센다 — 목소리를 막지 않는다', async () => {
    // 보충 클립이 몇 개 구워진 상태.
    for (let v = 0; v < 5; v += 1) await addPreset(CLONE, USER, 'cheer_v2', v);
    const res = await buildApp().request(`/voice/${CLONE}/prerender-status`, {}, ENV);
    expect(res.status).toBe(200);
    const status = (await res.json()) as { status: string; generated: number; total: number };
    expect(status.status).toBe('done');
    expect(status.generated).toBe(3); // 이 테스트의 클론은 응원 3개만 기본 세트로 굽혀 있다 — 보충 5개는 세지 않는다.
  });

  it('보충 회차는 줄 맨 뒤다 — 새 등록·다시 굽기가 먼저 잡힌다', async () => {
    await db.execute({
      sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language, status, refresh_existing, requested_at)
            VALUES (?, ?, 'ko', 'pending', 1, '2030-01-01 00:00:00.000')`,
      args: [OTHER_CLONE, USER],
    });
    const claims = await claimPendingPrerenderVoices(db, 5);
    expect(claims.map((claim) => [claim.voiceProfileId, claim.supplement])).toEqual([
      [OTHER_CLONE, false],
      [CLONE, true],
    ]);
    const supplementClaim = claims.find((claim) => claim.voiceProfileId === CLONE)!;
    // 다섯 번 진전 없이 실패해도 failed 가 아니라 done 으로 접는다(기본 세트는 멀쩡하다).
    for (let i = 0; i < 5; i += 1) {
      await markPrerenderFailed(db, CLONE, supplementClaim.claimToken);
      if (i < 4) {
        await db.execute({ sql: 'UPDATE voice_prerender_queue SET claim_token = ? WHERE voice_profile_id = ?', args: [supplementClaim.claimToken, CLONE] });
      }
    }
    const queue = await db.execute({ sql: 'SELECT status, supplement FROM voice_prerender_queue WHERE voice_profile_id = ?', args: [CLONE] });
    expect(queue.rows[0]).toMatchObject({ status: 'done', supplement: 0 });
    // 다음 응원 저장이 다시 요청한다 — 묶음 기록은 남아 있다(교체 회차가 보충까지 같이 굽는다).
    expect(await requestCloneContentSupplement(db, { voiceProfileId: CLONE, ownerUserId: USER, theme: 'cheer' })).toBe('queued');
  });

  it('남의 클론·큐가 없는 목소리·공개 전·다 있는 경우는 아무 일도 하지 않는다', async () => {
    expect(await requestCloneContentSupplement(db, { voiceProfileId: CLONE, ownerUserId: 'someone-else', theme: 'cheer' })).toBe('no_queue');
    expect(await requestCloneContentSupplement(db, { voiceProfileId: SYSTEM_VOICE, ownerUserId: USER, theme: 'cheer' })).toBe('no_queue');
    expect(await requestCloneContentSupplement(db, { voiceProfileId: CLONE, ownerUserId: USER, theme: 'wake' })).toBe('no_supplement');
    for (let v = 5; v < 14; v += 1) await addPreset(CLONE, USER, 'cheer_v2', v);
    expect(await requestCloneContentSupplement(db, { voiceProfileId: CLONE, ownerUserId: USER, theme: 'cheer' })).toBe('already_complete');
    await db.execute({ sql: `DELETE FROM stock_content_releases WHERE content_set = 'cheer_v2'`, args: [] });
    expect(await requestCloneContentSupplement(db, { voiceProfileId: CLONE, ownerUserId: USER, theme: 'cheer' })).toBe('not_released');
  });

  // ⚠ 2026-10-29 — 서버 알람 사본을 지웠다(#147). 옛 앱은 켜고 끌 때마다 테마·목소리를 그대로 올리는데, 그 올리기가
  //   실패로 접힌 보충을 다시 열면 켜고 끄기마다 유료 합성을 다섯 번씩 다시 시도한다. 이제 보충을 여는 것은 앱의 보충
  //   요청뿐이고(테마나 목소리를 새로 골랐을 때만 부른다), 알람 올리기는 아무것도 열지 않는다.
  it('알람 올리기(옛 앱의 POST·PATCH /alarm)는 접힌 보충을 열지 않는다 — 여는 것은 보충 요청뿐이다', async () => {
    // 앞 테스트들이 바꿔 둔 상태를 되돌린다 — 공개된 보충 묶음이 있고, 이 클론은 아직 덜 구웠다.
    await db.execute({ sql: `INSERT OR IGNORE INTO stock_content_releases (content_set) VALUES ('cheer_v2')`, args: [] });
    await db.execute({ sql: `DELETE FROM messages WHERE voice_profile_id = ? AND category = 'cheer_v2'`, args: [CLONE] });
    await db.execute({
      sql: `UPDATE voice_prerender_queue SET status = 'done', supplement = 0, attempts = 0, claimed_at = NULL, claim_token = NULL
            WHERE voice_profile_id = ?`,
      args: [CLONE],
    });
    const app = buildApp();
    const created = await app.request(
      '/alarm',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ time: '06:40', bucket_id: 'cheer', voice_profile_id: CLONE }),
      },
      ENV,
    );
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { alarm: { id: string } }).alarm.id;
    for (const fields of [
      { bucket_id: 'cheer', voice_profile_id: CLONE },
      { is_active: false, bucket_id: 'cheer', voice_profile_id: CLONE },
    ]) {
      const patched = await app.request(
        `/alarm/${id}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields) },
        ENV,
      );
      expect(patched.status).toBe(200);
    }
    expect(await cloneQueue()).toMatchObject({ status: 'done', supplement: 0 });

    // 앱이 응원을 새로 고른 저장 뒤에 알리면 그때 열린다.
    const res = await requestSupplement(CLONE);
    expect(await res.json()).toEqual({ result: 'queued' });
    expect(await cloneQueue()).toMatchObject({ status: 'pending', supplement: 1 });
  });
});

describe('비용 dry-run — 합성하지 않는다', () => {
  it('목소리 × 언어 × 문구의 실제 글자 수를 낸다', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const set = stockContentSet('cheer_v2')!;
    const cost = stockContentCost(set);
    const ko = set.items.reduce((sum, item) => sum + [...item.texts.ko].length, 0);
    expect(cost.languages.find((l) => l.language === 'ko')).toMatchObject({
      phrases: 14,
      chars: ko,
      synthesisChars: ko * SYSTEM_VOICE_NAMES.length,
      requests: 14 * SYSTEM_VOICE_NAMES.length,
    });
    expect(cost.requests).toBe(14 * 3 * SYSTEM_VOICE_NAMES.length);
    expect(cost.cloneSupplementPhrases).toBe(14);
    expect(stockContentCost(stockContentSet('wake_v1')!).cloneSupplementPhrases).toBe(0);

    const text = formatStockContentCost({ clones: 10, cloneLanguage: 'ko', creditsPerChar: 0.5 });
    expect(text).toContain('합성하지 않는다');
    expect(text).toContain('cheer_v2');
    expect(text).toContain('wake_v1');
    expect(text).not.toContain('cheer_v1 '); // 기본은 공개 전 묶음만
    expect(text).toContain(`클론 10개 × ko: 합성 글자 ≈${ko * 10}`);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
