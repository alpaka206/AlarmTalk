# 에러 코드 레퍼런스 (error_code)

백엔드(`packages/backend`)가 4xx/5xx 응답 본문에 담아 내려주는 `error_code` 목록이다.
응답 형태는 `{ "error": "<사람이 읽는 메시지>", "error_code": "<SCREAMING_SNAKE>", ... }` 이고,
클라이언트는 이 `error_code` 를 키로 사용자 안내 문구를 매핑한다.

> **드리프트 확인**: 이 표는 손으로 관리하므로 코드가 유일한 진실이다. 어긋났는지 보려면
> `packages/backend` 에서 아래를 돌려 표와 비교한다.
>
> ```
> grep -rhoE "error_code:\s*'[A-Z0-9_]+'" src | sed -E "s/.*'([A-Z0-9_]+)'/\1/" | sort -u
> ```
>
> `routes/auth.ts` 는 `jsonError('<CODE>', …)` 헬퍼를, `middleware/auth.ts` 의 토큰 검증 실패는
> 삼항 분기를 쓰므로 위 grep 에 안 걸린다. 그 두 파일은 직접 확인한다.

## 원칙: 앱 = 안내 문구 / 관리자 = 코드 + 위치

- **앱(사용자)**: `error_code` 원문을 노출하지 않고 코드별로 매핑한 안내 문구만 보여준다.
  Android 는 `network/ApiErrors.kt` 의 `apiErrorCode()` 로 코드를 뽑아 화면/뷰모델의 `when(code)` 로
  문구를 고르고, 매핑이 없으면 로컬라이즈된 fallback 을 쓴다. `ui/util/PlatformAndLabelUtils.kt` 의
  `userFacingError()` 는 서버 메시지 중 **한글이 포함된 것만** 노출하므로 SCREAMING_SNAKE 가 화면에 새지 않는다.
- **관리자**: `error_code` + '어디서/무엇' 을 서버 로그(구조화 JSON)와 Sentry 로 식별한다.
  `lib/logger.ts` 의 `logRouteError()` 가 `{ method, path, uid, error, stack }` 을 남기고,
  Sentry 캡처 시 `route`·`method`·`uid` 를 태그로 붙인다.

## 규약 (신규 라우트 추가 시 코드리뷰 체크)

1. **모든 에러 응답에 `error_code` 부여.** 클라가 HTTP status 만으로 분기하지 않게 안정적인 문자열 코드를 준다.
2. **표기법은 `SCREAMING_SNAKE_CASE`.**
3. **도메인 접두 권장.** 계정/인증은 `AUTH_`, 결제 검증은 `GOOGLE_`/`PLAY_`, 코드 사용은 `CODE_`,
   가족 알람은 `FAMILY_ALARM_`, 목소리는 `VOICE_`. 전역 공통 코드(`USER_NOT_FOUND`, `FORBIDDEN`,
   `INVALID_REQUEST`)는 접두 없이 둔다.
4. **코드는 안정적 계약.** 클라가 매핑한 코드의 철자를 함부로 바꾸지 않는다(문구는 코드와 분리해 바꾼다).
5. **메시지(`error`)는 로그·관리자용 참고 텍스트.** 사용자 노출 문구는 클라가 코드로 결정한다.
6. HTTP status 는 관례를 따른다: `400` 검증/형식, `401` 인증, `403` 권한/동의/플랜, `404` 미존재,
   `409` 상태충돌, `413` 페이로드 초과, `429` 레이트/쿼터, `5xx` 서버/업스트림(`502` 업스트림, `503` 미구성·용량).

> "HTTP" 칸은 대표 status. 위치는 `packages/backend/src` 기준 상대경로.

---

## 1. 공통

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `USER_NOT_FOUND` | 인증 주체/대상 사용자를 DB 에서 찾을 수 없음 | 404 | `routes/user.ts`, `billing-*.ts`, `code.ts`, `family-*.ts` |
| `FORBIDDEN` | 리소스 접근/소유권 없음(테스트 코드 발급자 아님) | 403 | `routes/billing-mutation.ts` |
| `INVALID_REQUEST` | 요청 바디 파싱/검증 실패(결제 계열) | 400 | `routes/billing-google.ts` |
| `INVALID_JSON` | JSON 본문 파싱 실패 | 400 | `routes/user.ts`, `push.ts` |
| `JSON_BODY_REQUIRED` | JSON 본문 필요 | 400 | `routes/voice-profile.ts` |
| `ADMIN_UNCONFIGURED` | 관리자 콘솔 미구성(`ADMIN_SECRET` 없음) | 503 | `routes/admin.ts` |

