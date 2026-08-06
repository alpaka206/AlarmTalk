import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, '..');

const WORKER_SECRET_KEYS = [
  'ELEVENLABS_API_KEY',
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
  // 백엔드가 읽는데 sync 목록에서 빠져 있어 추가. 빈 값은 위 루프(115행)에서 자동 skip.
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
] as const;

const REQUIRED_SECRET_KEYS = [
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'GOOGLE_CLIENT_ID',
  'JWT_SECRET',
  'PASSWORD_PEPPER',
] as const;

function parseArgs(argv: string[]): { envName: 'dev' | 'production'; envFile: string } {
  let envName: string | undefined;
  let envFile: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--env') {
      envName = argv[++i];
    } else if (arg.startsWith('--env=')) {
      envName = arg.slice('--env='.length);
    } else if (arg === '--env-file') {
      envFile = argv[++i];
    } else if (arg.startsWith('--env-file=')) {
      envFile = arg.slice('--env-file='.length);
    } else if (!envName) {
      envName = arg;
    } else if (!envFile) {
      envFile = arg;
    }
  }

  if (envName !== 'dev' && envName !== 'production') {
    throw new Error('Usage: sync-worker-secrets.ts --env <dev|production> --env-file <path>');
  }

  return {
    envName,
    envFile: resolve(BACKEND_DIR, envFile ?? (envName === 'production' ? '.dev.vars.prod' : '.dev.vars.dev')),
  };
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    throw new Error(`Env file not found: ${path}`);
  }

  const values: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = stripQuotes(line.slice(eq + 1));
    values[key] = value;
  }
  return values;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const values = loadEnvFile(args.envFile);

  const missingRequired = REQUIRED_SECRET_KEYS.filter((key) => !values[key]?.trim());
  if (missingRequired.length > 0) {
    throw new Error(`Missing required secrets in ${args.envFile}: ${missingRequired.join(', ')}`);
  }

  const cloudflareApiToken = values.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
  const cloudflareAccountId = values.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!cloudflareApiToken || !cloudflareAccountId) {
    throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.');
  }

  const secrets: Record<string, string> = {};
  for (const key of WORKER_SECRET_KEYS) {
    const value = values[key];
    if (value?.trim()) secrets[key] = value;
  }

  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', `npx wrangler secret bulk --env ${args.envName}`]
      : ['wrangler', 'secret', 'bulk', '--env', args.envName];
  const result = spawnSync(command, commandArgs, {
    cwd: BACKEND_DIR,
    input: JSON.stringify(secrets),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: cloudflareApiToken,
      CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log(`Synced ${Object.keys(secrets).length} secrets to ${args.envName}.`);
}

main();
