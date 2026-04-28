# P140: auth.ts + stats.ts 엣지 케이스 테스트 추가

## 선택 사유
- BACKLOG의 미완료 항목 3개가 모두 blocked 상태 (사용자 개입 필요)
- Section 4 규칙에 따라 "백엔드 테스트 커버리지 확장" 선택
- auth.ts: 12 → 26 tests (가장 critical 라우트이면서 테스트 밀도 낮음)
- stats.ts: 14 → 18 tests

## 변경 내용

### packages/backend/test/auth.test.ts
- `beforeEach`를 `mockDB.reset()`으로 변경 (기존: calls만 초기화 → results 누수 가능)
- **POST /auth/register 엣지 케이스 7개 추가**:
  - 이메일 대소문자 정규화 (KIM@Test.COM → kim@test.com)
  - name 누락 → 400
  - 빈 이메일 → 400
  - DB INSERT 실패 → 500 AUTH_REGISTER_FAILED
  - password 누락 → 400
  - 빈 body → 400
- **POST /auth/login 엣지 케이스 5개 추가**:
  - 이메일 대소문자 정규화 후 로그인
  - 잘못된 JSON → 400 AUTH_INVALID_JSON
  - 빈 body → 400
  - null name/plan 사용자 → 기본값 매핑
  - DB SELECT 실패 → 500 AUTH_LOGIN_FAILED
- **GET /auth/me 엣지 케이스 3개 추가**:
  - Bearer 없이 토큰만 → 401
  - 삭제된 사용자 → 404 AUTH_USER_NOT_FOUND
  - null name/plan → 기본값 매핑 (name='', plan='free')

### packages/backend/test/stats.test.ts
- **GET /stats 엣지 케이스 2개 추가**:
  - 빈 rows 배열 반환 시 0 폴백
  - 큰 숫자 정상 반환 (99999, 100000)
- **GET /stats/activity 엣지 케이스 2개 추가**:
  - 10개 초과 활동 → 10개로 잘림
  - 선물 note 50자 초과 시 잘림
- 기존 DB 에러 테스트에 error_code 필드 검증 추가

## 발견한 이슈
- auth.test.ts의 beforeEach가 `mockDB.calls.length = 0`만 수행하여 results 큐가 테스트 간 누수
  → `mockDB.reset()`으로 수정 (calls + results 모두 초기화)
- Zod `z.string().email()`은 공백 포함 이메일을 거부 → 정규화 테스트에서 공백 제거

## 검증
- auth.test.ts: 26/26 passed
- stats.test.ts: 18/18 passed
- Backend typecheck: 0 errors
- Mobile typecheck: 0 errors