## 2. 인증 / 계정

미들웨어(`middleware/auth.ts`, `middleware/consent.ts`) + `routes/auth.ts` + `routes/user.ts`.

### 2-1. 토큰 검증

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `AUTH_MISSING` | Authorization 헤더 없음 | 401 | `middleware/auth.ts`, `routes/auth.ts` |
| `AUTH_INVALID_SCHEME` | Bearer 스킴 아님 | 401 | `middleware/auth.ts` |
| `AUTH_EMPTY_TOKEN` | 토큰 문자열 비어있음 | 401 | `middleware/auth.ts` |
| `AUTH_TOKEN_EXPIRED` | JWT 만료 | 401 | `middleware/auth.ts` |
| `AUTH_AUDIENCE_MISMATCH` | JWT audience 불일치 | 401 | `middleware/auth.ts` |
| `AUTH_INVALID_ISSUER` | JWT issuer 불일치 | 401 | `middleware/auth.ts` |
| `AUTH_MALFORMED_TOKEN` | JWT 형식 오류 | 401 | `middleware/auth.ts` |
| `AUTH_VERIFICATION_FAILED` | 위 네 갈래에 해당 없는 JWT 검증 실패 | 401 | `middleware/auth.ts` |
| `AUTH_INVALID_TOKEN` | 토큰 재발급 경로의 JWT 검증 실패 | 401 | `routes/auth.ts` |
| `TOKEN_REVOKED` | 로그아웃/재발급으로 폐기된 토큰(`token_epoch` 불일치) | 401 | `middleware/auth.ts`, `routes/auth.ts` |
| `AUTH_USER_NOT_FOUND` | 토큰 sub 에 해당하는 사용자 없음 | 404 | `routes/auth.ts` |
| `ACCOUNT_PENDING_DELETION` | 탈퇴 유예(pending_deletion) 계정의 일반 요청 차단 | 403 | `middleware/auth.ts` |
| `ACCOUNT_STATUS_UNVERIFIED` | 계정 상태 확인 불가(fail-closed) | 503 | `middleware/auth.ts` |

### 2-2. 로그인 / 가입

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `AUTH_INVALID_JSON` | 인증 요청 JSON 파싱 실패 | 400 | `routes/auth.ts` |
| `AUTH_VALIDATION_FAILED` | 인증 요청 zod 검증 실패 | 400 | `routes/auth.ts` |
| `AUTH_EMAIL_CODE_INVALID` | 이메일 인증코드 불일치/무효 | 400 | `routes/auth.ts` |
| `AUTH_EMAIL_CODE_EXPIRED` | 이메일 인증코드 만료 | 400 | `routes/auth.ts` |
| `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED` | 이메일 인증 시도 횟수 초과 | 429 | `routes/auth.ts` |
| `AUTH_EMAIL_CODE_SEND_FAILED` | 인증코드 발송 실패(업스트림) | 5xx | `routes/auth.ts` |
| `AUTH_EMAIL_CODE_VERIFY_FAILED` | 인증코드 검증 처리 실패 | 500 | `routes/auth.ts` |
| `AUTH_EMAIL_TAKEN` | 이미 이메일/비번 계정으로 가입됨(로그인 유도) | 409 | `routes/auth.ts` |
| `AUTH_EMAIL_SOCIAL` | 이미 소셜 계정으로 가입됨(+`provider`) | 409 | `routes/auth.ts` |
| `AUTH_INVALID_CREDENTIALS` | 이메일/비밀번호 불일치 | 401 | `routes/auth.ts` |
| `AUTH_PASSWORD_RESET_FAILED` | 비밀번호 재설정 실패 | 500 | `routes/auth.ts` |
| `AUTH_REGISTER_FAILED` | 회원가입 처리 실패 | 500 | `routes/auth.ts` |
| `AUTH_LOGIN_FAILED` | 로그인 처리 실패 | 500 | `routes/auth.ts` |
| `AUTH_LOGOUT_FAILED` | 로그아웃 처리 실패 | 500 | `routes/auth.ts` |
| `AUTH_GOOGLE_CONFIG_MISSING` | Google client ID 미설정 | 500 | `routes/auth.ts` |
| `AUTH_GOOGLE_FAILED` | Google 로그인 검증 실패 | 5xx | `routes/auth.ts` |

