# P94 — voice.ts 라우트 분할 + 구조화 로깅 마이그레이션

## 선택한 항목
BACKLOG 잔여 항목 없음 (모두 blocked/manual). Section 4에 따라 "코드 품질 개선" 선택.
`voice.ts` (593줄)이 가장 큰 라우트 파일로 P57(family.ts 분할) 패턴 적용.

## 접근

### 1. voice.ts 분할 (593줄 → 11줄 aggregator)
P57에서 family.ts를 분할한 패턴 동일 적용:
- **voice-upload.ts** (254줄): 업로드, 화자 분리, 화자 목록/수정, 화자 다이어리제이션
  - POST /upload, POST /uploads/:uploadId/separate, GET /uploads/:uploadId/speakers, PATCH /uploads/:uploadId/speakers/:speakerId, POST /diarize
- **voice-profile.ts** (280줄): 프로필 CRUD, 가족 음성 조회, 클론, 통계, 삭제
  - GET /, GET /family, GET /:id, PATCH /:id, POST /clone, GET /:id/stats, DELETE /:id
- **voice.ts** (11줄): 얇은 집합기 (`Hono.route('/')` 마운트)

### 2. console.warn → logStructured 마이그레이션
`index.ts`와 `fcm.ts`에서 info 레벨 로그를 `console.warn`으로 출력하던 것을 개선:
- `logger.ts`에 `logStructured(level, data)` 함수 추가
- `index.ts` scheduled 핸들러: `console.warn(JSON.stringify({level:'info',...}))` → `logStructured('info', {...})`
- `fcm.ts` sendPushNotifications: 동일 패턴 적용
- FCM 테스트: `console.warn` spy → `console.log` spy 변경 (5건)

## 변경 파일 (6개)

### 신규 (2개)
1. `packages/backend/src/routes/voice-upload.ts` — 업로드 + 화자 관련 라우트 (254줄)
2. `packages/backend/src/routes/voice-profile.ts` — 프로필 CRUD 라우트 (280줄)

### 수정 (4개)
3. `packages/backend/src/routes/voice.ts` — 593줄 → 11줄 thin aggregator
4. `packages/backend/src/lib/logger.ts` — `logStructured()` 함수 추가
5. `packages/backend/src/index.ts` — `logStructured` import + scheduled 핸들러 로깅 교체
6. `packages/backend/src/lib/fcm.ts` — `logStructured` import + sendPush 로깅 교체
7. `packages/backend/test/fcm.test.ts` — `console.warn` → `console.log` spy 변경 (5건)

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 780/780 통과 (변경 없음)

## 다음 루프 참고
- 남은 대형 파일: alarm.ts (502줄), character.ts (405줄), billing.ts (378줄) — 같은 패턴으로 분할 가능
- `console.warn/log/error` 직접 호출은 이제 `middleware/logger.ts`와 `lib/logger.ts`에만 존재 (의도적)
