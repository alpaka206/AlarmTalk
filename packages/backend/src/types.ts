export interface Env {
  ELEVENLABS_API_KEY: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  /**
   * Sign in with Apple 검증용 **앱 번들 ID**. 네이티브 앱이 보내는 identity token 의
   * `aud` 가 이 값이다. 미설정 시 POST /auth/apple 이 500 으로 fail-closed 된다 —
   * aud 를 안 보면 다른 앱용으로 발급된 유효 토큰도 통과하기 때문이다.
   * (예: `com.voicealarm.nativeapp.ios`)
   *
   * ⚠ 이건 `.p8` 개인키가 **아니다.** 네이티브 로그인 플로우는 공개키(JWKS) 검증만
   * 하므로 비밀키가 필요 없다. `.p8` 은 웹/서버 대 서버 플로우에서만 쓴다.
   */
  APPLE_BUNDLE_ID?: string;
  /**
   * Apple Developer **Team ID**(10자). 로그인 client_secret 의 `iss`.
   * 결제(App Store Server API)가 쓰는 `APPLE_ISSUER_ID` 와 **다른 값**이다.
   */
  APPLE_TEAM_ID?: string;
  /**
   * **Sign in with Apple** 키의 Key ID.
   *
   * ⚠ `APPLE_KEY_ID` 에 넣지 말 것 — 그건 App Store Server API(결제 검증)의 *다른 키*라,
   * 같은 이름에 넣으면 애플 결제 검증이 통째로 죽는다.
   */
  APPLE_SIGNIN_KEY_ID?: string;
  /**
   * **Sign in with Apple** 키의 `.p8` **내용**(PEM 전문).
   *
   * ⚠ 파일 **경로가 아니다.** Cloudflare Workers 에는 파일시스템이 없어 경로를 넣으면
   * 런타임에 아무것도 읽지 못한다.
   * ⚠ 결제용 `APPLE_PRIVATE_KEY` 와 **다른 키**다(위와 같은 이유로 이름을 갈랐다).
   */
  APPLE_SIGNIN_PRIVATE_KEY?: string;
  /** App Store Connect Issuer ID (UUID). 미설정 시 Apple 결제 503. */
  APPLE_ISSUER_ID?: string;
  /** App Store Server API 키의 Key ID. */
  APPLE_KEY_ID?: string;
  /** App Store Server API 개인키(.p8 PEM 전체). 결제 검증 **전용** — 로그인과 무관하다. */
  APPLE_PRIVATE_KEY?: string;
  GOOGLE_VERTEX_CREDENTIALS_JSON?: string;
  GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED?: string;
  GOOGLE_VERTEX_LOCATION?: string;
  GOOGLE_VERTEX_MODEL?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_REPLY_TO?: string;
  /** FCM HTTP v1 푸시용 Firebase 프로젝트 ID. 미설정 시 푸시는 MOCK 로그만 남긴다. */
  FIREBASE_PROJECT_ID?: string;
  /** Firebase 서비스 계정 JSON 전체 (client_email/private_key 포함). */
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  /** Play Developer API 결제 검증용 서비스 계정 JSON. 미설정 시 Google 결제 503. */
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  /** Android 앱 패키지명 (Play 구독 검증 대상). */
  ANDROID_PACKAGE_NAME?: string;
  /**
   * RTDN(실시간 개발자 알림) Pub/Sub push 엔드포인트 검증용 비밀 토큰.
   * Play Console→Pub/Sub→`POST /api/billing/google/rtdn?token=<이 값>` 으로 들어오며,
   * 쿼리 token 이 이 값과 일치할 때만 처리한다. 미설정 시 RTDN 503.
   */
  GOOGLE_RTDN_VERIFICATION_TOKEN?: string;
  /** 관리자 콘솔(/admin) 보호용 시크릿(HTTP Basic 비밀번호). 미설정 시 /admin 은 503. */
  ADMIN_SECRET?: string;
  /**
   * data.go.kr KASI 특일정보 OpenAPI 서비스키 (getRestDeInfo). KR 공휴일의 대체/임시공휴일
   * 보정용 오버레이에 쓴다. 미설정 시 KR 오버레이를 생략하고 date-holidays 결과만 제공한다.
   * 주의: data.go.kr 는 Encoding/Decoding 두 키를 발급한다 — **Decoding(디코딩) 키**를 넣어라.
   * (URLSearchParams 로 한 번만 인코딩하므로 인코딩 키를 넣으면 이중 인코딩되어
   *  SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 난다.)
   */
  KASI_SERVICE_KEY?: string;
  JWT_SECRET: string;
  PASSWORD_PEPPER: string;
  ENVIRONMENT: string;
  INIT_DB_SECRET?: string;
  BILLING_STUB_ENABLED?: string;
  TEST_CODE_ISSUER_EMAILS?: string;
  SENTRY_DSN?: string;
  VOICE_BUCKET?: R2Bucket;
}

export interface SentryClient {
  captureException(exception: unknown): string;
  /**
   * toucan-js 의 Toucan 은 @sentry/core 의 Scope 를 상속해 setTag/setTags 를 제공한다.
   * 관리자가 Sentry 대시보드에서 에러를 필터·식별할 수 있도록 route/method/uid 같은
   * 위치 태그를 붙일 때 쓴다. 테스트 목 등 일부 구현체는 captureException 만 가지므로
   * optional 로 두고, 호출부(logger.ts)에서 옵셔널 체이닝으로 안전하게 호출한다.
   */
  setTag?(key: string, value: string | number | boolean | null | undefined): void;
  setTags?(tags: Record<string, string | number | boolean | null | undefined>): void;
}

export type AuthVariables = {
  /**
   * users.id (PK). 미들웨어가 JWT sub 을 DB 에서 해석해 항상 이 값으로 정규화한다.
   * 배포 전에 발급돼 sub 이 google_id 인 구(舊) 토큰도 여기서는 users.id 가 된다.
   */
  userId: string;
  /** users.id PK. userId 와 같은 값 — FK 참조를 명시하고 싶은 곳에서 쓴다. */
  userIdPK: string;
  /**
   * 토큰이 실제로 담고 있던 로그인 식별자(raw JWT sub). 구 토큰이면 google_id 다.
   * 과거에 user_id 컬럼에 로그인 식별자가 저장된 행(알람·목소리 등)을 함께 매칭해야 하는
   * 곳에서만 쓴다. 소유권 판정의 기준은 userId(=users.id) 이고, 이 값은 보조 매칭용이다.
   */
  userLoginId: string;
  userEmail: string;
  userName: string;
  sentry: SentryClient;
};

export type AppEnv = { Bindings: Env; Variables: AuthVariables };
