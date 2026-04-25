# P143 — library.ts 라우트 테스트 확장

## 선택한 항목
BACKLOG 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
Explore 에이전트로 미테스트 라우트 탐색 → library.ts가 유일한 미완전 테스트 파일 (125행, 기존 10 tests).

## 작업 내역

### library.test.ts 확장 (10→34 tests, +24)

**GET /library 엣지 케이스 (11개 추가)**
- voice 필터 잘못된 UUID → 400 INVALID_VOICE_PROFILE_ID
- date 필터 잘못된 형식 (DD-MM-YYYY, 문자열) → 400 INVALID_DATE_FORMAT
- limit=0 → falsy로 기본값 20 적용
- limit=-1 → Math.max(…,1)=1 클램프
- offset 음수 → 0 클램프
- limit NaN 문자열 → 기본값 20
- countRes.rows 비어있을 때 → total=0
- 알 수 없는 필터 키워드 → 무시 (전체 목록 반환)
- DB 에러 → 500 FETCH_LIBRARY_FAILED
- date 필터 SQL 검증 (date() 함수 + args)
- voice 필터 SQL 검증 (voice_profile_id + args)

**PATCH /library/:id/favorite 엣지 케이스 (5개 추가)**
- error_code 검증: INVALID_LIBRARY_ITEM_ID
- error_code 검증: LIBRARY_ITEM_NOT_FOUND
- DB 에러 → 500 TOGGLE_FAVORITE_FAILED
- 다른 사용자 항목 접근 시 404 (user_id 검증)
- SELECT SQL에 user_id 조건 포함 확인

**DELETE /library/:id 엣지 케이스 (4개 추가)**
- error_code 검증: INVALID_LIBRARY_ITEM_ID
- error_code 검증: LIBRARY_ITEM_NOT_FOUND
- DB 에러 → 500 DELETE_LIBRARY_ITEM_FAILED
- 삭제 SQL에 user_id 포함 확인

## 수정 사항
- `beforeEach`를 `mockDB.calls.length = 0` → `mockDB.reset()`으로 변경 (results도 초기화)
- `ID` 상수 import 추가 (UUID 하드코딩 → helpers 상수 사용)

## 변경 파일 (1개)
1. `packages/backend/test/library.test.ts` — 10→34 tests (+24)

## 검증
- library.test.ts: 34/34 통과
- 전체 backend: 1172/1172 통과 (1151→1172, +21 순증)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 전체 라우트 모듈 30/30 테스트 완료. 더 이상 미테스트 라우트 없음.
- 추가 커버리지 확장은 모바일 테스트, E2E, 또는 lib/ 유틸리티 모듈로 이동 필요
