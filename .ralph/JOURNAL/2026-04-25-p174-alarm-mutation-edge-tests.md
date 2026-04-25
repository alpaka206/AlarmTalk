# P174 — alarm-mutation 엣지 케이스 테스트 확장

## 선택한 항목
BACKLOG: `alarm-mutation 통합 테스트 확장 (현재 44개 — 추가 엣지 케이스 탐색)`

## 작업 내역

### POST /alarms — 신규 13개
1. **target_user_id 비문자열 (숫자)** → 400 INVALID_TARGET_USER
2. **voice_profile_id 잘못된 UUID** → 400 INVALID_VOICE_PROFILE_ID
3. **speaker_id 잘못된 UUID** → 400 INVALID_SPEAKER_ID
4. **repeat_days 비배열 (문자열)** → 400 INVALID_REPEAT_DAYS
5. **repeat_days 소수점 값 [1, 2.5]** → 400 INVALID_REPEAT_DAYS
6. **repeat_days 음수 [-1, 3]** → 400 INVALID_REPEAT_DAYS
7. **무료 플랜 count 문자열 "2"** → Number() 변환 후 403 (SQLite 문자열 반환 대응)
8. **time "00:00" 경계값** → 201 허용
9. **time "23:59" 경계값** → 201 허용
10. **time "24:00" 경계값** → 400 INVALID_TIME_VALUE
11. **snooze_minutes 1 (최소)** → 201 허용
12. **snooze_minutes 30 (최대)** → 201 허용

### PATCH /alarms/:id — 신규 7개
1. **voice_profile_id 잘못된 UUID** → 400 INVALID_VOICE_PROFILE_ID
2. **speaker_id 잘못된 UUID** → 400 INVALID_SPEAKER_ID
3. **is_active 비불리언 ("yes")** → 400 INVALID_IS_ACTIVE
4. **time 잘못된 형식 ("8:30")** → 400 INVALID_TIME_FORMAT
5. **message_id 잘못된 UUID** → 400 INVALID_MESSAGE_ID
6. **updated_at SQL 항상 포함** → UPDATE 쿼리에 `datetime('now')` 검증
7. **mode 수정 SQL 반영** → UPDATE 쿼리에 `mode = ?` + args 검증

## 변경 파일 (1개)
1. `packages/backend/test/alarm-mutation.test.ts` — 44→63 tests (+19)

## 검증
- alarm-mutation.test.ts: 63/63 통과
- 전체 backend: 1303/1303 통과 (1284→1303, +19)
- typecheck: backend 0 errors, mobile 0 errors

## 발견사항
- validateAlarmFields는 POST와 PATCH 양쪽에서 공유됨. PATCH에서도 voice_profile_id/speaker_id UUID 검증, is_active 타입 검증 등이 잘 작동하는지 별도 확인 필요했음 (확인 완료).
- repeat_days 검증에서 `Number.isInteger(d)` 사용 → 소수점(2.5)과 비정수 모두 정확히 거부됨.
- time 검증: 정규식 `^\d{2}:\d{2}$` + 범위 체크 이중 검증. "24:00"은 정규식 통과하나 h>23 범위에서 걸림.

## 다음 루프 참고
- BACKLOG 잔여: notification 라우트 테스트, normalizeAlarmRow 단위 테스트, alarm-helpers validateAlarmFields 분리 테스트, 앱 아이콘/스플래시, Sentry DSN
