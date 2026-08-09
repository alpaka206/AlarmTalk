// iOS 푸시 — **APNs 로 직접** 보낸다(Firebase iOS SDK 없이).
//
// 왜 Firebase 를 안 쓰나:
//   안드로이드는 이미 FCM 을 쓰지만, iOS 에 Firebase 를 붙이려면 SDK 의존성 +
//   `GoogleService-Info.plist` + 초기화 코드가 들어온다. 그런데 우리가 필요한 건
//   "토큰으로 알림 하나 보내기" 뿐이고, **APNs 인증은 App Store Server API 와 똑같은
//   ES256 JWT** 다(`apple-storekit.ts` 가 이미 그 서명을 한다). 서버에서 직접 쏘는 쪽이
//   앱에 넣을 것이 `UNUserNotificationCenter` 등록뿐이라 훨씬 가볍다.
//   FCM 을 거치면 어차피 애플 키를 Firebase 에 올려야 하므로 보안 이득도 없다.
//
// 필요한 값(전부 Apple Developer 에서 발급, 추가 비용 없음 — 개발자 프로그램에 포함):
//   APNS_KEY_ID · APNS_PRIVATE_KEY(.p8 PEM) · APPLE_TEAM_ID · APPLE_BUNDLE_ID
//
// ⚠ **결제 검증용 키(`APPLE_KEY_ID`/`APPLE_PRIVATE_KEY`)와 다른 키다.** App Store Server
// API 키는 App Store Connect 에서, APNs 키는 Developer Portal 의 Keys 에서 각각 발급하고
// 권한도 다르다. 한쪽에 다른 쪽 값을 넣으면 401 만 나온다.
//
// ⚠ **미설정이면 조용히 아무것도 안 한다**(예외를 던지지 않는다). 푸시는 즉시성만
// 담당하고 정확성은 클라의 재조회가 보장하므로, 키가 없다고 결제·보류 처리가 깨지면 안 된다.

const PRODUCTION_HOST = 'https://api.push.apple.com';
const SANDBOX_HOST = 'https://api.sandbox.push.apple.com';

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  /** .p8 파일 내용 (PEM). */
  privateKeyPem: string;
  /** 푸시 topic = 앱 번들 ID. */
  bundleId: string;
  /** 개발 빌드(Xcode 직접 실행·TestFlight 일부)는 샌드박스로 가야 한다. */
  useSandbox?: boolean;
}

export interface ApnsMessage {
  /** 기기 토큰(16진 문자열). */
  token: string;
  title: string;
  body: string;
  /** 앱이 읽는 부가 데이터. FCM 의 `data` 와 같은 역할. */
  data?: Record<string, string>;
}

export interface ApnsSendResult {
  token: string;
  success: boolean;
  /** APNs `reason`. `BadDeviceToken`/`Unregistered` 면 토큰을 지워야 한다. */
  reason?: string;
}

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * APNs provider JWT(ES256).
 *
 * ⚠ **토큰을 매 요청 새로 만들지 말 것 — 애플이 429(TooManyProviderTokenUpdates)로 막는다.**
 * 유효기간은 최대 1시간이고 애플 권장은 20~60분 재사용이다. 호출부가 `nowMs` 를 20분
 * 단위로 내려 캐시 키로 쓴다.
 */
export async function signApnsJwt(config: ApnsConfig, nowMs: number = Date.now()): Promise<string> {
  const now = Math.floor(nowMs / 1000);
  const header = { alg: 'ES256', kid: config.keyId };
  const payload = { iss: config.teamId, iat: now };
  const data = `${b64url(new TextEncoder().encode(JSON.stringify(header)))}.${b64url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(data),
  );
  return `${data}.${b64url(sig)}`;
}

/**
 * 알림을 보낸다. 실패해도 **던지지 않고** 결과 배열로 돌려준다 — 한 기기가 실패해도
 * 나머지는 가야 하고, 호출부의 결제·보류 처리가 깨지면 안 된다.
 */
export async function sendApnsNotifications(
  messages: ApnsMessage[],
  config: ApnsConfig,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<ApnsSendResult[]> {
  if (messages.length === 0) return [];
  const host = config.useSandbox ? SANDBOX_HOST : PRODUCTION_HOST;

  let jwt: string;
  try {
    jwt = await signApnsJwt(config, nowMs);
  } catch {
    // 키가 깨졌다 — 전부 실패로 보고하되 던지지 않는다.
    return messages.map((m) => ({ token: m.token, success: false, reason: 'InvalidProviderToken' }));
  }

  const results: ApnsSendResult[] = [];
  for (const message of messages) {
    // ⚠ `alert` 를 채워야 **눈에 보이는 알림**이 된다. 데이터만 보내면 사용자는 아무것도
    //   못 보고, 앱이 백그라운드면 그마저도 늦게 온다.
    const payload = {
      aps: {
        alert: { title: message.title, body: message.body },
        sound: 'default',
      },
      ...(message.data ?? {}),
    };
    try {
      const res = await fetchImpl(`${host}/3/device/${encodeURIComponent(message.token)}`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${jwt}`,
          'apns-topic': config.bundleId,
          // alert 푸시는 10 이 즉시 전송이다(5 는 절전 대기).
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        results.push({ token: message.token, success: true });
        continue;
      }
      let reason = `HTTP_${res.status}`;
      try {
        const parsed = (await res.json()) as { reason?: string };
        if (parsed.reason) reason = parsed.reason;
      } catch {
        // 본문이 비었거나 JSON 이 아니다 — 상태 코드만 남긴다.
      }
      results.push({ token: message.token, success: false, reason });
    } catch {
      // 네트워크 오류 — 토큰 문제가 아니므로 **정리 대상으로 표시하지 않는다**.
      results.push({ token: message.token, success: false, reason: 'NetworkError' });
    }
  }
  return results;
}

/**
 * 이 실패가 **토큰을 지워야 하는** 종류인가.
 *
 * ⚠ 네트워크 오류·일시 장애로 토큰을 지우면 그 기기는 다시 로그인하기 전까지 푸시를
 * 영영 못 받는다. 애플이 "이 토큰은 죽었다" 고 명시한 경우만 지운다.
 */
export function isDeadApnsToken(reason: string | undefined): boolean {
  return reason === 'BadDeviceToken' || reason === 'Unregistered' || reason === 'DeviceTokenNotForTopic';
}

export function apnsConfigFromEnv(env: {
  APNS_KEY_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APPLE_TEAM_ID?: string;
  APPLE_BUNDLE_ID?: string;
  ENVIRONMENT?: string;
}): ApnsConfig | null {
  if (!env.APNS_KEY_ID || !env.APNS_PRIVATE_KEY || !env.APPLE_TEAM_ID || !env.APPLE_BUNDLE_ID) {
    return null;
  }
  return {
    keyId: env.APNS_KEY_ID,
    teamId: env.APPLE_TEAM_ID,
    privateKeyPem: env.APNS_PRIVATE_KEY,
    bundleId: env.APPLE_BUNDLE_ID,
    // prod 워커만 프로덕션 APNs 를 쓴다. dev 워커는 샌드박스(Xcode 직접 설치 빌드)로 보낸다 —
    // 반대로 하면 "토큰은 맞는데 알림이 안 온다"가 되어 원인을 찾기 어렵다.
    useSandbox: env.ENVIRONMENT !== 'production',
  };
}
