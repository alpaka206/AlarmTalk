import { z } from 'zod';

/**
 * 플랜 상수의 **유일 출처**(2026-09-02).
 *
 * ## 왜 여기 있나
 *
 * 그전에는 같은 목록이 **네 벌**로 흩어져 있었다 — 백엔드 `PAID_USER_PLANS`, 안드로이드
 * `resolvePaidVoiceAccess` 안에 두 벌, iOS `PaidVoiceGate.resolve`. 그런데 이 저장소가
 * 「백엔드·클라 공용 계약」이라고 규정한 `@alarmtalk/shared` 에는 플랜 상수가 **하나도**
 * 없었다. 계약을 둘 자리가 비어 있어서 네 벌이 생긴 것이다.
 *
 * 실제로 갈라져 있었다: 안드로이드의 `planType` 목록에만 `individual`·`plus`·`couple` 이
 * 있었는데, DB CHECK 상 `plan_type` 은 `free|personal|family` 뿐이라 **도달할 수 없는
 * 가지**였다. 지금은 과허용 방향이라 사고가 안 났을 뿐, 반대로 한 칸만 어긋나면 돈을 낸
 * 사용자가 잠긴다.
 *
 * ## 축이 셋이고 뜻이 다르다
 *
 * | 컬럼 | 값 | 뜻 |
 * | --- | --- | --- |
 * | `plans.key` | free / personal / **couple** / family | 상품(가격·표시 이름) |
 * | `plans.plan_type` | free / personal / **family** | **행동 분류 — 그룹을 갖는가** |
 * | `users.plan` | free / personal / plus / couple / family | 사용자에게 부여된 등급 |
 *
 * ⚠ **커플은 `key='couple'` 인데 `plan_type='family'` 다** — 정원 2명짜리 그룹이라는 뜻이지
 * 가족 상품이라는 뜻이 아니다. 셋을 섞어 쓰면 그룹 생성·정원 계산이 통째로 어긋난다.
 *
 * ## 네이티브 앱은 이 파일을 못 가져다 쓴다
 *
 * TypeScript 라 Kotlin·Swift 가 import 할 수 없다. 그래서 두 앱에는 **같은 값의 상수를
 * 손으로** 두되, 그 선언 옆에 "shared 가 원본" 이라고 적고 값이 어긋나면 CI 가 잡는다
 * (`scripts/check-plan-constants.py`).
 */

/** 유료로 치는 `users.plan` 값. 판정기의 마지막 단이 이 집합을 본다. */
export const PAID_USER_PLANS = ['personal', 'plus', 'couple', 'family'] as const;
export type PaidUserPlan = (typeof PAID_USER_PLANS)[number];

/** `users.plan` 이 가질 수 있는 값 전부. */
export const USER_PLANS = ['free', ...PAID_USER_PLANS] as const;
export type UserPlan = (typeof USER_PLANS)[number];

/** 유료로 치는 `plans.plan_type`. **DB CHECK 와 같아야 한다**(`migrations.ts`). */
export const PAID_PLAN_TYPES = ['personal', 'family'] as const;
export type PaidPlanType = (typeof PAID_PLAN_TYPES)[number];

/** `plans.plan_type` 이 가질 수 있는 값 전부. DB CHECK 와 짝이다. */
export const PLAN_TYPES = ['free', ...PAID_PLAN_TYPES] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

/** 그룹(공유 이용권)을 갖는 플랜 타입. 커플이 여기 들어간다 — 위 표 참조. */
export const GROUP_PLAN_TYPES = ['family'] as const;

export const UserPlanSchema = z.enum(USER_PLANS);
export const PlanTypeSchema = z.enum(PLAN_TYPES);

/** 이 `users.plan` 이 유료인가. 서버·클라가 같은 답을 내야 하는 유일한 판정. */
export function isPaidUserPlan(plan: string | null | undefined): boolean {
  return plan != null && (PAID_USER_PLANS as readonly string[]).includes(plan.trim().toLowerCase());
}

/** 이 `plans.plan_type` 이 그룹을 갖는가(초대 코드·정원·해체 대상인가). */
export function isGroupPlanType(planType: string | null | undefined): boolean {
  return planType != null && (GROUP_PLAN_TYPES as readonly string[]).includes(planType);
}

/**
 * **기간 한정 개인 플랜** — 원시 `users.plan` 이 `'free'` 인 계정을 기간 동안 개인
 * 플랜으로 **읽는다**(DB 에는 쓰지 않는다). 규칙 전문: `docs/spec/billing-lifecycle.md`
 * 「기간 한정 개인 플랜」.
 *
 * ⚠ **끝 시각은 여기 한 곳에만 둔다.** 앱·CLAUDE.md·다른 문서에 베끼지 않는다 — 앱은 API 가
 * 준 `personal_promo.ends_at` 만 표시한다. 시작은 제품 상수가 아니라 **운영 스위치**(워커
 * 바인딩 `PERSONAL_PROMO_STARTS_AT`)라 여기 없다.
 *
 * - `endsAt` 은 **배타** 비교다 — 그 시각부터 무료다(한국 시간 자정 = 전날 15:00Z, 마이그레이션
 *   #74 와 같은 관례).
 * - `planKey`·`userPlan` 은 개인 플랜의 두 축 이름이다(위 표 — 상품 키 `personal`, 등급 `plus`).
 * - `noticeDays` 는 종료 안내를 띄우기 시작하는 날수다(`notice_from = endsAt − noticeDays`).
 */
