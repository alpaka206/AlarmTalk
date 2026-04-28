# P79 — Sentry captureException 버그 수정

## 선택한 항목
BACKLOG P79: sentryMiddleware try-catch 패턴이 Hono compose에서 동작하지 않는 버그 수정.

## 원인
Hono의 compose.js는 에러를 각 dispatch 수준에서 캐치하여, 호출자 미들웨어의 try-catch로 전파하지 않음. 따라서 sentryMiddleware의 `catch (err) { sentry.captureException(err); throw err; }` 블록은 절대 실행되지 않았음.

## 수정 내용
1. **sentryMiddleware** (sentry.ts): try-catch 제거 → Toucan 인스턴스를 context에 세팅하고 `await next()` 호출만 수행
2. **app.onError** (index.ts): `c.get('sentry')`로 Toucan 인스턴스 조회 → `captureException(err)` 호출 추가
3. **sentry.test.ts**: 테스트 5건으로 확장 (기존 4건 + onError captureException 검증 1건)

## 변경 파일 (3개)
1. `packages/backend/src/middleware/sentry.ts` — try-catch 제거 (27줄 → 21줄)
2. `packages/backend/src/index.ts` — app.onError에 sentry captureException 추가
3. `packages/backend/test/sentry.test.ts` — 5 tests (onError 패턴 검증 포함)

## 검증
- typecheck: backend 0 errors
- 테스트: backend 793/793 통과 (792 → 793, +1)
