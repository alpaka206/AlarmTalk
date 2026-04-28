# P5: 알람 정렬 + 라이브러리 즐겨찾기 고정 + 스택 화면 접근성 Batch 1

## BACKLOG 항목
1. 알람 목록 정렬 — 가장 이른 시간순
2. 메시지 라이브러리에서 즐겨찾기 상단 고정
3. 스택 화면 접근성 추가 (Batch 1: alarm/create, alarm/edit, library/index)

## 접근

### 알람 정렬
- `compareAlarms` 함수 추가: 활성→비활성 순, 활성끼리는 nextFireMs 오름차순, 비활성끼리는 time 문자열순
- `filteredAlarms` useMemo에 `.sort(compareAlarms)` 적용, `tick` 의존성 추가
- `formatCountdown` 하드코딩 한국어 → i18n 3키 (`countdownDaysHours`, `countdownHoursMinutes`, `countdownMinutes`)

### 라이브러리 즐겨찾기 고정
- `displayItems` 계산을 `useMemo`로 감싸고 `is_favorite` 내림차순 → `received_at` 내림차순 정렬 추가
- "all" 모드에서 즐겨찾기가 항상 목록 상단에 고정됨

### 접근성 Batch 1
- `alarm/create.tsx`: ~25개 라벨 추가 (target chips, day chips, quick days, snooze, voice, messages, preset 전체, create button)
- `alarm/edit.tsx`: ~15개 라벨 추가 (day chips, quick days, snooze, voice, messages, save button)
- `library/index.tsx`: ~6개 라벨 추가 (filter chips, category chips, message cards, favorite button)
- i18n 키 추가: `library.addFavorite`, `library.removeFavorite` (ko/en)

## 변경 파일 (7개)
- `apps/mobile/app/(tabs)/alarms.tsx` — 정렬 + formatCountdown i18n
- `apps/mobile/app/alarm/create.tsx` — 접근성 라벨 ~25개
- `apps/mobile/app/alarm/edit.tsx` — 접근성 라벨 ~15개
- `apps/mobile/app/library/index.tsx` — 즐겨찾기 정렬 + 접근성 라벨 ~6개
- `apps/mobile/src/i18n/ko.json` — countdown 3키 + library favorite 2키
- `apps/mobile/src/i18n/en.json` — 동일 5키

## 검증
- `npx tsc --noEmit` 통과 (mobile)

## 다음 루프 주의사항
- 접근성 Batch 2 필요: voice/record, message/create, dub/translate, family-alarm/create, voice/picker 등
