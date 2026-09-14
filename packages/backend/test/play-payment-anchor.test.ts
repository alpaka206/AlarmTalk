import { afterEach, describe, expect, it, vi } from 'vitest';
import { googlePaymentAnchor, selectAuthoritativeLineItem } from '../src/lib/play-subscriptions';

vi.mock('../src/lib/google-oauth', () => ({
  parseServiceAccountJson: () => ({ client_email: 'test@example.test', private_key: 'test' }),
  getGoogleAccessToken: vi.fn().mockResolvedValue('test-access'),
}));
afterEach(() => vi.unstubAllGlobals());

const env = { ANDROID_PACKAGE_NAME: 'com.alarmtalk.app' };
const paidAt = '2026-08-31T03:12:34.000Z';
const sub = {
  startTime: '2020-01-01T00:00:00Z',
  latestOrderId: 'declined-order',
  lineItems: [
    {
      productId: 'family_monthly',
      expiryTime: '2026-10-07T00:00:00Z',
      latestSuccessfulOrderId: 'paid-order',
    },
  ],
};
const order = {
  orderId: 'paid-order',
  purchaseToken: 'token',
  createTime: '2026-08-30T00:00:00Z',
  lastEventTime: '2026-09-02T00:00:00Z',
  orderHistory: { processedEvent: { eventTime: paidAt } },
};

describe('Play 결제일은 실제 성공 주문에서 읽는다', () => {
  it('최초 구독일·만료일·최근 환불일이 아니라 processedEvent 시각을 쓴다', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(order)));
    vi.stubGlobal('fetch', fetcher);
    expect((await googlePaymentAnchor(env, sub, 'token')).toISOString()).toBe(paidAt);
  });
  it('최신 실패 주문보다 최신 성공 주문을 조회한다', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(order));
      }),
    );
    await googlePaymentAnchor(env, sub, 'token');
    expect(urls[0]).toContain('/applications/com.alarmtalk.app/orders/paid-order');
  });
  it.each([
    { ...order, orderId: 'wrong' },
    { ...order, purchaseToken: 'wrong' },
    { ...order, orderHistory: {} },
    { ...order, orderHistory: { processedEvent: { eventTime: 'invalid' } } },
  ])('다른 주문·토큰·미확정 날짜는 추정값으로 대체하지 않는다', async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload))),
    );
    await expect(googlePaymentAnchor(env, sub, 'token')).rejects.toThrow();
  });
  it('Orders API 장애는 결제일을 현재 시각으로 바꾸지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(googlePaymentAnchor(env, sub, 'token')).rejects.toThrow('503');
  });
  it('예약 교체의 아직 소유하지 않은 상품은 알림이 지목해도 선택하지 않는다', () => {
    const current = sub.lineItems[0]!;
    const pending = { productId: 'couple_monthly' };
    expect(selectAuthoritativeLineItem([pending, current], pending.productId)).toBe(current);
  });
});
