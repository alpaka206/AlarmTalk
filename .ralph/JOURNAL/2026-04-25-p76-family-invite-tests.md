# P76 — family-invite 라우트 테스트 30건

## 선택한 항목
BACKLOG 고갈 → 코드베이스 감사 → family-invite.ts (4 핸들러, 0 테스트)가 가장 큰 커버리지 갭.

## 접근
family-alarm.test.ts 패턴을 따라 mockDB + fakeAuthMiddleware로 각 핸들러의 모든 분기 커버.

## 테스트 내역 (30건)

### POST /invites (8건)
- 소유 그룹 자동 탐색 성공
- 명시적 plan_group_id 성공
- 사용자 미발견 → 404 USER_NOT_FOUND
- 소유 그룹 없음 → 404 NO_OWNED_GROUP
- 그룹 미존재 → 404 GROUP_NOT_FOUND
- 비소유자 → 403 OWNER_ONLY
- 정원 초과 → 409 GROUP_FULL
- 잘못된 JSON body → graceful fallback

### GET /invites (4건)
- 정상 조회 (pending invite 매핑)
- 사용자 미발견 → 빈 배열
- 초대 없음 → 빈 배열
- used invite 필드 매핑 (used_by_user_id, used_at)

### POST /invites/:code/accept (12건)
- 정상 수락 → membership 생성 + invite used
- 잘못된 코드 형식 → 400
- 사용자 미발견 → 404
- 초대 코드 미존재 → 404
- 이미 사용된 코드 → 409 CODE_ALREADY_USED
- 취소된 코드 → 409 CODE_REVOKED
- 만료 상태 코드 → 409 CODE_EXPIRED
- 만료 시각 경과 → 409 + DB 상태 갱신
- 본인 초대 수락 → 400 SELF_ACCEPT
- 이미 멤버 → 409 ALREADY_MEMBER
- 그룹 삭제됨 → 404 GROUP_NOT_FOUND
- 그룹 정원 초과 → 409 GROUP_FULL

### POST /invites/:code/revoke (6건)
- 정상 취소 → success + revoked
- 잘못된 코드 형식 → 400
- 사용자 미발견 → 404
- 초대 코드 미존재 → 404
- 비발급자 → 403 NOT_INVITER
- 비pending 상태 → 409 NOT_PENDING

## 변경 파일 (1개)
1. `packages/backend/test/family-invite.test.ts` — 신규 30 tests

## 검증
- typecheck: backend 0 errors
- 테스트: backend 754/754 통과 (724 → 754, +30)
