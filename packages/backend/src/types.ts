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
  /** App Store Server API 자격 (Apple IAP 검증). 셋 다 있어야 활성화. */
  APPLE_ISSUER_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_IAP_PRIVATE_KEY?: string;
  /** iOS 번들 ID — App Store 트랜잭션의 bundleId 검증에 사용. */
  APPLE_BUNDLE_ID?: string;
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
  /** JWT sub (= users.google_id). Legacy convention used by most route SQL. */
  userId: string;
  /** users.id PK. UUID for accounts created before sub-as-id, sub for new ones. Use for FK refs. */
  userIdPK: string;
  userEmail: string;
  userName: string;
  sentry: SentryClient;
};

export type AppEnv = { Bindings: Env; Variables: AuthVariables };
