import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SECRET_KEYS, selectWorkerSecrets } from './worker-secret-keys.ts';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, '..');

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
    // ⚠ 이 파서는 **줄 단위**라 여러 줄 값을 담을 수 없다. PEM 을 그대로 붙여넣으면
    // 첫 줄만 올라가는데, 업로드는 성공하고 런타임에서만 조용히 실패한다.
    // 한 줄에 `\n` 이스케이프로 넣어야 한다 — 실수를 여기서 잡는다.
    if (value.includes('BEGIN ') && !value.includes('END ')) {
      throw new Error(
        `${key}: PEM 이 잘렸다(첫 줄만 들어옴). 한 줄에 \\n 이스케이프로 넣을 것.`,
      );
    }
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

  // 키 목록과 dev 전용 키 거절은 `worker-secret-keys.ts` 한 곳이다(테스트가 잠근다).
  const secrets = selectWorkerSecrets(args.envName, values);

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
