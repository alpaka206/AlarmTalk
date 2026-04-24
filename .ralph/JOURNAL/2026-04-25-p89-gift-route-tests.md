# P89 — gift.ts API 라우트 테스트 19건 추가

## 선택한 항목
BACKLOG 순서대로 진행: gift.ts (5개 엔드포인트, 259줄)가 14개 테스트만 보유 — handler당 1.4 테스트로 두 번째로 나쁜 비율.

## 접근

### 문제 분석
기존 14개 테스트는 기본 happy/error path만 커버. 누락 항목:
- error_code 필드 검증 (5개 에러 응답 미검증)
- GET /received, GET /sent: 페이지네이션/검색/빈 목록 미검증
- PATCH accept/reject: UUID 유효성, 응답 구조, message_library 삽입 검증 미검증
- 경계값: note 200자 정확히, 빈 이메일, note 미전달 시 null 저장
- DB 에러 500 응답 (5개 엔드포인트 모두)

### 추가된 테스트 (14→33, +19)

**POST /gift (8→13, +5)**:
- 빈 이메일 → 400 + INVALID_EMAIL
- 잘못된 message_id UUID → 400
- note 200자 정확히 → 201 성공
- note 미전달 시 null 저장 검증
- DB 에러 → 500
- 기존 에러 응답에 error_code 검증 추가 (INVALID_EMAIL, NOTE_TOO_LONG, RECIPIENT_NOT_FOUND, SELF_GIFT, NOT_FRIENDS)

**GET /gift/received (1→6, +5)**:
- 응답 pagination metadata (total, limit, offset)
- 빈 목록
- limit/offset 전달 검증
- limit 최대 100 클램핑
- 검색 쿼리 SQL LIKE 전달
- DB 에러 → 500

**GET /gift/sent (1→4, +3)**:
- pagination metadata
- 빈 목록
- 검색 쿼리 3필드 LIKE (name, email, text)
- DB 에러 → 500

**PATCH /gift/:id/accept (2→5, +3)**:
- 잘못된 UUID → 400
- 응답 상세 구조 (status, message_id)
- message_library 삽입 SQL 검증 (user_id, message_id)
- DB 에러 → 500

**PATCH /gift/:id/reject (2→5, +3)**:
- 잘못된 UUID → 400
- 응답 상세 (status='rejected')
- pending + recipient_id SQL 조건 검증
- DB 에러 → 500

## 변경 파일 (1개)
1. `packages/backend/src/routes/gift.test.ts` — API 라우트 테스트 19건 추가 (14→33)

## 검증
- typecheck: backend 0 errors
- 테스트: backend 895/895 (876→895, +19)
