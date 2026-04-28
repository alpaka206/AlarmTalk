# P161 — Family Management API Client + Dependency Cleanup

## 선택한 항목
BACKLOG 고갈 상태. API 정합성 감사에서 발견한 빠진 API 함수 추가 + 미사용 의존성 제거 + 테스트 수정.

## 작업 내역

### 1. Family Management API 함수 추가 (family.ts)
백엔드에 이미 존재하지만 모바일 API 클라이언트에 없던 3개 엔드포인트 함수 추가:
- `leaveFamilyGroup(groupId)` — POST /family/groups/:groupId/leave
- `transferFamilyOwnership(groupId, targetUserId)` — POST /family/groups/:groupId/transfer-ownership
- `removeFamilyMember(groupId, userId)` — DELETE /family/groups/:groupId/members/:userId

`api/index.ts` barrel export에도 추가.

### 2. expo-crypto 의존성 제거
- `depcheck`으로 미사용 확인, 소스 코드에서 import 없음
- `package.json`에서 제거
- `bundleAudit.test.ts`의 `allowedUnused` 목록에서 제거

### 3. queryCache.test.ts 수정
- P154에서 추가된 `'activity'` 쿼리 키가 `ALL_KNOWN_KEYS`에 누락 → 추가
- 1937 tests 전체 통과

### 4. README 테스트 수 업데이트
- 모바일 테스트 수: 1890 → 1937

## 변경 파일 (5개)
1. `apps/mobile/src/services/api/family.ts` — 3 함수 추가 + del import
2. `apps/mobile/src/services/api/index.ts` — 3 함수 export 추가
3. `apps/mobile/package.json` — expo-crypto 제거
4. `apps/mobile/test/bundleAudit.test.ts` — allowedUnused에서 expo-crypto 제거
5. `apps/mobile/test/queryCache.test.ts` — ALL_KNOWN_KEYS에 'activity' 추가
6. `README.md` — 테스트 수 업데이트

## 검증
- Mobile typecheck: 0 errors ✅
- Backend typecheck: 0 errors ✅
- Mobile tests: 1937 passed, 0 failed ✅

## 다음 루프 참고
- 추가한 3개 API 함수는 아직 UI에서 호출하지 않음 → People 탭에 가족 관리 액션 UI (탈퇴, 양도, 멤버 제거) 추가 필요
- PATCH /user/me (프로필 수정)도 모바일 클라이언트에 미구현 → 프로필 편집 기능 추가 시 필요
- expo-crypto node_modules 폴더는 아직 남아 있으나 npm install 시 자동 정리됨
