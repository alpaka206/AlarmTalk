import type { Client } from '@libsql/client/web';

const TURSO_RETRY_DELAYS_MS = [150, 450] as const;

/**
 * Turso 의 HTTP 게이트웨이(Cloudflare 앞단)가 요청을 받기도 전에 실패하는 경우.
 *
 * ⚠ **일부러 좁게 잡는다** — SQL 오류·클라이언트 실수는 즉시 실패해야 한다.
 *
 * 무엇이 일시적인가:
 *  - `SERVER_ERROR: Server returned HTTP status 5xx` — 520·525(오리진 SSL 핸드셰이크)·502·503·504.
 *    2026-09-22 전에는 **520 만** 봤다. 실제 Sentry(BACKEND-3)의 525 는 `String(err)` 가
 *    `LibsqlError: SERVER_ERROR: …` 라 소문자 `libsql` 검사에 걸리지 않아 **한 번도 재시도되지
 *    않았고**, 인증 미들웨어의 users 조회가 그대로 503(`ACCOUNT_STATUS_UNVERIFIED`)으로 나갔다.
 *  - 전송 계층 실패(`HRANA_WEBSOCKET_ERROR`·`HRANA_CLOSED_ERROR`·`fetch failed`·ECONNRESET) —
 *    응답을 받기 전에 끊긴 것이라 읽기는 다시 보내도 안전하다.
 *
 * 무엇이 아닌가: 4xx(토큰·한도 — 다시 보내도 같다), SQLite 오류(`SQLITE_*` — 우리 SQL 이 틀린 것).
 */
export function isTransientTursoGatewayError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/HTTP status 5\d\d\b/i.test(message)) return true;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (code === 'HRANA_WEBSOCKET_ERROR' || code === 'HRANA_CLOSED_ERROR') return true;
  return /\bfetch failed\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

/** Turso 게이트웨이 실패만 정해진 백오프(150ms·450ms, 최대 3회)로 다시 시도한다. */
export async function retryTransientTurso<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = TURSO_RETRY_DELAYS_MS[attempt];
      if (!isTransientTursoGatewayError(error) || delay === undefined) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * `execute` 의 문장이 읽기인가 — 다시 보내도 부작용이 없는 것만 재시도한다.
 *
 * 읽기로 보는 형태(코덱스 #795): `SELECT`·`EXPLAIN` / **읽기 `PRAGMA`**(`PRAGMA table_info(...)`
 * 같은 조회 — `=` 로 값을 정하는 `PRAGMA foreign_keys=off` 는 쓰기라 뺀다) / **CTE**(`WITH … SELECT`
 * — SQLite 는 `WITH … INSERT/UPDATE/DELETE` 도 허용하므로 본문에 DML 동사가 없을 때만).
 * 모르는 형태는 쓰기로 본다 — 틀려도 재시도를 안 하는 쪽이다.
 */
export function isReadStatement(statement: unknown): boolean {
  const sql =
    typeof statement === 'string'
      ? statement
      : typeof statement === 'object' && statement !== null && 'sql' in statement
        ? String((statement as { sql: unknown }).sql)
        : '';
  if (/^\s*(?:SELECT|EXPLAIN)\b/i.test(sql)) return true;
  if (/^\s*PRAGMA\b/i.test(sql)) return !/=/.test(sql);
  if (/^\s*WITH\b/i.test(sql)) {
    return !/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(stripStringLiterals(sql));
  }
  return false;
}

/** 문자열 리터럴 속의 낱말이 DML 로 읽히지 않게 지운다(`'delete me'` 같은 값). */
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * **읽기만** 게이트웨이 실패에서 다시 시도하는 클라이언트로 감싼다.
 *
 * 쓰기는 감싸지 않는다 — 애매한 HTTP 실패 뒤에 쓰기를 다시 보내면 부작용이 두 번 날 수 있다
 * (INSERT 중복 등). 실패한 쓰기는 호출부가 자기 규약대로 처리한다(cron 은 다음 틱에 재개,
 * 요청은 500 → 앱이 재시도).
 *
 * 2026-09-22 전에는 이 감싸기가 **cron 진입점에만** 있었다. HTTP 요청 경로의 `getDB` 는 맨
 * 클라이언트라, 인증 미들웨어의 users 한 줄 조회가 게이트웨이 한 번의 딸꾹질에 그대로 503 이
 * 됐다(Sentry BACKEND-8 의 `ACCOUNT_STATUS_UNVERIFIED`). 이제 `getDB` 가 이걸 두른다 —
 * `batch`·`transaction` 은 그대로 통과한다(쓰기가 섞일 수 있다).
 */
export function withTransientReadRetry(client: Client): Client {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'execute') {
        return (...args: unknown[]) => {
          const execute = () => Reflect.apply(target.execute, target, args);
          return isReadStatement(args[0]) ? retryTransientTurso(execute) : execute();
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
