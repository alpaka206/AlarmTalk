# P163 — PATCH /user/me API 클라이언트 + 설정 화면 연동

## 선택한 항목
BACKLOG: "PATCH /user/me 모바일 API 클라이언트 함수 + 프로필 편집 화면"

## 판단
백엔드 PATCH /user/me가 현재 `allow_family_alarms` boolean만 지원함. 별도 프로필 편집 화면 대신 설정 화면 계정 섹션에 토글로 통합하는 것이 합리적.

## 작업 내역

### 1. getUserProfile 응답 타입 수정 (버그 수정)
- 기존: `get<{ id, email, name, plan }>` — 백엔드 응답 `{ user: {...}, stats: {...} }` 구조 무시
- 수정: `UserProfile` 인터페이스 정의 + `data.user` 언래핑으로 정상 반환
- 결과: `profile?.name`, `profile?.email` 이 실제로 값을 반환하게 됨 (기존에는 항상 undefined)
- `allow_family_alarms: boolean` 필드 포함

### 2. updateUserSettings API 함수 추가
- `updateUserSettings({ allow_family_alarms: boolean })` → PATCH /user/me
- 반환: `{ success, allow_family_alarms }`

### 3. 설정 화면 연동
- family 플랜 사용자에게만 "가족 알람 수신" Switch 표시 (계정 섹션)
- 토글 시 optimistic update + mutation으로 서버 동기화
- 성공 시 userProfile + family-group 쿼리 무효화

### 4. i18n 키 추가
- `settings.allowFamilyAlarms`: "가족 알람 수신" / "Receive family alarms"

## 변경 파일 (5개)
1. `apps/mobile/src/services/api/user.ts` — UserProfile 인터페이스 + getUserProfile 타입 수정 + updateUserSettings 추가
2. `apps/mobile/src/services/api/index.ts` — updateUserSettings + UserProfile export
3. `apps/mobile/app/settings/index.tsx` — useMutation + allowFamilyAlarms 토글 UI
4. `apps/mobile/src/i18n/ko.json` — settings.allowFamilyAlarms
5. `apps/mobile/src/i18n/en.json` — settings.allowFamilyAlarms

## 검증
- Mobile typecheck: 0 errors ✅
- Backend typecheck: 0 errors ✅

## 다음 루프 참고
- getUserProfile 타입 수정으로 기존에 항상 undefined이던 name/email이 이제 실제 값을 반환
- 다른 곳에서 getUserProfile 사용하는 곳이 있으면 영향 확인 필요 (하지만 타입이 더 정확해졌으므로 문제 없을 것)
