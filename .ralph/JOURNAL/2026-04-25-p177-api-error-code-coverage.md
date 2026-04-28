# P177: API error_code 커버리지 갭 수정 — 25개 누락 에러코드 추가

## BACKLOG 항목
모바일 앱 API 에러 코드 커버리지 확장 (section 4: UX 품질 강화)

## 배경
백엔드에서 반환하는 error_code가 ~150개인데, 모바일 apiErrors.ts의 ERROR_CODE_I18N 맵에는 40개만 등록되어 있었음. 누락된 에러코드가 발생하면 "문제가 발생했어요" 같은 제네릭 메시지만 표시되어 사용자가 원인을 파악할 수 없는 UX 문제.

## 접근
1. 백엔드 전체 라우트에서 `error_code:` 패턴을 추출하여 고유 에러코드 전수 조사
2. 모바일 ERROR_CODE_I18N 맵과 교차 비교하여 누락 코드 식별
3. 사용자에게 노출되어 의미 있는 메시지를 제공할 수 있는 25개 코드 선별
4. i18n 양쪽(ko/en) 번역 추가 + 테스트 추가

## 추가된 에러코드 (25개)
**구독/플랜:** PLAN_NOT_FOUND, PLAN_INACTIVE, FREE_NOT_BILLABLE
**음성/TTS:** VOICE_PROFILE_NOT_READY, NO_VOICE_ID, TTS_GENERATION_FAILED, VOICE_CLONING_FAILED, VOICE_NOT_OWNED, VOICE_UPLOAD_NOT_FOUND, UPLOAD_NOT_FOUND
**가족:** TARGET_NOT_MEMBER, NO_OWNED_GROUP, INVITE_NOT_FOUND, NOT_INVITER
**친구:** INVALID_EMAIL, PENDING_NOT_FOUND, FRIENDSHIP_NOT_FOUND
**선물:** PENDING_GIFT_NOT_FOUND
**보관함:** LIBRARY_ITEM_NOT_FOUND
**검증:** NOTE_TOO_LONG, TEXT_TOO_LONG, MESSAGE_TEXT_TOO_LONG
**더빙:** DUB_START_FAILED, DUB_JOB_NOT_FOUND, SAME_LANGUAGE

## 수정 파일 (4개)
1. `apps/mobile/src/lib/apiErrors.ts` — ERROR_CODE_I18N에 25개 매핑 추가
2. `apps/mobile/src/i18n/ko.json` — apiError.* 키 27개 추가
3. `apps/mobile/src/i18n/en.json` — apiError.* 키 27개 추가
4. `apps/mobile/test/apiErrors.test.ts` — 25개 매핑 테스트 추가 (37→62)

## 검증
- Mobile tsc --noEmit: 0 errors
- Backend tsc --noEmit: 0 errors
- apiErrors.test.ts: 62 passed
- i18nKeys.test.ts: 14 passed (ko/en 키 일관성 검증 통과)

## 설계 판단
- 기술적 검증 에러(INVALID_ALARM_ID, INVALID_TIME_FORMAT 등)는 프론트엔드에서 사전 검증하므로 i18n에 추가하지 않음 — 발생 시 STATUS_I18N 폴백으로 충분
- 서버 내부 실패(FETCH_*_FAILED, SEND_GIFT_FAILED 등)도 제외 — HTTP 500 폴백이 더 적절
- AUTH_* 코드는 이미 401 상태코드 폴백이 있으므로 제외

## 다음 루프 참고
- 나머지 ~70개 기술/내부 에러코드는 의도적으로 제외 (STATUS_I18N 폴백으로 처리)
- 향후 백엔드에 에러코드 enum을 추출하면 자동 검증 가능하지만, 현재 구조에서는 grep 기반 수동 감사가 적절