### 2-3. 프로필 / 동의 / 탈퇴

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `CONSENT_REQUIRED` | 필수 동의 미이행 | 403 | `middleware/consent.ts`, `routes/tts.ts`, `voice-upload.ts`, `voice-profile.ts` |
| `CONSENT_STATE_UNAVAILABLE` | 동의 상태 조회 불가 | 500 | `middleware/consent.ts` |
| `INVALID_NAME` | name 이 문자열이 아님 | 400 | `routes/user.ts` |
| `INVALID_NAME_LENGTH` | 닉네임 길이 규칙 위반(1~30자) | 400 | `routes/user.ts`, `voice-profile.ts` |
| `INVALID_BOOLEAN` | boolean 필드 형식 오류(`allow_family_alarms`) | 400 | `routes/user.ts` |
| `INVALID_QUIET_WINDOWS` | 방해금지 창 형식 오류 | 400 | `routes/user.ts` |
| `INVALID_QUIET_DAYS` | 방해금지 요일 형식 오류 | 400 | `routes/user.ts` |
| `INVALID_QUIET_TIME` | 방해금지 시각 형식 오류 | 400 | `routes/user.ts` |
| `INVALID_DYNAMIC_PROMPT_SETTINGS` | 동적 프롬프트 설정 형식 오류 | 400 | `routes/user.ts` |
| `NO_FIELDS_TO_UPDATE` | 변경할 필드 없음(프로필) | 400 | `routes/user.ts` |
| `INVALID_CONSENT_TYPE` | 알 수 없는 동의 type | 400 | `routes/user.ts` |
| `CONSENTS_REQUIRED` | consents 필드 필요 | 400 | `routes/user.ts` |
| `CONSENT_RECORD_FAILED` | 동의 기록 실패 | 500 | `routes/user.ts` |
| `CONSENT_LOAD_FAILED` | 동의 조회 실패 | 500 | `routes/user.ts` |
| `CONSENT_STATUS_FAILED` | 동의 상태 조회 실패 | 500 | `routes/user.ts` |
| `DELETION_REQUEST_FAILED` | 탈퇴 요청 처리 실패 | 500 | `routes/user.ts` |
| `NO_PENDING_DELETION` | 취소할 탈퇴 예약 없음 | 404 | `routes/user.ts` |
| `DELETION_CANCEL_FAILED` | 탈퇴 취소 처리 실패 | 500 | `routes/user.ts` |
| `DELETE_ACCOUNT_FAILED` | 계정 삭제 처리 실패 | 500 | `routes/user.ts` |

## 3. 결제 / 구독

