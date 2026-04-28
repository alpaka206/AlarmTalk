# P78 — family-helpers 유틸 + sentry 미들웨어 테스트

## 선택한 항목
BACKLOG 고갈 → lib/middleware 커버리지 감사 → family-helpers.ts (2 함수, 0 직접 테스트) + sentry.ts (미들웨어, 0 테스트)

## 접근
- family-helpers: mockDB 패턴으로 resolveUserPk + assertSameGroup 모든 분기 커버
- sentry: vi.hoisted + class mock + app.fetch(env) 패턴으로 DSN 분기 커버

## 테스트 내역 (12건)

### resolveUserPk (3건)
- 정상 조회 → PK 반환 + SQL/args 검증
- 사용자 미발견 → null
- 숫자 id → 문자열 변환

### assertSameGroup (5건)
- 같은 그룹 → true
- sender 그룹 없음 → false (쿼리 1회만 실행)
- 그룹 미겹침 → false
- 다수 그룹 중 1개 겹침 → true
- recipient 그룹 없음 → false

### sentryMiddleware (4건)
- DSN 미설정 → 정상 통과, captureException 미호출
- DSN 설정 → context에 sentry 인스턴스 세팅
- DSN 미설정 + throw → 500, captureException 미호출
- DSN 설정 + throw → 500 반환

## 발견한 버그
**Sentry captureException 미작동**: Hono의 compose.js가 에러를 dispatch 수준에서 캐치하여, 미들웨어의 try-catch에 전달하지 않음. 따라서 `sentry.captureException(err)` 코드가 실행되지 않아 에러가 Sentry에 보고되지 않음. app.onError 패턴으로 마이그레이션 필요. → BACKLOG P79로 추가.

## 변경 파일 (2개)
1. `packages/backend/test/family-helpers.test.ts` — 신규 8 tests
2. `packages/backend/test/sentry.test.ts` — 신규 4 tests

## 검증
- typecheck: backend 0 errors
- 테스트: backend 792/792 통과 (780 → 792, +12)
