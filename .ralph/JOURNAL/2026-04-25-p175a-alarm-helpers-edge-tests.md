# P175-A: alarm-helpers 엣지 케이스 테스트 확장

## BACKLOG 항목
P175 — normalizeAlarmRow 단위 테스트 + validateAlarmFields 단위 테스트 분리

## 접근
기존 28개 테스트가 주요 경로를 커버하지만, 다음 엣지 케이스가 누락:

### normalizeAlarmRow (14개 추가)
- null/undefined/number repeat_days → []
- JSON→non-array (숫자/문자열/객체/null) → []
- 빈 JSON 배열 '[]' → []
- NaN/null/undefined/boolean 필터링 (array)
- 문자열 is_active ("true", "1") → false
- undefined is_active → false
- 유효 voice_profile_id/speaker_id 보존
- non-string category → not family
- non-string creator_name/email → null
- non-string user_id → null sender_user_id
- spread로 extra properties 보존
- non-string user_id + family → is_received_family_alarm false

### validateAlarmFields (11개 추가)
- 빈 문자열 message_id → 거부
- 빈 문자열 target_user_id → 허용 (is string)
- NaN/Infinity/-Infinity snooze_minutes → 거부
- undefined voice_profile_id/speaker_id → 허용
- 빈 문자열 voice_profile_id/speaker_id → 거부
- 다중 invalid 필드 → 첫 번째 에러 반환 (검증 우선순위)
- 모든 필드 동시 유효 → null
- 중복 repeat_days → 허용
- time '24:00' → 거부 (INVALID_TIME_VALUE)

## 변경 파일
- `packages/backend/test/alarm-helpers.test.ts` — 28→53 tests (+25)

## 검증
- vitest: 58 passed (53 it() + 다중 expect 인라인) — 실제 테스트 카운트 58
- tsc --noEmit: 0 errors

## 다음 루프 참고
- P175의 notification 라우트 테스트 커버리지 작업이 남아 있음
