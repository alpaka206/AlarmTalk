// 기간 한정 개인 플랜 — `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」.
// 경계·값 판정은 이 두 순수 함수가 유일 출처다. 백엔드의 모든 계산값 자리가 이걸 거친다.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  PERSONAL_PROMO,
  PersonalPromoFieldSchema,
  PersonalPromoSchema,
  isPersonalPromoActive,
  personalPromoNoticeFrom,
  userPlanWithPromo,
  type PersonalPromoWindow,
} from '../src/index.js';

const END = new Date(PERSONAL_PROMO.endsAt);
const WINDOW: PersonalPromoWindow = {
  startsAt: new Date('2026-10-01T00:00:00Z'),
  endsAt: END,
};
const justBefore = new Date(END.getTime() - 1);

describe('기간 한정 개인 플랜 — 상수', () => {
  it('끝은 한국 시간 11월 1일 00:00(배타) — 제품 결정', () => {
    // 이 값을 바꾸면 앱 안내·이용권 화면의 날짜가 전부 따라 바뀐다. 의도한 변경인지 확인하라.
    expect(PERSONAL_PROMO.endsAt).toBe('2026-10-31T15:00:00Z');
    expect(PERSONAL_PROMO.planKey).toBe('personal');
    expect(PERSONAL_PROMO.userPlan).toBe('plus');
    expect(PERSONAL_PROMO.noticeDays).toBe(7);
  });
});

describe('isPersonalPromoActive — 경계', () => {
  it('끝 1ms 전(14:59:59.999Z)은 활성, 끝 시각(15:00:00Z)부터는 비활성', () => {
    expect(isPersonalPromoActive(WINDOW, justBefore)).toBe(true);
    expect(isPersonalPromoActive(WINDOW, new Date('2026-10-31T14:59:59Z'))).toBe(true);
    expect(isPersonalPromoActive(WINDOW, END)).toBe(false);
    expect(isPersonalPromoActive(WINDOW, new Date(END.getTime() + 1))).toBe(false);
  });

  it('시작은 포함, 시작 전은 비활성', () => {
    expect(isPersonalPromoActive(WINDOW, WINDOW.startsAt)).toBe(true);
    expect(isPersonalPromoActive(WINDOW, new Date(WINDOW.startsAt.getTime() - 1))).toBe(false);
  });

  it('구간이 없거나(꺼짐) 시각이 해석 불가면 비활성 — fail-closed', () => {
    expect(isPersonalPromoActive(null, justBefore)).toBe(false);
    expect(isPersonalPromoActive(undefined, justBefore)).toBe(false);
    expect(isPersonalPromoActive({ startsAt: new Date('nope'), endsAt: END }, justBefore)).toBe(
      false,
    );
    expect(isPersonalPromoActive(WINDOW, new Date(Number.NaN))).toBe(false);
  });
});

describe('userPlanWithPromo — 값', () => {
  it('원시 free 만 plus 가 되고, 유료·null·빈 값은 그대로다', () => {
    expect(userPlanWithPromo('free', WINDOW, justBefore)).toBe('plus');
    expect(userPlanWithPromo('plus', WINDOW, justBefore)).toBe('plus');
    expect(userPlanWithPromo('family', WINDOW, justBefore)).toBe('family');
    expect(userPlanWithPromo(null, WINDOW, justBefore)).toBeNull();
    expect(userPlanWithPromo(undefined, WINDOW, justBefore)).toBeUndefined();
    expect(userPlanWithPromo('', WINDOW, justBefore)).toBe('');
  });

  it('끝 시각이 되거나 꺼져 있으면 원시 free 는 free 그대로다', () => {
    expect(userPlanWithPromo('free', WINDOW, END)).toBe('free');
    expect(userPlanWithPromo('free', null, justBefore)).toBe('free');
  });
});

describe('personal_promo 조각', () => {
  it('안내 시작은 끝 − 7일', () => {
    expect(personalPromoNoticeFrom(END).toISOString()).toBe('2026-10-24T15:00:00.000Z');
  });

  it('초 단위 UTC 를 받고, 계정 응답에서는 없어도·null 이어도 된다', () => {
    const value = {
      ends_at: '2026-10-31T15:00:00Z',
      notice_from: '2026-10-24T15:00:00Z',
      deletes_voices_at_end: true,
    };
    expect(PersonalPromoSchema.parse(value)).toEqual(value);
    expect(PersonalPromoFieldSchema.parse(null)).toBeNull();
    expect(PersonalPromoFieldSchema.parse(undefined)).toBeUndefined();
    expect(
      PersonalPromoSchema.safeParse({ ends_at: '10월 31일', notice_from: value.notice_from })
        .success,
    ).toBe(false);
    const User = z.object({ plan: z.string(), personal_promo: PersonalPromoFieldSchema });
    expect(User.safeParse({ plan: 'plus' }).success).toBe(true);
    expect(User.safeParse({ plan: 'plus', personal_promo: null }).success).toBe(true);
    expect(User.safeParse({ plan: 'plus', personal_promo: value }).success).toBe(true);
  });

  it('deletes_voices_at_end 는 불리언이고 빠지면 안 된다 — 결제 보류 계정은 false', () => {
    const base = { ends_at: '2026-10-31T15:00:00Z', notice_from: '2026-10-24T15:00:00Z' };
    expect(PersonalPromoSchema.safeParse({ ...base, deletes_voices_at_end: false }).success).toBe(
      true,
    );
    expect(PersonalPromoSchema.safeParse(base).success).toBe(false);
    expect(PersonalPromoSchema.safeParse({ ...base, deletes_voices_at_end: 'yes' }).success).toBe(
      false,
    );
  });
});
