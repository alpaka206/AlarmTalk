import { describe, it, expect } from 'vitest';
import { createMockDB } from './helpers';
import {
  MANUAL_TTS_MONTHLY_LIMITS,
  manualTtsMonthlyLimit,
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

describe('resolveManualTtsPool', () => {
  it('그룹(couple/family) 소속이면 plan_group_id 를 풀 키로 공유한다', async () => {
    const db = createMockDB();
    db.pushResult([{ group_id: 'grp-1', plan_key: 'family' }]);
    const pool = await resolveManualTtsPool(db.client, ['pk-1', 'sub-1'], 'pk-1');
    expect(pool).toEqual({ poolKey: 'grp-1', planKey: 'family', limit: 100 });
    // 그룹이 잡히면 구독 조회는 하지 않는다(쿼리 1회).
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]!.sql).toMatch(/plan_group_members/);
    expect(db.calls[0]!.args).toEqual(['pk-1', 'sub-1']);
  });

  it('그룹이 없으면 개인 구독 plan.key + 본인 PK 를 쓴다', async () => {
    const db = createMockDB();
    db.pushResult([]); // 그룹 없음
    db.pushResult([{ plan_key: 'personal' }]); // 개인 활성 구독
    const pool = await resolveManualTtsPool(db.client, ['pk-2', 'sub-2'], 'pk-2');
    expect(pool).toEqual({ poolKey: 'pk-2', planKey: 'personal', limit: 30 });
    expect(db.calls).toHaveLength(2);
    expect(db.calls[1]!.sql).toMatch(/FROM subscriptions/);
  });

  it('그룹도 구독도 없으면 한도 0(무료)', async () => {
    const db = createMockDB();
    db.pushResult([]);
    db.pushResult([]);
    const pool = await resolveManualTtsPool(db.client, ['pk-3', 'sub-3'], 'pk-3');
    expect(pool).toEqual({ poolKey: 'pk-3', planKey: null, limit: 0 });
  });
});

describe('reserveManualTtsQuota', () => {
  it('한도 0 이면 DB 를 건드리지 않고 거부', async () => {
    const db = createMockDB();
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 0);
    expect(res).toEqual({ ok: false, used: 0, limit: 0, remaining: 0 });
    expect(db.calls).toHaveLength(0);
  });

  it('여유가 있으면 원자 증가 후 used/remaining 을 준다', async () => {
    const db = createMockDB();
    db.pushResult([{ used_count: 7 }]); // RETURNING used_count
    const res = await reserveManualTtsQuota(db.client, 'grp-1', 100);
    expect(res).toEqual({ ok: true, used: 7, limit: 100, remaining: 93 });
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/INSERT INTO manual_tts_usage/);
    expect(call.sql).toMatch(/ON CONFLICT\(pool_key, usage_month\)/);
    expect(call.sql).toMatch(/WHERE manual_tts_usage\.used_count < \?/);
    expect(call.sql).toMatch(/RETURNING used_count/);
    expect(call.args).toEqual(['grp-1', 100]);
  });

  it('한도 도달(RETURNING 빈 결과)이면 거부하고 remaining 0', async () => {
    const db = createMockDB();
    db.pushResult([]); // WHERE 불성립 → 변경 없음
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 30);
    expect(res).toEqual({ ok: false, used: 30, limit: 30, remaining: 0 });
  });

  it('정확히 한도-1 에서 마지막 1회를 허용(used=limit)', async () => {
    const db = createMockDB();
    db.pushResult([{ used_count: 30 }]);
    const res = await reserveManualTtsQuota(db.client, 'pk-1', 30);
    expect(res).toEqual({ ok: true, used: 30, limit: 30, remaining: 0 });
  });
});

describe('refundManualTtsQuota', () => {
  it('카운터를 1 되돌린다(0 밑으론 안 내려감)', async () => {
    const db = createMockDB();
    db.pushResult([], 1);
    await refundManualTtsQuota(db.client, 'grp-9');
    const call = db.calls[0]!;
    expect(call.sql).toMatch(/UPDATE manual_tts_usage/);
    expect(call.sql).toMatch(/used_count = used_count - 1/);
    expect(call.sql).toMatch(/used_count > 0/);
    expect(call.args).toEqual(['grp-9']);
  });
});
