# P95 — alarm.ts 라우트 분할

## 선택한 항목
BACKLOG 잔여 항목 모두 blocked/manual. Section 4에 따라 "코드 품질 개선" 선택.
`alarm.ts` (502줄)이 가장 큰 잔여 라우트 파일로 P94(voice.ts 분할) 패턴 적용.

## 접근

### alarm.ts 분할 (502줄 → 11줄 aggregator)
P94에서 voice.ts를 분할한 패턴 동일 적용:
- **alarm-helpers.ts** (148줄): 타입 정의(AlarmRow, AlarmMode, VibrationPattern, WakeMode) + normalizeAlarmRow + validateAlarmFields
- **alarm-query.ts** (126줄): GET /tick, GET /, GET /:id — 읽기 전용 엔드포인트
- **alarm-mutation.ts** (241줄): POST /, PATCH /:id, DELETE /:id — 쓰기 엔드포인트
- **alarm.ts** (11줄): Hono.route() 마운트만 하는 thin aggregator

### 설계 결정
- helpers를 별도 파일로 분리한 이유: normalizeAlarmRow와 validateAlarmFields가 query와 mutation 양쪽에서 공유됨
- query/mutation 분리: 읽기/쓰기 관심사 분리로 각 파일 단일 책임

## 변경 파일 (4개)

### 신규 (3개)
1. `packages/backend/src/routes/alarm-helpers.ts` — 타입 + 유틸리티 함수 (148줄)
2. `packages/backend/src/routes/alarm-query.ts` — 읽기 엔드포인트 (126줄)
3. `packages/backend/src/routes/alarm-mutation.ts` — 쓰기 엔드포인트 (241줄)

### 수정 (1개)
4. `packages/backend/src/routes/alarm.ts` — 502줄 → 11줄 thin aggregator

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: alarm.test.ts 41/41 통과 (기존 테스트 변경 없이 통과 — import 경로 동일)

## 다음 루프 참고
- 남은 대형 파일: character.ts (405줄), billing.ts (378줄) — 같은 패턴으로 분할 가능
