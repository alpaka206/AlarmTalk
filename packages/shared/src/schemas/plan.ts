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
