// 관리자 기간 지급(`docs/spec/billing-lifecycle.md` 「관리자 기간 지급」) — 실제 SQLite(메모리)에 마이그레이션을 전부
// 돌리고 확인한다.
//  - 기간: 한국 달력 1개월(말일 보정), 겹친 지급은 합집합
//  - 읽기: 원시 free + 유효 지급 → plus, 원시 plan 은 그대로
//  - 멱등: 같은 확인 화면을 두 번 보내도 한 번
//  - 뒷정리: 다른 권한이 없으면 클론 반납 + 지금부터 3일 보관(더 늦은 기한은 그대로), 다른 권한이 있으면 아무것도 안 함
//  - 행사 종료 전환 대상에서 빠진다, 구독이 끝나도 지급 중이면 클론을 반납하지 않는다
//  - 콘솔: 상세 → 확인 → 지급 → 회수
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const holder: { db: Client | null } = { db: null };
vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import {
  addKstCalendarMonths,
  composeLimitedPlanFields,
  createPlanGrant,
  endOfKstDate,
  grantEndFor,
  loadPlanGrantAnswer,
  mergedGrantEnd,
  revokePlanGrant,
  settleEndedPlanGrants,
} from '../src/lib/plan-grants';
import { planWithGrantSql } from '../src/lib/plan-grant-sql';
import { cancelSubscriptionImmediate, hasActivePaidEntitlement } from '../src/lib/billing-cancel';
import adminRoutes from '../src/routes/admin';

const ENV = {} as AppEnv['Bindings'];
const DAY = 24 * 60 * 60 * 1000;
let db: Client;

async function run(sql: string, args: Array<string | number | null> = []) {
  await db.execute({ sql, args });
}

async function effectivePlan(id: string): Promise<string> {
  const r = await db.execute({ sql: `SELECT ${planWithGrantSql('users')} AS plan FROM users WHERE id = ?`, args: [id] });
  return String(r.rows[0]!.plan);
}

async function addUser(id: string, plan = 'free') {
  await run(`INSERT INTO users (id, email, name, plan) VALUES (?, ?, ?, ?)`, [id, `${id}@example.com`, id, plan]);
  await run(
    `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status) VALUES (?, ?, '내 목소리', ?, 'ready')`,
    [`vp-${id}`, id, `el-${id}`],
  );
}

async function grant(userPk: string, endsAt: Date, key: string, now = new Date()) {
  return createPlanGrant(db, ENV, { userPk, endsAt, reason: 'support', note: '', actor: 'test', requestKey: key }, now);
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  holder.db = db;
  await runMigrations(db);
});

beforeEach(async () => {
  for (const t of ['plan_grants', 'paid_voice_retention', 'voice_profiles', 'subscriptions', 'users']) {
    await run(`DELETE FROM ${t}`);
  }
});

