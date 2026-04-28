# P5: 알람 목록 정렬 — 가장 이른 시간순

## BACKLOG 항목
- 소규모 기능: 알람 목록 정렬 — 가장 이른 시간순

## 접근
`alarms.tsx`의 `filteredAlarms` useMemo에 정렬 로직 추가:
1. 활성 알람이 비활성보다 먼저 표시
2. 활성 알람끼리는 다음 울릴 시간(getNextFireMs) 기준 오름차순
3. 비활성 알람끼리는 시간 문자열(HH:MM) 기준 정렬
4. `tick` 의존성 추가하여 매분 정렬 순서 갱신

추가로 `formatCountdown` 함수의 하드코딩 한국어("일", "시간", "분")를 i18n으로 전환:
- `countdownDaysHours`, `countdownHoursMinutes`, `countdownMinutes` 키 추가 (ko/en)

## 변경 파일
- `apps/mobile/app/(tabs)/alarms.tsx` — compareAlarms 함수 추가, filteredAlarms에 sort 적용, formatCountdown i18n
- `apps/mobile/src/i18n/ko.json` — countdown 관련 3개 키 추가
- `apps/mobile/src/i18n/en.json` — 동일 3개 키 추가

## 검증
- `npx tsc --noEmit` 통과 (mobile)

## 다음 루프 주의사항
- 다음 항목: "메시지 라이브러리에서 즐겨찾기 상단 고정"
