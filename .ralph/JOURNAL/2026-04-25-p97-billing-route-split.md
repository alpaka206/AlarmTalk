# P97 — billing.ts 라우트 분할

## 선택한 항목
BACKLOG 잔여 항목 모두 blocked/manual. Section 4에 따라 "코드 품질 개선" 선택.
`billing.ts` (378줄)이 STATE.md에서 명시된 마지막 대형 라우트 파일. P94~P96 패턴 적용.

## 접근

### billing.ts 분할 (378줄 → 10줄 aggregator)
- **billing-helpers.ts** (23줄): `PAID_PLAN_TYPES` 상수 + `planTypeToUserPlan` 함수 + `resolveUserPk` 공유 유틸리티
- **billing-query.ts** (90줄): GET /vouchers + GET /subscription — 읽기 전용 엔드포인트 2개
- **billing-mutation.ts** (230줄): POST /checkout + POST /redeem — 결제/등록 쓰기 엔드포인트 2개
- **billing.ts** (10줄): Hono `.route('/')` 마운트 aggregator

### 설계 결정
- `resolveUserPk`를 helpers에 추출: checkout, redeem, vouchers 3곳에서 `users WHERE google_id = ?` 동일 패턴 사용. query에서는 null일 때 빈 배열 반환, mutation에서는 404 반환으로 분기.
- subscription 엔드포인트는 resolveUserPk 대신 직접 JOIN 사용 (쿼리 효율성) — helpers 사용하지 않음.

## 변경 파일 (4개)

### 신규 (3개)
1. `packages/backend/src/routes/billing-helpers.ts` — 공유 상수/유틸 (23줄)
2. `packages/backend/src/routes/billing-query.ts` — 읽기 엔드포인트 (90줄)
3. `packages/backend/src/routes/billing-mutation.ts` — 쓰기 엔드포인트 (230줄)

### 수정 (1개)
4. `packages/backend/src/routes/billing.ts` — 378줄 → 10줄 thin aggregator

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 780/780 통과 (billing 51/51 포함, 기존 테스트 변경 없이 통과)

## 다음 루프 참고
- 모든 대형 라우트 파일 분할 완료 (family 834→13, voice 593→11, alarm 502→11, character 405→11, billing 378→10)
- 남은 라우트 파일은 모두 적정 크기 (300줄 미만)
