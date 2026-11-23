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
 * 실제로 갈라져 있었다: 안드로이드의 `planType` 목록에만 DB CHECK 에 없는 값이 있어 **도달할
 * 수 없는 가지**였다. 과허용 방향이라 사고가 안 났을 뿐, 반대로 한 칸만 어긋나면 돈을 낸
 * 사용자가 잠긴다.
 *
 * ## 축이 셋이고 뜻이 다르다
 *
 * | 컬럼 | 값 | 뜻 |
 * | --- | --- | --- |
 * | `plans.key` | free / personal | 상품(가격·표시 이름) |
 * | `plans.plan_type` | free / personal | 행동 분류 |
 * | `users.plan` | free / personal / plus | 사용자에게 부여된 등급 |
 *
 * 개인 플랜은 상품 키가 `personal` 이고 등급이 `plus` 다 — 셋을 섞어 쓰지 말 것.
 * DB CHECK(`plans.plan_type`·`users.plan`)에는 `family` 가 아직 남아 있다. 커플·가족 이용권을
 * 걷어낼 때 부모 테이블을 다시 만들 수 없어 둔 글자이고, 그 값을 쓰는 코드는 없다.
 *
 * ## 네이티브 앱은 이 파일을 못 가져다 쓴다
 *
 * TypeScript 라 Kotlin·Swift 가 import 할 수 없다. 그래서 두 앱에는 **같은 값의 상수를
 * 손으로** 두되, 그 선언 옆에 "shared 가 원본" 이라고 적고 값이 어긋나면 CI 가 잡는다
 * (`scripts/check-plan-constants.py`).
 */

/** 유료로 치는 `users.plan` 값. 판정기의 마지막 단이 이 집합을 본다. */
export const PAID_USER_PLANS = ['personal', 'plus'] as const;

/**
 * 유료로 치는 `plans.plan_type`. **DB CHECK 가 허용하는 값만** 둔다(`migrations.ts` —
 * `scripts/check-plan-constants.py` 가 대조한다).
 */
export const PAID_PLAN_TYPES = ['personal'] as const;

/**
 * **직접 입력 월 한도**(KST 달력월, 계정 하나의 풀, 이월 없음). 무료는 **기본 목소리만**이고 다 쓰면 광고 보상 한 번씩
 * 더 만든다. 플러스는 기본·등록 목소리 합산이다. 이미 만든 내 음성을 다시 받는 것은 세지 않는다. 규칙 전문:
 * `docs/spec/voice-and-message.md` §8. 앱은 서버가 준 `limit`·`remaining` 만 표시한다(이 숫자를 베끼지 않는다).
 */
export const MANUAL_TTS_MONTHLY_LIMIT = {
  free: 3,
  plus: 30,
} as const;
