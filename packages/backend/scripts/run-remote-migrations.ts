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

type MigrationResponse = { ran?: string[]; maxId?: number };

async function postMigration(url: string, headers: Record<string, string>): Promise<MigrationResponse> {
  let lastError = '';
  // 마이그레이션이 레이트리밋 창(60req/분/IP)보다 많아지면 429 가 정상적으로 발생한다
  // (migration 65개 시점에 실제 배포 실패 발생). retryAfter 만큼 기다렸다 재시도해
  // 배포가 마이그레이션 개수에 비례해 깨지지 않게 한다.
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const res = await fetch(url, { method: 'POST', headers });
    const text = await res.text();
    if (res.ok) {
      return text ? (JSON.parse(text) as MigrationResponse) : {};
    }
    lastError = `${res.status} ${text}`;
    if (res.status === 429 && attempt < 8) {
      let retryAfter = Number(res.headers.get('retry-after'));
      if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
        try {
          retryAfter = Number((JSON.parse(text) as { retryAfter?: number }).retryAfter);
        } catch {
          retryAfter = Number.NaN;
        }
      }
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter + 1 : 30;
      console.log(`rate limited (429); waiting ${waitSeconds}s before retrying...`);
      await new Promise((resolveRetry) => setTimeout(resolveRetry, waitSeconds * 1000));
      continue;
    }
    if (res.status < 500 || attempt === 8) break;
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 1000 * attempt));
  }
  throw new Error(`Migration request failed: ${lastError}`);
}

/**
 * 응답을 **현재 번들의 워커에서 받을 때까지** 재시도한다.
 *
 * wrangler 배포 직후에는 잠시 옛 번들이 응답할 수 있다. 그 워커는 자기가 모르는 id 를 조용히
 * 건너뛰고 빈 `ran` 을 돌려주는데, 그건 '이미 적용됨' 과 구분되지 않는다 — 배포는 초록불인데
 * 스키마만 옛날에 고착된다(2026-08-01 dev 에서 실제로 발생: 89~91 이 통째로 누락).
 *
 * **요청마다 확인해야 한다.** 전파 창은 요청 단위라, 프로브 한 번만 통과시키면 그 뒤 요청이
 * 다시 옛 워커로 갈 수 있다(로드밸런싱은 요청마다 독립이다). 그러면 같은 사고가 그대로
 * 재현되므로, 여기서 받은 응답은 전부 `maxId` 로 출처를 확인한다.
 */
async function postMigrationFromCurrentBundle(
  url: string,
  headers: Record<string, string>,
  expectedMaxId: number,
  failureContext: string,
): Promise<MigrationResponse> {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await postMigration(url, headers);
    const maxId = result.maxId;
    if (typeof maxId === 'number' && maxId >= expectedMaxId) {
      if (attempt > 1) console.log(`worker is up to date (maxId=${maxId}).`);
      return result;
    }
    if (typeof maxId !== 'number') {
      // maxId 를 안 내려주는 구버전 워커. 이 스크립트와 짝이 맞는 워커가 아직 안 떴다는 뜻이다.
      console.log(`worker does not report maxId yet (attempt ${attempt}/12); waiting...`);
    } else {
      console.log(`worker still on older bundle (maxId=${maxId} < ${expectedMaxId}); waiting...`);
    }
    await new Promise((resolveRetry) => setTimeout(resolveRetry, 5000));
  }
  throw new Error(
    `Deployed worker never reported knowing migration ${expectedMaxId} (${failureContext}). ` +
      'The deploy has not propagated (or the wrong worker is serving this URL) — ' +
      'the schema may be incomplete. Re-run this step after the deploy settles.',
  );
}

/**
 * 본 작업 **전에** 전파를 확인한다. `fromId=0&toId=0` 은 실행할 마이그레이션이 없는 무해한
 * 프로브라, 아직 안 뜬 배포를 상대로 마이그레이션을 하나도 돌리지 않은 채 시끄럽게 실패할 수
 * 있다(반쯤 돌다 실패하는 것보다 낫다). 루프 안의 요청별 확인을 대신하지는 않는다.
 */
async function awaitWorkerKnowsMigrations(
  baseUrl: string,
  headers: Record<string, string>,
  expectedMaxId: number,
): Promise<void> {
  await postMigrationFromCurrentBundle(
    `${baseUrl}/api/init-db?fromId=0&toId=0`,
    headers,
    expectedMaxId,
    'pre-flight probe; migrations were NOT run',
  );
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

  // /api/init-db 는 모든 환경에서 x-init-db-secret 헤더를 요구한다(index.ts canRunInitDb).
  // dev·production 모두 동일하게 INIT_DB_SECRET 을 보낸다 — 없으면 404 로 조용히 실패한다.
  const secret = process.env.INIT_DB_SECRET?.trim();
  if (!secret) {
    throw new Error(`INIT_DB_SECRET is required for ${envName} migrations.`);
  }
  const headers: Record<string, string> = { 'x-init-db-secret': secret };

  // 본 작업 전에 전파를 확인한다. 이게 없으면 '모르는 id 를 건너뛴 것' 이 '이미 적용됨' 으로
  // 보여서, 스키마가 안 바뀐 채 배포가 성공으로 끝난다.
  await awaitWorkerKnowsMigrations(baseUrl, headers, to);

  for (let id = from; id <= to; id += 1) {
    const url = `${baseUrl}/api/init-db?fromId=${id}&toId=${id}`;
    // 응답마다 출처를 확인한다 — 프로브가 통과했어도 이 요청이 옛 워커로 갈 수 있고, 그
    // 워커의 빈 ran 은 '이미 적용됨' 이 아니라 '모르는 id 를 건너뜀' 이다.
    const result = await postMigrationFromCurrentBundle(
      url,
      headers,
      to,
      `while running migration ${id}`,
    );
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
