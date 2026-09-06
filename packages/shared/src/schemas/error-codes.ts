/**
 * **에러 코드의 단일 출처.**
 *
 * 백엔드는 4xx/5xx 에서 `{ error, error_code }` 를 내려주고, 앱은 그 코드로 분기하거나
 * 사용자 문구를 고른다. 그런데 코드가 라우트마다 **문자열 리터럴**로만 있던 시절에는
 * 같은 뜻에 코드가 둘씩 생겼다 — `NO_UPDATE_FIELDS` vs `NO_FIELDS_TO_UPDATE`,
 * `INVALID_JSON` vs `JSON_BODY_REQUIRED`, `NO_VOICE_PROFILE` vs `VOICE_PROFILE_NOT_FOUND`.
 * 더 나쁜 것은 **철자를 바꿔도 컴파일이 통과한다**는 점이다: 그 코드로 분기하던 앱만
 * 조용히 폴백으로 떨어진다.
 *
 * 그래서 목록을 여기 둔다. 백엔드는 `jsonError(c, status, code, ...)` 로만 코드를 내보내고
 * (`lib/api-error.ts`), 앱은 이 목록을 근거로 코드→문구 표를 만든다.
 *
 * ## 코드를 더할 때
 *
 * 1. 여기 배열에 추가한다(도메인 묶음 안, 알파벳 순).
 * 2. 백엔드에서 `jsonError` 로 내보낸다 — 리터럴을 쓰지 말 것.
 * 3. 사용자에게 보여 줄 말이 따로 있으면 앱의 코드→문구 표에도 넣는다
 *    (`ApiErrorMessages.kt` / `APIErrorMessages.swift`). 없으면 폴백 문구가 쓰인다.
 *
 * ## 코드를 **바꾸지** 말 것
 *
 * ⚠ 스토어에 나간 앱이 그 문자열로 분기하고 있다. 이름을 고치면 **구버전 앱에서 그 분기가
 * 통째로 죽는다.** 바꿔야 하면 새 코드를 **추가**하고, 옛 코드는 한동안 함께 내려보낸 뒤
 * 강제 업데이트가 끝난 회차에서 지운다.
 */
