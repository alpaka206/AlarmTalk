# P69 — error_code 일관성 확보 Batch 2 (user, notes, family-*)

## 선택한 항목
BACKLOG 고갈 → P68 후속: user.ts, notes.ts, family-invite/group/alarm.ts 라우트에 error_code 추가

## 선택 이유
P68에서 billing/character/alarm/friend/gift 라우트에 error_code를 추가했으나, P68 저널에서 "user.ts, family-*.ts 라우트에도 error_code 미적용 에러가 남아있음"을 명시. 이번 배치로 user + notes + family 라우트 3개(invite/group/alarm) 전체를 커버.

## 접근
P68과 동일 패턴: 기존 한국어/영어 `error` 텍스트는 유지하고, `error_code` 필드만 SCREAMING_SNAKE_CASE로 추가. backward-compatible (additive).

## 변경 파일 (5개)
1. `routes/user.ts` — 9건 error_code 추가
   - FETCH_USER_FAILED, NO_FIELDS_TO_UPDATE, INVALID_BOOLEAN, USER_NOT_FOUND(×2), INVALID_PLAN, UPDATE_PLAN_FAILED, DELETE_ACCOUNT_FAILED, SEARCH_FAILED
2. `routes/notes.ts` — 10건 error_code 추가
   - USER_NOT_FOUND(×2), RECEIVER_REQUIRED, TEXT_REQUIRED, TEXT_TOO_LONG, SELF_NOTE, RECEIVER_NOT_FOUND, NOT_SAME_GROUP, NOTE_NOT_FOUND, FORBIDDEN
3. `routes/family-invite.ts` — 20건 error_code 추가
   - USER_NOT_FOUND(×3), NO_OWNED_GROUP, GROUP_NOT_FOUND(×2), OWNER_ONLY, GROUP_FULL(×2), INVALID_CODE_FORMAT(×2), INVITE_NOT_FOUND(×2), CODE_ALREADY_USED, CODE_REVOKED, CODE_EXPIRED(×2), SELF_ACCEPT, ALREADY_MEMBER, NOT_INVITER, NOT_PENDING
4. `routes/family-group.ts` — 15건 error_code 추가
   - USER_NOT_FOUND(×3), NOT_MEMBER, OWNER_CANNOT_LEAVE, TARGET_REQUIRED, SELF_TRANSFER, GROUP_NOT_FOUND(×2), OWNER_ONLY(×2), TARGET_NOT_MEMBER(×2), SELF_REMOVE, CANNOT_REMOVE_OWNER
5. `routes/family-alarm.ts` — 24건 error_code 추가
   - RECIPIENT_REQUIRED(×2), INVALID_WAKE_AT(×2), MESSAGE_TEXT_REQUIRED, MESSAGE_TEXT_TOO_LONG, USER_NOT_FOUND(×2), SELF_ALARM(×2), NOT_SAME_GROUP(×2), RECIPIENT_NOT_FOUND(×2), FAMILY_ALARM_DISABLED(×2), VOICE_NOT_OWNED, NO_VOICE_PROFILE(×2), VOICE_UPLOAD_REQUIRED, LABEL_TOO_LONG, INVALID_DUB_LANGUAGE, UPLOAD_NOT_FOUND, NOT_UPLOAD_OWNER

## 검증
- typecheck: backend 0 errors
- 테스트: backend 684/684 통과 (error_code는 additive — 기존 테스트는 error 필드만 검증)
- mobile: 변경 없음

## 다음 루프 참고
- 남은 미적용 라우트: auth.ts (jsonError 헬퍼 사용, `code` 필드 이미 존재하나 `error_code`와 네이밍 불일치), library.ts, stats.ts, voice.ts, tts.ts, push.ts, dub.ts — 약 112건 잔여
- auth.ts는 `code` 필드를 이미 사용하고 있어 `error_code`로 전환 시 기존 테스트 영향 있을 수 있음