export const PERSONAL_PROMO = {
  planKey: 'personal',
  userPlan: 'plus',
  endsAt: '2026-10-31T15:00:00Z',
  noticeDays: 7,
} as const;

/** 프로모가 켜져 있는 구간 `[startsAt, endsAt)`. 서버가 운영 스위치에서 풀어 만든다. */
export interface PersonalPromoWindow {
  startsAt: Date;
  endsAt: Date;
}

/**
 * `now` 가 구간 안인가. 구간이 없거나(꺼짐) 시각이 해석 불가(`NaN`)면 **아니다**(fail-closed).
 * 시작은 포함, 끝은 배타다.
 */
export function isPersonalPromoActive(
  window: PersonalPromoWindow | null | undefined,
  now: Date,
): boolean {
  if (!window) return false;
  const start = window.startsAt.getTime();
  const end = window.endsAt.getTime();
  const at = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(at)) return false;
  return start <= at && at < end;
}

/**
 * 원시 `users.plan` 을 **읽을 때** 프로모를 반영한 값. 원시가 정확히 `'free'` 이고 구간 안이면
 * `'plus'`, 그 밖에는 원시 그대로다 — `null`·빈 값·유료는 손대지 않는다(행이 없는 계정을
 * 개인으로 올리지 않는다).
 *
 * ⚠ 이 값은 **표시와 내 개인 기능 게이트**용이다. `users.plan` 에 쓰는 경로·커플/가족 기능은
 * 원시값을 본다(스펙의 계산값/원시값 표).
 */
export function userPlanWithPromo<P extends string | null | undefined>(
  rawPlan: P,
  window: PersonalPromoWindow | null | undefined,
  now: Date,
): P | typeof PERSONAL_PROMO.userPlan {
  if (rawPlan === 'free' && isPersonalPromoActive(window, now)) return PERSONAL_PROMO.userPlan;
  return rawPlan;
}

/** 종료 안내를 띄우기 시작하는 시각 — `endsAt − noticeDays`일. */
export function personalPromoNoticeFrom(endsAt: Date): Date {
  return new Date(endsAt.getTime() - PERSONAL_PROMO.noticeDays * 24 * 60 * 60 * 1000);
}

/**
 * API 의 `personal_promo` 조각 — 계정 응답의 `user` 와 `GET /billing/subscription` 최상위에
 * 실린다. 원시 plan 이 free 이고 구간 안일 때만 값이 있고, 그 밖에는 `null`(구서버는 필드
 * 자체가 없다 — 그래서 optional·nullable 이다). 시각은 초 단위 UTC ISO 8601(`…T15:00:00Z`).
 *
 * - 값이 있다 = **원시 plan 이 free 다.** 앱은 이걸로 '구독 행이 커플·가족 등급을 올리지 못하는
 *   보류 상태' 를 안다 — 그래서 결제 보류 계정에도 `null` 로 두지 않는다.
 * - `deletes_voices_at_end` = 지금 끝나면 이 계정이 **종료 전환 대상**인가(원시 free **이고**
 *   `status = 'active'` 구독 행이 없다). 결제 보류(ON_HOLD·PAUSED)처럼 행이 남아 있으면 `false`
 *   — 목소리는 삭제 예약되지 않으므로 앱은 종료 안내에서 "등록한 목소리는 3일 보관 후
 *   삭제돼요" 문장을 뺀다. 구버전 앱은 이 키를 모르고 무시한다.
 * - `computed_at` = 서버가 이 답(계산값 `plan` 과 이 조각)을 **계산한 시각** — 서버 시계, 초
 *   단위로 내린 값. 앱은 이걸 낡은 캐시 판정(스펙 D1)의 '받은 시각' 으로 쓴다 — 기기 시계가
 *   서버보다 빠르면 끝 직전에 계산된 답이 끝 뒤에 받은 것으로 찍혀 영영 권위로 남기 때문이다.
 *   이 조각은 구간 안에서만 실리므로 값은 언제나 `ends_at` 보다 이르다. **optional** 이다 —
 *   이 키가 없는 서버·테스트 응답도 읽혀야 한다(없으면 앱은 받은 순간의 기기 시계를 쓴다).
 */
export const PersonalPromoSchema = z.object({
  ends_at: z.iso.datetime(),
  notice_from: z.iso.datetime(),
  deletes_voices_at_end: z.boolean(),
  computed_at: z.iso.datetime().optional(),
});
export type PersonalPromo = z.infer<typeof PersonalPromoSchema>;
export const PersonalPromoFieldSchema = PersonalPromoSchema.nullable().optional();
