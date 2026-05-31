import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, '..');

const DEFAULT_BASE_URLS = {
  dev: 'https://api-dev.alarm-talk.com',
  production: 'https://api.alarm-talk.com',
} as const;

type EnvName = keyof typeof DEFAULT_BASE_URLS;

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function parseEnvName(): EnvName {
  const value = argValue('--env') ?? process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (value === 'dev' || value === 'production') return value;
  throw new Error('Usage: run-remote-migrations.ts --env <dev|production>');
}

function migrationMaxId(): number {
  const text = readFileSync(resolve(BACKEND_DIR, 'src/lib/migrations.ts'), 'utf8');
  const ids = [...text.matchAll(/^\s*id:\s*(\d+),/gm)].map((match) => Number(match[1]));
  if (ids.length === 0) {
    throw new Error('No migration ids found in src/lib/migrations.ts');
  }
  return Math.max(...ids);
}

function parseNumberArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function postMigration(url: string, headers: Record<string, string>): Promise<{ ran?: string[] }> {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(url, { method: 'POST', headers });
    const text = await res.text();
    if (res.ok) {
      return text ? (JSON.parse(text) as { ran?: string[] }) : {};
    }
    lastError = `${res.status} ${text}`;
    if (res.status < 500 || attempt === 3) break;
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 1000 * attempt));
  }
  throw new Error(`Migration request failed: ${lastError}`);
}

async function assertHealth(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/health`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Health check failed: ${res.status} ${text}`);
  }
  const json = JSON.parse(text) as { db?: string; status?: string };
  if (json.db !== 'ok') {
    throw new Error(`Health check DB is not ok: ${text}`);
  }
}

async function main(): Promise<void> {
  const envName = parseEnvName();
  const baseUrl = (argValue('--base-url') ?? DEFAULT_BASE_URLS[envName]).replace(/\/+$/, '');
  const from = parseNumberArg('--from', 1);
  const to = parseNumberArg('--to', migrationMaxId());
  if (from > to) {
    throw new Error('--from must be less than or equal to --to');
  }

  const headers: Record<string, string> = {};
  if (envName === 'production') {
    const secret = process.env.INIT_DB_SECRET?.trim();
    if (!secret) {
      throw new Error('INIT_DB_SECRET is required for production migrations.');
    }
    headers['x-init-db-secret'] = secret;
  }

  for (let id = from; id <= to; id += 1) {
    const url = `${baseUrl}/api/init-db?fromId=${id}&toId=${id}`;
    const result = await postMigration(url, headers);
    const ran = result.ran?.join(', ') || 'already applied';
    console.log(`${envName} migration ${id}/${to}: ${ran}`);
  }

  await assertHealth(baseUrl);
  console.log(`${envName} migrations complete.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
