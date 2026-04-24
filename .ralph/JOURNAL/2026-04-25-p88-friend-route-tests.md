# P88 — friend.ts API 라우트 테스트 19건 추가

## 선택한 항목
BACKLOG 고갈 → 테스트 커버리지 감사 수행: friend.ts (5개 엔드포인트, 226줄)가 12개 테스트만 보유 — handler당 1.2 테스트로 전체 라우트 중 최악의 비율.

## 접근

### 문제 분석
기존 12개 테스트는 각 엔드포인트의 happy path와 기본 에러만 커버. 누락된 항목:
- error_code 필드 검증 (6개 에러 응답 모두 미검증)
- GET /list 검색(q 파라미터), 페이지네이션, limit 클램핑
- GET /pending 페이지네이션
- PATCH /:id/accept UUID 유효성 검증, 응답 상세 구조
- DELETE /:id UUID 유효성 검증, SQL 조건 검증
- 빈 목록 케이스
- DB 에러 500 응답 (3개 엔드포인트)

### 추가된 테스트 (12→31, +19)

**POST /friend (6→9, +3)**:
- 빈 이메일 → 400 + INVALID_EMAIL
- 이메일 필드 누락 → 400 + INVALID_EMAIL
- DB 에러 → 500
- 기존 6건에 error_code 검증 추가 + 201 응답 상세 구조 검증

**GET /friend/list (1→7, +6)**:
- 빈 친구 목록 (total=0)
- limit/offset 파라미터 전달 검증
- limit 최대 100 클램핑
- limit 최소 1 클램핑
- 검색 쿼리(q) SQL LIKE 전달 검증
- 빈 검색어 trim → LIKE 미적용
- DB 에러 → 500

**GET /friend/pending (1→4, +3)**:
- 빈 대기 목록
- 페이지네이션 파라미터 검증
- DB 에러 → 500

**PATCH /friend/:id/accept (2→5, +3)**:
- 잘못된 UUID 형식 → 400
- 응답에 requester 상세 정보 (name, email, picture) 포함 검증
- pending 상태 + 현재 사용자 조건 SQL 검증
- DB 에러 → 500

**DELETE /friend/:id (2→5, +3)**:
- 잘못된 UUID 형식 → 400
- user_a/user_b 조건 SQL 검증 (본인 관련 친구만 삭제 가능)
- DB 에러 → 500
- 기존 success 검증 유지

## 변경 파일 (1개)
1. `packages/backend/src/routes/friend.test.ts` — API 라우트 테스트 19건 추가 (12→31)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 876/876 (857→876, +19), mobile 662/662 (변동 없음)
