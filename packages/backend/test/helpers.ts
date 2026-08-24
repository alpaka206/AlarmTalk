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

/** 결과 큐 항목 — 성공 결과이거나, 그 자리에서 던질 오류(pushError). */
type MockQueueEntry = MockExecuteResult | { error: Error };

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
  const results: MockQueueEntry[] = [];
  const transactions = {
    commits: 0,
    rollbacks: 0,
    closes: 0,
  };

  function pushResult(rows: MockRow[] = [], rowsAffected = 0) {
    results.push({ rows, rowsAffected });
  }

  /**
   * **SQL 조각으로 짝지어 주는 결과** — FIFO 큐를 건너뛴다.
   *
   * 큐는 호출 **순서**에 묶여 있어서, 검사하려는 쿼리가 흐름 깊숙이 있으면 그 앞의
   * 모든 쿼리에 자리채움을 밀어 넣어야 하고 구현이 조금만 바뀌어도 깨진다. 그런 자리는
   * "몇 번째"가 아니라 "어떤 쿼리"로 짝지어야 읽을 수 있다.
   * 한 번 쓰면 소비된다 — 같은 SQL 이 여러 번 오면 그만큼 등록한다.
   */
  const matchers: { fragment: string; entry: MockQueueEntry }[] = [];
  function pushResultFor(fragment: string, rows: MockRow[] = [], rowsAffected = 0) {
    matchers.push({ fragment, entry: { rows, rowsAffected } });
  }
  function pushErrorFor(fragment: string, error: Error) {
    matchers.push({ fragment, entry: { error } });
  }
  function takeMatched(sql: string): MockQueueEntry | null {
    const i = matchers.findIndex((m) => sql.includes(m.fragment));
    if (i === -1) return null;
    return matchers.splice(i, 1)[0]!.entry;
  }

  /**
   * 다음 execute 를 성공 대신 이 오류로 실패시킨다 — 결과 큐와 같은 FIFO 자리를 차지한다.
   * 구 스키마 폴백('no such column' 을 잡아 다른 SQL 로 재시도)처럼, 실패해야만 도달하는
   * 분기를 검증하기 위한 것.
   */
  function pushError(error: Error) {
    results.push({ error });
  }

  /** 큐에서 하나 꺼낸다 — 오류 항목이면 execute 가 실패한 것처럼 던진다. */
  function takeNext(): MockExecuteResult {
    const next = results.shift();
    if (!next) return { rows: [], rowsAffected: 0 };
    if ('error' in next) throw next.error;
    return next;
  }

  function reset() {
    calls.length = 0;
    results.length = 0;
    transactions.commits = 0;
    transactions.rollbacks = 0;
    transactions.closes = 0;
    consentResultsAllowMissing = false;
    matchers.length = 0;
  }

  function clearResults() {
    results.length = 0;
    matchers.length = 0;
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
      // SQL 로 짝지어 둔 결과가 있으면 큐보다 먼저 쓴다(순서 의존 제거).
      const matched = takeMatched(query.sql);
      if (matched) {
        calls.push({ sql: query.sql, args: query.args });
        if ('error' in matched) throw matched.error;
        return matched;
      }
      // user_consents 조회 처리:
      //  - 기본(consentResultsAllowMissing=false): 큐 소비/ calls 기록 없이 모든 필수
      //    동의를 '동의함'으로 합성해 돌려준다. 기존 라우트 테스트의 push 순서·calls[N]
      //    인덱스 단언을 보존하기 위한 부수 쿼리 격리.
      //  - missing 모드(true): 동의 상태를 테스트가 직접 제어하도록 큐에서 결과를
      //    꺼내 반환한다(동의 미충족/부분 동의 시나리오 검증용). calls 에는 기록한다.
      if (/FROM user_consents/i.test(query.sql)) {
        if (consentResultsAllowMissing) {
          calls.push({ sql: query.sql, args: query.args });
          return takeNext();
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
      // 배포 직후 #104 전후 호환 판정. 실제 구 스키마는 별도 real-libSQL 테스트로 고정하고,
      // 일반 route mock 은 최신 스키마를 기본으로 해 기존 FIFO 결과를 소비하지 않는다.
      if (/PRAGMA table_info\('alarms'\)/i.test(query.sql)) {
        calls.push({ sql: query.sql, args: query.args });
        return { rows: [{ name: 'delivery_version' }], rowsAffected: 0 };
      }
      calls.push({ sql: query.sql, args: query.args });
      return takeNext();
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

  return {
    client,
    calls,
    pushResult,
    pushResultFor,
    pushErrorFor,
    pushError,
    reset,
    clearResults,
    transactions,
    setConsentMissing,
  };
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
