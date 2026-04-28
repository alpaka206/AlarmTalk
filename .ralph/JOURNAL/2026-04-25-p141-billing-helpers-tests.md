# P141: billing-helpers.ts 테스트 커버리지 확장 (5→13)

## 선택 사유
- BACKLOG 미완료 항목 3개 모두 사용자 개입 필요 (디바이스 확인, wrangler deploy, Sentry DSN)
- Section 4 규칙에 따라 "백엔드 테스트 커버리지 확장" 선택
- billing-helpers.ts: 전체 라우트 중 최저 테스트 밀도 (5개)
- resolveUserPk 함수가 0% 커버리지 — DB 쿼리 + 컨텍스트 연동이므로 테스트 필수

## 변경 내용

### packages/backend/test/billing-helpers.test.ts
- **PAID_PLAN_TYPES 추가 (1개)**:
  - Set 크기 검증 (정확히 2개)
- **planTypeToUserPlan 엣지 케이스 추가 (2개)**:
  - 대소문자 변형 → free 매핑 (case-sensitive 확인)
  - 공백 패딩 문자열 → free 매핑
- **resolveUserPk 신규 테스트 (5개)**:
  - 사용자 존재 시 PK 반환 + SQL/args 검증
  - 사용자 미존재 시 null 반환
  - 숫자 id → 문자열 변환 확인
  - 컨텍스트 userId가 google_id 쿼리 인자로 전달 확인
  - 복수 행 반환 시 첫 번째 행 사용

### 테스트 구조
- Hono 미니앱 + fakeAuthMiddleware 패턴으로 Context를 실제 환경처럼 제공
- mockDB를 vi.mock으로 주입하여 getDB 격리

## 검증
- billing-helpers.test.ts: 13/13 passed
- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors
