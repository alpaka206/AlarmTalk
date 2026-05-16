import { describe, it, expect } from 'vitest';
import {
  DAILY_XP_CAP,
  applyDailyXpCap,
  computeAffectionForEvent,
  computeGrant,
  computeXpForEvent,
  isXpEvent,
} from '../src/lib/xpRules';

describe('computeXpForEvent', () => {
  it('alarm_completed=5, alarm_snoozed=-5, alarm_dismissed=-5', () => {
    expect(computeXpForEvent('alarm_completed')).toBe(5);
    expect(computeXpForEvent('alarm_snoozed')).toBe(-5);
    expect(computeXpForEvent('alarm_dismissed')).toBe(-5);
  });

  it('family_alarm_received=10, friend_invited=50', () => {
    expect(computeXpForEvent('family_alarm_received')).toBe(10);
    expect(computeXpForEvent('friend_invited')).toBe(50);
  });
});
describe('computeAffectionForEvent', () => {
  it('alarm_completed=2, family_alarm_received=3, friend_invited=5', () => {
    expect(computeAffectionForEvent('alarm_completed')).toBe(2);
    expect(computeAffectionForEvent('family_alarm_received')).toBe(3);
    expect(computeAffectionForEvent('friend_invited')).toBe(5);
  });

  it('스누즈·강제 종료는 애정도 0', () => {
    expect(computeAffectionForEvent('alarm_snoozed')).toBe(0);
    expect(computeAffectionForEvent('alarm_dismissed')).toBe(0);
  });
});

describe('isXpEvent', () => {
  it('정의된 이벤트 이름이면 true', () => {
    expect(isXpEvent('alarm_completed')).toBe(true);
    expect(isXpEvent('friend_invited')).toBe(true);
  });

  it('오타·타입 오염은 false', () => {
    expect(isXpEvent('alarm_complete')).toBe(false);
    expect(isXpEvent(42)).toBe(false);
    expect(isXpEvent(null)).toBe(false);
    expect(isXpEvent(undefined)).toBe(false);
  });
});

describe('applyDailyXpCap', () => {
  it('여유 내에서는 그대로 지급 + capped=false', () => {
    expect(applyDailyXpCap(30, 0)).toEqual({
      grantedXp: 30,
      capped: false,
      remainingCap: 170,
    });
  });

  it('정확히 캡 도달 → 전부 지급, remainingCap=0, capped=false', () => {
    expect(applyDailyXpCap(50, 150)).toEqual({
      grantedXp: 50,
      capped: false,
      remainingCap: 0,
    });
  });

  it('캡 초과 → 남은 몫만 지급 + capped=true', () => {
    expect(applyDailyXpCap(10, 195)).toEqual({
      grantedXp: 5,
      capped: true,
      remainingCap: 0,
    });
  });

  it('이미 캡 소진 → 0 지급 + capped=true', () => {
    expect(applyDailyXpCap(30, 200)).toEqual({
      grantedXp: 0,
      capped: true,
      remainingCap: 0,
    });
  });

  it('earned=0 → capped=false, grantedXp=0 (캡은 발동 안 함)', () => {
    expect(applyDailyXpCap(0, 100)).toEqual({
      grantedXp: 0,
      capped: false,
      remainingCap: 100,
    });
  });

  it('음수 earned 는 캡과 무관하게 차감 후보로 반환하고 NaN 은 0 처리', () => {
    expect(applyDailyXpCap(-10, 0).grantedXp).toBe(-10);
    expect(applyDailyXpCap(Number.NaN, 0).grantedXp).toBe(0);
  });

  it('음수 alreadyEarnedToday 는 0 으로 처리', () => {
    expect(applyDailyXpCap(30, -50)).toEqual({
      grantedXp: 30,
      capped: false,
      remainingCap: 170,
    });
  });

  it('custom cap 적용 가능', () => {
    expect(applyDailyXpCap(60, 0, 50)).toEqual({
      grantedXp: 50,
      capped: true,
      remainingCap: 0,
    });
  });

  it('DAILY_XP_CAP 상수는 200', () => {
    expect(DAILY_XP_CAP).toBe(200);
  });
});

describe('computeGrant', () => {
  it('여유 내 alarm_completed → xp 5 + 애정도 2', () => {
    const r = computeGrant('alarm_completed', 0);
    expect(r.event).toBe('alarm_completed');
    expect(r.xp.grantedXp).toBe(5);
    expect(r.xp.capped).toBe(false);
    expect(r.affection).toBe(2);
  });

  it('캡에 정확히 도달해도 애정도는 온전히 유지', () => {
    const r = computeGrant('alarm_completed', 195);
    expect(r.xp.grantedXp).toBe(5);
    expect(r.xp.capped).toBe(false);
    expect(r.affection).toBe(2);
  });

  it('강제 종료는 XP -5, 애정도 0', () => {
    const r = computeGrant('alarm_dismissed', 0);
    expect(r.xp.grantedXp).toBe(-5);
    expect(r.affection).toBe(0);
  });

  it('친구 초대 50 XP + 5 애정도', () => {
    const r = computeGrant('friend_invited', 0);
    expect(r.xp.grantedXp).toBe(50);
    expect(r.affection).toBe(5);
  });
});
