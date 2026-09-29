/**
 * `sync-worker-secrets.ts` 가 워커에 올리는 키 목록과 고르는 규칙.
 *
 * 스크립트 본문은 실행하면 곧바로 `wrangler secret bulk` 를 부르므로 테스트가 가져다 쓸 수
 * 없다 — 그래서 **고르는 규칙만** 여기 따로 둔다(`test/personal-promo.test.ts` 가 잠근다).
 */

export const WORKER_SECRET_KEYS = [
  'ELEVENLABS_API_KEY',
  // 합성 모델 id — 비워 둔다(= eleven_v3). 바꾸려면 재렌더 계획이 먼저다(`lib/voice-provider.ts` 의 `ttsModelId`).
  'ELEVENLABS_TTS_MODEL_ID',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_VERTEX_CREDENTIALS_JSON',
  'GOOGLE_VERTEX_LOCATION',
  'GOOGLE_VERTEX_MODEL',
  'RESEND_API_KEY',
  'AUTH_EMAIL_FROM',
  'AUTH_EMAIL_REPLY_TO',
  'JWT_SECRET',
  'PASSWORD_PEPPER',
  'INIT_DB_SECRET',
  'SENTRY_DSN',
  'FIREBASE_PROJECT_ID',
  // 푸시(FCM) 서비스계정 + 결제(Google Play) + 공휴일(KR).
  // 백엔드가 읽는데 sync 목록에서 빠져 있어 추가. 빈 값은 자동 skip.
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON',
  'ANDROID_PACKAGE_NAME',
  'GOOGLE_RTDN_VERIFICATION_TOKEN',
  'ADMIN_SECRET',
  'KASI_SERVICE_KEY',
  // Apple — **세 갈래이고 키가 서로 다르다.** 빈 값은 자동 skip.
  //  1) 로그인 검증: APPLE_BUNDLE_ID 하나(애플 공개키 JWKS 검증이라 비밀키 불필요)
  //  2) 탈퇴 시 연결 해제: APPLE_TEAM_ID + APPLE_SIGNIN_* (Sign in with Apple 키)
  //  3) 결제 검증: APPLE_ISSUER_ID + APPLE_KEY_ID + APPLE_PRIVATE_KEY
  //     (App Store Server API 키 — 2)와 **다른 키**다. 한 이름에 몰면 결제가 죽는다.)
  'APPLE_BUNDLE_ID',
  'APPLE_TEAM_ID',
  'APPLE_SIGNIN_KEY_ID',
  'APPLE_SIGNIN_PRIVATE_KEY',
  'APPLE_ISSUER_ID',
  'APPLE_KEY_ID',
  'APPLE_PRIVATE_KEY',
  //  4) 푸시(APNs): APNS_KEY_ID + APNS_PRIVATE_KEY (+ APPLE_TEAM_ID 재사용)
  'APNS_KEY_ID',
  'APNS_PRIVATE_KEY',
  // Perso(랜딩 이벤트 메시지 클립). 비어 있으면 그 라우트만 503.
  'PERSO_API_KEY',
  // 기간 한정 개인 플랜의 **시작 스위치**(ISO 8601, 시간대 포함). 없으면 프로모는 꺼져 있다.
  // `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」.
  'PERSONAL_PROMO_STARTS_AT',
] as const;

/**
 * **dev 에만 올리는 키.** production 파일에 값이 있으면 동기화 자체를 거절한다.
 *
 * - `PERSONAL_PROMO_ENDS_AT` — 기간 한정 개인 플랜의 **리허설용 끝**. 제품의 끝은
 *   `@alarmtalk/shared` 의 `PERSONAL_PROMO.endsAt` 하나다. 운영에 리허설 값이 올라가면
 *   프로모가 조용히 조기 종료·연장된다(워커도 production 에서는 이 값을 읽지 않는다 —
 *   `lib/personal-promo.ts` — 이중 잠금이다).
 */
export const DEV_ONLY_SECRET_KEYS = ['PERSONAL_PROMO_ENDS_AT'] as const;

export const REQUIRED_SECRET_KEYS = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'JWT_SECRET',
  'PASSWORD_PEPPER',
] as const;

export type WorkerEnvName = 'dev' | 'production';

/**
 * 파일에서 읽은 값 중 이 환경에 올릴 것만 고른다. 빈 값은 건너뛴다(올리지도 지우지도 않는다 —
 * 이미 올라간 값을 지우려면 `wrangler secret delete` 를 써야 한다).
 * @throws production 인데 dev 전용 키에 값이 있으면.
 */
export function selectWorkerSecrets(
  envName: WorkerEnvName,
  values: Record<string, string | undefined>,
): Record<string, string> {
  if (envName === 'production') {
    const leaked = DEV_ONLY_SECRET_KEYS.filter((key) => values[key]?.trim());
    if (leaked.length > 0) {
      throw new Error(
        `${leaked.join(', ')}: dev 전용 키다 — production 에 올리지 않는다(파일에서 지울 것).`,
      );
    }
  }
  const keys: readonly string[] =
    envName === 'production'
      ? WORKER_SECRET_KEYS
      : [...WORKER_SECRET_KEYS, ...DEV_ONLY_SECRET_KEYS];
  const secrets: Record<string, string> = {};
  for (const key of keys) {
    const value = values[key];
    if (value?.trim()) secrets[key] = value;
  }
  return secrets;
}
