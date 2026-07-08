import { describe, it, expect } from 'vitest';
import {
  parseDeveloperNotification,
  decideSubscriptionAction,
  selectAuthoritativeLineItem,
} from '../src/routes/billing-google-rtdn';

function pubsubEnvelope(notification: unknown): { message: { data: string } } {
  const json = JSON.stringify(notification);
  const b64 = Buffer.from(json, 'utf-8').toString('base64');
  return { message: { data: b64 } };
}

describe('billing google RTDN', () => {
  describe('parseDeveloperNotification', () => {
    it('Pub/Sub 엔벨로프의 base64 data 를 DeveloperNotification 으로 디코드한다', () => {
      const env = pubsubEnvelope({
        version: '1.0',
        packageName: 'com.alarmtalk.app',
        subscriptionNotification: {
          notificationType: 2,
          purchaseToken: 'tok_123',
          subscriptionId: 'personal_monthly',
        },
      });
      const parsed = parseDeveloperNotification(env);
      expect(parsed?.packageName).toBe('com.alarmtalk.app');
      expect(parsed?.subscriptionNotification?.purchaseToken).toBe('tok_123');
      expect(parsed?.subscriptionNotification?.subscriptionId).toBe('personal_monthly');
    });

    it('UTF-8(한글) 페이로드도 깨지지 않는다', () => {
      const parsed = parseDeveloperNotification(pubsubEnvelope({ packageName: '한글앱' }));
      expect(parsed?.packageName).toBe('한글앱');
    });

    it('testNotification 도 파싱된다', () => {
      const parsed = parseDeveloperNotification(
        pubsubEnvelope({ testNotification: { version: '1.0' } }),
      );
      expect(parsed?.testNotification).toBeDefined();
    });

    it('data 가 없거나 형식이 잘못되면 null', () => {
      expect(parseDeveloperNotification(null)).toBeNull();
      expect(parseDeveloperNotification({})).toBeNull();
      expect(parseDeveloperNotification({ message: {} })).toBeNull();
      expect(parseDeveloperNotification({ message: { data: 'not-base64-json!' } })).toBeNull();
    });
  });

  describe('decideSubscriptionAction', () => {
    const now = 1_000_000_000_000;
    const future = now + 86_400_000;
    const past = now - 86_400_000;

    it('ACTIVE + 만료 미래 → entitle', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ACTIVE', future, now)).toBe('entitle');
    });

    it('GRACE_PERIOD + 만료 미래 → entitle', () => {
      expect(
        decideSubscriptionAction('SUBSCRIPTION_STATE_IN_GRACE_PERIOD', future, now),
      ).toBe('entitle');
    });

    it('CANCELED + 만료 미래 → cancel_at_period_end (기간까지 유지)', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_CANCELED', future, now)).toBe(
        'cancel_at_period_end',
      );
    });

    it('CANCELED + 만료 지남 → deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_CANCELED', past, now)).toBe('deactivate');
    });

    it('EXPIRED → deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_EXPIRED', past, now)).toBe('deactivate');
    });

    it('ON_HOLD / PAUSED / REVOKED → deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ON_HOLD', future, now)).toBe('deactivate');
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_PAUSED', future, now)).toBe('deactivate');
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_REVOKED', past, now)).toBe('deactivate');
    });

    it('ACTIVE 라도 만료가 지났으면 deactivate (방어적)', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ACTIVE', past, now)).toBe('deactivate');
    });

    it('만료시각이 NaN 이면 deactivate', () => {
      expect(decideSubscriptionAction('SUBSCRIPTION_STATE_ACTIVE', NaN, now)).toBe('deactivate');
    });
  });

  // 위조 RTDN 등급상승 방어: 등급 결정용 productId 는 알림 본문(위조 가능)이 아니라
  // 재조회한 lineItems(권위)에서 와야 한다.
  describe('selectAuthoritativeLineItem (위조 productId 등급상승 차단)', () => {
    it('위조된 상위 productId 알림이 와도 실제 구독 lineItem(저가) 을 고른다', () => {
      const lineItems = [{ productId: 'personal_monthly', expiryTime: '2999-01-01T00:00:00Z' }];
      // 공격자가 family_monthly 로 위조해도 → 실제 personal lineItem 이 선택됨
      const picked = selectAuthoritativeLineItem(lineItems, 'family_monthly');
      expect(picked?.productId).toBe('personal_monthly');
    });

    it('알림 productId 가 실제 lineItem 과 일치하면 그 항목을 고른다', () => {
      const lineItems = [
        { productId: 'personal_monthly' },
        { productId: 'family_monthly' },
      ];
      expect(selectAuthoritativeLineItem(lineItems, 'family_monthly')?.productId).toBe(
        'family_monthly',
      );
    });

    it('lineItems 가 없으면 undefined (등급 부여 불가)', () => {
      expect(selectAuthoritativeLineItem(undefined, 'family_monthly')).toBeUndefined();
      expect(selectAuthoritativeLineItem([], 'family_monthly')).toBeUndefined();
    });
  });
});
