import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { LibsqlError } from '@libsql/client/web';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import pushRoutes from '../src/routes/push';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/push', pushRoutes);
  // 운영의 `app.onError`(`src/index.ts`)처럼 던져진 예외를 500 으로 싣는다 — 라우트가 실패를
  // 삼키지 않고 **던졌다**는 것을 상태코드로 본다(Hono 기본 처리기는 같은 500 에 스택을 찍는다).
  app.onError((_err, c) => c.json({ error: 'Internal server error', error_code: 'INTERNAL_ERROR' }, 500));
  return app;
}

/** `db.batch(문장들, 모드)` 호출 기록 — 목의 시그니처에는 모드가 없어 여기서 모양을 준다. */
type BatchCall = [Array<{ sql: string; args: unknown[] }>, string | undefined];
function batchCallsOf(spy: { mock: { calls: unknown[][] } }): BatchCall[] {
  return spy.mock.calls as unknown as BatchCall[];
}

/** 운영에서 실제로 오는 모양 — `@libsql/client` 의 `mapHranaError` 가 만든다(`SERVER_ERROR: …`). */
function gatewayError(status: number): LibsqlError {
  return new LibsqlError(`Server returned HTTP status ${status}`, 'SERVER_ERROR');
}

/**
 * 재시도 대기(150·450ms)를 가짜 시계로 넘기며 응답을 기다린다.
 * 요청 본문을 읽는 동안에는 아직 타이머가 없을 수 있어, 한 번에 다 돌리지 않고 끝날 때까지 민다.
 */
async function withRetryDelaysSkipped<T>(run: () => T | Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = Promise.resolve(run());
    let settled = false;
    pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let turn = 0; turn < 50 && !settled; turn += 1) await vi.advanceTimersByTimeAsync(1_000);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

