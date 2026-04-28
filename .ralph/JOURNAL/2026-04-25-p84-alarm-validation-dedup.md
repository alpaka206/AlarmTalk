# P84 — alarm.ts 검증 로직 중복 제거 + error_code 일관성

## 선택한 항목
BACKLOG 고갈 → 코드 품질 감사 수행: alarm.ts에 POST/PATCH 핸들러 간 ~70줄 동일 검증 코드 중복 + error_code 누락 다수 발견.

## 접근

### 문제 분석
1. POST `/alarm` (생성)과 PATCH `/alarm/:id` (수정) 핸들러가 mode, vibration_pattern, wake_mode, voice_profile_id, speaker_id, time, repeat_days, snooze_minutes에 대해 동일한 검증 로직을 각각 별도로 작성.
2. 알람 라우트의 에러 응답 대부분에 `error_code` 필드 누락 — P68~P71에서 다른 라우트에 추가한 error_code 패턴과 불일치.

### 구현
1. `validateAlarmFields()` 함수 추출 — 모든 공통 필드 검증을 단일 함수로 통합
   - message_id UUID, target_user_id 타입, mode/vibration_pattern/wake_mode enum, voice_profile_id/speaker_id UUID (null 허용), time 형식/범위, repeat_days 배열, snooze_minutes 범위, is_active 타입
   - 각 검증 실패 시 `{ error, error_code }` 반환
2. POST 핸들러: 15줄의 개별 검증 → `validateAlarmFields(body)` 1줄 호출로 대체
3. PATCH 핸들러: 18줄의 개별 검증 → `validateAlarmFields(body)` 1줄 호출로 대체 + 검증을 DB 조회 전으로 이동 (fail-fast)
4. 모든 에러 응답에 `error_code` 추가:
   - `REQUIRED_FIELDS_MISSING`, `INVALID_ALARM_MODE`, `INVALID_VIBRATION_PATTERN`, `INVALID_WAKE_MODE`
   - `INVALID_VOICE_PROFILE_ID`, `INVALID_SPEAKER_ID`, `INVALID_TIME_FORMAT`, `INVALID_TIME_VALUE`
   - `INVALID_REPEAT_DAYS`, `INVALID_SNOOZE_MINUTES`, `INVALID_IS_ACTIVE`
   - `INVALID_ALARM_ID`, `ALARM_NOT_FOUND`, `NO_UPDATE_FIELDS`, `INVALID_MESSAGE_ID`, `INVALID_TARGET_USER`
5. 프론트엔드: `apiErrors.ts`에 `ALARM_NOT_FOUND` 매핑 추가 + ko/en i18n 키 추가

### 테스트 업데이트
- `alarm.test.ts` beforeEach: `mockDB.calls.length = 0` → `mockDB.reset()` (결과 큐 누수 방지)
- PATCH time 검증 테스트: 불필요한 mock pushResult 제거 (검증이 DB 조회 전으로 이동)
- `error_code 일관성 검증` describe 블록 신규: 8 tests (REQUIRED_FIELDS_MISSING, INVALID_ALARM_MODE, INVALID_VIBRATION_PATTERN, INVALID_WAKE_MODE, ALARM_NOT_FOUND x2, NO_UPDATE_FIELDS, INVALID_ALARM_ID x2)

### 대안: Zod 스키마 도입
alarm.ts를 다른 라우트(auth.ts)처럼 Zod 스키마 기반 검증으로 전환할 수 있으나, 현재 수동 검증이 정상 동작하고 있고 범위가 커지므로 향후 과제로 남김.

## 변경 파일 (5개)
1. `packages/backend/src/routes/alarm.ts` — validateAlarmFields 추출, POST/PATCH 리팩토링, error_code 추가
2. `packages/backend/test/alarm.test.ts` — reset() 전환, mock 정리, error_code 테스트 8건 추가
3. `apps/mobile/src/lib/apiErrors.ts` — ALARM_NOT_FOUND 매핑 추가
4. `apps/mobile/src/i18n/ko.json` — alarmNotFound 키 추가
5. `apps/mobile/src/i18n/en.json` — alarmNotFound 키 추가

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 806/806 (798 → 806, +8), mobile 662/662
