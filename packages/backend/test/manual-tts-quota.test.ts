import { describe, it, expect } from 'vitest';
import { createMockDB } from './helpers';
import {
  MANUAL_TTS_MONTHLY_LIMITS,
  manualTtsLimitForUserPlan,
  manualTtsMonthlyLimit,
  readManualTtsUsage,
  refundManualTtsQuota,
  reserveManualTtsQuota,
  resolveManualTtsPool,
} from '../src/lib/manual-tts-quota';

describe('manualTtsMonthlyLimit', () => {
  it('개인 플랜 한도를 준다', () => {
    expect(manualTtsMonthlyLimit('personal')).toBe(30);
  });

  it('없앤 커플·가족 key 는 0 이다 — 그룹 풀 한도는 없다', () => {
    expect(manualTtsMonthlyLimit('couple')).toBe(0);
    expect(manualTtsMonthlyLimit('family')).toBe(0);
  });

  it('무료/미구독/알 수 없는 key 는 0', () => {
    expect(manualTtsMonthlyLimit('free')).toBe(0);
    expect(manualTtsMonthlyLimit(null)).toBe(0);
    expect(manualTtsMonthlyLimit(undefined)).toBe(0);
    expect(manualTtsMonthlyLimit('plus')).toBe(0);
  });

  it('한도 맵은 개인 하나뿐이다', () => {
    expect(Object.keys(MANUAL_TTS_MONTHLY_LIMITS)).toEqual(['personal']);
  });
});

describe('manualTtsLimitForUserPlan', () => {
  it('users.plan(plus) 을 폴백 한도로 매핑한다', () => {
    expect(manualTtsLimitForUserPlan('plus')).toBe(30); // personal
    // 옛 그룹 등급 'family' 는 유료가 아니다(CHECK 글자만 남았다 — #131 이 그 계정을 다시 매겼다).
    expect(manualTtsLimitForUserPlan('family')).toBe(0);
    expect(manualTtsLimitForUserPlan('free')).toBe(0);
    expect(manualTtsLimitForUserPlan(null)).toBe(0);
    expect(manualTtsLimitForUserPlan(undefined)).toBe(0);
  });
});

describe('resolveManualTtsPool', () => {
  it('개인 활성 구독 plan.key + 본인 PK 를 쓴다 — 조회는 구독 한 번뿐이다', async () => {
    const db = createMockDB();
    db.pushResult([{ plan_key: 'personal' }]); // 개인 활성 구독
    const pool = await resolveManualTtsPool(db.client, ['pk-2', 'sub-2'], 'pk-2', 'plus');
    expect(pool).toEqual({ poolKey: 'pk-2', planKey: 'personal', limit: 30 });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.sql).toMatch(/FROM subscriptions/);
    // 보류(ON_HOLD·PAUSED) 행은 권한이 아니다.
    expect(db.calls[0]!.sql).toMatch(/entitlement_state != 'suspended'/);
    expect(db.calls[0]!.sql).not.toMatch(/plan_group/);
  });

  it('구독이 없으면 users.plan 폴백으로 한도를 준다(결제 사용자 허위 차단 방지)', async () => {
    const db = createMockDB();
    db.pushResult([]); // 개인 구독 없음
    const pool = await resolveManualTtsPool(db.client, ['pk-3', 'sub-3'], 'pk-3', 'plus');
    expect(pool).toEqual({ poolKey: 'pk-3', planKey: 'personal', limit: 30 });
  });

  it('폴백도 무료면 한도 0', async () => {
    const db = createMockDB();
    db.pushResult([]);
    const pool = await resolveManualTtsPool(db.client, ['pk-4', 'sub-4'], 'pk-4', 'free');
    expect(pool).toEqual({ poolKey: 'pk-4', planKey: null, limit: 0 });
  });

  it('기간 한정 개인 플랜에서만 오는 접근은 구독을 보지 않고 개인 30회·본인 풀이다', async () => {
    const db = createMockDB();
    const pool = await resolveManualTtsPool(db.client, ['pk-5', 'sub-5'], 'pk-5', 'plus', {
      promoOnly: true,
    });
    expect(pool).toEqual({ poolKey: 'pk-5', planKey: 'personal', limit: 30 });
    expect(db.calls).toHaveLength(0);
  });
});

describe('reserveManualTtsQuota', () => {
  it('한도 0 이면 DB 를 건드리지 않고 거부', async () => {
    const db = createMockDB();
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 0);
    expect(res).toEqual({ ok: false, used: 0, limit: 0, remaining: 0, month: null });
    expect(db.calls).toHaveLength(0);
  });

  it('여유가 있으면 원자 증가 후 used/remaining/month 를 준다', async () => {
    const db = createMockDB();
    db.pushResult([{ used_count: 7, usage_month: '2026-07' }]);
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 30);
    expect(res).toEqual({ ok: true, used: 7, limit: 30, remaining: 23, month: '2026-07' });
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/INSERT INTO manual_tts_usage/);
    expect(call.sql).toMatch(/ON CONFLICT\(pool_key, usage_month\)/);
    expect(call.sql).toMatch(/WHERE manual_tts_usage\.used_count < \?/);
    expect(call.sql).toMatch(/RETURNING used_count, usage_month/);
    expect(call.args).toEqual(['pk-1', 30]);
  });

  it('한도 도달(RETURNING 빈 결과)이면 거부하고 remaining 0, month null', async () => {
    const db = createMockDB();
    db.pushResult([]); // WHERE 불성립 → 변경 없음
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 30);
    expect(res).toEqual({ ok: false, used: 30, limit: 30, remaining: 0, month: null });
  });

  it('정확히 한도-1 에서 마지막 1회를 허용(used=limit)', async () => {
    const db = createMockDB();
    db.pushResult([{ used_count: 30, usage_month: '2026-07' }]);
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 30);
    expect(res).toEqual({ ok: true, used: 30, limit: 30, remaining: 0, month: '2026-07' });
  });
});

describe('readManualTtsUsage', () => {
  it('행이 있으면 used_count 를, 없으면 0 을 준다', async () => {
    const db = createMockDB();
    db.pushResult([{ used_count: 12 }]);
    expect(await readManualTtsUsage(db.client, 'pk-1')).toBe(12);
    db.pushResult([]);
    expect(await readManualTtsUsage(db.client, 'pk-1')).toBe(0);
    expect(db.calls.every((c) => /SELECT used_count FROM manual_tts_usage/.test(c.sql))).toBe(true);
  });
});

describe('refundManualTtsQuota', () => {
  it('예약이 증가시킨 바로 그 월로 카운터를 1 되돌린다(월 경계 안전)', async () => {
    const db = createMockDB();
    db.pushResult([], 1);
    await refundManualTtsQuota(db.client, 'pk-9', '2026-07');
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/UPDATE manual_tts_usage/);
    expect(call.sql).toMatch(/used_count = used_count - 1/);
    expect(call.sql).toMatch(/used_count > 0/);
    // KST 재계산이 아니라 예약 월을 인자로 받는다.
    expect(call.sql).toMatch(/usage_month = \?/);
    expect(call.args).toEqual(['pk-9', '2026-07']);
  });
});
