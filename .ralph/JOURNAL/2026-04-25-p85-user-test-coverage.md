# P85 — user.test.ts 테스트 커버리지 강화 + error_code 검증

## 선택한 항목
BACKLOG 고갈 → 테스트 커버리지 감사 수행: user.ts (191줄, 5개 엔드포인트)가 16개 테스트로 error_code 검증 누락, 에러 핸들러 미테스트, toBoolFlag 변환 미테스트 발견.

## 접근

### 문제 분석
1. `beforeEach`에서 `mockDB.calls.length = 0` 사용 — P84에서 발견한 결과 큐 누수 패턴
2. PATCH /user/me, PATCH /user/plan의 기존 테스트가 `error_code` 필드를 검증하지 않음
3. `toBoolFlag()` 함수가 6가지 truthy/falsy 입력을 지원하나 `true`/`false`만 테스트됨
4. GET /user/me, DELETE /user/me, GET /user/search, PATCH /user/plan의 catch 블록(500 에러) 미테스트
5. allow_family_alarms null → false 변환 미테스트

### 구현
1. **beforeEach 수정**: `mockDB.calls.length = 0` → `mockDB.reset()` + `originalExecute` 복원 (DB error 테스트에서 execute 오버라이드 후 복원 보장)
2. **error_code 검증 추가** (기존 3개 테스트 강화):
   - PATCH /user/me: `NO_FIELDS_TO_UPDATE`, `INVALID_BOOLEAN`, `USER_NOT_FOUND`
   - PATCH /user/plan: `INVALID_PLAN`, `USER_NOT_FOUND`
3. **toBoolFlag 변환 테스트 6건**:
   - 문자열 '1' → true, '0' → false, 'true' → true, 'false' → false
   - 숫자 1 → true, 0 → false
4. **에러 핸들링 테스트 3건**:
   - GET /user/me DB 에러 → 500 FETCH_USER_FAILED (+ detail 필드 검증)
   - DELETE /user/me DB 에러 → 500 DELETE_ACCOUNT_FAILED
   - GET /user/search DB 에러 → 500 SEARCH_FAILED
5. **엣지 케이스 테스트 4건**:
   - allow_family_alarms null → false 변환
   - PATCH /user/me 잘못된 JSON → 400 NO_FIELDS_TO_UPDATE
   - PATCH /user/plan 잘못된 JSON → 500 UPDATE_PLAN_FAILED
   - PATCH /user/plan family 플랜 성공
   - GET /user/search 쿼리 파라미터 없음 → 빈 배열

## 변경 파일 (1개)
1. `packages/backend/test/user.test.ts` — beforeEach 수정, error_code 검증 강화, 14 tests 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 820/820 (806 → 820, +14), mobile 662/662
