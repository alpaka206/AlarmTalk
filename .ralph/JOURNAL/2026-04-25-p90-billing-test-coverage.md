# P90 — billing.ts API 라우트 테스트 25건 추가

## 선택한 항목
BACKLOG 미완료 항목 모두 blocked(사용자 의존/Notion 접근). 섹션 4 규칙에 따라 "백엔드 테스트 커버리지 확장"에서 가장 커버리지 비율 낮은 billing.ts (378줄, 26테스트, 비율 1:14.5) 선택.

## 접근

### 문제 분석
기존 26개 테스트는 happy path와 기본 에러 분기를 커버하지만 누락 항목:
- error_code 필드 검증 (모든 에러 응답에 error_code 미검증)
- DB 에러 → 500 (4개 엔드포인트 모두)
- POST /checkout: malformed body, 비문자열 plan_key, period_days=0 기본값
- GET /subscription: family plan_group_id non-null 응답
- GET /vouchers: 응답 필드 매핑 정확성, ORDER BY 검증
- POST /redeem: user not found, plan not found (voucher 이후), 기간 검증, malformed body
- 모든 redeem 에러 응답에 error_code 검증

### 추가된 테스트 (26→51, +25)

**POST /billing/checkout (+10)**:
- error_code 5종 (PLAN_KEY_REQUIRED, PLAN_NOT_FOUND, PLAN_INACTIVE, FREE_NOT_BILLABLE, USER_NOT_FOUND)
- malformed JSON body → 400
- 비문자열 plan_key → 400
- period_days=0 → 기본값 30일 적용
- DB 에러 → 500

**GET /billing/subscription (+2)**:
- family 구독 plan_group_id non-null 검증
- DB 에러 → 500

**GET /billing/vouchers (+3)**:
- 응답 필드 매핑 (subscription_id, used_at null)
- SQL ORDER BY issued_at DESC 검증
- DB 에러 → 500

**POST /billing/redeem (+10)**:
- error_code 6종 (CODE_REQUIRED, INVALID_FORMAT, CODE_NOT_FOUND, CODE_ALREADY_USED, CODE_EXPIRED, SELF_ISSUED)
- user not found → 404 + USER_NOT_FOUND
- plan not found → 404 + PLAN_NOT_FOUND
- 기간 검증 (expires_at = starts_at + period_days)
- malformed JSON body → 400
- DB 에러 → 500

## 변경 파일 (1개)
1. `packages/backend/test/billing.test.ts` — 25건 추가 (26→51)

## 검증
- typecheck: backend 0 errors
- 테스트: backend 920/920 (895→920, +25)