`routes/billing-google.ts`, `billing-google-rtdn.ts`, `billing-mutation.ts`, `lib/store-billing.ts`.

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `GOOGLE_BILLING_UNCONFIGURED` | Google 결제 서버 미구성 | 503 | `routes/billing-google.ts` |
| `RTDN_UNCONFIGURED` | RTDN(실시간 알림) 미구성 | 503 | `routes/billing-google-rtdn.ts` |
| `RTDN_BAD_TOKEN` | RTDN 검증 토큰 불일치 | 403 | `routes/billing-google-rtdn.ts` |
| `UNKNOWN_PRODUCT` | SKU 화이트리스트 밖 상품 id | 400 | `routes/billing-google.ts` |
| `PACKAGE_MISMATCH` | 패키지명 불일치 | 400 | `routes/billing-google.ts` |
| `PRODUCT_MISMATCH` | 상품 id 불일치 | 400 | `routes/billing-google.ts` |
| `GOOGLE_VERIFICATION_FAILED` | Google 구매 검증 실패(업스트림) | 502 | `routes/billing-google.ts`, `billing-google-rtdn.ts` |
| `GOOGLE_PURCHASE_NOT_FOUND` | Google 구매 미존재 | 404 | `routes/billing-google.ts` |
| `SUBSCRIPTION_NOT_ACTIVE` | 구독 상태가 entitled 아님 | 400 | `routes/billing-google.ts` |
| `SUBSCRIPTION_EXPIRED` | 구독 만료 | 400 | `routes/billing-google.ts` |
| `TRANSACTION_ACCOUNT_MISMATCH` | 구매의 `obfuscatedAccountId` 가 다른 계정 | 403 | `routes/billing-google.ts` |
| `TRANSACTION_ACCOUNT_UNVERIFIED` | 구매에 계정 식별자가 없어 귀속 확인 불가 | 403 | `routes/billing-google.ts` |
| `TRANSACTION_OWNED_BY_OTHER_USER` | 다른 계정에 이미 귀속된 트랜잭션 | 409 | `lib/store-billing.ts`(→ `billing-google.ts`) |
| `CHECKOUT_DISABLED` | 테스트 빌드에서 체크아웃 비활성(코드 등록 유도) | 403 | `routes/billing-mutation.ts` |
| `PLAN_KEY_REQUIRED` | plan_key 필요 | 400 | `routes/billing-mutation.ts` |
| `PLAN_NOT_FOUND` | 플랜 미존재 | 400 | `routes/billing-*.ts`, `lib/*-redemption.ts` |
| `PLAN_INACTIVE` | 비활성 플랜 | 400 | `routes/billing-mutation.ts` |
| `FREE_NOT_BILLABLE` | 무료 플랜은 결제/코드 대상 아님 | 400 | `routes/billing-mutation.ts` |
| `GIFT_PERSONAL_ONLY` | 선물 결제는 개인 플랜만 | 400 | `routes/billing-mutation.ts` |
| `INVALID_COUNT` | 테스트 코드 count 범위 오류(1~50) | 400 | `routes/billing-mutation.ts` |
| `INVALID_DAYS` | 테스트 코드 days 범위 오류(1~365) | 400 | `routes/billing-mutation.ts` |
| `INVALID_CANCEL_MODE` | 해지 mode 가 `at_period_end`/`immediate` 아님 | 400 | `routes/billing-mutation.ts` |
| `NO_ACTIVE_SUBSCRIPTION` | 활성 구독 없음(취소/변경 대상 없음) | 400 | `routes/billing-mutation.ts` |
| `SAME_PLAN` | 이미 해당 플랜 이용 중 | 400 | `routes/billing-mutation.ts` |
| `PLAY_CANCEL_FAILED` | Play 구독 해지 실패(+`manage_url`) | 502 | `routes/billing-mutation.ts` |
| `PLAY_REVOKE_FAILED` | Play 구독 즉시 철회 실패(+`manage_url`) | 502 | `routes/billing-mutation.ts` |
| `NO_ACTIVE_FAMILY_OWNER_SUBSCRIPTION` | 활성 가족 플랜 소유권 없음(공유코드 발급 불가) | 404 | `routes/billing-mutation.ts` |
| `GROUP_FULL` | 그룹 정원 초과 | 409 | `routes/billing-mutation.ts`, `lib/voucher-redemption.ts` |

## 4. 프로모 / 바우처 코드

`routes/code.ts`(바우처: 초대·선물), `routes/billing-promo.ts`(공용 프로모),
`lib/voucher-redemption.ts`, `lib/promo-redemption.ts`.
공용 프로모와 개인 바우처는 별개 경로지만 노출 코드는 상당수 공유한다.

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `CODE_REQUIRED` | code 값 필요 | 400 | `routes/code.ts`, `billing-promo.ts`, `billing-mutation.ts`, `lib/*-redemption.ts` |
| `INVALID_FORMAT` | 바우처 코드 형식 오류 | 400 | `lib/voucher-redemption.ts` |
| `CODE_NOT_FOUND` | 코드 미존재(바우처/프로모) | 404 | `lib/voucher-redemption.ts`, `lib/promo-redemption.ts` |
| `CODE_INACTIVE` | 프로모 코드 비활성 | 409 | `lib/promo-redemption.ts` |
| `CODE_MISCONFIGURED` | 프로모 코드 설정 오류(duration ≤ 0) | 409 | `lib/promo-redemption.ts` |
| `CODE_NOT_IN_WINDOW` | 등록 유효창(valid_from~until) 밖 | 409 | `lib/promo-redemption.ts` |
| `CODE_EXPIRED` | 코드 만료 | 409 | `lib/voucher-redemption.ts` |
| `CODE_ALREADY_USED` | 이미 사용된 코드(상한 도달) | 409 | `lib/voucher-redemption.ts` |
| `CODE_ALREADY_REDEEMED_BY_YOU` | 본인이 이미 사용한 코드(중복) | 409 | `lib/voucher-redemption.ts`, `lib/promo-redemption.ts` |
| `CODE_GROUP_ALREADY_REDEEMED` | 같은 프로모션 그룹의 다른 코드를 이미 사용 | 409 | `lib/promo-redemption.ts` |
| `CODE_EXHAUSTED` | 총 사용 상한 소진(원자 claim 실패) | 409 | `lib/promo-redemption.ts` |
| `ACTIVE_SUBSCRIPTION_EXISTS` | 활성 유료 구독 보유자는 프로모 사용 불가 | 409 | `lib/promo-redemption.ts` |
| `SELF_ISSUED` | 본인이 발급한 바우처는 사용 불가 | 400 | `lib/voucher-redemption.ts` |
| `INVALID_GIFT_PLAN` | 선물 코드는 개인 플랜만 | 400 | `lib/voucher-redemption.ts` |
| `INVALID_INVITE_PLAN` | 초대 코드는 가족/커플 플랜만 | 400 | `lib/voucher-redemption.ts` |
| `OWNS_ACTIVE_GROUP` | 다른 멤버가 있는 가족 그룹 소유자는 코드 사용 불가(양도/정리 후 재시도) | 409 | `lib/voucher-redemption.ts`, `lib/promo-redemption.ts` |
| `PROMO_REDEEM_FAILED` | 프로모 사용 처리 중 예기치 못한 실패 | 500 | `routes/billing-promo.ts` |

