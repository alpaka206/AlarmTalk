import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import billingQuery from '../src/routes/billing-query';

const PLAN_PLUS_ID = '70000000-0000-4000-8000-000000000002';
const PLAN_FAMILY_ID = '70000000-0000-4000-8000-000000000003';

function buildApp(userId = 'google-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/billing', billingQuery);
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

// ---------------------------------------------------------------------------
// GET /billing/vouchers — split module direct import
// ---------------------------------------------------------------------------
describe('GET /billing/vouchers (billingQuery)', () => {
  it('resolveUserPk 로 google_id → user.id 조회 후 issuer 필터링', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]);

    await buildApp('google-1').request(jsonReq('GET', '/billing/vouchers'));

    const userQuery = mockDB.calls[0]!;
    expect(userQuery.sql).toContain('FROM users');
    expect(userQuery.args[0]).toBe('google-1');
    const voucherQuery = mockDB.calls[1]!;
    expect(voucherQuery.args[0]).toBe('user-pk-1');
  });

  it('voucher JOIN plans — plan_key, plan_name, plan_type 포함', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([{
      id: 'v1', code: 'INV-AAAA-BBBB-CCCC', plan_id: PLAN_PLUS_ID,
      issuer_subscription_id: 'sub-1', redeemed_by_user_id: null,
      status: 'issued', issued_at: '2026-04-21T00:00:00.000Z',
      used_at: null, expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers[0]).toMatchObject({
      id: 'v1',
      code: 'INV-AAAA-BBBB-CCCC',
      plan_key: 'personal',
      plan_name: '개인',
      plan_type: 'personal',
      subscription_id: 'sub-1',
      redeemed_by_user_id: null,
      used_at: null,
    });
  });

  it('SQL 에 JOIN plans + issuer_user_id 필터 + ORDER BY issued_at DESC 포함', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/vouchers'));

    const sql = mockDB.calls[1]!.sql;
    expect(sql).toContain('JOIN plans p ON p.id = v.plan_id');
    expect(sql).toContain('v.issuer_user_id = ?');
    expect(sql).toContain('ORDER BY v.issued_at DESC');
  });

  it('사용자 없으면 DB 조회 없이 빈 배열 반환', async () => {
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers).toEqual([]);
    expect(mockDB.calls).toHaveLength(1);
  });

  it('used 상태 voucher 의 redeemed_by_user_id, used_at 정상 매핑', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([{
      id: 'v1', code: 'INV-AAAA-BBBB-CCCC', plan_id: PLAN_PLUS_ID,
      issuer_subscription_id: 'sub-1', redeemed_by_user_id: 'user-pk-2',
      status: 'used', issued_at: '2026-04-21T00:00:00.000Z',
      used_at: '2026-04-22T10:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers[0].status).toBe('used');
    expect(body.vouchers[0].redeemed_by_user_id).toBe('user-pk-2');
    expect(body.vouchers[0].used_at).toBe('2026-04-22T10:00:00.000Z');
  });

  it('여러 voucher 반환 시 순서 유지 (DB 결과 순서대로)', async () => {
    mockDB.pushResult([{ id: 'user-pk-1' }]);
    mockDB.pushResult([
      { id: 'v1', code: 'INV-AAAA-2222-2222', plan_id: PLAN_PLUS_ID, issuer_subscription_id: null, redeemed_by_user_id: null, status: 'issued', issued_at: '2026-04-22T00:00:00.000Z', used_at: null, expires_at: '2026-05-22T00:00:00.000Z', plan_key: 'personal', plan_name: '플러스', plan_type: 'personal' },
      { id: 'v2', code: 'INV-BBBB-2222-2222', plan_id: PLAN_FAMILY_ID, issuer_subscription_id: null, redeemed_by_user_id: null, status: 'issued', issued_at: '2026-04-21T00:00:00.000Z', used_at: null, expires_at: '2026-05-21T00:00:00.000Z', plan_key: 'family', plan_name: '가족', plan_type: 'family' },
    ]);

    const res = await buildApp().request(jsonReq('GET', '/billing/vouchers'));
    const body = await res.json();
    expect(body.vouchers).toHaveLength(2);
    expect(body.vouchers[0].id).toBe('v1');
    expect(body.vouchers[1].id).toBe('v2');
  });
});

