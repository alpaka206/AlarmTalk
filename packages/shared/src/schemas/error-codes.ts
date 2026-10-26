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
  /** 목소리의 결(voice_energy)이 '' · 'lively' · 'calm' 이 아니다. */
  'INVALID_VOICE_ENERGY',
  /** 목소리 높이(`pitch_semitones`)가 −10…+6 반음·0.5 눈금이 아니다(`VoicePitchSemitonesSchema`). */
  'INVALID_VOICE_PITCH',
  'INVALID_VOICE_TRANSITION',
  'JSON_BODY_REQUIRED',
  'NAME_TOO_LONG',
  'SOURCE_AUDIO_MISSING',
  'SPEECH_STYLE_ANALYSIS_FAILED',
  'SPEECH_STYLE_RETRY_CONFLICT',
  'VOICE_CAPACITY_EXHAUSTED',
  'VOICE_CLONE_AUDIO_TOO_LONG',
  'VOICE_CLONE_AUDIO_TOO_SHORT',
  /**
   * 등록 녹음에서 말소리를 거의 찾지 못했다(전사가 `MIN_SPEECH_TRANSCRIPT_CHARS` 자 미만) — 아무것도
   * 만들지 않았고 월 등록 횟수도 그대로다. 다시 녹음하면 된다(`docs/spec/voice-and-message.md` §4-1).
   */
  'VOICE_CLONE_NO_SPEECH',
  'VOICE_CLONING_FAILED',
  'VOICE_DRAFT_REQUIRED',
  'VOICE_LIMIT_REACHED',
  'VOICE_MONTHLY_CHANGE_LIMIT_REACHED',
  'VOICE_NOT_READY',
  'VOICE_PERSONA_LOCKED',
  /** 목소리 높이는 등록 확정(초안 → 정식) 때만 정한다 — 그 뒤에는 바꿀 수 없다. */
  'VOICE_PITCH_LOCKED',
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
  'DELETION_REQUEST_FAILED',
  'DOCUMENT_VERSION_REQUIRED',
  'INVALID_CONSENT_TYPE',
  'INVALID_DYNAMIC_PROMPT_SETTINGS',
  'INVALID_NAME',
  'INVALID_NAME_LENGTH',
  'NO_FIELDS_TO_UPDATE',
  'POLICY_VERSION_MISMATCH',
  // 광고 보상 (ads.ts) — AdMob 서버가 부르는 콜백이라 앱에는 닿지 않는다.
  /** 키 목록을 방금 다시 받았다 — AdMob 이 1초 뒤 재시도하면 받힌다(`lib/admob-ssv.ts`). */
  'AD_REWARD_RETRY_LATER',
  'AD_REWARD_SIGNATURE_INVALID',
  // 음성 생성(TTS) (tts.ts)
  'BASIC_VOICE_PRESET_ONLY',
  'FREE_PLAN_PRESET_ONLY',
  'INVALID_CATEGORY',
  'MANUAL_TTS_QUOTA_EXCEEDED',
  'MESSAGE_AUDIO_MISSING',
  'MESSAGE_AUDIO_NOT_FOUND',
  'NO_VOICE_ID',
  'RANDOM_CATEGORY_REQUIRED',
  'RANDOM_TTS_RETIRED',
  'TEXT_PREPARATION_FAILED',
  'TEXT_TOO_LONG',
  'TRANSLATION_NOT_CONFIGURED',
  'TTS_GENERATION_FAILED',
  /** 같은 `request_id` 에 다른 입력이 왔다 — 앱의 버그다(문구를 바꾸면 새 id). */
  'TTS_REQUEST_ID_CONFLICT',
  /** 같은 `request_id` 가 아직 만들어지는 중이다 — 잠시 뒤 다시 보내면 그 결과를 받는다. */
  'TTS_REQUEST_IN_PROGRESS',
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
  'FREE_NOT_BILLABLE',
  // GIFT_PERSONAL_ONLY 는 2026-10-14 에 지웠다 — 선물 결제를 없앴다(아래 「코드 등록」 묶음의 ⚠).
  'INVALID_CANCEL_MODE',
  'NOT_FOUND',
  'NO_ACTIVE_SUBSCRIPTION',
  'PLAN_INACTIVE',
  'PLAN_KEY_REQUIRED',
  'PLAY_CANCEL_FAILED',
  'PLAY_REVOKE_FAILED',
  'STORE_CANCEL_UNSUPPORTED',
  // 알람 공통 검증 (alarm-helpers.ts)
  'INVALID_ALARM_MODE',
  'INVALID_BUCKET_ID',
  'INVALID_IS_ACTIVE',
  'INVALID_MESSAGE_ID',
  'INVALID_REPEAT_DAYS',
  'INVALID_SNOOZE_MINUTES',
  'INVALID_TARGET_DATE',
  'INVALID_TIME_FORMAT',
  'INVALID_TIME_VALUE',
  'INVALID_VIBRATION_PATTERN',
  'INVALID_VOICE_PROFILE_ID',
  'INVALID_WAKE_MODE',
  // 알람 쓰기 (alarm-mutation.ts)
  'ALARM_DELETE_FAILED',
  'ALARM_NOT_FOUND',
  'INVALID_ALARM_ID',
  'MESSAGE_NOT_FOUND',
  /** `POST /alarm` 의 `target_user_id` 가 남의 계정이다 — 남에게 보내는 알람은 없다(옛 앱의 가족 알람 보내기). */
  'NOT_CONNECTED',
  'NO_UPDATE_FIELDS',
  'REQUIRED_FIELDS_MISSING',
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
  // ⚠ **이미 나가고 있던 코드다**(2026-09-08 문서 감사). `lib/store-billing.ts` 가 409 로
  // 돌려주고 `routes/billing-google.ts` 가 `error_code` 에 실어 보내는데 이 목록에는 없었다 —
  // `isKnownErrorCode` 가 거부하니 두 앱이 문구를 못 고르고 기본 메시지로 떨어졌다.
  // 회귀 테스트가 못 잡은 이유는 판정 헬퍼가 `code:` 가 아니라 `errorCode:` 로 담기 때문이다
  // (`test/error-codes.test.ts` 의 정규식을 함께 넓혔다).
  'TRANSACTION_OWNED_BY_OTHER_USER',
  'TRANSACTION_REVOKED',
  // ⚠ **다른 스토어가 아직 갱신을 쥐고 있다.** 앱이 먼저 막지만 그 판정은 캐시된
  // 스냅샷이라, 다른 기기에서 방금 Play 구독을 시작한 경우를 못 본다 — 서버가
  // 확정 시점에 한 번 더 본다. 거절해도 스토어 트랜잭션은 남으므로, Play 를 해지한
  // 뒤 앱이 다시 올리면 그때 통과한다(`docs/spec/billing-lifecycle.md`).
  'CROSS_STORE_RENEWAL_ACTIVE',
  'UNKNOWN_PRODUCT',
  'USER_NOT_FOUND',
  // 가족 알람·가족 그룹·음성 업로드 묶음은 2026-10-20 커플·가족 이용권과 함께 지웠다 — 내던 라우트가 없다.
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
  'AUTH_EMAIL_INVALID',
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
  // PURCHASE_NOT_COMPLETED 는 2026-10-14 에 지웠다 — 그 코드를 내던 1회성 상품(선물) 확정 갈래가
  // 없어졌다(아래 「코드 등록」 묶음의 ⚠). 구독 확정은 이 코드를 낸 적이 없다.
  'SUBSCRIPTION_NOT_ACTIVE',
  // 공휴일 (holiday.ts)
  'COUNTRY_REQUIRED',
  'INVALID_DATE',
  'INVALID_RANGE',
  'RANGE_TOO_LARGE',
  // 애플 서버 알림 V2 (billing-apple-notifications.ts) — 애플 서버만 받는다. 앱은 이 코드를 보지 않는다
  // (`docs/spec/billing-lifecycle.md` 「애플 서버 알림 V2」).
  /** 애플이 서명했지만 우리 앱(번들 ID)의 알림이 아니다 — App Store Connect 의 URL 설정을 봐야 한다. */
  'APPLE_NOTIFICATION_BUNDLE_MISMATCH',
  /** 애플이 서명했지만 이 워커가 받는 환경이 아니다(운영 = Production, dev = Sandbox) — URL 설정이 바뀌었다. */
  'APPLE_NOTIFICATION_ENVIRONMENT_MISMATCH',
  /** 본문 형식·서명·인증서 체인이 틀렸다. 위조 요청이면 정상 거절이다. */
  'APPLE_NOTIFICATION_INVALID',
  /** 기록은 남겼지만 처리(스토어 재조회·회수)가 실패했다 — 애플이 재전송하면 다시 처리한다. */
  'APPLE_NOTIFICATION_PROCESSING_FAILED',
  // 구글 실시간 알림 (billing-google-rtdn.ts)
  'GOOGLE_PURCHASE_NOT_FOUND',
  'GOOGLE_VERIFICATION_FAILED',
  'RTDN_BAD_TOKEN',
  'RTDN_UNCONFIGURED',
  // 동의 (consent.ts)
  'CONSENT_REQUIRED',
  'CONSENT_STATE_UNAVAILABLE',
  // 사용 기록 (events.ts)
  'INVALID_JSON',
  'INVALID_USAGE_EVENTS',
  // 푸시 (push.ts)
  'INVALID_PLATFORM',
  'INVALID_PUSH_TOKEN',
  // 관리자 (admin.ts) — 콘솔 화면만 받는다. 앱은 이 코드를 보지 않는다(`docs/spec/admin-console.md`).
  'ADMIN_PUSH_COPY_INVALID',
  'ADMIN_PUSH_FAILED',
  'ADMIN_PUSH_JOB_NOT_FOUND',
  /** 광고 알림을 한국 시각 08:00~21:00 밖에 보내려 했다. */
  'ADMIN_PUSH_OUTSIDE_AD_HOURS',
  'ADMIN_PUSH_TEST_RECIPIENT_NO_DEVICE',
  /** 광고 시험 발송을 광고성 정보 수신에 동의하지 않은 계정으로 보내려 했다. */
  'ADMIN_PUSH_TEST_RECIPIENT_NO_MARKETING_CONSENT',
  'ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND',
  /** 같은 문구의 시험 발송(60분 안, 한 대 이상 성공) 없이 전체 발송을 만들려 했다. */
  'ADMIN_PUSH_TEST_REQUIRED',
  'ADMIN_UNAUTHORIZED',
  'ADMIN_UNCONFIGURED',
  // 코드 등록 (code.ts) — **받는 코드가 없다.** 옛 앱의 코드 등록 화면이 아직 부르므로 언제나 이 코드 하나로
  // 답한다(옛 앱 호환 — minSupported 가 현재 빌드를 넘으면 지운다).
  // 프로모 코드 갈래(ACTIVE_SUBSCRIPTION_EXISTS·CODE_EXHAUSTED·CODE_GROUP_ALREADY_REDEEMED·
  // CODE_INACTIVE·CODE_MISCONFIGURED·CODE_NOT_IN_WINDOW·PROMO_REDEEM_FAILED)는 프로모 코드와 함께
  // 2026-10-12 에 지웠다(App Store 3.1.1 — routes/code.ts 머리말). 옛 앱은 그 코드를 받을 일이 없다.
  // ⚠ **선물 갈래(INVALID_GIFT_PLAN — 그리고 위의 GIFT_PERSONAL_ONLY·PURCHASE_NOT_COMPLETED)는 선물 코드와
  //   함께 2026-10-14 에 지웠다 — 되살리지 말 것**(App Store 3.1.1 두 번째 반려 — routes/code.ts 머리말).
  //   서버가 더는 내지 않으니 옛 앱도 받을 일이 없다. 할인·무료 이용은 스토어 오퍼 코드로 준다.
  // 초대 코드 갈래(CODE_REQUIRED·CODE_TOO_LONG·CODE_EXPIRED·CODE_ALREADY_USED·CODE_ALREADY_REDEEMED_BY_YOU·
  // INVALID_FORMAT·INVALID_INVITE_PLAN·OWNS_ACTIVE_GROUP·SELF_ISSUED)는 2026-10-20 커플·가족 이용권과 함께 지웠다.
  // 마지막 CODE_NOT_FOUND(옛 앱의 코드 등록 호환)는 2026-10-26 그 라우트와 함께 지웠다 — 강제 업데이트(안드로이드 36·iOS 14)가
  // 그 화면이 있는 앱을 막았다.
  // 랜딩 이벤트 (event.ts) — 앱이 아니라 랜딩 페이지가 받는다(문구는 apps/landing 의 messages).
  'INVALID_BODY',
  'INVALID_ID',
  'PERSO_FAILED',
  'PERSO_NOT_CONFIGURED',
  'VOICE_NOT_AVAILABLE',
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
  // 목소리 등록 녹음에 말소리가 없다는 400. 보통은 그 사람의 녹음이라 다시 녹음하면 풀린다 — 그런데
  // 판정이 전사(ElevenLabs Scribe)의 글자 수라, **갑자기 늘면** 전사가 빈 글을 돌려주는 고장이고 그동안
  // **모든 등록이 막힌다**(전사가 아예 실패하면 막지 않고 통과시키지만, 빈 글은 '말소리 없음' 과 구별되지
  // 않는다). 그 고장은 사용자가 고칠 수 없어 경보로 올린다(`docs/spec/error-codes.md` §3).
  'VOICE_CLONE_NO_SPEECH',
  'TTS_GENERATION_FAILED',
  'PERSO_FAILED',
  // 결제 확정이 거절된 갈래. 2026-09-19 사고에서 우리는 증상(VOICE_FEATURE_REQUIRES_PAID_PLAN)만
  // 보고 원인은 한 줄도 못 봤다 — 거절이 구조화 로그에만 남아 있었다. 사용자는 이미 돈을 냈는데
  // 서버가 무료로 보는 상태이고, 고칠 수 있는 것은 우리뿐이다. (`SUBSCRIPTION_EXPIRED` 는 정상
  // 만료에서도 흔해 넣지 않는다.)
  'TRANSACTION_OWNED_BY_OTHER_USER',
  'TRANSACTION_ACCOUNT_MISMATCH',
  'CROSS_STORE_RENEWAL_ACTIVE',
  'APPLE_VERIFICATION_FAILED',
  // 애플 서버 알림의 범위 불일치. 이 둘은 **애플 서명을 통과한 뒤에만** 나온다 — 위조로는 만들 수 없고, App Store
  // Connect 의 알림 URL 이 잘못된 워커를 가리킨다는 뜻이다. 그동안 그 환경의 알림이 통째로 버려진다.
  'APPLE_NOTIFICATION_BUNDLE_MISMATCH',
  'APPLE_NOTIFICATION_ENVIRONMENT_MISMATCH',
  // ⚠ **이 400 은 그 기기의 사용 기록 큐를 영구히 막는다.** 두 앱 모두 2xx 가 아닌 배치를
  // 큐에서 지우지 않으므로(`UsageEventUploadWorker`·`UsageEventUploader`), 배치에 한 건이라도
  // 서버가 모르는 값이 섞이면 그 기기는 그 뒤로 **아무 기록도 올리지 못한다.** 오타가 아니라
  // 앱이 서버보다 앞서 나갔다는 신호이고(`usage-event.ts` — 새 종류는 서버를 먼저 올린다),
  // 고칠 수 있는 것은 우리뿐이라 로그가 아니라 경보로 올린다. `POLICY_VERSION_MISMATCH` 와
  // 같은 갈래다.
  'INVALID_USAGE_EVENTS',
];