> 클라 폴백: `code/register`(바우처) 가 `CODE_NOT_FOUND` **또는 `INVALID_FORMAT`** 으로 실패하면
> Android 는 `billing/promo/redeem`(공용 프로모)로 폴백한다
> (`ui/main/MainViewModelBillingActions.kt`). 공용 프로모 코드는 바우처 형식을 안 지켜서
> `INVALID_FORMAT` 으로 떨어지기 때문이다. 그 외 코드는 폴백하지 않고 매핑 문구를 노출한다.

## 5. 알람

`routes/alarm-mutation.ts`, `alarm-helpers.ts`(생성/수정 입력 검증). `alarm-query.ts` 는 에러 코드를 내지 않는다.

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `INVALID_ALARM_ID` | 알람 ID 형식 오류 | 400 | `routes/alarm-mutation.ts` |
| `ALARM_NOT_FOUND` | 알람 미존재(또는 소유 아님) | 404 | `routes/alarm-mutation.ts` |
| `REQUIRED_FIELDS_MISSING` | 필수 필드(time 등) 누락 | 400 | `routes/alarm-mutation.ts` |
| `NO_UPDATE_FIELDS` | 수정할 필드 없음 | 400 | `routes/alarm-mutation.ts` |
| `INVALID_TARGET_USER` | target_user_id 형식 오류 | 400 | `routes/alarm-mutation.ts`, `alarm-helpers.ts` |
| `NOT_CONNECTED` | 대상과 같은 커플/가족 그룹 아님 | 403 | `routes/alarm-mutation.ts` |
| `FAMILY_ALARM_DISABLED` | 수신자가 가족 알람 비허용 | 403 | `routes/alarm-mutation.ts`, `alarm-helpers.ts`, `family-alarm.ts` |
| `FAMILY_ALARM_QUIET_TIME` | 수신자 방해금지 시간대 | 403 | `routes/alarm-helpers.ts`, `family-alarm.ts` |
| `FAMILY_ALARM_LEAD_TIME` | 다음 발사까지 최소 리드타임 미달 | 400 | `routes/alarm-helpers.ts`, `family-alarm.ts` |
| `VOICE_FEATURE_REQUIRES_PAID_PLAN` | 음성 기능은 유료 플랜 필요 | 403 | `routes/alarm-mutation.ts`, `tts.ts`, `voice-profile.ts`, `voice-upload.ts` |
| `VOICE_PROFILE_NOT_FOUND` | 음성 프로필 미존재 | 404 | `routes/alarm-mutation.ts`, `tts.ts`, `voice-profile.ts` |
| `MESSAGE_NOT_FOUND` | 메시지 미존재 | 404 | `routes/alarm-mutation.ts`, `tts.ts` |
| `INVALID_MESSAGE_ID` | message_id 형식 오류 | 400 | `routes/alarm-helpers.ts`, `tts.ts` |
| `INVALID_BUCKET_ID` | bucket_id 형식 오류 | 400 | `routes/alarm-mutation.ts`, `alarm-helpers.ts` |
| `INVALID_ALARM_MODE` | mode 값 허용 밖 | 400 | `routes/alarm-helpers.ts` |
| `INVALID_VIBRATION_PATTERN` | vibration_pattern 값 허용 밖 | 400 | `routes/alarm-helpers.ts` |
| `INVALID_WAKE_MODE` | wake_mode 값 허용 밖 | 400 | `routes/alarm-helpers.ts` |
| `INVALID_VOICE_PROFILE_ID` | voice_profile_id 형식 오류 | 400 | `routes/alarm-helpers.ts`, `tts.ts`, `voice-profile.ts` |
| `INVALID_TIME_FORMAT` | time 이 HH:mm 아님 | 400 | `routes/alarm-helpers.ts` |
| `INVALID_TIME_VALUE` | time 값 범위 오류 | 400 | `routes/alarm-helpers.ts` |
| `INVALID_REPEAT_DAYS` | repeat_days 형식 오류(0~6 배열) | 400 | `routes/alarm-helpers.ts` |
| `INVALID_SNOOZE_MINUTES` | snooze_minutes 범위 오류(1~30) | 400 | `routes/alarm-helpers.ts` |
| `INVALID_IS_ACTIVE` | is_active 가 boolean 아님 | 400 | `routes/alarm-helpers.ts` |