function registerRequest() {
  return jsonReq('POST', '/push/register', { token: 'fcm-token-abc', platform: 'android' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /push/register — FCM 토큰 등록', () => {
  beforeEach(() => mockDB.reset());

  it('유효 토큰+플랫폼 → success, 원자적 쓰기 batch 하나로 DELETE+UPSERT 재배정', async () => {
    const batch = vi.spyOn(mockDB.client, 'batch');
    mockDB.pushResult([], 0); // DELETE 다른 소유자 행
    mockDB.pushResult([], 1); // INSERT ... ON CONFLICT(user_id, token)
    const res = await buildApp('user-1').request(registerRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // 따로 나가는 'DELETE 후 INSERT' 2문장은 동시 등록(빠른 계정 전환) 인터리빙에서 소유자 2행이
    // 남는 레이스가 있었다(Codex #567 P1) — 반드시 **한 쓰기 단위**로 커밋돼야 한다.
    // 2026-10-11 부터 그 단위는 대화형 트랜잭션(왕복 셋)이 아니라 batch 하나(왕복 하나)다 —
    // 'write' 가 `BEGIN IMMEDIATE` 다. 기본값('deferred')으로 내려가면 단일 writer 락이 풀린다.
    expect(batch).toHaveBeenCalledTimes(1);
    const [statements, mode] = batchCallsOf(batch)[0]!;
    expect(mode).toBe('write');
    expect(statements).toHaveLength(2);
    expect(statements[0]!.sql.startsWith('DELETE FROM push_tokens')).toBe(true);
    expect(statements[1]!.sql).toContain('INSERT INTO push_tokens');
    // 대화형 트랜잭션은 열리지 않았다 — 왕복 사이에 스트림을 쥐고 있지 않는다.
    expect(mockDB.transactions).toEqual({ commits: 0, rollbacks: 0, closes: 0 });
    const del = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(del).toBeDefined();
    // 마지막 인자는 '계정이 아직 active 인가' 조건의 id 다(코덱스 #904 — INSERT 와 같은 조건).
    expect(del!.args).toEqual(['fcm-token-abc', 'user-1', 'user-1']);
    expect(del!.sql).toContain("deletion_status = 'active'");
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT INTO push_tokens'));
    expect(insert).toBeDefined();
    // 컨플릭트 타깃은 (user_id, token) 유지 — 배포가 마이그레이션(#71 token 전역 UNIQUE)보다
    // 먼저 나가는 창에서 ON CONFLICT(token) 은 매칭 제약이 없어 500 이 된다(Codex #568 P2).
    expect(insert!.sql).toContain('ON CONFLICT(user_id, token)');
    expect(insert!.args).toContain('user-1');
    expect(insert!.args).toContain('fcm-token-abc');
    expect(insert!.args).toContain('android');
  });

  // ── 게이트웨이 일시 실패는 batch 째 다시 보낸다(쓰기 재시도의 좁은 예외) ──
  //
  // 2026-09-28·10-07 prod(BACKEND-E): 이 라우트의 쓰기가 Turso 게이트웨이 525·520 을 받아 그대로
  // 500 이었다. 쓰기라 아무도 재시도하지 않았다. 두 문장이 멱등이고 batch 가 전부 아니면 전무라
  // 여기만 다시 보낸다(`docs/spec/error-codes.md` 구현 지도).
  it('게이트웨이 520 뒤의 성공 → 200, batch 를 두 번 보낸다(같은 문장 그대로)', async () => {
    const batch = vi.spyOn(mockDB.client, 'batch').mockRejectedValueOnce(gatewayError(520));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await withRetryDelaysSkipped(() => buildApp('user-1').request(registerRequest()));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(batch).toHaveBeenCalledTimes(2);
    // 다시 보낸 것은 첫 회차와 **같은 문장·같은 인자**다(행 id 포함) — 회차마다 새로 만들지 않는다.
    const [first, second] = batchCallsOf(batch);
    expect(second![0]).toEqual(first![0]);
    expect(second![1]).toBe('write');
    expect(mockDB.transactions).toEqual({ commits: 0, rollbacks: 0, closes: 0 });
  });

  it('게이트웨이 5xx 가 세 번 이어지면 500 — 정확히 세 번 시도하고 멈춘다', async () => {
    const batch = vi
      .spyOn(mockDB.client, 'batch')
      .mockRejectedValueOnce(gatewayError(520))
      .mockRejectedValueOnce(gatewayError(525))
      .mockRejectedValueOnce(gatewayError(503));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await withRetryDelaysSkipped(() => buildApp('user-1').request(registerRequest()));

    // fail-closed: 성공으로 답하지 않는다 — 마지막 실패를 그대로 던진다.
    expect(res.status).toBe(500);
    expect(batch).toHaveBeenCalledTimes(3);
  });

  it('게이트웨이 오류가 아니면(SQL 제약 위반) 다시 보내지 않는다 — 한 번 시도하고 500', async () => {
    const batch = vi
      .spyOn(mockDB.client, 'batch')
      .mockRejectedValueOnce(
        new LibsqlError('CHECK constraint failed: platform', 'SQLITE_CONSTRAINT'),
      );

    const res = await buildApp('user-1').request(registerRequest());

    expect(res.status).toBe(500);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('token 누락 → 400 INVALID_PUSH_TOKEN', async () => {
    const res = await buildApp().request(jsonReq('POST', '/push/register', { platform: 'android' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PUSH_TOKEN');
  });

  it('공백 token → 400', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/push/register', { token: '   ', platform: 'android' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PUSH_TOKEN');
  });

  it('허용되지 않은 platform → 400 INVALID_PLATFORM', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/push/register', { token: 'tok', platform: 'windows' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PLATFORM');
  });

  // iOS 는 마이그레이션 #88 이 push_tokens.platform CHECK 에서 걷어냈다가 #94 가
  // 되돌린 값이다. 라우트 레벨에서 다시 막히면 iOS 기기가 가족 알람·목소리 공유·
  // 목소리 철회 신호를 하나도 못 받는다.
  it('ios platform 을 받아들인다 (#94)', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/push/register', { token: 'apns-token-abc', platform: 'ios' }),
    );
    expect(res.status).toBe(200);
  });

  it('잘못된 JSON → 400 INVALID_JSON', async () => {
    const res = await buildApp().request(
      new Request('http://localhost/push/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_JSON');
  });
});

describe('POST /push/unregister — 토큰 해제(로그아웃)', () => {
  beforeEach(() => mockDB.reset());

  // ⚠ **호출자 소유의 행만 지운다**(2026-08-20 Codex #699 P2). 토큰만 보고 지우면,
  // A 의 해제 요청이 떠 있는 동안 B 가 같은 기기 토큰으로 등록을 마쳤을 때 뒤늦게 도착한
  // A 의 요청이 **B 의 새 바인딩을 지운다** — B 는 다음 등록까지 알림을 놓친다.
  // "delete-on-register 로 전역 단일 소유자" 라는 근거는 범위를 좁혀도 그대로 성립한다:
  // 지금 그 토큰의 주인이 곧 호출자다.
  it('호출자 소유의 행만 지운다 → success', async () => {
    mockDB.pushResult([], 1); // DELETE FROM push_tokens WHERE token = ? AND user_id = ?
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/push/unregister', { token: 'fcm-token-abc' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const del = mockDB.calls.find((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(del).toBeDefined();
    expect(del!.sql).toContain('WHERE token = ? AND user_id = ?');
    expect(del!.args).toEqual(['fcm-token-abc', 'user-1']);
  });

  // 문장 하나짜리 멱등 쓰기 — `/register` 와 같은 좁은 예외로 게이트웨이 일시 실패에서 다시 보낸다.
  // 실패한 해제는 로그아웃한 기기를 떠난 계정에 묶어 둔다.
  it('게이트웨이 525 뒤의 성공 → 200, DELETE 를 두 번 보낸다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDB.pushError(gatewayError(525));
    mockDB.pushResult([], 1);

    const res = await withRetryDelaysSkipped(() =>
      buildApp('user-1').request(jsonReq('POST', '/push/unregister', { token: 'fcm-token-abc' })),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    const deletes = mockDB.calls.filter((c) => c.sql.startsWith('DELETE FROM push_tokens'));
    expect(deletes).toHaveLength(2);
    expect(deletes[1]).toEqual(deletes[0]);
  });

  it('게이트웨이 5xx 가 세 번 이어지면 500 — 정확히 세 번 시도한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const status of [525, 520, 502]) mockDB.pushError(gatewayError(status));

    const res = await withRetryDelaysSkipped(() =>
      buildApp('user-1').request(jsonReq('POST', '/push/unregister', { token: 'fcm-token-abc' })),
    );

    expect(res.status).toBe(500);
    expect(mockDB.calls.filter((c) => c.sql.startsWith('DELETE FROM push_tokens'))).toHaveLength(3);
  });

  it('게이트웨이 오류가 아니면 다시 보내지 않는다', async () => {
    mockDB.pushError(new LibsqlError('no such table: push_tokens', 'SQLITE_ERROR'));

    const res = await buildApp('user-1').request(
      jsonReq('POST', '/push/unregister', { token: 'fcm-token-abc' }),
    );

    expect(res.status).toBe(500);
    expect(mockDB.calls.filter((c) => c.sql.startsWith('DELETE FROM push_tokens'))).toHaveLength(1);
  });

  it('token 누락 → 400', async () => {
    const res = await buildApp().request(jsonReq('POST', '/push/unregister', {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_PUSH_TOKEN');
  });
});
