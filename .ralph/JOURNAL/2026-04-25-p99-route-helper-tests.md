# P99 — Route Helper 단위 테스트 추가

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 manual/blocked. Section 4에 따라 "백엔드 테스트 커버리지 확장" 선택.
분할된 route helper 모듈 중 테스트 미존재 파일에 대한 단위 테스트 작성.

## 작업 내역

### 1. alarm-helpers.test.ts (37 tests)
- `normalizeAlarmRow`: repeat_days 파싱 (JSON string, array, invalid), is_active 변환, mode/vibration/wake_mode 기본값 및 유효값, family alarm 감지, sender 정보 추출
- `validateAlarmFields`: 11개 필드 각각의 유효/무효 케이스 (UUID, enum, time format, repeat_days 범위, snooze_minutes 범위, boolean 검증)

### 2. character-helpers.test.ts (11 tests)
- `rowToCharacter`: 누락 필드 기본값, 숫자 타입 강제변환
- `buildProgress`: 레벨별 XP 진행률 계산, 상한 캡핑
- `serializeCharacter`: 스트릭 정보, 기본 stats, XP→레벨/스테이지 재계산, achievements 전달
- `todayString`: ISO 날짜 형식

### 3. billing-helpers.test.ts (5 tests)
- `PAID_PLAN_TYPES`: Set 구성원 검증
- `planTypeToUserPlan`: family→family, personal→plus, 기타→free 매핑

### 미테스트 파일 (향후 작업)
- alarm-mutation.ts, alarm-query.ts — HTTP 라우트 통합 테스트 필요
- billing-mutation.ts, billing-query.ts — DB 의존 통합 테스트
- character-mutation.ts, character-query.ts — DB 의존 통합 테스트
- voice-profile.ts, voice-upload.ts — 외부 API + R2 의존

## 변경 파일 (3개, 모두 신규)
1. `packages/backend/test/alarm-helpers.test.ts`
2. `packages/backend/test/character-helpers.test.ts`
3. `packages/backend/test/billing-helpers.test.ts`

## 검증
- 신규 테스트: 56/56 통과
- 전체 테스트: 836/836 통과 (780 → 836, +56)
- typecheck: backend 0 errors, mobile 0 errors

## 다음 루프 참고
- 순수 함수 helper 테스트 완료. 남은 미테스트 route 모듈은 모두 DB/외부 API 의존 → mock DB 기반 통합 테스트로 진행 가능
- alarm-mutation, billing-mutation이 가장 비즈니스 로직 밀도 높음 → 우선 추천