## 6. 음성 / TTS

`routes/tts.ts`(합성/미리듣기/메시지), `routes/voice-profile.ts`(프로필·초안·클로닝),
`routes/voice-upload.ts`(업로드).

### 6-1. 합성 (tts.ts)

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `VOICE_AND_TEXT_REQUIRED` | voice_profile_id·text 필요 | 400 | `routes/tts.ts` |
| `TEXT_TOO_LONG` | 텍스트 200자 초과 | 400 | `routes/tts.ts` |
| `INVALID_CATEGORY` | TTS 카테고리 허용 밖 | 400 | `routes/tts.ts` |
| `RANDOM_CATEGORY_REQUIRED` | 랜덤 TTS 는 프리셋 카테고리 필요 | 400 | `routes/tts.ts` |
| `VOICE_PROFILE_NOT_READY` | 음성 프로필 준비 안 됨(processing) | 400 | `routes/tts.ts` |
| `FREE_PLAN_PRESET_ONLY` | 무료 플랜은 스톡 보이스+프리셋 문구만 | 403 | `routes/tts.ts` |
| `BASIC_VOICE_PRESET_ONLY` | 유료라도 기본(시스템) 목소리는 프리셋 문구만 | 403 | `routes/tts.ts` |
| `VOICE_LOCKED_FREE_PLAN` | 무료 강등으로 잠긴 목소리 | 403 | `routes/tts.ts` |
| `VOICE_DRAFT_NOT_USABLE` | 초안 목소리는 확인 미리듣기 외 사용 불가 | 403 | `routes/tts.ts` |
| `VOICE_PREVIEW_DRAFT_REQUIRED` | 확인 미리듣기는 비공개 초안만 가능 | 409 | `routes/tts.ts` |
| `VOICE_PREVIEW_IN_PROGRESS` | 미리듣기 준비가 이미 진행 중 | 409 | `routes/tts.ts` |
| `VOICE_PREVIEW_UNAVAILABLE` | 저장된 미리듣기 오디오가 사라짐 | 409 | `routes/tts.ts` |
| `VOICE_AUTHORIZATION_CHANGED` | 합성 도중 목소리 권한이 바뀜 | 409 | `routes/tts.ts` |
| `MANUAL_TTS_QUOTA_EXCEEDED` | 이번 달 직접 입력 문구 생성 쿼터 소진(+`manual_quota`) | 429 | `routes/tts.ts` |
| `NO_VOICE_ID` | 프로필에 사용 가능한 voice ID 없음 | 400 | `routes/tts.ts` |
| `TRANSLATION_NOT_CONFIGURED` | 알람 텍스트 번역 미구성 | 503 | `routes/tts.ts` |
| `TEXT_PREPARATION_FAILED` | 알람 텍스트 준비가 유효하지 않은 결과 반환 | 502 | `routes/tts.ts` |
| `TTS_GENERATION_FAILED` | TTS 합성 실패(업스트림) | 500 | `routes/tts.ts` |
| `MESSAGE_AUDIO_MISSING` | 메시지에 저장된 오디오 없음 | 404 | `routes/tts.ts` |
| `MESSAGE_AUDIO_NOT_FOUND` | 저장 오디오 객체 미존재(R2) | 404 | `routes/tts.ts` |

