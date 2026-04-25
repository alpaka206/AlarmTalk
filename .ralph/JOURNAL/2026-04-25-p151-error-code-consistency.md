# P151 — API Error Response Consistency + i18n/a11y 보완

## 선택한 항목
BACKLOG 잔여 미완료 항목 모두 blocked/manual. Section 4에 따라 "TypeScript 엄격 모드 강화" + "접근성 강화" 카테고리에서 선택.
코드 감사 실시 → 3가지 개선 영역 발견: error response 일관성, i18n 누락, 접근성 누락.

## 작업 내역

### 1. API Error Response 정규화 (error_code 필드 일관성)
모든 API 에러 응답에 `error_code` 필드를 일관되게 포함하도록 정규화.

**friend.ts** — 9개 에러 응답에 error_code 추가:
- `FRIEND_REQUEST_FAILED`, `FETCH_FRIENDS_FAILED`, `FETCH_PENDING_FAILED`
- `INVALID_ID_FORMAT` (2곳), `PENDING_NOT_FOUND`, `ACCEPT_FAILED`, `FRIENDSHIP_NOT_FOUND`, `DELETE_FAILED`

**gift.ts** — 11개 에러 응답에 error_code 추가:
- `INVALID_MESSAGE_ID`, `MESSAGE_NOT_FOUND`, `SEND_GIFT_FAILED`
- `FETCH_RECEIVED_FAILED`, `FETCH_SENT_FAILED`
- `INVALID_ID_FORMAT` (2곳), `PENDING_GIFT_NOT_FOUND` (2곳)
- `ACCEPT_GIFT_FAILED`, `REJECT_GIFT_FAILED`

**alarm-mutation.ts** — 1개 error_code 추가: `MESSAGE_NOT_FOUND`

**voice-profile.ts** — 비표준 응답 구조 수정: `{ error: 'VOICE_LIMIT_REACHED', message: '...' }` → `{ error: '최대 2개까지...', error_code: 'VOICE_LIMIT_REACHED' }`

**auth.ts** — `jsonError()` 헬퍼에서 중복 `code` 필드 제거 (error_code만 유지)

**middleware/auth.ts** — `code` → `error_code` 정규화 (4곳)

**user.ts** — 내부 에러 메시지 유출 `detail` 필드 제거 (보안 개선)

### 2. i18n 하드코딩 문자열 수정
- `family-alarm/create.tsx`: `placeholder="07:00"` → `placeholder={t('familyAlarm.wakeTimePlaceholder')}`
- `EmailPasswordForm.tsx`: `placeholder="you@example.com"` → `placeholder={t('authForm.emailPlaceholder')}`
- ko.json + en.json에 해당 키 추가
- i18n 검증 테스트 allowedIdentical에 `authForm.emailPlaceholder` 추가

### 3. 접근성 보완
- `ProfileDropdown.tsx`: menu Pressable에 `accessibilityLabel={t('profile.menuLabel')}` 추가
- ko.json + en.json에 `profile.menuLabel` 키 추가

## 변경 파일 (16개)
1. `apps/mobile/src/i18n/ko.json` — i18n 키 3개 추가
2. `apps/mobile/src/i18n/en.json` — i18n 키 3개 추가
3. `apps/mobile/app/family-alarm/create.tsx` — placeholder i18n 전환
4. `apps/mobile/src/components/EmailPasswordForm.tsx` — placeholder i18n 전환
5. `apps/mobile/src/components/ProfileDropdown.tsx` — accessibilityLabel 추가
6. `packages/backend/src/routes/friend.ts` — error_code 9개 추가
7. `packages/backend/src/routes/gift.ts` — error_code 11개 추가
8. `packages/backend/src/routes/alarm-mutation.ts` — error_code 1개 추가
9. `packages/backend/src/routes/voice-profile.ts` — 응답 구조 정규화
10. `packages/backend/src/routes/auth.ts` — 중복 code 필드 제거
11. `packages/backend/src/routes/user.ts` — detail 필드 제거
12. `packages/backend/src/middleware/auth.ts` — code→error_code 정규화
13. `packages/backend/test/auth.test.ts` — body.code→body.error_code (7곳)
14. `packages/backend/test/auth-middleware.test.ts` — body.code→body.error_code (13곳)
15. `packages/backend/test/integration-smoke.test.ts` — body.code→body.error_code (2곳)
16. `packages/backend/test/voice-profile.test.ts` — body.message→body.error (1곳)
17. `packages/backend/test/user.test.ts` — detail 검증 제거 (1곳)
18. `apps/mobile/test/i18nKeys.test.ts` — allowedIdentical 추가

## 검증
- Backend typecheck: 0 errors ✅
- Mobile typecheck: 0 errors ✅
- Backend tests: 1185/1185 passed ✅
- Mobile tests: 1890/1890 passed ✅

## 다음 루프 참고
- 모든 API 에러 응답이 `{ error: string, error_code: string }` 형태로 통일됨
- 프론트에서 error_code 기반 분기가 필요하면 안전하게 사용 가능
- auth 관련 응답에서 `body.code`는 더 이상 존재하지 않음 → `body.error_code` 사용
