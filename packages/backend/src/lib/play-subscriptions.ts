/**
 * Google Play 구독 서버 제어 (purchases.subscriptionsv2 get/cancel/revoke).
 *
 * billing-google.ts(confirm)·billing-google-rtdn.ts 와 같은 서비스 계정 인증
 * (getGoogleAccessToken + androidpublisher scope)을 재사용한다.
 *
 * 호출자 규약: "Play 성공을 확인하기 전에는 로컬 DB·음성 데이터를 바꾸지 않는다."
 * 그래서 여기 함수들은 실패를 조용히 삼키지 않고 전부 throw 한다.
 *  - PlayBillingUnconfiguredError: 서비스 계정/패키지 env 미설정 (호출자가 스텁 폴백/스킵 판단)
 *  - PlayApiError: Play API 가 non-2xx 반환 (호출자가 502 매핑)
 */
import type { Env } from '../types';
import { getGoogleAccessToken, parseServiceAccountJson } from './google-oauth';

export const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export interface SubscriptionV2Response {
  subscriptionState?: string;
  acknowledgementState?: string;
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    /** autoRenewEnabled=false 면 사용자가 자동갱신을 꺼둔 상태(기간종료 해지 예약). */
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
  latestOrderId?: string;
  /**
   * 구매 시 클라가 setObfuscatedAccountId 로 실은 계정 식별자.
   * 계약(Android 와 공유): sha256hex(로그인 사용자 id — JWT sub 와 동일한 세션 user id).
   * confirm 의 구매-계정 바인딩 검증(billing-google.ts)에 쓴다.
   */
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  /**
   * **교체 구매(업/다운그레이드)에서 대체된 옛 purchaseToken.**
   *
   * Play 는 `setSubscriptionUpdateParams` 로 산 구독에 **새 purchaseToken** 을 발급하고,
   * 옛 토큰을 여기 남긴다. 우리 RTDN 은 `store_transactions` 에 매핑된 토큰으로만
   * 사용자를 찾으므로, 이 값이 없으면 전환 알림이 **매핑 없는 토큰**으로 버려진다
   * (2026-08-11 확인 — 전환이 RTDN 으로 안 잡히던 원인).
   */
  linkedPurchaseToken?: string;
}

export const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
]);

/** Play 구독 제어에 필요한 env 부분집합 (billing-google.ts confirm 과 동일 시크릿). */
/**
 * **결제 실패로 보류된(회복형) 상태인가** — 종료가 아니라 카드만 다시 긁는 중이다.
 *
 * ⚠ RTDN 갈래와 만료 크론 재조회가 **같은 판정을 써야 한다.** 갈라지면 한쪽은 그룹을
 * 보존했는데 다른 쪽이 5분 뒤 해체하는 사고가 난다(실제로 그랬다).
 */
export function isRecoverablePlayState(state: string): boolean {
  return state === 'SUBSCRIPTION_STATE_ON_HOLD' || state === 'SUBSCRIPTION_STATE_PAUSED';
}

export type PlayEnv = Pick<Env, 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON' | 'ANDROID_PACKAGE_NAME'>;

/** 서비스 계정/패키지 env 미설정 — 호출자가 스텁 폴백이나 스킵을 판단한다. */
export class PlayBillingUnconfiguredError extends Error {
  constructor() {
    super('Google Play billing is not configured (service account or package name missing)');
    this.name = 'PlayBillingUnconfiguredError';
  }
}

