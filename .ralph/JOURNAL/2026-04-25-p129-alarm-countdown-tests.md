# P129 — alarmCountdown.ts 단위 테스트

## 선택한 항목
Section 4 규칙 적용: `any` 제거/타입 보강은 불필요 (이미 clean), 새로 추출한 alarmCountdown.ts에 테스트 부재 → 테스트 추가

## 작업 내역

### getNextFireMs (8 tests)
- inactive alarm → null
- 미래 시간 one-time → positive ms
- 과거 시간 one-time → 내일로 (20~25시간 범위)
- 오늘 dow 매칭 + 미래 시간 → 24시간 미만
- 오늘 dow 비매칭 → 다음 매칭일로 스킵
- JSON 문자열 repeat_days 파싱
- 매일 반복 → 24시간 미만
- 주말에 평일 전용 알람 → 월요일로 스킵 (조건부)

### formatCountdown (7 tests)
- 분만 (1시간 미만) → countdownMinutes
- 0분 → countdownMinutes
- 시간+분 (24시간 미만) → countdownHoursMinutes
- 정확히 1시간 → countdownHoursMinutes
- 일+시간 (24시간+) → countdownDaysHours
- 정확히 24시간 → countdownDaysHours
- 여러 날 → 올바른 days/hours

### getNearestFireMs (5 tests)
- 빈 배열 → null
- 모두 비활성 → null
- 여러 알람 중 가장 가까운 것 반환 (타이밍 허용 오차 50ms)
- 비활성 알람 스킵
- 단일 알람 → 해당 fire ms

## 변경 파일 (1개)
1. `apps/mobile/test/alarmCountdown.test.ts` (신규)

## 검증
- 20/20 테스트 통과
- typecheck: mobile 0 errors
