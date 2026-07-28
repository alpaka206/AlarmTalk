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

/**
 * `?` 개수와 args 길이가 어긋난 쿼리를 테스트에서 즉시 잡는다.
 *
 * libSQL 은 이런 문을 실행 전에 거절하므로, 라우트가 통째로 죽는다(500). 실제로
 * Apple 로그인 조건을 걷어내면서 `WHERE google_id = ? OR id = ?` 로 줄인 뒤 args 의
 * 세 번째 값을 안 지운 곳이 세 군데 있었고(fcm.getTokensForUser · DELETE /user/me ·
 * purgeUserAccount 고아 가드), 타입 검사로는 걸리지 않았다.
 *
 * 실행 시점의 sql 은 IN 절 생성기까지 전개된 최종 문자열이라 `?` 를 그대로 세면 된다.
 */
function assertBindingCount(query: { sql: string; args: unknown[] }) {
  if (!Array.isArray(query.args)) return;
  const placeholders = (query.sql.match(/\?/g) ?? []).length;
  if (placeholders !== query.args.length) {
    throw new Error(
      `SQL 바인딩 개수 불일치: placeholders=${placeholders} args=${query.args.length} — ${query.sql}`,
    );
  }
}

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
      assertBindingCount(query);
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
      // F1 전역 클론 슬롯 카운트 쿼리(evictLruClonesIfOverCap): 클론 등록 경로에 새로 추가된
      // 부수 쿼리라 기존 테스트의 FIFO 결과 순서를 어긋나게 한다. user_consents 와 동일하게
      // 큐를 소비하지 않고 기본 count=0(상한 미달 → eviction 없음)을 돌려준다. 실제 eviction
      // 동작은 실기기 QA 로 검증한다(이 쿼리는 'AS n' 라벨이 유일 식별자).
      if (/SELECT COUNT\(\*\) AS n FROM voice_profiles/i.test(query.sql)) {
        return { rows: [{ n: 0 }], rowsAffected: 0 };
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

/**
 * 실제 authMiddleware 가 심는 세 식별자를 모두 채운다.
 *
 * userIdPK/userLoginId 를 비워 두면 라우트가 `c.get('userIdPK') || c.get('userId')` 폴백을
 * 타면서 늘 한 값으로 붕괴해, 이중 식별자 매칭이 깨져도 테스트가 초록으로 통과한다.
 *
 * loginId 를 따로 주면 '구 토큰(sub=google_id)으로 들어온 사용자' 상황을 재현할 수 있다.
 * 기본값은 셋 다 같은 값 — 실제로도 기존 계정은 users.id 와 google_id 가 같다.
 */
export function fakeAuthMiddleware(
  userId = 'user-1',
  email = 'user@test.com',
  loginId = userId,
) {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set('userId', userId);
    c.set('userIdPK', userId);
    c.set('userLoginId', loginId);
    c.set('userEmail', email);
    c.set('userName', 'Test User');
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
};