// ---------------------------------------------------------------------------
// GET /billing/subscription — split module direct import
// ---------------------------------------------------------------------------
describe('GET /billing/subscription (billingQuery)', () => {
  it('subscription 쿼리는 c.get(userId)(= users.id) 를 직접 사용 (resolveUserPk 미사용)', async () => {
    mockDB.pushResult([]);

    await buildApp('my-user-pk').request(jsonReq('GET', '/billing/subscription'));

    // 첫 조회가 구독이고, 그 뒤는 갱신 주인 신호용(활성 구독 → 스토어 기록)이다.
    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('u.id = ?');
    expect(mockDB.calls[0]!.args[0]).toBe('my-user-pk');
    expect(mockDB.calls[1]!.args[0]).toBe('my-user-pk');
  });

  it('활성 구독 없으면 { subscription: null, plan: null }', async () => {
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription).toBeNull();
    expect(body.plan).toBeNull();
  });

  it('SQL 에 LIMIT 1 + ORDER BY starts_at DESC (최신 구독만)', async () => {
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('ORDER BY s.starts_at DESC');
    expect(sql).toContain('LIMIT 1');
  });

  it('SQL 에 active 상태 + 만료되지 않은 조건 포함', async () => {
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.expires_at > datetime('now')");
  });

  // -------------------------------------------------------------------------
  // store_provider — 해지가 어느 스토어를 거쳐야 하는가 (코덱스 #732 P1)
  //
  // ⚠ 앱이 이 판정을 **로컬 스토어 상태로 흉내 내면** 애플 entitlement 가 기기에 남은 채
  //   Play 구독을 쓰는 사용자의 해지가 조용히 실패한다 — 값의 출처는 서버 하나다.
  // -------------------------------------------------------------------------
  function pushSubscriptionRow() {
    mockDB.pushResult([{
      sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID,
      plan_group_id: null, status: 'active',
      starts_at: '2026-04-21T00:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
      period_days: 30, max_members: 1, price_krw: 4900,
    }]);
  }

  // -------------------------------------------------------------------------
  // store_renewal_providers — **지금 갱신을 쥔 스토어 전부** (코덱스 #733 3차)
  //
  // ⚠ `store_provider` 와 다른 질문이다. 그쪽은 "해지가 어느 스토어를 거치나" 라 애플이
  //   있으면 애플로 접어 버린다. 이중 청구를 막으려면 **구글이 살아 있는가**를 알아야 한다.
  // -------------------------------------------------------------------------
  it('활성 구독이 없어도 갱신 주인은 돌려준다 — Play 보류가 여기 걸린다', async () => {
    // Play `ON_HOLD` 는 구독 행을 active 로 남기고 expires_at 은 지나 있다 →
    // 위 SELECT(만료 필터)에는 안 걸리지만 갱신은 Play 가 쥐고 있다.
    mockDB.pushResult([]); // 만료되지 않은 활성 구독 없음
    mockDB.pushResult([{ sub_id: 'sub-hold', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([{ provider: 'google', provider_transaction_id: 'tok-1', product_id: 'p1', subscription_id: 'sub-hold' }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription).toBeNull();
    expect(body.store_renewal_providers).toEqual(['google']);
  });

  it('애플·구글이 함께 살아 있으면 둘 다 돌려준다 — store_provider 는 apple 로 접힌다', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([
      { sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
      { sub_id: 'sub-2', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
    ]);
    mockDB.pushResult([
      { provider: 'apple', provider_transaction_id: 'tx-1', product_id: 'p1', subscription_id: 'sub-1' },
      { provider: 'google', provider_transaction_id: 'tok-1', product_id: 'p1', subscription_id: 'sub-2' },
    ]);

    const body = await (await buildApp().request(jsonReq('GET', '/billing/subscription'))).json();
    // 해지 판정은 애플 우선으로 접힌다(서버가 애플을 못 끊으므로).
    expect(body.subscription.store_provider).toBe('apple');
    // 구매 차단 판정은 접히면 안 된다 — Play 가 살아 있다.
    expect(body.store_renewal_providers).toEqual(['apple', 'google']);
  });

  it('해지 예약된 구독은 갱신 주인이 아니다 — 안내대로 해지한 사람을 막지 않는다', async () => {
    // ⚠ `cancel_at_period_end = 1` 은 "아직 유료지만 **다음 갱신은 없다**" 는 뜻이다.
    //   그걸 세면 우리가 "Play 에서 먼저 해지하라" 고 안내해 놓고, 그대로 한 사용자를
    //   남은 기간 내내 막게 된다(코덱스 #733 6차).
    pushSubscriptionRow();
    mockDB.pushResult([{ sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal', cancel_at_period_end: 1 }]);
    mockDB.pushResult([{ provider: 'google', provider_transaction_id: 'tok-1', product_id: 'p1', subscription_id: 'sub-1' }]);

    const body = await (await buildApp().request(jsonReq('GET', '/billing/subscription'))).json();
    expect(body.store_renewal_providers).toEqual([]);
    // 해지 판정은 반대다 — 예약해지든 아니든 서버는 애플 구독을 못 끊는다.
    expect(body.subscription.store_provider).toBe('google');
  });

  it('스토어 결제가 없으면 빈 배열이다', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([{ sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([]);

    const body = await (await buildApp().request(jsonReq('GET', '/billing/subscription'))).json();
    expect(body.store_renewal_providers).toEqual([]);
  });

  it('애플 결제면 store_provider=apple', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([{ sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([{ provider: 'apple', provider_transaction_id: 'tx-1', product_id: 'p1', subscription_id: 'sub-1' }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    expect((await res.json()).subscription.store_provider).toBe('apple');
  });

  it('구글 결제면 store_provider=google', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([{ sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([{ provider: 'google', provider_transaction_id: 'tok-1', product_id: 'p1', subscription_id: 'sub-1' }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    expect((await res.json()).subscription.store_provider).toBe('google');
  });

  it('애플·구글이 섞여 있으면 apple 이 이긴다 — 해지 라우트가 409 로 거절하는 조건과 같다', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([
      { sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
      { sub_id: 'sub-2', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' },
    ]);
    mockDB.pushResult([
      { provider: 'google', provider_transaction_id: 'tok-1', product_id: 'p1', subscription_id: 'sub-1' },
      { provider: 'apple', provider_transaction_id: 'tx-1', product_id: 'p1', subscription_id: 'sub-1' },
    ]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    expect((await res.json()).subscription.store_provider).toBe('apple');
  });

  it('스토어 결제가 아니면(프로모·바우처) store_provider=null — 서버 로컬 해지가 된다', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([{ sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    expect((await res.json()).subscription.store_provider).toBeNull();
  });

  it('판정 범위는 최신 1건이 아니라 **활성 구독 전부** — 해지 라우트와 같은 집합이다', async () => {
    pushSubscriptionRow();
    mockDB.pushResult([{ sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID, plan_group_id: null, plan_type: 'personal', plan_key: 'personal' }]);
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    // 2번째 = 활성 구독 조회(만료 필터 없이 status='active' 전부), 3번째 = 그 구독들의 스토어 기록.
    expect(mockDB.calls[1]!.sql).toContain("s.status = 'active'");
    expect(mockDB.calls[1]!.sql).not.toContain('LIMIT 1');
    expect(mockDB.calls[2]!.sql).toContain('FROM store_transactions');
    expect(mockDB.calls[2]!.sql).toContain('subscription_id IN');
  });

  it('personal 구독 시 plan_group_id null 반환', async () => {
    mockDB.pushResult([{
      sub_id: 'sub-1', user_id: 'user-pk-1', plan_id: PLAN_PLUS_ID,
      plan_group_id: null, status: 'active',
      starts_at: '2026-04-21T00:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'personal', plan_name: '개인', plan_type: 'personal',
      period_days: 30, max_members: 1, price_krw: 4900,
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription.plan_group_id).toBeNull();
    expect(body.plan.plan_type).toBe('personal');
  });

  it('family 구독 시 plan_group_id 포함 + plan 필드 전체 정확성', async () => {
    mockDB.pushResult([{
      sub_id: 'sub-fam', user_id: 'user-pk-1', plan_id: PLAN_FAMILY_ID,
      plan_group_id: 'group-1', status: 'active',
      starts_at: '2026-04-21T00:00:00.000Z', expires_at: '2026-05-21T00:00:00.000Z',
      plan_key: 'family', plan_name: '가족', plan_type: 'family',
      period_days: 30, max_members: 6, price_krw: 9900,
    }]);

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    const body = await res.json();
    expect(body.subscription).toMatchObject({
      id: 'sub-fam',
      user_id: 'user-pk-1',
      plan_id: PLAN_FAMILY_ID,
      plan_group_id: 'group-1',
      status: 'active',
    });
    expect(body.plan).toMatchObject({
      id: PLAN_FAMILY_ID,
      key: 'family',
      name: '가족',
      plan_type: 'family',
      period_days: 30,
      max_members: 6,
      price_krw: 9900,
    });
  });

  it('SQL JOIN 구조: subscriptions → users → plans', async () => {
    mockDB.pushResult([]);

    await buildApp().request(jsonReq('GET', '/billing/subscription'));

    const sql = mockDB.calls[0]!.sql;
    expect(sql).toContain('JOIN users u ON u.id = s.user_id');
    expect(sql).toContain('JOIN plans p ON p.id = s.plan_id');
  });

  it('DB 에러 → 500', async () => {
    const origExecute = mockDB.client.execute;
    mockDB.client.execute = async () => { throw new Error('DB read failed'); };

    const res = await buildApp().request(jsonReq('GET', '/billing/subscription'));
    expect(res.status).toBe(500);
    mockDB.client.execute = origExecute;
  });
});