export const ERROR_CODES = [
  // 목소리 프로필 (voice-profile.ts)
  'AUDIO_AND_NAME_REQUIRED',
  'AUDIO_FILE_EMPTY',
  'AUDIO_FILE_TOO_LARGE',
  'INVALID_AUDIO_MIME_TYPE',
  'INVALID_DURATION',
  'INVALID_LISTENER_TITLE',
  'INVALID_PREVIEW_TOKEN',
  'INVALID_RELATIONSHIP_LABEL',
  'INVALID_VOICE_TRANSITION',
  'JSON_BODY_REQUIRED',
  'NAME_TOO_LONG',
  'SOURCE_AUDIO_MISSING',
  'SPEECH_STYLE_ANALYSIS_FAILED',
  'SPEECH_STYLE_RETRY_CONFLICT',
  'VOICE_CAPACITY_EXHAUSTED',
  'VOICE_CLONE_AUDIO_TOO_LONG',
  'VOICE_CLONE_AUDIO_TOO_SHORT',
  'VOICE_CLONING_FAILED',
  'VOICE_DRAFT_REQUIRED',
  'VOICE_LIMIT_REACHED',
  'VOICE_MONTHLY_CHANGE_LIMIT_REACHED',
  'VOICE_NOT_READY',
  'VOICE_PERSONA_LOCKED',
  'VOICE_PREVIEW_CONFIRMATION_CONFLICT',
  'VOICE_PREVIEW_REQUIRED',
  'VOICE_PREVIEW_TEXT_INVALID',
  'VOICE_PROMOTION_FIELDS_NOT_ALLOWED',
  'VOICE_REPLACE_TARGET_AMBIGUOUS',
  'VOICE_SLOT_EXHAUSTED',
  'VOICE_TRANSITION_CONFLICT',
  // 계정·설정 (user.ts)
  'CONSENTS_REQUIRED',
  'CONSENT_LOAD_FAILED',
  'CONSENT_RECORD_FAILED',
  'CONSENT_STATUS_FAILED',
  'DELETE_ACCOUNT_FAILED',
  'DELETION_CANCEL_FAILED',
  'DELETION_REQUEST_FAILED',
  'DOCUMENT_VERSION_REQUIRED',
  'INVALID_BOOLEAN',
  'INVALID_CONSENT_TYPE',
  'INVALID_DYNAMIC_PROMPT_SETTINGS',
  'INVALID_NAME',
  'INVALID_NAME_LENGTH',
  'INVALID_QUIET_DAYS',
  'INVALID_QUIET_TIME',
  'INVALID_QUIET_WINDOWS',
  'NO_FIELDS_TO_UPDATE',
  'NO_PENDING_DELETION',
  'POLICY_VERSION_MISMATCH',
  // 음성 생성(TTS) (tts.ts)
  'BASIC_VOICE_PRESET_ONLY',
  'FREE_PLAN_PRESET_ONLY',
  'INVALID_CATEGORY',
  'MANUAL_TTS_QUOTA_EXCEEDED',
  'MESSAGE_AUDIO_MISSING',
  'MESSAGE_AUDIO_NOT_FOUND',
  'NO_VOICE_ID',
  'RANDOM_CATEGORY_REQUIRED',
  'TEXT_PREPARATION_FAILED',
  'TEXT_TOO_LONG',
  'TRANSLATION_NOT_CONFIGURED',
  'TTS_GENERATION_FAILED',
  'VOICE_AND_TEXT_REQUIRED',
  'VOICE_AUTHORIZATION_CHANGED',
  'VOICE_DRAFT_NOT_USABLE',
  'VOICE_LOCKED_FREE_PLAN',
  'VOICE_PREVIEW_DRAFT_REQUIRED',
  'VOICE_PREVIEW_IN_PROGRESS',
  'VOICE_PREVIEW_UNAVAILABLE',
  'VOICE_PROFILE_NOT_READY',
  // 결제·구독 (billing-mutation.ts)
  'CHECKOUT_DISABLED',
  'FORBIDDEN',
  'FREE_NOT_BILLABLE',
  'GIFT_PERSONAL_ONLY',
  'GROUP_FULL',
  'INVALID_CANCEL_MODE',
  'INVALID_COUNT',
  'INVALID_DAYS',
  'NOT_FOUND',
  'NO_ACTIVE_FAMILY_OWNER_SUBSCRIPTION',
  'NO_ACTIVE_SUBSCRIPTION',
  'PLAN_INACTIVE',
  'PLAN_KEY_REQUIRED',
  'PLAY_CANCEL_FAILED',
  'PLAY_REVOKE_FAILED',
  'STORE_CANCEL_UNSUPPORTED',
  // 알람 공통 검증 (alarm-helpers.ts)
  'FAMILY_ALARM_DISABLED',
  'FAMILY_ALARM_LEAD_TIME',
  'FAMILY_ALARM_QUIET_TIME',
  'INVALID_ALARM_MODE',
  'INVALID_BUCKET_ID',
  'INVALID_IS_ACTIVE',
  'INVALID_MESSAGE_ID',
  'INVALID_REPEAT_DAYS',
  'INVALID_SNOOZE_MINUTES',
  'INVALID_TARGET_USER',
  'INVALID_TIME_FORMAT',
  'INVALID_TIME_VALUE',
  'INVALID_VIBRATION_PATTERN',
  'INVALID_VOICE_PROFILE_ID',
  'INVALID_WAKE_MODE',
  // 알람 쓰기 (alarm-mutation.ts)
  'ALARM_DELETE_FAILED',
  'ALARM_NOT_FOUND',
  'ALARM_SCHEMA_UPGRADING',
  'DELIVERY_VERSION_REQUIRED',
  'INVALID_ALARM_ID',
  'INVALID_DELIVERY_VERSION',
  'MESSAGE_NOT_FOUND',
  'NOT_CONNECTED',
  'NO_UPDATE_FIELDS',
  'REQUIRED_FIELDS_MISSING',
  'TARGETED_ALARM_IMMUTABLE',
  'VOICE_FEATURE_REQUIRES_PAID_PLAN',
  'VOICE_PROFILE_NOT_FOUND',
  // 애플 결제 (billing-apple.ts)
  'APPLE_BILLING_UNCONFIGURED',
  'APPLE_VERIFICATION_FAILED',
  'INVALID_REQUEST',
  'PLAN_NOT_FOUND',
  'SUBSCRIPTION_EXPIRED',
  'TRANSACTION_ACCOUNT_MISMATCH',
  'TRANSACTION_ACCOUNT_UNVERIFIED',
  'TRANSACTION_NOT_FOUND',
  'TRANSACTION_NOT_SUBSCRIPTION',
  'TRANSACTION_REVOKED',
  'UNKNOWN_PRODUCT',
  'USER_NOT_FOUND',
  // 가족 알람 (family-alarm.ts)
  'INVALID_WAKE_AT',
  'LABEL_TOO_LONG',
  'NOT_SAME_GROUP',
  'NOT_UPLOAD_OWNER',
  'NO_VOICE_PROFILE',
  'RECIPIENT_NOT_FOUND',
  'RECIPIENT_REQUIRED',
  'SELF_ALARM',
  'UPLOAD_NOT_FOUND',
  'VOICE_UPLOAD_REQUIRED',
  // 가족 그룹 (family-group.ts)
  'CANNOT_REMOVE_OWNER',
  'GROUP_NOT_FOUND',
  'NOT_MEMBER',
  'OWNER_CANNOT_LEAVE',
  'OWNER_ONLY',
  'SELF_REMOVE',
  'SELF_TRANSFER',
  'TARGET_NOT_MEMBER',
  'TARGET_REQUIRED',
  // 인증 (auth.ts)
  // ⚠ 여기 코드는 오래 산다 — 앱의 로그인·가입 화면이 코드로 분기한다(이메일 중복, 소셜
  //    계정으로 가입된 이메일 등). 이름을 고치면 구버전 앱의 그 분기가 통째로 죽는다.
  'ACCOUNT_PENDING_DELETION',
  'ACCOUNT_STATUS_UNVERIFIED',
  'AUTH_APPLE_CONFIG_MISSING',
  'AUTH_APPLE_FAILED',
  'AUTH_AUDIENCE_MISMATCH',
  'AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED',
  'AUTH_EMAIL_CODE_EXPIRED',
  'AUTH_EMAIL_CODE_INVALID',
  'AUTH_EMAIL_CODE_SEND_FAILED',
  'AUTH_EMAIL_CODE_VERIFY_FAILED',
  'AUTH_EMAIL_SOCIAL',
  'AUTH_EMAIL_TAKEN',
  'AUTH_EMPTY_TOKEN',
  'AUTH_GOOGLE_CONFIG_MISSING',
  'AUTH_GOOGLE_FAILED',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_INVALID_ISSUER',
  'AUTH_INVALID_JSON',
  'AUTH_INVALID_SCHEME',
  'AUTH_INVALID_TOKEN',
  'AUTH_LOGIN_FAILED',
  'AUTH_LOGOUT_FAILED',
  'AUTH_MALFORMED_TOKEN',
  'AUTH_MISSING',
  'AUTH_PASSWORD_RESET_FAILED',
  'AUTH_REGISTER_FAILED',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_USER_NOT_FOUND',
  'AUTH_VALIDATION_FAILED',
  'AUTH_VERIFICATION_FAILED',
  'TOKEN_REVOKED',
  // 구글 결제 (billing-google.ts)
  'GOOGLE_BILLING_UNCONFIGURED',
  'PACKAGE_MISMATCH',
  'PRODUCT_MISMATCH',
  'PURCHASE_NOT_COMPLETED',
  'SUBSCRIPTION_NOT_ACTIVE',
  // 공휴일 (holiday.ts)
  'COUNTRY_REQUIRED',
  'INVALID_DATE',
  'INVALID_RANGE',
  'RANGE_TOO_LARGE',
  // 음성 업로드 (voice-upload.ts)
  'AUDIO_DURATION_TOO_LONG',
  'AUDIO_DURATION_TOO_SHORT',
  'AUDIO_FILE_REQUIRED',
  'MULTIPART_BODY_REQUIRED',
  // 구글 실시간 알림 (billing-google-rtdn.ts)
  'GOOGLE_PURCHASE_NOT_FOUND',
  'GOOGLE_VERIFICATION_FAILED',
  'RTDN_BAD_TOKEN',
  'RTDN_UNCONFIGURED',
  // 프로모션 (billing-promo.ts)
  'CODE_REQUIRED',
  'PROMO_REDEEM_FAILED',
  // 동의 (consent.ts)
  'CONSENT_REQUIRED',
  'CONSENT_STATE_UNAVAILABLE',
  // 사용 기록 (events.ts)
  'INVALID_JSON',
  'INVALID_USAGE_EVENTS',
  // 푸시 (push.ts)
  'INVALID_PLATFORM',
  'INVALID_PUSH_TOKEN',
  // 관리자 (admin.ts)
  'ADMIN_UNCONFIGURED',
  // 코드 등록·프로모 (lib/voucher-redemption.ts, lib/promo-redemption.ts)
  // ⚠ 라우트가 아니라 **라이브러리**가 던진다(RedemptionError.errorCode) — 목록에서 빠지기
  //    쉬운 자리다. 앱의 코드 등록 화면이 이 코드들로 안내 문구를 고른다.
  'ACTIVE_SUBSCRIPTION_EXISTS',
  'CODE_ALREADY_REDEEMED_BY_YOU',
  'CODE_ALREADY_USED',
  'CODE_EXHAUSTED',
  'CODE_EXPIRED',
  'CODE_GROUP_ALREADY_REDEEMED',
  'CODE_INACTIVE',
  'CODE_MISCONFIGURED',
  'CODE_NOT_FOUND',
  'CODE_NOT_IN_WINDOW',
  'INVALID_FORMAT',
  'INVALID_GIFT_PLAN',
  'INVALID_INVITE_PLAN',
  'OWNS_ACTIVE_GROUP',
  'SELF_ISSUED',
  // 코드 등록 (code.ts)
  'CODE_TOO_LONG',
  // 공통·미들웨어 (index.ts, middleware/)
  // ⚠ 라우트 도메인에 속하지 않는 것들. 앱은 이 코드로 "다시 시도" 를 안내한다.
  'DB_INIT_FAILED',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
  'REQUEST_BODY_TOO_LARGE',
  'STOCK_CLIP_SEED_FAILED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** 서버 응답의 문자열이 우리가 아는 코드인가. 모르는 값은 앱이 폴백 문구로 처리한다. */
export function isKnownErrorCode(value: string | null | undefined): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/**
 * **눈에 띄어야 하는 코드.** 이것만 경보(Sentry)로 보낸다 — 나머지는 구조화 로그에만 남는다.
 *
 * 기준은 "사용자가 하려던 일이 막혔고, 우리가 손쓸 수 있는가" 다. 오타·형식 오류처럼
 * 사용자가 고칠 수 있는 것은 넣지 않는다(그건 노이즈다).
 */
export const ALERTING_ERROR_CODES: readonly ErrorCode[] = [
  // 신규 가입·재동의가 통째로 막힌 상태. 앱 릴리스와 서버 버전이 어긋났다는 신호다.
  'POLICY_VERSION_MISMATCH',
  // 유료 사용자가 기능을 못 쓰는 상태 — 결제 상태 동기화가 밀렸을 수 있다.
  'VOICE_FEATURE_REQUIRES_PAID_PLAN',
  'VOICE_LOCKED_FREE_PLAN',
  // 한도 소진. 사용자에게는 정상 안내지만, 갑자기 늘면 한도 자체를 다시 봐야 한다.
  'MANUAL_TTS_QUOTA_EXCEEDED',
  // 외부 제공자(음성 합성·클론)가 실패한 것. 우리가 고칠 수 있는 유일한 갈래다.
  'VOICE_CLONING_FAILED',
  'TTS_GENERATION_FAILED',
  // 스키마 마이그레이션 창에 걸린 요청 — 배포 직후 잠깐이어야 하고, 계속 나오면 사고다.
  'ALARM_SCHEMA_UPGRADING',
];
