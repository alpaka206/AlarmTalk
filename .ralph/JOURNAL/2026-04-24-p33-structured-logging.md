# P33: 백엔드 console.error → 구조화 로깅 전환

**날짜**: 2026-04-24
**BACKLOG 항목**: 자가 생성 풀 — 백엔드 console.error → 구조화 로깅 전환 (Sentry 연동 강화)

## 접근

기존 상태: 7개 라우트 파일 + index.ts에 22개의 `console.error()` 호출이 산재. 각각 `console.error(\`POST /friend failed: ${err.message}\`)` 형태의 비구조화 문자열 로그를 출력. 문제:

1. Cloudflare Workers 로그에서 JSON 파싱 불가 — 필터링/검색 비효율
2. 요청 메타데이터(userId, method, path) 누락 — 디버깅 시 맥락 부족
3. Sentry 캡처가 onError 핸들러에서만 동작 — 라우트 catch 블록의 에러는 Sentry에 미전달
4. 에러 메시지 추출 로직 중복 (`err instanceof Error ? err.message : err`)

해결: `logRouteError(c, err)` 유틸리티 함수를 만들어 모든 라우트의 console.error 호출을 대체.

## 구현

### `src/lib/logger.ts` (신규)
- `logRouteError(c, err)` — 단일 함수
- JSON 출력 형식: `{ level, method, path, uid?, error, stack? }`
- Sentry 자동 캡처: context에서 sentry 클라이언트 추출 → captureException
- `Context<any>` 타입: auth 라우트(`{ Bindings: Env }`)와 인증 라우트(`AppEnv`) 모두 수용

### 라우트 마이그레이션 (8파일, 22건)
| 파일 | 변경 수 |
|------|---------|
| auth.ts | 2건 (detail 변수 + console.error 제거) |
| friend.ts | 5건 |
| gift.ts | 5건 |
| library.ts | 3건 |
| stats.ts | 2건 |
| user.ts | 4건 (GET /user/me는 detail을 응답에 사용하므로 유지) |
| voice.ts | 1건 (detail을 응답에 사용하므로 유지) |
| index.ts | 1건 (onError 핸들러 — 인라인 JSON 제거, requestId 응답 필드도 제거) |

### 변경하지 않은 것
- `middleware/logger.ts` — 이미 JSON 구조화된 요청/응답 로거
- `lib/fcm.ts` — 이미 JSON 구조화된 mock FCM 로거 (info 레벨)
- `index.ts` scheduled — 이미 JSON 구조화된 cron 로거 (info 레벨)

### 테스트 (신규)
- `test/route-logger.test.ts` — 6 tests:
  - Error 인스턴스 → 구조화 JSON 출력 (level, method, path, uid, error, stack)
  - 비-Error 값 → string 변환, stack/uid 생략
  - userId 미설정 시 uid 생략
  - Sentry captureException 호출
  - Sentry 미초기화 시 에러 없음
  - stack 5줄 절단

## 검증

- backend `npx tsc --noEmit` — 0 errors
- mobile `npx tsc --noEmit` — 0 errors
- backend tests: 653/653 passed (기존 647 + 신규 6)
- mobile tests: 316/316 (영향 없음)

## 다음 루프

BACKLOG 자가 생성 풀 잔여: `접근성 자동화 테스트 (axe-core)`.
