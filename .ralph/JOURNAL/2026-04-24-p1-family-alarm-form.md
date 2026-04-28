# P1: 가족 알람 폼 분리

## 집은 항목
BACKLOG P1 — 가족 알람 분리

## 접근
People 탭의 "가족 알람 보내기" 버튼이 가리키는 `/family-alarm/create` 라우트를 생성. 기존 family.tsx(삭제됨)의 알람 폼 로직을 재구현.

### 주요 결정
- `familyAlarmForm.ts`의 `validateFamilyAlarmForm`, `filterFamilyAlarmRecipients`, `buildMemberDisplayName` 재사용.
- 시간 입력은 TextInput (HH:mm). 네이티브 타임 피커는 P5 UI 폴리시에서 추가 가능.
- 반복 요일은 일~토 칩 (DAY_LABELS). 선택 없으면 "한 번만 울려요" 힌트.
- Stack 모달로 표시 (`presentation: 'modal'`).

## 변경 파일 목록

### 신규
- `apps/mobile/app/family-alarm/create.tsx` — 가족 알람 생성 폼.

### 수정
- `apps/mobile/app/_layout.tsx` — `family-alarm/create` Stack.Screen 추가.
- `apps/mobile/src/i18n/ko.json` — `familyAlarm.*` 키 12개 추가.
- `apps/mobile/src/i18n/en.json` — `familyAlarm.*` 키 12개 추가.

## 검증 결과
- `npx tsc --noEmit` (mobile) — 통과

## 다음 루프 주의사항
- 시간 입력이 TextInput이므로 형식 유효성만 검증 (`HH:mm` regex). 더 나은 UX를 위해 DateTimePicker 고려 가능 (P5).
- 반복 요일 빈 배열은 "한 번만" 동작. 백엔드에서 `repeat_days` 없으면 일회성 알람으로 처리.
