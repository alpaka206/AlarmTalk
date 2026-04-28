# P145 — Alarms/Home/Settings 스크린 단위 테스트 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "모바일 테스트 커버리지 확장" 선택.
스크린 테스트 커버리지가 18% (5/28)로 가장 큰 갭 → 핵심 스크린 3개의 비즈니스 로직 테스트 작성.

## 작업 내역

### 1. alarmsScreen.test.ts (49 tests)
- `compareAlarms`: active/inactive 정렬, next fire time 정렬, null 폴백, time 문자열 비교
- `formatRepeatDays`: once/daily/weekday/weekend/custom, 비정렬 입력 처리
- `filterAlarms`: 검색 필터 (time/voice_name/message_text), 대소문자 무시, 공백 trim, null 입력
- `resolveDisplayAlarms`: live/cached 폴백
- `isShowingCached`: 오프라인 캐시 표시 조건
- `shouldEnableAlarmsQuery`: auth + network 조건
- `DAY_KEYS`: 7개, Sun~Sat 패턴 검증

### 2. homeScreen.test.ts (55 tests)
- `getTimeGreeting`: 시간대별 인사말 (night/morning/afternoon/evening) 경계값 포함
- `TrendBadge` 로직: diff 계산, label 포맷, 색상 선택, badge 표시 조건
- `findNextAlarm`: 첫 활성 알람 탐색, null/undefined/empty 처리
- `getLatestMessage`: 첫 메시지, null/undefined/empty
- `resolveDisplayData`: 제네릭 live/cached 폴백
- `getAvatarInitial`: 이름/한국어/빈값/?폴백
- `shouldEnableQuery`: auth + network
- LibraryItem slice (최대 3개), quick action routes (6개), play/pause 토글

### 3. settingsScreen.test.ts (33 tests)
- `formatBytes`: B/KB/MB 단위 변환, 경계값 (0, 1023, 1024, 1MB, 1GB)
- `getPlanLabel`: free/plus/family/unknown 플랜 라벨
- `shouldShowDeleteDialog`: 삭제 확인 텍스트 매칭, 대소문자 구분
- `isValidSnoozeMinutes`: 범위 1~30, 정수 검증
- 버전 폴백 (undefined → '1.0.0')

## 변경 파일 (3개, 모두 신규)
1. `apps/mobile/test/alarmsScreen.test.ts` — 49 tests
2. `apps/mobile/test/homeScreen.test.ts` — 55 tests
3. `apps/mobile/test/settingsScreen.test.ts` — 33 tests

## 검증
- 신규 테스트: 137/137 통과
- 전체 Mobile 테스트: 1250/1250 통과 (1113 → 1250, +137)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 스크린 테스트 커버리지: 5/28 → 8/28 (29%)
- 나머지 미테스트 스크린 후보 (비즈니스 로직 밀도 높은 순):
  - character/index.tsx (캐릭터 스테이지/스트릭/능력치)
  - people/index.tsx (세그먼트 컨트롤, 플랜별 분기)
  - code-register/index.tsx (코드 유효성 검증)
  - voice/* (녹음/업로드/화자분리/선택)
