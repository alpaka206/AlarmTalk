# P115 — alarm-mutation + alarm-query 통합 테스트

## 선택한 항목
BACKLOG 실질적 미완료 항목 없음 (2건 모두 manual/blocked). Section 4에 따라 "백엔드 테스트 커버리지 확장" 계속 진행.
P99에서 추천한 alarm-mutation, alarm-query 통합 테스트 작성.

## 작업 내역

### alarm-mutation.test.ts (26 tests)
**POST /alarms (생성)**
- 필수 필드 누락 (message_id, time) → 400
- 유효하지 않은 mode → 400 INVALID_ALARM_MODE
- target_user_id 비친구 → 403 NOT_FRIENDS
- target_user_id 자기 자신 → friendship 검증 스킵
- 무료 플랜 2개 제한 초과 → 403 FREE_PLAN_LIMIT
- 무료 플랜 2개 미만 → 허용
- 유료 플랜 제한 없음
- message 미존재 → 404
- 성공 시 201 + alarm 반환
- 기본값 확인 (mode=tts, vibration=default, wake_mode=sound_then_voice)
- 커스텀 mode/vibration/wake_mode
- target_user_id 친구 → 성공
- voice_profile_id/speaker_id null 기본값

**PATCH /alarms/:id (수정)**
- 잘못된 UUID → 400
- 유효하지 않은 mode → 400
- 미존재 알람 → 404
- 빈 body → 400 NO_UPDATE_FIELDS
- 단일 필드 수정 성공
- 여러 필드 동시 수정
- is_active 0/1 변환 검증
- voice_profile_id null 해제

**DELETE /alarms/:id (삭제)**
- 잘못된 UUID → 400
- 미존재 → 404
- 성공 삭제
- userId 바인딩 검증 (타인 알람 삭제 방지)

### alarm-query.test.ts (13 tests)
**GET /alarms/tick**
- 빈 결과
- firing 알람 포함
- SQL에 user_id + target_user_id 필터 검증

**GET /alarms (목록)**
- 빈 목록
- limit/offset 파라미터
- limit 최대값 100 제한
- is_active 필터
- voice_profile_id 필터
- normalizeAlarmRow 적용 확인

**GET /alarms/:id (단건)**
- 잘못된 UUID → 400
- 미존재 → 404
- 정상 조회
- SQL 접근 제어 검증

## 변경 파일 (2개, 모두 신규)
1. `packages/backend/test/alarm-mutation.test.ts`
2. `packages/backend/test/alarm-query.test.ts`

## 검증
- 신규 테스트: 39/39 통과
- 전체 백엔드 테스트: 911/911 (872 → 911, +39)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- alarm 도메인 route 테스트 완료 (helpers + mutation + query)
- 다음 우선순위: billing-mutation.ts (259줄) + billing-query.ts (91줄) — 결제/플랜 비즈니스 로직 밀도 높음
- character-mutation.ts (223줄) + character-query.ts (29줄) 도 후보
