import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import eventsRoutes from '../src/routes/events';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/events', eventsRoutes);
  return app;
}

const ALARM_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE_ID = '22222222-2222-4222-8222-222222222222';

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'alarm_created',
    occurred_at: '2026-09-06T21:00:00.000Z',
    alarm_id: ALARM_ID,
    ...overrides,
  };
}

function consent(type: string, version: string, createdAt: string, agreed = 1) {
  return { consent_type: type, policy_version: version, created_at: createdAt, agreed };
}

const priorRequiredConsents = [
  consent('terms', '3', '2000-01-01 00:00:00.000'),
  consent('age14', '3', '2000-01-01 00:00:00.000'),
];

describe('POST /events — 사용 기록 배치 수집', () => {
  beforeEach(() => mockDB.reset());
  afterEach(() => vi.restoreAllMocks());

  it('재동의 뒤 처음 올라온 배치에서도 동의 전 기록과 그 보관함 갱신을 버린다', async () => {
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '6', '2026-09-06 21:00:00.500'),
      consent('privacy', '4', '2000-01-01 00:00:00.000'),
      ...priorRequiredConsents,
    ]);
    const before = event({
      type: 'manual_message_attached', message_id: MESSAGE_ID,
      occurred_at: '2026-09-06T21:00:00.499Z',
    });
    const atBoundary = event({ occurred_at: '2026-09-06T21:00:00.500Z' });
    const after = event({ occurred_at: '2026-09-06T21:00:01.000Z' });

    const response = await buildApp().request(jsonReq('POST', '/events', {
      events: [before, atBoundary, after],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 2 });
    const inserted = mockDB.calls.filter((call) => call.sql.includes('INSERT OR IGNORE INTO usage_events'))
      .flatMap((call) => call.args);
    expect(inserted).not.toContain(before.id);
    expect(inserted).toContain(atBoundary.id);
    expect(inserted).toContain(after.id);
    expect(mockDB.calls.some((call) => call.sql.includes('UPDATE message_library'))).toBe(false);
  });

  it('전부 동의 전 기록이면 쓰기 없이 200으로 큐를 비운다', async () => {
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '6', '2026-09-07 00:00:00.000'), ...priorRequiredConsents,
    ]);
    const response = await buildApp().request(jsonReq('POST', '/events', {
      events: [event({ type: 'manual_message_attached', message_id: MESSAGE_ID })],
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 0 });
    expect(mockDB.calls.some((call) => /INSERT|UPDATE/i.test(call.sql))).toBe(false);
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('유효한 동의를 다시 제출해도 원래 동의 뒤의 오프라인 기록은 받는다', async () => {
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '6', '2026-09-07 00:00:00.000'),
      consent('privacy', '5', '2026-09-01 00:00:00.000'),
      consent('privacy', '4', '2000-01-01 00:00:00.000'),
      ...priorRequiredConsents,
    ]);
    const response = await buildApp().request(jsonReq('POST', '/events', { events: [event()] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 1 });
  });

  it.each(['privacy', 'terms', 'age14'])('%s 거절 뒤 다시 동의한 경우 이전 기간의 기록을 버린다', async (type) => {
    mockDB.pushResultFor('FROM user_consents', [
      consent(type, '6', '2026-09-07 00:00:00.000'),
      consent(type, '6', '2026-09-06 20:00:00.000', 0),
      consent(type, '6', '2026-09-01 00:00:00.000'),
      ...['privacy', 'terms', 'age14'].filter((other) => other !== type)
        .map((other) => consent(other, '6', '2000-01-01 00:00:00.000')),
    ]);
    const response = await buildApp().request(jsonReq('POST', '/events', {
      events: [event(), event({ occurred_at: '2026-09-07T00:00:00.000Z' })],
    }));
    expect(await response.json()).toEqual({ accepted: 1 });
  });

  it('초 단위 옛 동의는 그 초의 기록을 버리고 다음 초부터 받는다', async () => {
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '5', '2026-09-06 21:00:00'), ...priorRequiredConsents,
    ]);
    const response = await buildApp().request(jsonReq('POST', '/events', {
      events: [event({ occurred_at: '2026-09-06T21:00:00.999Z' }),
        event({ occurred_at: '2026-09-07T06:00:01.000+09:00' })],
    }));
    expect(await response.json()).toEqual({ accepted: 1 });
  });

  it.each(['', 'unknown', '2026-09-06T21:00:00'])('동의 시각을 확정할 수 없으면 기록을 받지 않는다 (%s)', async (createdAt) => {
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '6', createdAt), ...priorRequiredConsents,
    ]);
    const response = await buildApp().request(jsonReq('POST', '/events', { events: [event()] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, accepted: 0, skipped_reason: 'consent_below_disclosure',
    });
    expect(mockDB.calls.some((call) => /INSERT|UPDATE/i.test(call.sql))).toBe(false);
  });

  // ⚠ 이 라우트는 동의 미들웨어를 거치지 않는다(`middleware/consent.ts`) — 동의가 모자라면 **200 으로 받고 버려**
  //   앱이 큐를 비우게 한다. 403 을 주면 앱이 배치를 들고 있다가 재동의 뒤 고지 전 기록을 다시 보낸다(2026-10-16).
  it.each([
    [
      '처리방침이 고지 버전(5) 미만',
      [
        ['terms', '6'],
        ['privacy', '4'],
        ['age14', '6'],
      ],
    ],
    [
      '필수 동의(약관)가 없음',
      [
        ['privacy', '6'],
        ['age14', '6'],
      ],
    ],
    ['동의 기록이 하나도 없음', []],
  ] as const)('%s 이면 받고 버린다(200, accepted 0)', async (_label, rows) => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult(
      rows.map(([type, version]) => ({ consent_type: type, policy_version: version, agreed: 1 })),
    );
    const response = await buildApp().request(jsonReq('POST', '/events', { events: [event()] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      accepted: 0,
      skipped_reason: 'consent_below_disclosure',
    });
    expect(mockDB.calls.some((call) => /INSERT/i.test(call.sql))).toBe(false);
  });

  it('문구 이벤트 100건은 개별 DB 요청 없이 두 batch로 처리한다', async () => {
    const transaction = await mockDB.client.transaction();
    const execute = vi.spyOn(transaction, 'execute');
    const batch = vi.spyOn(transaction, 'batch');
    vi.spyOn(mockDB.client, 'transaction').mockResolvedValueOnce(transaction);

    const response = await buildApp().request(
      jsonReq('POST', '/events', {
        events: Array.from({ length: 100 }, () =>
          event({
            type: 'manual_message_attached',
            message_id: MESSAGE_ID,
          }),
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(2);
    expect(batch.mock.calls[0]?.[0]).toHaveLength(4);
    expect(batch.mock.calls[1]?.[0]).toHaveLength(104);
    expect(mockDB.transactions.commits).toBe(1);
  });

  it('같은 배치의 중복 UUID는 첫 사실만 보관함에 반영한다', async () => {
    const attached = event({ type: 'manual_message_attached', message_id: MESSAGE_ID });
    const response = await buildApp().request(
      jsonReq('POST', '/events', {
        events: [attached, { ...attached, type: 'manual_message_released' }],
      }),
    );

    expect(response.status).toBe(200);
    expect(mockDB.calls.filter((call) => call.sql.includes('UPDATE message_library'))).toHaveLength(
      1,
    );
    expect(mockDB.calls.some((call) => call.sql.includes('SET in_use = 0'))).toBe(false);
  });

  it('batch 쓰기 실패는 전체 트랜잭션을 롤백한다', async () => {
    mockDB.pushErrorFor('UPDATE message_library', new Error('write failed'));
    const response = await buildApp().request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_attached', message_id: MESSAGE_ID })],
      }),
    );

    expect(response.status).toBe(500);
    expect(mockDB.transactions.commits).toBe(0);
    expect(mockDB.transactions.rollbacks).toBe(1);
  });

  it('배치를 한 트랜잭션에서 INSERT OR IGNORE 로 넣는다(재전송 멱등)', async () => {
    const res = await buildApp('user-1').request(
      jsonReq('POST', '/events', { events: [event(), event({ type: 'alarm_rang' })] }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { accepted: number }).accepted).toBe(2);
    expect(mockDB.transactions.commits).toBe(1);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO usage_events'));
    expect(insert).toBeDefined();
    // 소유자는 **토큰의 사용자**다 — 클라가 보낸 값을 쓰지 않는다.
    expect(insert!.args).toContain('user-1');
  });

  it('울림 이벤트도 그대로 받는다 — 기기가 오프라인에 쌓았다가 나중에 보낸 것이다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'alarm_rang', occurred_at: '2026-09-01T21:00:00.000Z' })],
      }),
    );
    expect(res.status).toBe(200);
    const insert = mockDB.calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO usage_events'));
    // 도착 시각이 아니라 **일어난 시각**이 그대로 저장돼야 한다(며칠 늦게 와도).
    expect(insert!.args).toContain('2026-09-01T21:00:00.000Z');
  });

  it('문구를 붙이면 보관함 행을 사용중으로 표시한다 — 본인 행만', async () => {
    await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_attached', message_id: MESSAGE_ID })],
      }),
    );
    const update = mockDB.calls.find((c) => c.sql.includes('SET in_use = 1'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('user_id = ?');
    expect(update!.args).toEqual([
      '2026-09-06T21:00:00.000Z',
      '2026-09-06T21:00:00.000Z',
      MESSAGE_ID,
      'user-1',
      '2026-09-06T21:00:00.000Z',
    ]);
  });

  it('붙임도 더 최근 사실을 덮지 않는다 — 다른 기기의 최신 해제를 되돌리면 안 된다', async () => {
    await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_attached', message_id: MESSAGE_ID })],
      }),
    );
    const update = mockDB.calls.find((c) => c.sql.includes('SET in_use = 1'));
    // 해제와 **같은** 가드가 있어야 한다. 한쪽만 막으면 뒤늦게 도착한 붙임이 최신 해제를
    // 되돌려 그 문구가 영원히 '사용중' 으로 남는다.
    expect(update!.sql).toContain('in_use_updated_at <= ?');
  });

  it('해제는 더 최근 사실을 덮지 않는다 — 늦게 도착한 큐가 사용중을 되돌리면 안 된다', async () => {
    await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_released', message_id: MESSAGE_ID })],
      }),
    );
    const update = mockDB.calls.find((c) => c.sql.includes('SET in_use = 0'));
    expect(update).toBeDefined();
    // 시각 비교 가드가 있어야 한다(오프라인 큐는 며칠 밀릴 수 있다).
    expect(update!.sql).toContain('in_use_updated_at <= ?');
  });

  it.each([1, 5 * 365 * 24 * 60 * 60 * 1000])('도착보다 %s ms 미래인 기록은 시각을 바꿔 저장하지 않고 버린다', async (aheadMs) => {
    const receivedAtMs = Date.parse('2026-09-07T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockReturnValue(receivedAtMs);
    // 기록이 오기 전에 재동의를 마쳤지만, 기기 시계가 앞선 기록의 실제 발생 시각은 알 수 없다.
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '6', '2026-09-06 21:00:00.500'),
      consent('privacy', '4', '2000-01-01 00:00:00.000'),
      ...priorRequiredConsents,
    ]);
    const response = await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [
          event({
            type: 'manual_message_attached', message_id: MESSAGE_ID,
            occurred_at: new Date(receivedAtMs + aheadMs).toISOString(),
          }),
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 0 });
    expect(mockDB.calls.some((call) => /INSERT|UPDATE/i.test(call.sql))).toBe(false);
    expect(mockDB.transactions.commits).toBe(0);
  });

  it('미래·동의 전·정상 기록이 섞이면 정상 기록만 원래 시각으로 저장한다', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-07T00:00:00.000Z'));
    mockDB.pushResultFor('FROM user_consents', [
      consent('privacy', '6', '2026-09-06 21:00:00.500'), ...priorRequiredConsents,
    ]);
    const future = event({
      type: 'manual_message_attached', message_id: MESSAGE_ID,
      occurred_at: '2026-09-07T09:00:00.001+09:00',
    });
    const beforeConsent = event({
      type: 'manual_message_attached', message_id: MESSAGE_ID,
      occurred_at: '2026-09-06T21:00:00.499Z',
    });
    const atConsent = event({ occurred_at: '2026-09-07T06:00:00.500+09:00' });
    const atReceipt = event({ occurred_at: '2026-09-07T00:00:00.000Z' });

    const response = await buildApp().request(jsonReq('POST', '/events', {
      events: [future, beforeConsent, atConsent, atReceipt],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: 2 });
    const inserted = mockDB.calls.filter((call) => call.sql.includes('INSERT OR IGNORE INTO usage_events'))
      .flatMap((call) => call.args);
    expect(inserted).not.toContain(future.id);
    expect(inserted).not.toContain(beforeConsent.id);
    expect(inserted).toContain(atConsent.id);
    expect(inserted).toContain('2026-09-06T21:00:00.500Z');
    expect(inserted).toContain(atReceipt.id);
    expect(inserted).toContain(atReceipt.occurred_at);
    expect(mockDB.calls.some((call) => call.sql.includes('UPDATE message_library'))).toBe(false);
  });

  it('이미 저장된 사건은 보관함을 다시 건드리지 않는다 — 재전송은 멱등이다', async () => {
    const dup = event({ type: 'manual_message_attached', message_id: MESSAGE_ID });
    // 응답만 못 받고 서버는 커밋했던 배치 — 같은 id 가 이미 들어 있다.
    mockDB.pushResultFor('SELECT id FROM usage_events', [{ id: dup.id }]);

    const res = await buildApp('user-1').request(jsonReq('POST', '/events', { events: [dup] }));

    expect(res.status).toBe(200);
    // INSERT 는 그대로 시도한다(OR IGNORE 가 버린다).
    expect(mockDB.calls.some((c) => c.sql.includes('INSERT OR IGNORE INTO usage_events'))).toBe(
      true,
    );
    // 갱신은 없어야 한다 — 재전송이 그 사이에 들어온 해제를 되돌리면 안 된다.
    expect(mockDB.calls.some((c) => c.sql.includes('SET in_use = 1'))).toBe(false);
  });

  it('중복 조회는 INSERT 앞에서 돈다 — 뒤로 가면 모든 갱신이 조용히 사라진다', async () => {
    await buildApp('user-1').request(
      jsonReq('POST', '/events', {
        events: [event({ type: 'manual_message_attached', message_id: MESSAGE_ID })],
      }),
    );
    const select = mockDB.calls.findIndex((c) => c.sql.includes('SELECT id FROM usage_events'));
    const insert = mockDB.calls.findIndex((c) =>
      c.sql.includes('INSERT OR IGNORE INTO usage_events'),
    );
    expect(select).toBeGreaterThanOrEqual(0);
    expect(select).toBeLessThan(insert);
    // 새 사건은 그대로 반영된다 — 위 건너뛰기가 정상 경로를 죽이지 않는다.
    expect(mockDB.calls.some((c) => c.sql.includes('SET in_use = 1'))).toBe(true);
  });

  it('모르는 종류는 400 — 앱이 서버보다 앞서 나가도 조용히 버려지지 않는다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/events', { events: [event({ type: 'something_new' })] }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('INVALID_USAGE_EVENTS');
  });

  it('빈 배열·상한 초과는 400', async () => {
    const app = buildApp();
    const empty = await app.request(jsonReq('POST', '/events', { events: [] }));
    expect(empty.status).toBe(400);
    const tooMany = await app.request(
      jsonReq('POST', '/events', { events: Array.from({ length: 101 }, () => event()) }),
    );
    expect(tooMany.status).toBe(400);
  });

  it('자유 문자열은 길이를 막는다 — 이벤트는 식별자만 나른다', async () => {
    const res = await buildApp().request(
      jsonReq('POST', '/events', { events: [event({ detail: 'x'.repeat(121) })] }),
    );
    expect(res.status).toBe(400);
  });
});
