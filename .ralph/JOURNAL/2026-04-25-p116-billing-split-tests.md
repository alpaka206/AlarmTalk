# P116 — billing-mutation + billing-query 통합 테스트

## 선택한 항목
BACKLOG P116: billing-mutation.ts 와 billing-query.ts 분할 모듈에 대한 직접 import 테스트 작성.

## 배경
기존 `billing.test.ts`가 aggregator를 통해 46개 테스트로 전체 엔드포인트를 커버하고 있음.
P116은 분할된 모듈을 직접 import하여 standalone 동작 검증 + aggregator 테스트에서 놓친 edge case 보강.

## 작업 내역

### 1. billing-mutation.test.ts (15 tests)
**POST /billing/checkout (7 tests):**
- plan_key 공백 trim 처리 검증
- max_members null/0 → 기본값 1 적용
- 응답 plan 필드 전체 속성 검증 (toMatchObject)
- personal checkout DB 쿼리 순서 검증 (plan → user → subscription → users.plan → voucher)
- family checkout DB 쿼리 순서 검증 (plan → user → plan_groups → members → subscription → users.plan → voucher)
- voucher code_hash ↔ 평문 SHA-256 일치 검증
- subscription INSERT args 정확성 (user_id, plan_id, 'active')

**POST /billing/redeem (8 tests):**
- redeem 성공 시 DB 쿼리 순서 검증 (user → voucher → plan → subscription → voucher update → users.plan)
- voucher UPDATE 에 status='used' + redeemed_by_user_id + used_at + WHERE status='issued' 검증
- period_days null/0 → 기본값 30일 적용
- 응답 plan 전체 필드 검증
- code 가 숫자 타입 → CODE_REQUIRED
- code 공백만 → CODE_REQUIRED
- expires_at 가 유효하지 않은 날짜 → isFinite 체크로 만료 스킵 + 정상 진행
- voucher lookup은 code_hash로 수행 (해시 값 일치 검증)

### 2. billing-query.test.ts (14 tests)
**GET /billing/vouchers (6 tests):**
- resolveUserPk 로 google_id → user.id 조회 후 issuer 필터링 검증
- JOIN plans 응답 필드 정확성 (plan_key, plan_name, plan_type)
- SQL JOIN + 필터 + ORDER BY 검증
- 사용자 없으면 DB 조회 1회만 (voucher 쿼리 스킵)
- used 상태 voucher 필드 매핑 (redeemed_by_user_id, used_at)
- 여러 voucher 반환 시 순서 유지

**GET /billing/subscription (8 tests):**
- google_id 직접 사용 (resolveUserPk 미사용) 확인
- 활성 구독 없으면 null 반환
- SQL LIMIT 1 + ORDER BY starts_at DESC 검증
- SQL active + 미만료 조건 검증
- personal 구독 plan_group_id null
- family 구독 전체 필드 정확성 (toMatchObject)
- SQL JOIN 구조 검증 (subscriptions → users → plans)
- DB 에러 → 500

## 변경 파일 (2개, 모두 신규)
1. `packages/backend/test/billing-mutation.test.ts`
2. `packages/backend/test/billing-query.test.ts`

## 검증
- 신규 테스트: 29/29 통과
- 전체 테스트: 940/940 통과 (911 → 940, +29)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- BACKLOG에 미완료 항목 없음 (P116 완료 시 모든 항목 완료)
- 남은 unchecked 항목은 manual/blocked (iOS/Android 렌더링 확인, wrangler deploy)
- Section 4 "BACKLOG 고갈 시" 절차에 따라 새 항목 생성 필요
