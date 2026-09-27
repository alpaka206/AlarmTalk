// 기간 한정 개인 플랜 **종료** — 전환·보관 스윕이 처리방침의 약속(끝 + 3일)을 지키는가.
// 스펙: `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」 → 「종료」.
//
// 지키는 것:
//   1. `delete_after` 는 약속 시각(끝 + 3일)을 넘지 않고, 정시로 내려 잡히며, 늦게 전환된 사람일수록
//      늦다(스윕이 기한 순서로 지우므로 몰리지 않는다).
//   2. **2,500명**을 실제 크론 주기(전용 1분 + 5분 틱)로 끝부터 끝 + 3일까지 돌려, 전원이 약속 전에
//      지워지고, 누구도 자기 `delete_after`(푸시가 적은 시각) 전에 지워지지 않으며, 전용 크론의 한
//      실행이 subrequest 상한을 넘지 않는다 — **푸시를 켠 채로**(기기마다 FCM 요청, OAuth 캐시 비움).
//   3. 매번 실패하는 사람이 전환·스윕을 멈추지 않고, 경보가 올라간다.
//   4. 전용 크론 문자열이 `wrangler.toml` 두 환경·`index.ts` 분기와 같고, 끝 전에는 DB 를 부르지 않는다.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PERSONAL_PROMO } from '@alarmtalk/shared';
import type { Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  PERSONAL_PROMO_END_CRON,
  PROMO_END_RUN_BUDGET,
  PROMO_END_SWEEP_BATCH,
  PROMO_END_TRANSITION_BATCH,
  promoEndDeleteAfter,
  promoEndRetentionDeadline,
  runPersonalPromoEnd,
  sweepDueRetentionInBulk,
  transitionPersonalPromoEnd,
} from '../src/lib/personal-promo-end';
import { sweepPaidVoiceRetention } from '../src/lib/billing-cancel';
import { formatKstHour, personalPromoEndWarningBody } from '../src/lib/fcm';

const DIR = mkdtempSync(join(tmpdir(), 'alarmtalk-promo-end-'));
afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(DIR, { recursive: true, force: true });
});

const END = new Date(PERSONAL_PROMO.endsAt);
const WINDOW = { startsAt: new Date('2026-09-30T15:00:00Z'), endsAt: END };
const DEADLINE = promoEndRetentionDeadline(WINDOW);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PERSONAL = '70000000-0000-4000-8000-000000000002';

/** 운영과 같은 모양 — production, 시작 스위치만 켜져 있고 끝은 shared 상수. */
const BASE_ENV = {
  ENVIRONMENT: 'production',
  PERSONAL_PROMO_STARTS_AT: '2026-10-01T00:00:00+09:00',
} as const;

// ── subrequest 계수 ─────────────────────────────────────────────────────────
// DB 왕복 하나 = subrequest 하나(트랜잭션은 문장·묶음마다 + 커밋 한 번). FCM·OAuth 도 하나씩.
const counts = { db: 0, fetch: 0 };
function counted(raw: Client): Client {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === 'execute' || prop === 'batch') {
        return async (...args: unknown[]) => {
          counts.db += 1;
          return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (prop === 'transaction') {
        return async (mode: 'read' | 'write') => {
          const tx = await target.transaction(mode);
          return new Proxy(tx, {
            get(t, p) {
              if (p === 'execute' || p === 'batch' || p === 'commit') {
                return async (...args: unknown[]) => {
                  counts.db += 1;
                  return (t[p] as (...a: unknown[]) => unknown).apply(t, args);
                };
              }
              const v = Reflect.get(t, p);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Client;
}

let signingKeyPem = '';
let isolate = 0;
/** 푸시가 켜진 env — 서비스 계정 이메일을 매번 바꿔 OAuth 캐시를 비운다(새 isolate 와 같다). */
function pushEnv(): Env {
  return {
    ...BASE_ENV,
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: `svc-${++isolate}@test-project.iam.gserviceaccount.com`,
      private_key: signingKeyPem,
    }),
  } as unknown as Env;
}
const fcmBodies: string[] = [];

beforeAll(async () => {
  const keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  signingKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: RequestInit) => {
      counts.fetch += 1;
      if (new URL(String(url)).hostname === 'oauth2.googleapis.com') {
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), {
          status: 200,
        });
      }
      if (typeof init?.body === 'string') {
        const body = (JSON.parse(init.body) as { message?: { notification?: { body?: string } } })
          .message?.notification?.body;
        if (body) fcmBodies.push(body);
      }
      return new Response('{}', { status: 200 });
    }),
  );
});