/** Play API non-2xx — 호출자가 502 매핑 등으로 구분 처리한다. */
class PlayApiError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(operation: string, status: number, detail: string) {
    super(`Play subscriptionsv2 ${operation} failed: ${status} ${detail}`);
    this.name = 'PlayApiError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * 사용자가 스토어에서 직접 구독을 관리할 수 있는 Play 딥링크.
 * 서버 측 cancel/revoke 실패 시 응답 manage_url 로 내려 클라가 안내한다.
 */
export function playManageUrl(
  productId?: string | null,
  packageName?: string | null,
): string {
  const base = 'https://play.google.com/store/account/subscriptions';
  if (!productId || !packageName) return base;
  return `${base}?sku=${encodeURIComponent(productId)}&package=${encodeURIComponent(packageName)}`;
}

function requirePlayConfig(env: PlayEnv): {
  account: NonNullable<ReturnType<typeof parseServiceAccountJson>>;
  packageName: string;
} {
  const account = parseServiceAccountJson(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const packageName = env.ANDROID_PACKAGE_NAME;
  if (!account || !packageName) throw new PlayBillingUnconfiguredError();
  return { account, packageName };
}

async function playSubscriptionFetch(
  env: PlayEnv,
  purchaseToken: string,
  action: '' | ':cancel' | ':revoke',
  init?: { method: 'POST'; body: string },
): Promise<Response> {
  const { account, packageName } = requirePlayConfig(env);
  const accessToken = await getGoogleAccessToken(account, ANDROID_PUBLISHER_SCOPE);
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}${action}`;
  return fetch(url, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init ? { body: init.body } : {}),
  });
}

/**
 * 기간종료 해지 — 자동갱신만 끄고 남은 기간은 유지한다. 성공 시 빈 응답(2xx).
 * 성공해야만 호출자가 로컬 cancel_at_period_end 를 세울 수 있다.
 */
export async function playCancelSubscription(env: PlayEnv, purchaseToken: string): Promise<void> {
  const res = await playSubscriptionFetch(env, purchaseToken, ':cancel', {
    method: 'POST',
    body: JSON.stringify({
      cancellationContext: { cancellationType: 'USER_REQUESTED_STOP_RENEWALS' },
    }),
  });
  if (res.ok) return;
  const apiError = new PlayApiError('cancel', res.status, (await res.text()).slice(0, 300));
  // 복구 경로: 직전 시도에서 Play 취소는 성공했지만 DB 반영 전에 실패한 갈림 창에서는,
  // 사용자 재시도가 Play 로부터 4xx(이미 취소됨)를 받는다. 실상태를 재조회해 자동갱신이
  // 이미 꺼져 있으면(autoRenew=false 또는 CANCELED) 성공으로 간주한다 — 재시도가 502
  // 무한 루프에 빠지지 않고 전체 성공으로 수렴하게 하는 장치다. 그 외 에러·재조회 실패는
  // 기존대로 throw 해 호출자가 502 로 매핑한다.
  if (apiError.status >= 400 && apiError.status < 500) {
    try {
      const sub = await getPlaySubscriptionV2(env, purchaseToken);
      const autoRenew = sub.lineItems?.[0]?.autoRenewingPlan?.autoRenewEnabled;
      if (autoRenew === false || sub.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED') return;
    } catch {
      // 재조회 실패 — 원래 cancel 에러로 처리.
    }
  }
  throw apiError;
}

/**
 * 즉시 해지 — 구독을 즉시 종료하고 남은 기간을 비례 환불한다. 성공 시 빈 응답(2xx).
 * 성공해야만 호출자가 로컬 구독을 cancelled 로 바꿀 수 있다.
 */
export async function playRevokeSubscription(env: PlayEnv, purchaseToken: string): Promise<void> {
  const res = await playSubscriptionFetch(env, purchaseToken, ':revoke', {
    method: 'POST',
    body: JSON.stringify({ revocationContext: { proratedRefund: {} } }),
  });
  if (res.ok) return;
  const apiError = new PlayApiError('revoke', res.status, (await res.text()).slice(0, 300));
  // 복구 경로(cancel 과 동일한 갈림 창 수렴): revoke 4xx 면 실상태를 재조회해 이미
  // EXPIRED/REVOKED(=entitled 아님)면 성공으로 간주한다. 그 외에는 기존대로 throw.
  if (apiError.status >= 400 && apiError.status < 500) {
    try {
      const sub = await getPlaySubscriptionV2(env, purchaseToken);
      const state = sub.subscriptionState ?? '';
      if (state === 'SUBSCRIPTION_STATE_EXPIRED' || state === 'SUBSCRIPTION_STATE_REVOKED') return;
    } catch {
      // 재조회 실패 — 원래 revoke 에러로 처리.
    }
  }
  throw apiError;
}

/**
 * 구독 실상태 재조회 — RTDN 유실 대비 reconciliation·confirm 검증에 쓴다.
 * (알림/클라 주장을 신뢰하지 않고 Play 응답만 권위로 삼는 기존 전략과 동일.)
 */
export async function getPlaySubscriptionV2(
  env: PlayEnv,
  purchaseToken: string,
): Promise<SubscriptionV2Response> {
  const res = await playSubscriptionFetch(env, purchaseToken, '');
  if (!res.ok) throw new PlayApiError('get', res.status, (await res.text()).slice(0, 300));
  return (await res.json()) as SubscriptionV2Response;
}
