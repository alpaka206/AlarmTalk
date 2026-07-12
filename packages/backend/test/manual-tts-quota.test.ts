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
  it('유료 플랜별 한도를 준다', () => {
    expect(manualTtsMonthlyLimit('personal')).toBe(30);
    expect(manualTtsMonthlyLimit('couple')).toBe(50);
    expect(manualTtsMonthlyLimit('family')).toBe(100);
  });

  it('무료/미구독/알 수 없는 key 는 0', () => {
    expect(manualTtsMonthlyLimit('free')).toBe(0);
    expect(manualTtsMonthlyLimit(null)).toBe(0);
    expect(manualTtsMonthlyLimit(undefined)).toBe(0);
    expect(manualTtsMonthlyLimit('plus')).toBe(0);
  });

  it('한도 맵은 유료 3종만', () => {
    expect(Object.keys(MANUAL_TTS_MONTHLY_LIMITS).sort()).toEqual([
      'couple',
      'family',
      'personal',
    ]);
  });
});

describe('manualTtsLimitForUserPlan', () => {
  it('users.plan(plus/family) 을 폴백 한도로 매핑한다', () => {
    expect(manualTtsLimitForUserPlan('plus')).toBe(30); // personal
    expect(manualTtsLimitForUserPlan('family')).toBe(100);
    expect(manualTtsLimitForUserPlan('free')).toBe(0);
    expect(manualTtsLimitForUserPlan(null)).toBe(0);
    expect(manualTtsLimitForUserPlan(undefined)).toBe(0);
  });
});

describe('resolveManualTtsPool', () => {
  it('활성 구독이 붙은 그룹(couple/family)이면 plan_group_id 를 풀 키로 공유한다', async () => {
    const db = createMockDB();
    db.pushResult([{ group_id: 'grp-1', plan_key: 'family' }]);
    const pool = await resolveManualTtsPool(db.client, ['pk-1', 'sub-1'], 'pk-1', 'family');
    expect(pool).toEqual({ poolKey: 'grp-1', planKey: 'family', limit: 100 });
    // 그룹이 잡히면 구독/폴백 조회는 하지 않는다(쿼리 1회).
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.sql).toMatch(/plan_group_members/);
    expect(db.calls[0]!.sql).toMatch(/JOIN subscriptions/); // 만료 필터
    expect(db.calls[0]!.sql).toMatch(/ORDER BY pg\.id/); // 결정적 선택
  });

  it('그룹이 없으면 개인 활성 구독 plan.key + 본인 PK 를 쓴다', async () => {
    const db = createMockDB();
    db.pushResult([]); // 활성 그룹 없음
    db.pushResult([{ plan_key: 'personal' }]); // 개인 활성 구독
    const pool = await resolveManualTtsPool(db.client, ['pk-2', 'sub-2'], 'pk-2', 'plus');
    expect(pool).toEqual({ poolKey: 'pk-2', planKey: 'personal', limit: 30 });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]!.sql).toMatch(/FROM subscriptions/);
  });

  it('구독/그룹 모두 없으면 users.plan 폴백으로 한도를 준다(결제 사용자 허위 차단 방지)', async () => {
    const db = createMockDB();
    db.pushResult([]); // 그룹 없음
    db.pushResult([]); // 개인 구독 없음
    const pool = await resolveManualTtsPool(db.client, ['pk-3', 'sub-3'], 'pk-3', 'plus');
    expect(pool).toEqual({ poolKey: 'pk-3', planKey: 'personal', limit: 30 });
  });

  it('폴백도 무료면 한도 0', async () => {
    const db = createMockDB();
    db.pushResult([]);
    db.pushResult([]);
    const pool = await resolveManualTtsPool(db.client, ['pk-4', 'sub-4'], 'pk-4', 'free');
    expect(pool).toEqual({ poolKey: 'pk-4', planKey: null, limit: 0 });
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
    const res = await reserveManualTtsQuota(db.client, 'grp-1', 100);
    expect(res).toEqual({ ok: true, used: 7, limit: 100, remaining: 93, month: '2026-07' });
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/INSERT INTO manual_tts_usage/);
    expect(call.sql).toMatch(/ON CONFLICT\(pool_key, usage_month\)/);
    expect(call.sql).toMatch(/WHERE manual_tts_usage\.used_count < \?/);
    expect(call.sql).toMatch(/RETURNING used_count, usage_month/);
    expect(call.args).toEqual(['grp-1', 100]);
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
    expect(await readManualTtsUsage(db.client, 'grp-1')).toBe(12);
    db.pushResult([]);
    expect(await readManualTtsUsage(db.client, 'grp-1')).toBe(0);
    expect(db.calls.every((c) => /SELECT used_count FROM manual_tts_usage/.test(c.sql))).toBe(true);
  });
});

describe('refundManualTtsQuota', () => {
  it('예약이 증가시킨 바로 그 월로 카운터를 1 되돌린다(월 경계 안전)', async () => {
    const db = createMockDB();
    db.pushResult([], 1);
    await refundManualTtsQuota(db.client, 'grp-9', '2026-07');
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/UPDATE manual_tts_usage/);
    expect(call.sql).toMatch(/used_count = used_count - 1/);
    expect(call.sql).toMatch(/used_count > 0/);
    // KST 재계산이 아니라 예약 월을 인자로 받는다.
    expect(call.sql).toMatch(/usage_month = \?/);
    expect(call.args).toEqual(['grp-9', '2026-07']);
  });
});