### 6-2. 프로필 / 초안 / 클로닝 (voice-profile.ts)

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `DEV_ONLY_ROUTE` | dev 전용 라우트 | 404 | `routes/voice-profile.ts` |
| `INVALID_NAME_LENGTH` | 이름 길이 규칙 위반 | 400 | `routes/voice-profile.ts` |
| `NAME_TOO_LONG` | 이름 50자 초과 | 400 | `routes/voice-profile.ts` |
| `INVALID_RELATIONSHIP_LABEL` | relationship_label 형식 오류 | 400 | `routes/voice-profile.ts` |
| `INVALID_LISTENER_TITLE` | listener_title 형식 오류 | 400 | `routes/voice-profile.ts` |
| `AUDIO_AND_NAME_REQUIRED` | 클로닝: audio·name 필요 | 400 | `routes/voice-profile.ts` |
| `INVALID_PREVIEW_TOKEN` | preview_playback_token 이 UUID 아님 | 400 | `routes/voice-profile.ts` |
| `VOICE_PREVIEW_TEXT_INVALID` | 미리듣기 문구가 1~200자/대괄호 규칙 위반 | 400 | `routes/voice-profile.ts` |
| `VOICE_PREVIEW_REQUIRED` | 등록 전 미리듣기 청취 필요 | 409 | `routes/voice-profile.ts` |
| `VOICE_PREVIEW_CONFIRMATION_CONFLICT` | 재생 토큰이 낡았거나 초안이 바뀜 | 409 | `routes/voice-profile.ts` |
| `VOICE_DRAFT_REQUIRED` | 등록 전 비공개 초안 생성·미리듣기 필요 | 409 | `routes/voice-profile.ts` |
| `VOICE_PROMOTION_FIELDS_NOT_ALLOWED` | 등록(승격) 중 페르소나 필드 변경 불가 | 409 | `routes/voice-profile.ts` |
| `VOICE_PERSONA_LOCKED` | 등록 후 관계·호칭 변경 불가 | 409 | `routes/voice-profile.ts` |
| `INVALID_VOICE_TRANSITION` | 정식 목소리를 초안으로 되돌릴 수 없음 | 409 | `routes/voice-profile.ts` |
| `VOICE_TRANSITION_CONFLICT` | 목소리 상태가 바뀜(새로고침 후 재시도) | 409 | `routes/voice-profile.ts` |
| `VOICE_NOT_READY` | 사전렌더를 걸 수 있는 상태가 아님 | 409 | `routes/voice-profile.ts` |
| `SOURCE_AUDIO_MISSING` | 원본 녹음이 없어 말투 분석 재시도 불가 | 409 | `routes/voice-profile.ts` |
| `SPEECH_STYLE_RETRY_CONFLICT` | 말투 분석이 이미 실행 중이거나 재시도 대상 아님 | 409 | `routes/voice-profile.ts` |
| `SPEECH_STYLE_ANALYSIS_FAILED` | 말투 분석 실패(업스트림) | 502 | `routes/voice-profile.ts` |
| `VOICE_LIMIT_REACHED` | 음성 프로필 개수 상한 도달 | 409 | `routes/voice-profile.ts` |
| `VOICE_MONTHLY_CHANGE_LIMIT_REACHED` | 이번 달 공식 목소리 변경 횟수 소진 | 429 | `routes/voice-profile.ts` |
| `VOICE_SLOT_EXHAUSTED` | 음성 제공자 슬롯 소진(일시적) | 503 | `routes/voice-profile.ts` |
| `VOICE_CAPACITY_EXHAUSTED` | 등록 요청이 몰려 수용 불가(일시적) | 503 | `routes/voice-profile.ts` |
| `VOICE_CLONING_FAILED` | 음성 클로닝 실패 | 500 | `routes/voice-profile.ts` |
| `VOICE_CLONE_AUDIO_TOO_SHORT` | 클로닝 오디오 너무 짧음 | 400 | `routes/voice-profile.ts` |
| `VOICE_CLONE_AUDIO_TOO_LONG` | 클로닝 오디오 너무 긺 | 400 | `routes/voice-profile.ts` |

