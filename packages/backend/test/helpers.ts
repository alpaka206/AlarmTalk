import type { AppEnv } from '../src/types';
import type { Context, Next } from 'hono';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

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
    consentResultsAllowMissing = false;
  }

  function clearResults() {
    results.length = 0;
  }

  // 동의 게이트(B4)용 기본 응답. needsConsent / consentMiddleware 가 user_consents 를
  // 조회하는데, 기존 라우트 단위 테스트들은 이 부수 쿼리를 위해 결과를 push 하지 않는다.
  // 결과 큐를 소비하지 않고(=기존 push 순서/인덱스 보존), 모든 필수 동의를 '동의함'으로
  // 합성해 돌려준다. 동의 미충족 시나리오를 검증하려면 consentResultsAllowMissing 를
  // false 로 두고 직접 user_consents 결과를 push 하면 된다.
  let consentResultsAllowMissing = false;
  const CONSENT_TYPES_FOR_MOCK = [
    'terms',
    'privacy',
    'age14',
    'voice_biometric',
    'overseas_transfer',
  ];
  function setConsentMissing(missing: boolean) {
    consentResultsAllowMissing = missing;
  }

  const client = {
    execute: async (query: { sql: string; args: (string | number | null)[] }) => {
      // user_consents 조회 처리:
      //  - 기본(consentResultsAllowMissing=false): 큐 소비/ calls 기록 없이 모든 필수
      //    동의를 '동의함'으로 합성해 돌려준다. 기존 라우트 테스트의 push 순서·calls[N]
      //    인덱스 단언을 보존하기 위한 부수 쿼리 격리.
      //  - missing 모드(true): 동의 상태를 테스트가 직접 제어하도록 큐에서 결과를
      //    꺼내 반환한다(동의 미충족/부분 동의 시나리오 검증용). calls 에는 기록한다.
      if (/FROM user_consents/i.test(query.sql)) {
        if (consentResultsAllowMissing) {
          calls.push({ sql: query.sql, args: query.args });
          return results.shift() ?? { rows: [], rowsAffected: 0 };
        }
        return {
          rows: CONSENT_TYPES_FOR_MOCK.map((t) => ({
            consent_type: t,
            policy_version: CURRENT_POLICY_VERSION,
            agreed: 1,
          })),
          rowsAffected: 0,
        };
      }
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

  return { client, calls, pushResult, reset, clearResults, transactions, setConsentMissing };
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
