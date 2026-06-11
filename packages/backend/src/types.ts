export interface Env {
  ELEVENLABS_API_KEY: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  APPLE_CLIENT_ID?: string;
  /**
   * App Store Connect 의 "Apple shared secret".
   * 현재 /billing/apple/confirm 은 이 secret 이 있어도 fail-closed 로 동작하며,
   * 후속 PR 에서 Apple App Store Server API v2 의 JWS 검증으로 entitlement 갱신을 열 예정.
   */
  APPLE_SHARED_SECRET?: string;
  GOOGLE_VERTEX_CREDENTIALS_JSON?: string;
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
  /** App Store Server API 자격 (Apple IAP 검증). 셋 다 있어야 활성화. */
  APPLE_ISSUER_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_IAP_PRIVATE_KEY?: string;
  /** iOS 번들 ID — App Store 트랜잭션의 bundleId 검증에 사용. */
  APPLE_BUNDLE_ID?: string;
  /** PortOne(구 아임포트) V2 API Secret — 국내 PG 결제 검증. */
  PORTONE_API_SECRET?: string;
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
}

export type AuthVariables = {
  /** JWT sub (= users.google_id). Legacy convention used by most route SQL. */
  userId: string;
  /** users.id PK. UUID for accounts created before sub-as-id, sub for new ones. Use for FK refs. */
  userIdPK: string;
  userEmail: string;
  userName: string;
  userPicture: string;
  sentry: SentryClient;
};

export type AppEnv = { Bindings: Env; Variables: AuthVariables };
