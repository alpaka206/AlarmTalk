# P68 — API 에러 응답 error_code 일관성 확보

## 선택한 항목
BACKLOG 고갈 → 자가 생성: API 에러 응답에 machine-readable error_code 추가

## 선택 이유
코드베이스 감사 결과, `code.ts` 라우트만 `error_code` 필드를 포함하고 나머지 라우트는 한국어 `error` 텍스트만 반환. 모바일 앱이 `getApiErrorMessage()`로 `error` 텍스트를 직접 표시하므로 한국어 메시지는 유지하되, 모든 에러 응답에 `error_code`를 추가하여:
1. 클라이언트가 error_code 기반 i18n 전환 가능 (향후)
2. 프로그래매틱 에러 핸들링 가능 (ex: CODE_EXPIRED 시 재시도 안내 UI)
3. API 에러 분석/모니터링 용이

## 접근
한국어 `error` 텍스트는 그대로 유지 (모바일 앱이 직접 표시). `error_code` 필드만 추가. code.ts의 기존 패턴과 일관된 네이밍 사용 (SCREAMING_SNAKE_CASE).

### 대안 검토
- error 텍스트를 영어로 전환: 모바일 앱이 raw error 텍스트를 toast로 표시 → 한국어 UI 파손. 거부.
- error_code를 별도 미들웨어로 자동 생성: 에러 메시지 → 코드 매핑이 불가능. 수동 지정이 정확.

## 변경 파일 (6개)
1. `routes/billing.ts` — 13건 error_code 추가 (checkout 5건 + redeem 8건)
2. `routes/character.ts` — 3건 error_code 추가 (USER_NOT_FOUND 2건 + UNSUPPORTED_EVENT 1건)
3. `routes/alarm.ts` — 2건 error_code 추가 (NOT_FRIENDS + FREE_PLAN_LIMIT)
4. `routes/friend.ts` — 5건 error_code 추가 (INVALID_EMAIL, USER_NOT_FOUND, SELF_REQUEST, ALREADY_FRIENDS, ALREADY_PENDING)
5. `routes/gift.ts` — 5건 error_code 추가 (INVALID_EMAIL, NOTE_TOO_LONG, RECIPIENT_NOT_FOUND, SELF_GIFT, NOT_FRIENDS)
6. `routes/code.ts` — 이미 error_code 있음, 변경 없음

## error_code 목록
| Route | error_code | HTTP Status |
|-------|-----------|-------------|
| billing/checkout | PLAN_KEY_REQUIRED | 400 |
| billing/checkout | PLAN_NOT_FOUND | 400 |
| billing/checkout | PLAN_INACTIVE | 400 |
| billing/checkout | FREE_NOT_BILLABLE | 400 |
| billing/checkout | USER_NOT_FOUND | 404 |
| billing/redeem | CODE_REQUIRED | 400 |
| billing/redeem | INVALID_FORMAT | 400 |
| billing/redeem | USER_NOT_FOUND | 404 |
| billing/redeem | CODE_NOT_FOUND | 404 |
| billing/redeem | CODE_ALREADY_USED | 409 |
| billing/redeem | CODE_EXPIRED | 409 |
| billing/redeem | SELF_ISSUED | 400 |
| billing/redeem | PLAN_NOT_FOUND | 404 |
| character/me | USER_NOT_FOUND | 404 |
| character/xp | UNSUPPORTED_EVENT | 400 |
| character/xp | USER_NOT_FOUND | 404 |
| alarm (create) | NOT_FRIENDS | 403 |
| alarm (create) | FREE_PLAN_LIMIT | 403 |
| friend (create) | INVALID_EMAIL | 400 |
| friend (create) | USER_NOT_FOUND | 404 |
| friend (create) | SELF_REQUEST | 400 |
| friend (create) | ALREADY_FRIENDS | 409 |
| friend (create) | ALREADY_PENDING | 409 |

## 검증
- typecheck: backend 0 errors
- 테스트: backend 684/684 통과 (error_code는 additive — 기존 테스트는 error 필드만 검증)
- mobile typecheck: 변경 없음

## 다음 루프 참고
- user.ts, family-*.ts 라우트에도 error_code 미적용 에러가 남아있음 (대부분 English 기술 에러)
- 모바일 getApiErrorMessage() 함수를 error_code 기반 i18n 조회로 업그레이드하면 완전한 다국어 에러 지원 가능
- 이 변경은 backward-compatible (error_code는 새 필드, 기존 error 필드 유지)
