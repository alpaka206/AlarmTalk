# P77 — family-group 라우트 테스트 26건

## 선택한 항목
BACKLOG P77: family-group.ts 전체 핸들러 테스트 커버리지 작성.

## 접근
family-invite.test.ts 패턴을 따라 mockDB + fakeAuthMiddleware로 4개 핸들러의 모든 분기 커버.

## 테스트 내역 (26건)

### GET /family/groups/current (4건)
- 정상 조회: 그룹 + 멤버 2명 + role/allow_family_alarms 매핑
- 사용자 미발견 → group: null, members: [], role: null
- 멤버십 없음 → group: null, members: [], role: null
- null 필드 매핑 (email/name/picture null, allow_family_alarms null → false)

### POST /family/groups/:groupId/leave (4건)
- 멤버 정상 탈퇴 → success + DELETE 쿼리 확인
- 사용자 미발견 → 404 USER_NOT_FOUND
- 비멤버 → 403 NOT_MEMBER
- 소유자 → 409 OWNER_CANNOT_LEAVE

### POST /family/groups/:groupId/transfer-ownership (11건)
- 정상 양도 → success + 3개 UPDATE 쿼리 확인
- target_user_id 누락 → 400 TARGET_REQUIRED
- target_user_id 공백문자열 → 400 TARGET_REQUIRED
- target_user_id 비문자열(숫자) → 400 TARGET_REQUIRED
- malformed JSON body → 400 TARGET_REQUIRED
- 사용자 미발견 → 404 USER_NOT_FOUND
- 자기 자신 양도 → 400 SELF_TRANSFER
- 그룹 미존재 → 404 GROUP_NOT_FOUND
- 비소유자 → 403 OWNER_ONLY
- 대상 비멤버 → 400 TARGET_NOT_MEMBER
- 공백 포함 target_user_id trim → 정상 양도

### DELETE /family/groups/:groupId/members/:userId (7건)
- 멤버 정상 제거 → success + DELETE 쿼리 확인
- 실행자 미발견 → 404 USER_NOT_FOUND
- 그룹 미존재 → 404 GROUP_NOT_FOUND
- 비소유자 → 403 OWNER_ONLY
- 자기 자신 제거 → 400 SELF_REMOVE
- 대상 비멤버 → 404 TARGET_NOT_MEMBER
- 대상이 owner → 400 CANNOT_REMOVE_OWNER

## 변경 파일 (1개)
1. `packages/backend/test/family-group.test.ts` — 신규 26 tests

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 780/780 통과 (754 → 780, +26)
