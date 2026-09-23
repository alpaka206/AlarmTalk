import { createClient, type Client } from '@libsql/client/web';
import type { Env } from '../types';
import { runMigrations } from './migrations';
import { withTransientReadRetry } from './turso-retry';

let client: Client | null = null;

/**
 * 프로세스에 하나인 Turso 클라이언트. **읽기는 게이트웨이 실패에서 다시 시도한다**
 * (`withTransientReadRetry` — 왜 읽기만인지는 그 주석). HTTP 요청·cron 이 같은 것을 쓴다.
 */
export function getDB(env: Env): Client {
  if (!client) {
    client = withTransientReadRetry(
      createClient({
        url: env.TURSO_DATABASE_URL,
        authToken: env.TURSO_AUTH_TOKEN,
      }),
    );
  }
  return client;
}

export async function initDB(env: Env) {
  const db = getDB(env);
  await runMigrations(db);
}