async function freshDb(name: string): Promise<Client> {
  const client = createClient({ url: `file:${join(DIR, `${name}.db`)}` });
  await runMigrations(client);
  return client;
}

async function insertMany(db: Client, statements: InStatement[]) {
  for (let i = 0; i < statements.length; i += 400) {
    await db.batch(statements.slice(i, i + 400), 'write');
  }
}

/**
 * 기간 중 목소리를 만든 원시 무료 계정 하나 — 운영에서 흔한 모양대로: 클론 하나(제공자 id 있음),
 * 원본 업로드 하나, 사전렌더 클립 `clips` 개(메시지 + 생성 오디오), 내 알람 둘, 안드로이드 기기
 * `devices` 대. 절반은 구글 계정(PK ≠ 로그인 id).
 */
function seedPromoUser(
  id: string,
  opts: { clips?: number; devices?: number; googleLogin?: boolean } = {},
): InStatement[] {
  const clips = opts.clips ?? 3;
  const devices = opts.devices ?? 1;
  const loginId = opts.googleLogin ? `g-${id}` : id;
  const vp = `vp-${id}`;
  const out: InStatement[] = [
    {
      sql: `INSERT INTO users (id, google_id, email, name, plan) VALUES (?, ?, ?, ?, 'free')`,
      args: [id, loginId, `${id}@t.test`, id],
    },
    {
      sql: `INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_draft, is_shared)
            VALUES (?, ?, '목소리', 'ready', ?, 0, 0)`,
      args: [vp, id, `el-${id}`],
    },
    {
      sql: `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes)
            VALUES (?, ?, ?, 'audio/wav', 100)`,
      args: [`up-${id}`, id, `uploads/${id}/src.wav`],
    },
  ];
  for (let c = 0; c < clips; c++) {
    const msg = `msg-${id}-${c}`;
    out.push(
      {
        sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
              VALUES (?, ?, ?, '좋은 아침', 'weather', 1, ?)`,
        args: [msg, id, vp, `r2://generated-tts/${id}/${c}.mp3`],
      },
      {
        sql: `INSERT INTO generated_audio_assets
                (id, user_id, voice_profile_id, message_id, provider, provider_voice_id, model_id,
                 language, request_hash, text, audio_object_key)
              VALUES (?, ?, ?, ?, 'elevenlabs', ?, 'm', 'ko', ?, '좋은 아침', ?)`,
        args: [
          `ga-${id}-${c}`,
          id,
          vp,
          msg,
          `el-${id}`,
          `h-${id}-${c}`,
          `generated-tts/${id}/${c}.mp3`,
        ],
      },
    );
  }
  for (let a = 0; a < 2; a++) {
    out.push({
      sql: `INSERT INTO alarms (id, user_id, message_id, time, mode, voice_profile_id)
            VALUES (?, ?, ?, '07:00', 'tts', ?)`,
      args: [`al-${id}-${a}`, id, clips > 0 ? `msg-${id}-0` : null, vp],
    });
  }
  for (let d = 0; d < devices; d++) {
    out.push({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'android')`,
      args: [`pt-${id}-${d}`, id, `tok-${id}-${d}`],
    });
  }
  return out;
}

async function retentionOf(db: Client, userId: string): Promise<string | null> {
  const r = await db.execute({
    sql: 'SELECT delete_after FROM paid_voice_retention WHERE user_id = ?',
    args: [userId],
  });
  return r.rows[0] ? String(r.rows[0].delete_after) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('promoEndDeleteAfter — 약속 시각을 넘지 않게 거꾸로 나눠 건다', () => {
  const at = new Date(END.getTime() + 5 * MINUTE);

  it('언제나 약속 시각(끝 + 3일) 이하, 정시', () => {
    for (const remaining of [1, 10, 11, 250, 2500, 5000]) {
      const d = promoEndDeleteAfter(WINDOW, at, remaining);
      expect(d.getTime()).toBeLessThanOrEqual(DEADLINE.getTime());
      expect(d.getTime() % HOUR).toBe(0);
    }
    expect(DEADLINE.toISOString()).toBe('2026-11-03T15:00:00.000Z');
  });

  it('남은 대상이 줄수록(나중에 전환될수록) 늦다 — 스윕이 기한 순서로 지우면 몰리지 않는다', () => {
    let previous = 0;
    for (let remaining = 2500; remaining >= 1; remaining -= 15) {
      const d = promoEndDeleteAfter(WINDOW, at, remaining).getTime();
      expect(d).toBeGreaterThanOrEqual(previous);
      previous = d;
    }
    // 마지막 사람도 약속 시각보다 최소 한 시간은 먼저다.
    expect(promoEndDeleteAfter(WINDOW, at, 1).getTime()).toBe(DEADLINE.getTime() - HOUR - HOUR);
  });

  it('2,500명이면 가장 이른 사람도 끝 + 2.5일 뒤다(보관을 크게 줄이지 않는다)', () => {
    const earliest = promoEndDeleteAfter(WINDOW, at, 2500);
    expect(earliest.getTime() - END.getTime()).toBeGreaterThanOrEqual(2.5 * DAY);
  });

  it('약속을 지킬 수 없을 만큼 많거나 이미 지났으면 — 지금 이후 첫 정시, 그래도 약속 시각을 넘지 않는다', () => {
    const huge = promoEndDeleteAfter(WINDOW, at, 1_000_000);
    expect(huge.getTime()).toBe(Math.ceil(at.getTime() / HOUR) * HOUR);
    const late = promoEndDeleteAfter(WINDOW, new Date(DEADLINE.getTime() + 2 * HOUR), 1);
    expect(late.getTime()).toBe(DEADLINE.getTime());
  });
});

describe('삭제 예고 문구 — 개인 플랜 종료는 이용권 문구를 쓰지 않는다', () => {
  it('사람마다 자기 기한을 한국 시간 정시로 적는다', () => {
    const deleteAfter = new Date('2026-11-03T05:00:00Z');
    expect(formatKstHour(deleteAfter)).toBe('11월 3일 오후 2시');
    const body = personalPromoEndWarningBody(deleteAfter, new Date('2026-11-01T00:00:00Z'));
    expect(body).toContain('기간 한정 개인 플랜이 끝나');
    expect(body).toContain('11월 3일 오후 2시까지만 보관');
    expect(body).not.toContain('이용권이 끝나');
    expect(body).not.toContain('다시 등록');
  });

  it('기한이 한 시간도 안 남았으면 시각을 약속하지 않는다', () => {
    const body = personalPromoEndWarningBody(
      new Date('2026-11-03T15:00:00Z'),
      new Date('2026-11-03T14:30:00Z'),
    );
    expect(body).toContain('곧 영구 삭제');
    expect(body).not.toMatch(/\d+시까지/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('전용 크론 한 실행의 subrequest — 푸시를 켠 운영 조건', () => {
  it('전환 한 묶음: 기기 수로 잘라 상한 안, 대상에게는 개인 플랜 종료 문구', async () => {
    const raw = await freshDb('budget-transition');
    const seed: InStatement[] = [];
    // 기기 셋인 사람이 섞여 있다 — 사람 수가 아니라 알림 수가 묶음을 자른다.
    for (let i = 0; i < 40; i++) {
      seed.push(
        ...seedPromoUser(`t${String(i).padStart(3, '0')}`, {
          devices: i % 7 === 0 ? 3 : 1,
          googleLogin: i % 2 === 0,
        }),
      );
    }
    await insertMany(raw, seed);
    const db = counted(raw);
    fcmBodies.length = 0;
    counts.db = 0;
    counts.fetch = 0;
    const at = new Date(END.getTime() + MINUTE);
    const run = await runPersonalPromoEnd(db, pushEnv(), at, { role: 'dedicated' });
    const used = counts.db + counts.fetch;
    console.log('전환 한 실행 subrequests =', used, 'transitioned =', run.transitioned.length);
    expect(run.transitioned.length).toBeGreaterThan(0);
    expect(run.transitioned.length).toBeLessThanOrEqual(PROMO_END_TRANSITION_BATCH);
    expect(used).toBeLessThanOrEqual(PROMO_END_RUN_BUDGET);
    expect(fcmBodies.length).toBeGreaterThan(0);
    for (const body of fcmBodies) expect(body).toContain('기간 한정 개인 플랜이 끝나');
    // 전환된 사람: 원시 free · 클론 반납 · 보관 행(약속 시각 이하).
    const first = run.transitioned[0]!;
    expect(first.deleteAfter.getTime()).toBeLessThanOrEqual(DEADLINE.getTime());
    expect(await retentionOf(raw, first.userPk)).toBe(first.deleteAfter.toISOString());
    const vp = await raw.execute({
      sql: 'SELECT elevenlabs_voice_id, evicted_provider_voice_id FROM voice_profiles WHERE id = ?',
      args: [`vp-${first.userPk}`],
    });
    expect(vp.rows[0]!.elevenlabs_voice_id).toBeNull();
    expect(vp.rows[0]!.evicted_provider_voice_id).toBe(`el-${first.userPk}`);
    raw.close();
  });

  it('스윕 한 묶음: 사전렌더 21클립짜리 사람들을 한 번에 지워도 상한 안', async () => {
    const raw = await freshDb('budget-sweep');
    const seed: InStatement[] = [];
    const ids = Array.from({ length: 30 }, (_, i) => `s${String(i).padStart(3, '0')}`);
    for (const [i, id] of ids.entries()) {
      // 기기 둘인 사람이 섞여 있다 — 무음 신호가 기기마다 한 통이라 묶음이 그만큼 줄어든다.
      seed.push(
        ...seedPromoUser(id, { clips: 21, devices: i % 3 === 0 ? 2 : 1, googleLogin: i % 2 === 0 }),
      );
      seed.push({
        sql: 'INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, ?)',
        args: [id, '2026-11-03T05:00:00.000Z'],
      });
    }
    await insertMany(raw, seed);
    const db = counted(raw);
    counts.db = 0;
    counts.fetch = 0;
    const at = new Date('2026-11-03T05:01:00Z');
    const run = await runPersonalPromoEnd(db, pushEnv(), at, { role: 'dedicated' });
    const used = counts.db + counts.fetch;
    console.log('스윕 한 실행 subrequests =', used, 'cleaned =', run.sweep?.cleanedUserPks.length);
    expect(run.sweep?.cleanedUserPks.length).toBeGreaterThan(0);
    expect(run.sweep?.cleanedUserPks.length).toBeLessThanOrEqual(PROMO_END_SWEEP_BATCH);
    expect(used).toBeLessThanOrEqual(PROMO_END_RUN_BUDGET);
    // 지운 사람: 목소리·클립·업로드·알람 행이 없고, 파일은 삭제 큐에 있다. 보관 행도 없다.
    const gone = run.sweep!.cleanedUserPks[0]!;
    for (const [table, col] of [
      ['voice_profiles', 'id'],
      ['messages', 'user_id'],
      ['voice_uploads', 'user_id'],
      ['generated_audio_assets', 'user_id'],
    ] as const) {
      const r = await raw.execute({
        sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`,
        args: [table === 'voice_profiles' ? `vp-${gone}` : gone],
      });
      expect(Number(r.rows[0]!.n)).toBe(0);
    }
    expect(await retentionOf(raw, gone)).toBeNull();
    const queued = await raw.execute({
      sql: `SELECT COUNT(*) AS n FROM pending_external_deletions WHERE ref LIKE ?`,
      args: [`generated-tts/${gone}/%`],
    });
    expect(Number(queued.rows[0]!.n)).toBe(21);
    // 남은 사람은 그대로다.
    const left = ids.filter((id) => !run.sweep!.cleanedUserPks.includes(id));
    expect(await retentionOf(raw, left[0]!)).not.toBeNull();
    raw.close();
  });

  it('스윕 묶음: 지금 유료인 사람은 보관 행만 풀고 데이터는 남긴다', async () => {
    const raw = await freshDb('bulk-sweep-paid');
    await insertMany(raw, [
      ...seedPromoUser('keep', { clips: 2 }),
      ...seedPromoUser('drop', { clips: 2 }),
      {
        sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
              VALUES ('sub-keep', 'keep', ?, 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
        args: [PERSONAL],
      },
      { sql: `UPDATE users SET plan = 'plus' WHERE id = 'keep'`, args: [] },
      {
        sql: 'INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, ?), (?, ?)',
        args: ['keep', '2026-11-03T05:00:00.000Z', 'drop', '2026-11-03T05:00:00.000Z'],
      },
    ]);
    // 창이 작으면 묶음이 창의 절반이다(끝물 회피) — 두 번 돌면 둘 다 한 번씩 본다.
    const attempted: string[] = [];
    const cleaned: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await sweepDueRetentionInBulk(raw, new Date('2026-11-03T06:00:00Z'), {
        promoCoversFree: false,
        notifyMessages: null,
      });
      attempted.push(...res.attempted);
      cleaned.push(...res.cleanedUserPks);
    }
    expect(attempted.sort()).toEqual(['drop', 'keep']);
    expect(cleaned).toEqual(['drop']);
    expect(await retentionOf(raw, 'keep')).toBeNull();
    const kept = await raw.execute("SELECT COUNT(*) AS n FROM voice_profiles WHERE id = 'vp-keep'");
    expect(Number(kept.rows[0]!.n)).toBe(1);
    const dropped = await raw.execute(
      "SELECT COUNT(*) AS n FROM voice_profiles WHERE id = 'vp-drop'",
    );
    expect(Number(dropped.rows[0]!.n)).toBe(0);
    raw.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2,500명 — 실제 크론 주기로 끝부터 끝 + 3일까지', () => {
  it('전원이 약속 전에, 자기 기한 뒤에 지워지고, 전용 크론 한 실행은 상한 안이다', async () => {
    const raw = await freshDb('simulation');
    const N = 2500;
    const targets: string[] = [];
    const seed: InStatement[] = [];
    for (let i = 0; i < N; i++) {
      const id = `u${String(i).padStart(5, '0')}`;
      targets.push(id);
      // 기기: 대부분 하나, 열에 하나는 둘, 쉰에 하나는 없음.
      const devices = i % 50 === 0 ? 0 : i % 10 === 0 ? 2 : 1;
      seed.push(...seedPromoUser(id, { devices, googleLogin: i % 2 === 0 }));
    }
    // 대상 아님: 결제자 · 결제 보류(원시 free + active 행) · 목소리 없는 무료.
    for (let i = 0; i < 20; i++) {
      const paid = `paid${i}`;
      const hold = `hold${i}`;
      seed.push(
        ...seedPromoUser(paid),
        { sql: `UPDATE users SET plan = 'plus' WHERE id = ?`, args: [paid] },
        {
          sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
                  VALUES (?, ?, ?, 'active', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z')`,
          args: [`sub-${paid}`, paid, PERSONAL],
        },
        ...seedPromoUser(hold),
        {
          sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at, entitlement_state)
                  VALUES (?, ?, ?, 'active', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z', 'suspended')`,
          args: [`sub-${hold}`, hold, PERSONAL],
        },
        {
          sql: `INSERT INTO users (id, google_id, email, name, plan) VALUES (?, ?, ?, ?, 'free')`,
          args: [`novoice${i}`, `novoice${i}`, `nv${i}@t.test`, 'nv'],
        },
      );
    }
    await insertMany(raw, seed);
    const db = counted(raw);

    const deleteAfterOf = new Map<string, number>();
    const cleanedAt = new Map<string, number>();
    let maxDedicated = 0;
    let transitionDoneAt: number | null = null;
    const errors: string[] = [];
    const hooks = { onError: (stage: string) => void errors.push(stage) };

    for (let t = END.getTime(); t <= DEADLINE.getTime() + 30 * MINUTE; t += MINUTE) {
      const at = new Date(t);
      counts.db = 0;
      counts.fetch = 0;
      const run = await runPersonalPromoEnd(db, pushEnv(), at, { role: 'dedicated', hooks });
      maxDedicated = Math.max(maxDedicated, counts.db + counts.fetch);
      for (const tr of run.transitioned) deleteAfterOf.set(tr.userPk, tr.deleteAfter.getTime());
      for (const id of run.sweep?.cleanedUserPks ?? []) cleanedAt.set(id, t);

      if ((t - END.getTime()) % (5 * MINUTE) === 0) {
        // 5분 틱: 전환 폴백 + 사람마다 스윕(예전부터 있던 그물).
        const main = await runPersonalPromoEnd(db, pushEnv(), at, { role: 'main', hooks });
        for (const tr of main.transitioned) deleteAfterOf.set(tr.userPk, tr.deleteAfter.getTime());
        const swept = await sweepPaidVoiceRetention(db, at, false);
        for (const id of swept.cleanedUserPks) cleanedAt.set(id, t);
      }
      if (transitionDoneAt === null && deleteAfterOf.size === N) transitionDoneAt = t;
    }

    console.log(
      'simulation: 전용 크론 최대 subrequests =',
      maxDedicated,
      '/ 전원 전환까지(분) =',
      transitionDoneAt === null ? null : (transitionDoneAt - END.getTime()) / MINUTE,
      '/ 가장 이른 삭제(끝부터 시간) =',
      (Math.min(...cleanedAt.values()) - END.getTime()) / HOUR,
      '/ 가장 늦은 삭제(약속 전 분) =',
      (DEADLINE.getTime() - Math.max(...cleanedAt.values())) / MINUTE,
    );
    expect(errors).toEqual([]);
    expect(maxDedicated).toBeLessThanOrEqual(PROMO_END_RUN_BUDGET);
    // 전원 전환 — 끝 뒤 하루 안에(실제로는 몇 시간).
    expect(deleteAfterOf.size).toBe(N);
    expect(transitionDoneAt! - END.getTime()).toBeLessThan(DAY);
    // 전원 삭제 — 약속 시각 전에, 그리고 푸시가 적은 자기 기한 전에는 아니게.
    for (const id of targets) {
      const at = cleanedAt.get(id);
      expect(at, id).toBeDefined();
      expect(at!).toBeLessThanOrEqual(DEADLINE.getTime());
      expect(at!).toBeGreaterThanOrEqual(deleteAfterOf.get(id)!);
      expect(deleteAfterOf.get(id)!).toBeLessThanOrEqual(DEADLINE.getTime());
    }
    const left = await raw.execute(
      `SELECT COUNT(*) AS n FROM voice_profiles WHERE id LIKE 'vp-u%'`,
    );
    expect(Number(left.rows[0]!.n)).toBe(0);
    // 대상 아님은 그대로다 — 보관 행도 없다.
    for (let i = 0; i < 20; i++) {
      expect(await retentionOf(raw, `paid${i}`)).toBeNull();
      expect(await retentionOf(raw, `hold${i}`)).toBeNull();
      expect(await retentionOf(raw, `novoice${i}`)).toBeNull();
    }
    const kept = await raw.execute(
      `SELECT COUNT(*) AS n FROM voice_profiles WHERE id LIKE 'vp-paid%' OR id LIKE 'vp-hold%'`,
    );
    expect(Number(kept.rows[0]!.n)).toBe(40);
    raw.close();
  }, 600_000);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('매번 실패하는 사람이 멈추게 하지 않는다', () => {
  it('전환: 실패한 사람은 경보하고 빼며, 나머지는 같은 실행·다음 실행에서 계속된다', async () => {
    const raw = await freshDb('starve-transition');
    const seed: InStatement[] = [];
    // 'a-bad' 가 id 순서로 맨 앞 — 예전(`ORDER BY u.id LIMIT 3`)이면 매 틱 한 자리를 영구히 먹었다.
    for (const id of ['a-bad', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']) {
      seed.push(...seedPromoUser(id, { devices: 0 }));
    }
    await insertMany(raw, seed);
    await raw.execute(`CREATE TRIGGER fail_bad BEFORE INSERT ON paid_voice_retention
      WHEN NEW.user_id = 'a-bad' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    const alerts: Array<{ stage: string; uid?: string }> = [];
    const hooks = {
      onError: (stage: string, _err: unknown, tags?: Record<string, string>) =>
        void alerts.push({ stage, uid: tags?.uid }),
    };
    const at = new Date(END.getTime() + MINUTE);
    const exclude = new Set<string>();
    // 기준점 '' = 맨 앞부터 → 'a-bad' 가 묶음 첫 자리. 묶음이 실패하고, 한 사람씩 다시 한다.
    const first = await transitionPersonalPromoEnd(raw, WINDOW, at, {
      limit: 5,
      pivot: '',
      exclude,
      notifyMessages: null,
      hooks,
    });
    expect(first.map((t) => t.userPk)).toEqual(['b1', 'b2']);
    expect(alerts).toEqual([{ stage: 'transition_user', uid: 'a-bad' }]);
    expect(exclude.has('a-bad')).toBe(true);
    // 같은 실행의 다음 묶음은 그 사람을 빼고 고른다.
    const second = await transitionPersonalPromoEnd(raw, WINDOW, at, {
      limit: 5,
      pivot: '',
      exclude,
      notifyMessages: null,
      hooks,
    });
    expect(second.map((t) => t.userPk)).toEqual(['b3', 'b4', 'b5', 'b6', 'b7']);

    // 기준점이 매번 무작위라 실행마다 같은 사람이 맨 앞에 오지 않는다 — 전용 크론으로 돌려도
    // 나머지가 전부 끝난다(여기서는 이미 끝났으니 'a-bad' 만 남아 경보만 쌓인다).
    for (let i = 0; i < 5; i++) {
      await runPersonalPromoEnd(
        raw,
        BASE_ENV as unknown as Env,
        new Date(at.getTime() + i * MINUTE),
        {
          role: 'dedicated',
          hooks,
        },
      );
    }
    expect(await retentionOf(raw, 'a-bad')).toBeNull();
    expect(alerts.every((a) => a.uid === 'a-bad')).toBe(true);
    raw.close();
  });

  it('스윕: 실패하는 사람이 창 맨 앞에 남아도 나머지는 지워지고, 묶음 실패는 경보된다', async () => {
    const raw = await freshDb('starve-sweep');
    const ids = [
      'a-bad',
      ...Array.from({ length: 24 }, (_, i) => `s${String(i).padStart(2, '0')}`),
    ];
    const seed: InStatement[] = [];
    for (const id of ids) {
      seed.push(...seedPromoUser(id, { devices: 0 }), {
        sql: 'INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, ?)',
        // 'a-bad' 의 기한이 가장 이르다 — 기한 순서 창의 맨 앞에 영원히 남는다.
        args: [id, id === 'a-bad' ? '2026-11-03T04:00:00.000Z' : '2026-11-03T05:00:00.000Z'],
      });
    }
    await insertMany(raw, seed);
    await raw.execute(`CREATE TRIGGER fail_bad_sweep BEFORE DELETE ON voice_profiles
      WHEN OLD.user_id = 'a-bad' BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    // 결정적인 난수(선형 합동) — 실행마다 다른 묶음.
    let seedValue = 7;
    const random = () => {
      seedValue = (seedValue * 1103515245 + 12345) % 2147483648;
      return seedValue / 2147483648;
    };
    const alerts: string[] = [];
    const at = new Date('2026-11-03T05:30:00Z');
    let runs = 0;
    for (; runs < 30; runs++) {
      await sweepDueRetentionInBulk(raw, new Date(at.getTime() + runs * MINUTE), {
        promoCoversFree: false,
        notifyMessages: null,
        random,
        hooks: { onError: (stage) => void alerts.push(stage) },
      });
      const left = await raw.execute('SELECT COUNT(*) AS n FROM paid_voice_retention');
      if (Number(left.rows[0]!.n) === 1) break;
    }
    expect(runs).toBeLessThan(30);
    expect(await retentionOf(raw, 'a-bad')).not.toBeNull();
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts)).toEqual(new Set(['sweep_batch']));
    raw.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('전용 크론 배선', () => {
  it('wrangler.toml 두 환경에 전용 크론이 있고, 5분 틱도 그대로다', () => {
    const toml = readFileSync(join(__dirname, '../wrangler.toml'), 'utf-8');
    for (const env of ['dev', 'production']) {
      const block = toml.slice(toml.indexOf(`[env.${env}.triggers]`));
      const crons = block.slice(0, block.indexOf(']', block.indexOf('crons')) + 1);
      expect(crons).toContain(`"${PERSONAL_PROMO_END_CRON}"`);
      expect(crons).toContain('"*/5 * * * *"');
    }
  });

  it('index.ts 는 그 문자열로 분기한다', () => {
    const src = readFileSync(join(__dirname, '../src/index.ts'), 'utf-8');
    expect(src).toContain('event.cron === PERSONAL_PROMO_END_CRON');
  });

  it('끝 전·스위치 꺼짐·약속 + 하루 뒤에는 DB 를 부르지 않는다(기간 내내 1분마다 도는 실행이다)', async () => {
    const raw = await freshDb('idle');
    const db = counted(raw);
    counts.db = 0;
    await runPersonalPromoEnd(db, BASE_ENV as unknown as Env, new Date(END.getTime() - MINUTE), {
      role: 'dedicated',
    });
    await runPersonalPromoEnd(db, {} as Env, new Date(END.getTime() + MINUTE), {
      role: 'dedicated',
    });
    await runPersonalPromoEnd(
      db,
      BASE_ENV as unknown as Env,
      new Date(DEADLINE.getTime() + 2 * DAY),
      {
        role: 'dedicated',
      },
    );
    await runPersonalPromoEnd(db, BASE_ENV as unknown as Env, new Date(END.getTime() - MINUTE), {
      role: 'main',
    });
    expect(counts.db).toBe(0);
    raw.close();
  });
});
