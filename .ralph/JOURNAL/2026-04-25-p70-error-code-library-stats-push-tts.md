# P70 — error_code 일관성 확보 Batch 3 (library, stats, push, tts)

## 선택한 항목
BACKLOG 고갈 → P69 후속: library.ts, stats.ts, push.ts, tts.ts 라우트에 error_code 추가

## 선택 이유
P69에서 user/notes/family 라우트를 커버. 남은 미적용 라우트 7개 중 작은 파일 4개를 이번 배치로 처리.

## 접근
P68/P69와 동일 패턴: 기존 `error` 텍스트 유지 + `error_code` SCREAMING_SNAKE_CASE 필드 추가. backward-compatible (additive).

## 변경 파일 (4개)
1. `routes/library.ts` — 9건 error_code 추가
   - INVALID_VOICE_PROFILE_ID, INVALID_DATE_FORMAT, FETCH_LIBRARY_FAILED, INVALID_LIBRARY_ITEM_ID(×2), LIBRARY_ITEM_NOT_FOUND(×2), TOGGLE_FAVORITE_FAILED, DELETE_LIBRARY_ITEM_FAILED
2. `routes/stats.ts` — 2건 error_code 추가
   - FETCH_STATS_FAILED, FETCH_ACTIVITY_FAILED
3. `routes/push.ts` — 5건 error_code 추가
   - JSON_BODY_REQUIRED(×2), INVALID_TOKEN_LENGTH, INVALID_PLATFORM, TOKEN_REQUIRED
4. `routes/tts.ts` — 12건 error_code 추가
   - VOICE_AND_TEXT_REQUIRED, INVALID_VOICE_PROFILE_ID(×2), TEXT_TOO_LONG, INVALID_CATEGORY, DAILY_TTS_LIMIT_EXCEEDED, VOICE_PROFILE_NOT_FOUND, VOICE_PROFILE_NOT_READY, NO_VOICE_ID, TTS_GENERATION_FAILED, INVALID_MESSAGE_ID, MESSAGE_IN_USE, MESSAGE_NOT_FOUND

## 검증
- typecheck: backend 0 errors
- 테스트: backend 684/684 통과 (error_code는 additive — 기존 테스트는 error 필드만 검증)
- mobile: 변경 없음

## 다음 루프 참고
- 남은 미적용 라우트 3개: voice.ts (~30건), dub.ts (~7건), auth.ts (이미 `code` 필드 사용 — `error_code` alias 추가 필요)
- voice.ts가 가장 크고 에러 응답이 많음 (~30건)
