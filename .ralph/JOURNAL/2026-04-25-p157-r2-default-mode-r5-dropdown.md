# P157 — R2 알람 기본 모드 수정 + R5 프로필 드롭다운 정리

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. R0-R5 스펙 교차 검증 수행.
2개 스펙 갭 발견: R2 알람 기본 모드와 R5 프로필 드롭다운 중복 항목.

## 작업 내역

### 1. R2 알람 기본 모드 수정 (High Priority)
R2 스펙: "**목소리 없는 알람**이 기본 (알람 소리만)"
기존: `alarm/create.tsx`에서 `mode` 기본값이 `'tts'`였음
수정: `'sound-only'`로 변경. 새 알람 생성 시 음성 없이 알람 소리만 나는 것이 기본.
`alarm/edit.tsx`는 기존 알람 데이터에서 mode를 로드하므로 수정 불필요.

### 2. R5 프로필 드롭다운 중복 제거 (Medium Priority)
R5 스펙에 프로필 드롭다운 항목: 프로필, 플랜, 코드등록, 언어, 다크모드, 로그아웃, 계정삭제.
"내 사람들(people)" 항목은 스펙에 없고, NotificationBell이 이미 `/people`로 이동함.
ProfileDropdown에서 "people" MenuItem 삭제 + i18n `profile.people` 키 제거 (ko/en 모두).

### 3. i18n 정리
`profile.people` 키가 더 이상 참조되지 않으므로 ko.json/en.json에서 삭제.
i18n 검증 테스트 14개 통과 확인.

## 변경 파일 (4개)
1. `apps/mobile/app/alarm/create.tsx` — mode 기본값 'tts' → 'sound-only'
2. `apps/mobile/src/components/ProfileDropdown.tsx` — "people" MenuItem 삭제
3. `apps/mobile/src/i18n/ko.json` — `profile.people` 키 삭제
4. `apps/mobile/src/i18n/en.json` — `profile.people` 키 삭제

## 검증
- Backend typecheck: 0 errors ✅
- Mobile typecheck: 0 errors ✅
- i18n key validation: 14/14 passed ✅

## 다음 루프 참고
- 전체 BACKLOG 미완료 항목이 모두 manual/blocked 상태
- 새 BACKLOG 항목 추가 필요 (section 4 규칙)
- R0-R5 스펙 갭 추가 검증 완료 — 주요 스펙 준수 확인됨
