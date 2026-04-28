# P71 — error_code 일관성 확보 Final Batch (voice, dub, auth)

## 선택한 항목
STATE.md 잔여 목록: voice.ts (~30건), dub.ts (~7건), auth.ts (error_code alias)

## 선택 이유
P68~P70에서 billing/character/alarm/friend/user/notes/family/library/stats/push/tts 라우트를 커버.
마지막 3개 파일을 처리하여 전체 API error_code 일관성 100% 달성.

## 접근
P68~P70과 동일 패턴: 기존 `error` 텍스트 유지 + `error_code` SCREAMING_SNAKE_CASE 필드 추가. backward-compatible (additive).
auth.ts는 기존 `code` 필드를 사용 중이므로 `error_code` alias를 `jsonError` 헬퍼에 추가.

## 변경 파일 (3개)
1. `routes/voice.ts` — 35건 error_code 추가
   - POST /upload: MULTIPART_BODY_REQUIRED, AUDIO_FILE_REQUIRED, INVALID_AUDIO_MIME_TYPE, AUDIO_FILE_EMPTY, AUDIO_FILE_TOO_LARGE, INVALID_DURATION
   - POST /uploads/:uploadId/separate: INVALID_UPLOAD_ID, VOICE_UPLOAD_NOT_FOUND, FORBIDDEN
   - GET /uploads/:uploadId/speakers: INVALID_UPLOAD_ID, VOICE_UPLOAD_NOT_FOUND, FORBIDDEN
   - PATCH /uploads/:uploadId/speakers/:speakerId: INVALID_ID_FORMAT, JSON_BODY_REQUIRED, INVALID_LABEL_LENGTH, VOICE_UPLOAD_NOT_FOUND, FORBIDDEN, SPEAKER_NOT_FOUND
   - GET /:id: INVALID_VOICE_PROFILE_ID, VOICE_PROFILE_NOT_FOUND
   - PATCH /:id: INVALID_VOICE_PROFILE_ID, JSON_BODY_REQUIRED, INVALID_NAME_LENGTH, VOICE_PROFILE_NOT_FOUND
   - POST /clone: VOICE_LIMIT_REACHED, AUDIO_AND_NAME_REQUIRED, NAME_TOO_LONG, VOICE_CLONING_FAILED
   - POST /diarize: AUDIO_FILE_REQUIRED, DIARIZATION_FAILED
   - GET /:id/stats: INVALID_VOICE_PROFILE_ID, VOICE_PROFILE_NOT_FOUND
   - DELETE /:id: INVALID_VOICE_PROFILE_ID, VOICE_PROFILE_NOT_FOUND, VOICE_PROFILE_IN_USE
2. `routes/dub.ts` — 7건 error_code 추가
   - POST /: MISSING_REQUIRED_FIELDS, SAME_LANGUAGE, INVALID_SOURCE_MESSAGE_ID, DUB_START_FAILED
   - GET /:id: INVALID_DUB_JOB_ID, DUB_JOB_NOT_FOUND, DUB_PROGRESS_CHECK_FAILED
3. `routes/auth.ts` — jsonError 헬퍼에 error_code alias 추가 (기존 `code` 필드와 동일 값)

## 검증
- typecheck: backend 0 errors
- 테스트: backend 684/684 통과 (error_code는 additive — 기존 테스트는 error 필드만 검증)
- mobile: 변경 없음

## 추가 작업: voice.test.ts error_code 검증 28건 추가
기존 error-path 테스트에 `expect(body.error_code).toBe('...')` assertion 추가.
모든 에러 응답이 올바른 error_code를 반환하는지 검증.
테스트: 684/684 통과 (신규 assertion만 추가, 테스트 케이스 수 변동 없음).

## 다음 루프 참고
- **전체 API error_code 일관성 100% 달성** — 모든 라우트 파일에 error_code 적용 완료
- voice.test.ts에 error_code 검증 추가 완료. 다른 테스트 파일(dub, auth 등)에도 동일 패턴 적용 가능.
- 남은 BACKLOG 미완료 항목: iOS/Android 렌더링 확인(수동), wrangler deploy(사용자 실행), Notion 기획서(MCP 필요)
- 모두 자동화 불가 항목이므로 BACKLOG 고갈 프로토콜에 따라 새 항목 탐색 필요
