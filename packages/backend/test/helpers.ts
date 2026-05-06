import type { AppEnv } from '../src/types';
import type { Context, Next } from 'hono';

export interface MockRow {
  [key: string]: string | number | null;
}

export interface MockExecuteResult {
  rows: MockRow[];
  rowsAffected: number;
}

export type ExecuteCall = { sql: string; args: (string | number | null)[] };

export function createMockDB() {
  const calls: ExecuteCall[] = [];
  const results: MockExecuteResult[] = [];
  const transactions = {
    commits: 0,
    rollbacks: 0,
    closes: 0,
  };

  function pushResult(rows: MockRow[] = [], rowsAffected = 0) {
    results.push({ rows, rowsAffected });
  }

  function reset() {
    calls.length = 0;
    results.length = 0;
    transactions.commits = 0;
    transactions.rollbacks = 0;
    transactions.closes = 0;
  }

  function clearResults() {
    results.length = 0;
  }

  const client = {
    execute: async (query: { sql: string; args: (string | number | null)[] }) => {
      calls.push({ sql: query.sql, args: query.args });
      return results.shift() ?? { rows: [], rowsAffected: 0 };
    },
    batch: async () => {},
    transaction: async () => {
      const tx = {
        closed: false,
        execute: async (query: { sql: string; args: (string | number | null)[] }) => {
          return client.execute(query);
        },
        batch: async () => {},
        executeMultiple: async () => {},
        commit: async () => {
          transactions.commits++;
          tx.closed = true;
        },
        rollback: async () => {
          transactions.rollbacks++;
          tx.closed = true;
        },
        close: () => {
          transactions.closes++;
          tx.closed = true;
        },
      };
      return tx;
    },
  };

  return { client, calls, pushResult, reset, clearResults, transactions };
}

export function fakeAuthMiddleware(userId = 'user-1', email = 'user@test.com') {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set('userId', userId);
    c.set('userEmail', email);
    c.set('userName', 'Test User');
    c.set('userPicture', '');
    await next();
  };
}

export function jsonReq(method: string, path: string, body?: Record<string, unknown>) {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

export const ID = {
  alarm: '00000000-0000-4000-8000-000000000001',
  alarm404: '00000000-0000-4000-8000-0000000000ff',
  message: '10000000-0000-4000-8000-000000000001',
  messageBad: '10000000-0000-4000-8000-0000000000ff',
  friendship: '20000000-0000-4000-8000-000000000001',
  friendship404: '20000000-0000-4000-8000-0000000000ff',
  gift: '30000000-0000-4000-8000-000000000001',
  gift404: '30000000-0000-4000-8000-0000000000ff',
};