describe('기간 계산', () => {
  it('한국 달력 1개월 — 같은 날짜가 없으면 그 달 말일의 같은 시각', () => {
    // 10/26 14:00 KST = 05:00Z
    expect(addKstCalendarMonths(new Date('2026-10-26T05:00:00Z'), 1).toISOString()).toBe('2026-11-26T05:00:00.000Z');
    // 10/31 14:00 KST → 11/30 14:00 KST
    expect(addKstCalendarMonths(new Date('2026-10-31T05:00:00Z'), 1).toISOString()).toBe('2026-11-30T05:00:00.000Z');
    // 한국 날짜로는 1/31 인데 UTC 로는 1/30 인 순간 — 한국 달력을 따른다(→ 2/28 KST).
    expect(addKstCalendarMonths(new Date('2027-01-30T20:00:00Z'), 1).toISOString()).toBe('2027-02-27T20:00:00.000Z');
  });

  it('끝나는 날 지정은 그 한국 날짜가 끝나는 순간이다', () => {
    expect(endOfKstDate('2026-11-08')!.toISOString()).toBe('2026-11-08T15:00:00.000Z');
    expect(endOfKstDate('2026-02-30')).toBeNull();
  });

  it('지난 날·너무 긴 기간은 거절한다', () => {
    const now = new Date('2026-10-26T05:00:00Z');
    expect(() => grantEndFor({ kind: 'until', date: '2026-10-25' }, now)).toThrow();
    expect(() => grantEndFor({ kind: 'days', days: 400 }, now)).toThrow();
    expect(grantEndFor({ kind: 'days', days: 7 }, now).toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('겹치거나 맞닿은 지급은 하나로 잇고, 기간을 더하지 않는다', () => {
    const now = new Date('2026-10-26T00:00:00Z');
    const end = mergedGrantEnd(
      [
        { startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', revokedAt: null },
        { startsAt: '2026-10-25T00:00:00Z', endsAt: '2026-11-05T00:00:00Z', revokedAt: null },
        { startsAt: '2026-11-05T00:00:00Z', endsAt: '2026-11-10T00:00:00Z', revokedAt: null },
        { startsAt: '2026-11-20T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', revokedAt: null },
        { startsAt: '2026-10-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', revokedAt: '2026-10-02T00:00:00Z' },
      ],
      now,
    );
    expect(end!.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });
});

describe('지급과 읽기', () => {
  it('원시 free + 유효 지급 → 플러스로 읽고, 원시 plan 은 그대로다', async () => {
    await addUser('u1');
    const { created } = await grant('u1', new Date(Date.now() + 7 * DAY), 'key-u1-0001');
    expect(created).toBe(true);
    expect(await effectivePlan('u1')).toBe('plus');
    const raw = await db.execute(`SELECT plan FROM users WHERE id = 'u1'`);
    expect(raw.rows[0]!.plan).toBe('free');
    expect(await hasActivePaidEntitlement(db, 'u1', false)).toBe(true);
    const answer = await loadPlanGrantAnswer(db, 'u1', null);
    expect(answer.plan).toBe('plus');
    expect(answer.planGrant).toMatchObject({ ends_at: expect.any(String), computed_at: expect.any(String) });
  });

  it('원시 유료(구독자)에게는 plan_grant 를 싣지 않는다 — 앱이 산 이용권을 무료로 읽지 않게', async () => {
    await addUser('u1p', 'plus');
    await grant('u1p', new Date(Date.now() + 7 * DAY), 'key-u1p-001');
    expect(await loadPlanGrantAnswer(db, 'u1p', null)).toEqual({ plan: 'plus', rawPlan: 'plus', planGrant: null });
  });

  it('같은 확인 화면을 두 번 보내도 한 번만 준다', async () => {
    await addUser('u2');
    const end = new Date(Date.now() + 7 * DAY);
    await grant('u2', end, 'key-u2-0001');
    const again = await grant('u2', end, 'key-u2-0001');
    expect(again.created).toBe(false);
    const n = await db.execute(`SELECT COUNT(*) AS n FROM plan_grants WHERE user_id = 'u2'`);
    expect(Number(n.rows[0]!.n)).toBe(1);
  });

  it('탈퇴 대기·시스템 계정에는 주지 않는다', async () => {
    await addUser('u3');
    await run(`UPDATE users SET deletion_status = 'pending_deletion' WHERE id = 'u3'`);
    await expect(grant('u3', new Date(Date.now() + DAY), 'key-u3-0001')).rejects.toThrow();
  });

  it('지급하면 걸려 있던 목소리 보관 예약을 푼다', async () => {
    await addUser('u4');
    await run(`INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('u4', ?)`, [
      new Date(Date.now() + DAY).toISOString(),
    ]);
    await grant('u4', new Date(Date.now() + 7 * DAY), 'key-u4-0001');
    const r = await db.execute(`SELECT 1 FROM paid_voice_retention WHERE user_id = 'u4'`);
    expect(r.rows).toHaveLength(0);
  });
});

describe('행사와 지급이 둘 다 덮으면 더 늦게 끝나는 기한 하나만 싣는다', () => {
  const promo = { ends_at: '2026-10-31T15:00:00Z', notice_from: '2026-10-24T15:00:00Z', deletes_voices_at_end: true };
  const grantField = (ends_at: string) => ({ ends_at, computed_at: '2026-10-26T00:00:00Z' });
  it('지급이 행사보다 먼저 끝나면 행사 조각 — 짧은 지급이 행사를 가리지 않는다', () => {
    expect(composeLimitedPlanFields(promo, grantField('2026-10-27T15:00:00Z'))).toEqual({ personalPromo: promo, planGrant: null });
  });
  it('지급이 더 길면 지급 조각 — 행사 종료 뒤 삭제 안내를 내지 않는다', () => {
    const g = grantField('2026-12-01T00:00:00Z');
    expect(composeLimitedPlanFields(promo, g)).toEqual({ personalPromo: null, planGrant: g });
  });
  it('한쪽만 있으면 그대로', () => {
    expect(composeLimitedPlanFields(promo, null)).toEqual({ personalPromo: promo, planGrant: null });
    expect(composeLimitedPlanFields(null, grantField('2026-12-01T00:00:00Z')).planGrant).not.toBeNull();
  });
});

describe('응답의 등급과 지급 끝은 한 순간이다', () => {
  it('지급이 끝난 순간에 계산하면 plan 도 free 다 — 기한 없는 plus 가 나가지 않는다', async () => {
    await addUser('u11');
    const now = new Date();
    const end = new Date(now.getTime() + 60_000);
    await grant('u11', end, 'key-u11-001', now);
    expect((await loadPlanGrantAnswer(db, 'u11', null, new Date(end.getTime() - 1))).plan).toBe('plus');
    expect(await loadPlanGrantAnswer(db, 'u11', null, end)).toEqual({ plan: 'free', rawPlan: 'free', planGrant: null });
  });
});

describe('끝난 지급의 뒷정리', () => {
  it('회수하면 그 지급만 끝나고, 다른 권한이 없으면 클론 반납 + 지금부터 3일 보관', async () => {
    await addUser('u5');
    const now = new Date();
    const { grant: g } = await grant('u5', new Date(now.getTime() + 30 * DAY), 'key-u5-0001', now);
    await revokePlanGrant(db, ENV, g.id, 'test', now);
    expect(await effectivePlan('u5')).toBe('free');
    const ret = await db.execute(`SELECT delete_after FROM paid_voice_retention WHERE user_id = 'u5'`);
    expect(Date.parse(String(ret.rows[0]!.delete_after))).toBe(now.getTime() + 3 * DAY);
    const vp = await db.execute(`SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp-u5'`);
    expect(vp.rows[0]!.elevenlabs_voice_id).toBeNull();
    // 다시 돌려도 한 번뿐이다.
    expect(await settleEndedPlanGrants(db, ENV, new Date(now.getTime() + DAY))).toEqual([]);
  });

  it('다른 지급이 남아 있으면 아무것도 하지 않는다', async () => {
    await addUser('u6');
    const now = new Date();
    const { grant: a } = await grant('u6', new Date(now.getTime() + 3 * DAY), 'key-u6-0001', now);
    await grant('u6', new Date(now.getTime() + 30 * DAY), 'key-u6-0002', now);
    await revokePlanGrant(db, ENV, a.id, 'test', now);
    expect(await effectivePlan('u6')).toBe('plus');
    const ret = await db.execute(`SELECT 1 FROM paid_voice_retention WHERE user_id = 'u6'`);
    expect(ret.rows).toHaveLength(0);
    const vp = await db.execute(`SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp-u6'`);
    expect(vp.rows[0]!.elevenlabs_voice_id).toBe('el-u6');
  });

  it('탈퇴 대기 계정도 정리한다 — 유예 중 철회해도 클론 반납·보관이 빠지지 않는다', async () => {
    await addUser('u12');
    const now = new Date();
    const { grant: g } = await grant('u12', new Date(now.getTime() + DAY), 'key-u12-001', now);
    await run(`UPDATE users SET deletion_status = 'pending_deletion' WHERE id = 'u12'`);
    await revokePlanGrant(db, ENV, g.id, 'test', now);
    const ret = await db.execute(`SELECT 1 FROM paid_voice_retention WHERE user_id = 'u12'`);
    expect(ret.rows).toHaveLength(1);
    const vp = await db.execute(`SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp-u12'`);
    expect(vp.rows[0]!.elevenlabs_voice_id).toBeNull();
  });

  it('이미 안내한 더 늦은 보관 기한을 앞당기지 않는다', async () => {
    await addUser('u7');
    const now = new Date();
    const later = new Date(now.getTime() + 10 * DAY).toISOString();
    const { grant: g } = await grant('u7', new Date(now.getTime() + DAY), 'key-u7-0001', now);
    await run(`INSERT INTO paid_voice_retention (user_id, delete_after) VALUES ('u7', ?)`, [later]);
    await revokePlanGrant(db, ENV, g.id, 'test', now);
    const ret = await db.execute(`SELECT delete_after FROM paid_voice_retention WHERE user_id = 'u7'`);
    expect(String(ret.rows[0]!.delete_after)).toBe(later);
  });

  it('구독이 끝나도 지급 중이면 클론을 반납하지 않는다', async () => {
    await addUser('u8', 'plus');
    const plan = await db.execute(`SELECT id FROM plans WHERE key = 'personal' LIMIT 1`);
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, status, expires_at) VALUES ('sub-u8', 'u8', ?, 'active', ?)`,
      [String(plan.rows[0]!.id), new Date(Date.now() + DAY).toISOString()],
    );
    await grant('u8', new Date(Date.now() + 30 * DAY), 'key-u8-0001');
    await cancelSubscriptionImmediate(
      db,
      {
        subscriptionId: 'sub-u8',
        userPk: 'u8',
        planType: 'personal',
        entitlementState: 'entitled',
      } as Parameters<typeof cancelSubscriptionImmediate>[1],
      new Date(),
      { deleteVoiceData: false },
    );
    expect(await effectivePlan('u8')).toBe('plus');
    const vp = await db.execute(`SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = 'vp-u8'`);
    expect(vp.rows[0]!.elevenlabs_voice_id).toBe('el-u8');
  });
});

describe('콘솔', () => {
  const SECRET = 'admin-secret-value';
  const AUTH = 'Basic ' + Buffer.from('x:' + SECRET).toString('base64');
  function request(path: string, init: RequestInit = {}) {
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    const headers = new Headers(init.headers);
    headers.set('Authorization', AUTH);
    if (init.method === 'POST') headers.set('Origin', 'http://localhost');
    return a.request(`http://localhost${path}`, { ...init, headers }, { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings']);
  }
  function form(values: Record<string, string>) {
    return { method: 'POST', body: new URLSearchParams(values), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
  }

  it('상세 → 확인 → 지급 → 회수', async () => {
    await addUser('u9');
    const detail = await request('/admin/users/u9');
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain('플러스 지급');

    const preview = await request('/admin/users/u9/grants/preview', form({ length: '1m', reason: 'support', note: '문의 보정' }));
    expect(preview.status).toBe(200);
    const html = await preview.text();
    const key = /name="request_key" value="([^"]+)"/.exec(html)![1]!;
    const endsAt = /name="ends_at" value="([^"]+)"/.exec(html)![1]!;

    const body = { request_key: key, ends_at: endsAt, reason: 'support', note: '문의 보정' };
    const first = await request('/admin/users/u9/grants', form(body));
    expect(first.status).toBe(303);
    expect(first.headers.get('Location')).toContain('done=granted');
    const second = await request('/admin/users/u9/grants', form(body));
    expect(second.headers.get('Location')).toContain('done=again');
    expect(await effectivePlan('u9')).toBe('plus');

    const g = await db.execute(`SELECT id FROM plan_grants WHERE user_id = 'u9'`);
    const noConfirm = await request(`/admin/grants/${g.rows[0]!.id}/revoke`, form({ user: 'u9' }));
    expect(noConfirm.headers.get('Location')).toContain('err=');
    expect(await effectivePlan('u9')).toBe('plus');
    const revoked = await request(`/admin/grants/${g.rows[0]!.id}/revoke`, form({ user: 'u9', confirm: '1' }));
    expect(revoked.headers.get('Location')).toContain('done=revoked');
    expect(await effectivePlan('u9')).toBe('free');
  });

  it('출처가 다른 POST 는 막는다', async () => {
    await addUser('u10');
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    const res = await a.request(
      'http://localhost/admin/users/u10/grants',
      { method: 'POST', headers: { Authorization: AUTH, Origin: 'https://evil.example' }, body: new URLSearchParams({}) },
      { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings'],
    );
    expect(res.status).toBe(403);
  });
});
