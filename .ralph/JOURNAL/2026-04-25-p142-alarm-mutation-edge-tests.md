# P142 — alarm-mutation 엣지 케이스 테스트 19개 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
P99 journal에서 권고한 alarm-mutation 라우트 엣지 케이스 테스트 확장.

## 작업 내역

### POST /alarms 신규 테스트 (14개)
- 유효하지 않은 vibration_pattern → 400 INVALID_VIBRATION_PATTERN
- 유효하지 않은 wake_mode → 400 INVALID_WAKE_MODE
- 유효하지 않은 time 형식 (7:30) → 400 INVALID_TIME_FORMAT
- time 값 범위 초과 (25:00) → 400 INVALID_TIME_VALUE
- 유효하지 않은 message_id 형식 (non-UUID) → 400 INVALID_MESSAGE_ID
- repeat_days 범위 밖 (7) → 400 INVALID_REPEAT_DAYS
- snooze_minutes 범위 밖 (0) → 400 INVALID_SNOOZE_MINUTES
- snooze_minutes 범위 밖 (31) → 400 INVALID_SNOOZE_MINUTES
- repeat_days INSERT SQL에 JSON.stringify 반영 확인
- voice_profile_id + speaker_id 지정 시 INSERT 반영 + 응답 포함
- user 미존재 시 plan 체크 건너뛰고 생성 허용
- family 플랜도 알람 개수 제한 없음
- snooze_minutes 커스텀 값 INSERT 반영

### PATCH /alarms/:id 신규 테스트 (5개)
- 유효하지 않은 vibration_pattern → 400
- 유효하지 않은 wake_mode → 400
- snooze_minutes 범위 밖 → 400
- repeat_days 수정 시 JSON.stringify SQL 반영
- speaker_id 수정 반영

## 변경 파일 (1개)
1. `packages/backend/test/alarm-mutation.test.ts` — 25 → 44 테스트

## 검증
- alarm-mutation 테스트: 44/44 통과
- 전체 Backend 테스트: 1151/1151 통과 (1133 → 1151, +18)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- alarm-mutation 라우트 커버리지 충분. 
- 다음 추천: billing-mutation 또는 character-mutation 라우트 엣지 케이스 테스트
- 또는 mobile 테스트 커버리지 확장 (현재 1113개)