### 6-3. 업로드 (voice-upload.ts)

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `MULTIPART_BODY_REQUIRED` | multipart/form-data 본문 필요 | 400 | `routes/voice-upload.ts` |
| `AUDIO_FILE_REQUIRED` | audio 파일 필요 | 400 | `routes/voice-upload.ts` |
| `AUDIO_FILE_EMPTY` | audio 파일이 비어있음 | 400 | `routes/voice-upload.ts`, `voice-profile.ts` |
| `INVALID_AUDIO_MIME_TYPE` | audio/* MIME 아님 | 400 | `routes/voice-upload.ts`, `voice-profile.ts` |
| `INVALID_DURATION` | durationMs 가 양의 정수 아님 | 400 | `routes/voice-upload.ts`, `voice-profile.ts` |
| `AUDIO_FILE_TOO_LARGE` | 업로드 파일 바이트 상한 초과 | 413 | `routes/voice-upload.ts`, `voice-profile.ts` |
| `AUDIO_DURATION_TOO_SHORT` | 업로드 오디오 최소 길이 미만 | 400 | `routes/voice-upload.ts` |
| `AUDIO_DURATION_TOO_LONG` | 업로드 오디오 최대 길이 초과 | 400 | `routes/voice-upload.ts` |

## 7. 가족 / 그룹

`routes/family-group.ts`(그룹 탈퇴/양도/제거), `routes/family-alarm.ts`(가족 알람 발송).
가족 알람의 `FAMILY_ALARM_*` 코드는 §5 에 있다.

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `NOT_MEMBER` | 해당 그룹 멤버 아님 | 403 | `routes/family-group.ts` |
| `OWNER_ONLY` | 그룹 소유자만 가능(양도/제거) | 403 | `routes/family-group.ts` |
| `OWNER_CANNOT_LEAVE` | 소유자는 탈퇴 불가(양도 필요) | 400 | `routes/family-group.ts` |
| `TARGET_REQUIRED` | target_user_id 필요 | 400 | `routes/family-group.ts` |
| `SELF_TRANSFER` | 자기 자신에게 양도 불가 | 400 | `routes/family-group.ts` |
| `SELF_REMOVE` | 자기 자신 제거 불가(탈퇴/양도 사용) | 400 | `routes/family-group.ts` |
| `CANNOT_REMOVE_OWNER` | owner 는 제거 불가 | 400 | `routes/family-group.ts` |
| `TARGET_NOT_MEMBER` | 대상이 그룹 멤버 아님 | 400 | `routes/family-group.ts` |
| `GROUP_NOT_FOUND` | 그룹 미존재 | 404 | `routes/family-group.ts` |
| `RECIPIENT_REQUIRED` | recipient_user_id 필요 | 400 | `routes/family-alarm.ts` |
| `INVALID_WAKE_AT` | wake_at 이 HH:mm 아님 | 400 | `routes/family-alarm.ts` |
| `SELF_ALARM` | 자기 자신에게 가족 알람 불가 | 400 | `routes/family-alarm.ts` |
| `NOT_SAME_GROUP` | 같은 가족 그룹 멤버 아님 | 403 | `routes/family-alarm.ts` |
| `RECIPIENT_NOT_FOUND` | 수신자 미존재 | 404 | `routes/family-alarm.ts` |
| `NO_VOICE_PROFILE` | 수신자 음성 프로필 없음 | 400 | `routes/family-alarm.ts` |
| `VOICE_UPLOAD_REQUIRED` | voice_upload_id 필요 | 400 | `routes/family-alarm.ts` |
| `LABEL_TOO_LONG` | label 길이 초과 | 400 | `routes/family-alarm.ts` |
| `UPLOAD_NOT_FOUND` | 음성 업로드 미존재 | 400 | `routes/family-alarm.ts` |
| `NOT_UPLOAD_OWNER` | 업로드 소유자 아님 | 400 | `routes/family-alarm.ts` |

## 8. 푸시 토큰

`routes/push.ts`.

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `INVALID_PUSH_TOKEN` | token 누락 또는 길이 상한 초과 | 400 | `routes/push.ts` |
| `INVALID_PLATFORM` | platform 이 허용 목록 밖 | 400 | `routes/push.ts` |

## 9. 공휴일

`routes/holiday.ts`.

| 코드 | 의미 | HTTP | 위치 |
|---|---|---|---|
| `COUNTRY_REQUIRED` | country 필요 | 400 | `routes/holiday.ts` |
| `INVALID_DATE` | from/to 가 YYYY-MM-DD 아님 | 400 | `routes/holiday.ts` |
| `INVALID_RANGE` | from > to | 400 | `routes/holiday.ts` |
| `RANGE_TOO_LARGE` | 조회 범위 상한 초과 | 400 | `routes/holiday.ts` |

---

## 관리자 가시성 (Sentry / 로그)

- **구조화 로그**: `logRouteError()` 가 `{ level:"error", method, path, uid, error, stack }` JSON 을
  stderr 로 남긴다. Cloudflare Workers 로그(wrangler tail / 대시보드)에서 `path` 로 검색한다.
- **Sentry 태그**: `SENTRY_DSN` 이 설정된 경우 캡처 전에 `route`(=`c.req.path`)·`method`·`uid` 를
  태그로 붙인다. `route:/api/...`, `method:POST`, `uid:<...>` 로 필터할 수 있다(`lib/logger.ts`).
- **주의**: 5xx(서버/업스트림 실패) 계열만 `logRouteError()` 로 캡처된다. 4xx(사용자 입력/상태)는
  정상 흐름이라 캡처하지 않고, 클라가 응답 본문의 `error_code` 로 안내 문구를 고른다.