/**
 * **사용자가 친 값의 예상된 거절.** 두 앱은 이 코드의 4xx 를 Sentry 이벤트로 올리지 않고 브레드크럼(category
 * `refusal`)으로 남긴다. 틀렸거나 지난 인증 코드, 이미 가입된 이메일, 옛 앱의 코드 등록에 친 코드 — 이유가 **사용자가
 * 친 값**이고, 화면이 코드로 고른 문장으로 그 이유를 이미 말한다. 우리가 고칠 코드가 없다
 * (`docs/spec/error-codes.md` §3 「앱도 같다」).
 *
 * 낮추는 조건은 셋이 다 맞을 때다 — 상태 400~499, 응답에 `error_code` 가 있다, 그 코드가 이 목록에 있다. 같은
 * 코드라도 5xx 면 그대로 이슈다.
 *
 * 두 앱은 TypeScript 를 가져다 쓸 수 없어 **같은 값을 손으로** 둔다(안드로이드 `EXPECTED_REFUSAL_CODES`, iOS
 * `expectedRefusalCodes`). 셋이 어긋나는 것은 `scripts/check-expected-refusal-codes.py`(CI lint)가 막는다 — 여기를
 * 고치면 두 앱도 같이 고친다.
 *
 * ⚠ `AUTH_EMAIL_CODE_ATTEMPTS_EXCEEDED`·`VOICE_MONTHLY_CHANGE_LIMIT_REACHED` 는 **넣지 않는다**(시끄럽게 둔다). 거기
 * 닿았다는 것은 화면이 사용자에게 시도를 다 태우게 뒀다는 뜻이다 — 고칠 것은 화면이고, 1.2.10 의 두 묶음(같은
 * 코드 다섯 번 제출, 낡은 등록 횟수)이 그렇게 이슈로 올라와 드러났다. 경보 목록(`ALERTING_ERROR_CODES`)과도 겹치지
 * 않는다 — 그쪽은 '우리가 고칠 것', 이쪽은 '사용자가 고칠 것' 이다.
 */
export const CLIENT_EXPECTED_REFUSAL_CODES: readonly ErrorCode[] = [
  // 이메일 인증 코드가 틀렸거나 지났다 — 맞는 숫자를 다시 치거나 새 코드를 받으면 풀린다.
  'AUTH_EMAIL_CODE_INVALID',
  'AUTH_EMAIL_CODE_EXPIRED',
  // 가입하려는 이메일이 이미 있다(이메일/비밀번호 계정 · 소셜 계정) — 화면이 로그인으로 안내한다.
  'AUTH_EMAIL_TAKEN',
  'AUTH_EMAIL_SOCIAL',
];
