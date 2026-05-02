export interface Env {
  PERSO_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GOOGLE_CLIENT_ID: string;
  JWT_SECRET: string;
  PASSWORD_PEPPER: string;
  ENVIRONMENT: string;
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
