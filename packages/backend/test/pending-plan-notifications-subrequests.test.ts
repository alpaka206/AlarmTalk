// **탈퇴 등급 통지 대기열의 한 차례가 예산(`PLAN_NOTIFY_RUN_BUDGET`) 안에 드는가** — 실측(리뷰).
//
// 비우기는 사람마다 기기 수로 비용을 미리 세어(기기당 최대 두 통 + 메시지 밖 비용
// `PLAN_NOTIFY_RUN_OVERHEAD`) 예산 안에 드는 만큼만 잡는다. 그 셈이 맞는지는 진짜 발송 함수
// (`notifyBillingStateChanged` → `sendBillingStateSignals` → FCM)를 돌려 subrequest 를 세어 봐야 안다 —
// 발송 쪽에 조회가 하나 늘면 셈이 조용히 틀어져, 예산에 든다고 잡은 사람이 잘리고 시도 횟수만 오른다.
// DB 왕복 하나 = subrequest 하나, OAuth·FCM 발송도 하나씩(`personal-promo-end.test.ts` 와 같은 계수).
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import type { Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  enqueuePlanNotificationsStatement,
  runPlanNotificationDrainTurn,
  PLAN_NOTIFY_RUN_BUDGET,
  PLAN_NOTIFY_RUN_OVERHEAD,
} from '../src/lib/pending-plan-notifications';

const counts = { db: 0, fetch: 0, fcm: 0 };
function counted(raw: Client): Client {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === 'execute' || prop === 'batch') {
        return async (...args: unknown[]) => {
          counts.db += 1;
          return (target[prop] as (...a: unknown[]) => unknown).apply(target, args);
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
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: `svc-${++isolate}@test-project.iam.gserviceaccount.com`,
      private_key: signingKeyPem,
    }),
  } as unknown as Env;
}

beforeAll(async () => {
  const keys = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const b64 = btoa(String.fromCharCode(...pkcs8));
  signingKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      counts.fetch += 1;
      if (new URL(String(url)).hostname === 'oauth2.googleapis.com') {
        return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
      }
      counts.fcm += 1;
      return new Response(JSON.stringify({ name: 'projects/test-project/messages/1' }), { status: 200 });
    }),
  );
});

let raw: Client;
beforeEach(async () => {
  raw = createClient({ url: ':memory:' });
  await runMigrations(raw);
  counts.db = 0;
  counts.fetch = 0;
  counts.fcm = 0;
});

/** 탈퇴로 그룹에서 떨어져 나간 멤버 — 기기 `devices` 대, 목소리 보관 유예가 걸려 예고까지 받는다(최악). */
async function member(id: string, devices: number): Promise<void> {
  await raw.execute({
    sql: `INSERT INTO users (id, email, name, plan) VALUES (?, ?, ?, 'free')`,
    args: [id, `${id}@example.com`, id],
  });
  await raw.execute({
    sql: `INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, '2026-10-08T00:00:00.000Z')`,
    args: [id],
  });
  for (let i = 0; i < devices; i++) {
    await raw.execute({
      sql: `INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'android')`,
      args: [`pt-${id}-${i}`, id, `tok-${id}-${i}`],
    });
  }
  await raw.execute(enqueuePlanNotificationsStatement([id])!);
}

async function queued(): Promise<number> {
  const res = await raw.execute(`SELECT COUNT(*) AS n FROM pending_plan_notifications`);
  return Number(res.rows[0]!.n);
}

describe('탈퇴 등급 통지 대기열 — 한 차례의 subrequest 실측', () => {
  it('기기 하나인 멤버가 많으면 예산에 드는 만큼(18명) 보내고, 한 차례가 예산 안이다', async () => {
    for (let i = 0; i < 25; i++) await member(`m${String(i).padStart(2, '0')}`, 1);

    expect(await runPlanNotificationDrainTurn(counted(raw), pushEnv())).toBe(true);

    const used = counts.db + counts.fetch;
    const fits = Math.floor((PLAN_NOTIFY_RUN_BUDGET - PLAN_NOTIFY_RUN_OVERHEAD) / 2);
    // 예고 + 재조회 짝 — 기기당 두 통.
    expect(counts.fcm).toBe(2 * fits);
    expect(await queued()).toBe(25 - fits);
    expect(used).toBeLessThanOrEqual(PLAN_NOTIFY_RUN_BUDGET);
  });

  it('기기가 예산보다 많은 한 사람도 그 사람만 잘라 보내고, 한 차례가 예산 안이다', async () => {
    await member('many', 40);
    await member('next', 1);

    await runPlanNotificationDrainTurn(counted(raw), pushEnv());

    const used = counts.db + counts.fetch;
    expect(counts.fcm).toBe(PLAN_NOTIFY_RUN_BUDGET - PLAN_NOTIFY_RUN_OVERHEAD);
    expect(await queued()).toBe(1);
    expect(used).toBeLessThanOrEqual(PLAN_NOTIFY_RUN_BUDGET);
  });

  it('대기열이 비어 있으면 조회 한 번으로 끝난다(같은 실행에서 개인 플랜 종료 작업이 이어 쓴다)', async () => {
    expect(await runPlanNotificationDrainTurn(counted(raw), pushEnv())).toBe(false);
    expect(counts.db + counts.fetch).toBe(1);
  });
});
