// iOS 푸시(APNs) — 서버가 직접 보내는 경로.
//
// 실제 P-256 키로 JWT 서명을 진짜로 태우고 애플 응답만 목킹한다.
// **유료 계정 없이 전부 검증된다** — 계정에서 오는 값(Key ID / Team ID / .p8)은 형식만
// 맞으면 되고, 실제 값은 발급받은 뒤에 넣는다.
import { describe, it, expect } from 'vitest';
import {
  signApnsJwt,
  sendApnsNotifications,
  isDeadApnsToken,
  apnsConfigFromEnv,
  type ApnsConfig,
} from '../src/lib/apns';

const BUNDLE_ID = 'com.alarmtalk.app';
const TEAM_ID = 'ABCDE12345';

function decodeSeg<T>(seg: string): T {
  const pad = seg.length % 4 === 0 ? '' : '='.repeat(4 - (seg.length % 4));
  const b64 = (seg + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(u8)) as T;
}

let cached: ApnsConfig | null = null;
async function makeConfig(over: Partial<ApnsConfig> = {}): Promise<ApnsConfig> {
  if (!cached) {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    cached = {
      keyId: 'PUSHKEY123',
      teamId: TEAM_ID,
      privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`,
      bundleId: BUNDLE_ID,
    };
  }
  return { ...cached, ...over };
}

describe('signApnsJwt', () => {
  it('애플 규격대로 헤더·클레임을 채운다', async () => {
    const jwt = await signApnsJwt(await makeConfig(), 1_700_000_000_000);
    const [h, p] = jwt.split('.') as [string, string, string];
    expect(decodeSeg<{ alg: string; kid: string }>(h)).toEqual({
      alg: 'ES256',
      kid: 'PUSHKEY123',
    });
    const payload = decodeSeg<{ iss: string; iat: number }>(p);
    expect(payload.iss).toBe(TEAM_ID);
    expect(payload.iat).toBe(1_700_000_000);
  });
});

describe('sendApnsNotifications', () => {
  const MSG = { token: 'devicetoken1', title: '결제가 확인되지 않았어요', body: '카드를 확인해 주세요.' };

  it('알림 payload 와 필수 헤더를 애플 규격대로 보낸다', async () => {
    const config = await makeConfig();
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    const fetchMock = async (url: string, init: RequestInit) => {
      seenUrl = String(url);
      seenHeaders = init.headers as Record<string, string>;
      seenBody = JSON.parse(String(init.body));
      return new Response('', { status: 200 });
    };

    const results = await sendApnsNotifications(
      [{ ...MSG, data: { type: 'plan_changed' } }],
      config,
      fetchMock as unknown as typeof fetch,
    );

    expect(results).toEqual([{ token: 'devicetoken1', success: true }]);
    expect(seenUrl).toBe('https://api.push.apple.com/3/device/devicetoken1');
    expect(seenHeaders['apns-topic']).toBe(BUNDLE_ID);
    expect(seenHeaders['apns-push-type']).toBe('alert');
    expect(seenHeaders.authorization).toMatch(/^bearer /);
    // ⚠ `alert` 가 있어야 **눈에 보이는** 알림이 된다. 데이터만 보내면 사용자는 못 본다.
    expect(seenBody.aps).toMatchObject({ alert: { title: MSG.title, body: MSG.body } });
    expect(seenBody.type).toBe('plan_changed');
  });

  it('개발 환경은 샌드박스로 보낸다', async () => {
    const config = await makeConfig({ useSandbox: true });
    let seenUrl = '';
    const fetchMock = async (url: string) => {
      seenUrl = String(url);
      return new Response('', { status: 200 });
    };
    await sendApnsNotifications([MSG], config, fetchMock as unknown as typeof fetch);
    expect(seenUrl).toContain('sandbox');
  });

  // ⚠ 한 기기가 실패해도 나머지는 가야 하고, 호출부(결제·보류 처리)가 깨지면 안 된다.
  it('실패해도 던지지 않고 결과로 돌려준다', async () => {
    const config = await makeConfig();
    const fetchMock = async (url: string) =>
      String(url).endsWith('bad')
        ? new Response(JSON.stringify({ reason: 'BadDeviceToken' }), { status: 400 })
        : new Response('', { status: 200 });

    const results = await sendApnsNotifications(
      [{ ...MSG, token: 'bad' }, { ...MSG, token: 'good' }],
      config,
      fetchMock as unknown as typeof fetch,
    );

    expect(results[0]).toEqual({ token: 'bad', success: false, reason: 'BadDeviceToken' });
    expect(results[1]).toEqual({ token: 'good', success: true });
  });

  it('네트워크 오류도 던지지 않는다', async () => {
    const config = await makeConfig();
    const fetchMock = async () => {
      throw new Error('boom');
    };
    const results = await sendApnsNotifications([MSG], config, fetchMock as unknown as typeof fetch);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.reason).toBe('NetworkError');
  });
});

describe('isDeadApnsToken', () => {
  // 애플이 "이 토큰은 죽었다" 고 명시한 것만 지운다.
  it.each(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'])('%s → 지운다', (reason) => {
    expect(isDeadApnsToken(reason)).toBe(true);
  });

  // ⚠ 네트워크 오류로 지우면 그 기기는 재로그인 전까지 푸시를 영영 못 받는다.
  it.each(['NetworkError', 'TooManyRequests', 'InternalServerError', undefined, 'HTTP_503'])(
    '%s → 지우지 않는다',
    (reason) => {
      expect(isDeadApnsToken(reason)).toBe(false);
    },
  );
});

describe('apnsConfigFromEnv', () => {
  const full = {
    APNS_KEY_ID: 'K',
    APNS_PRIVATE_KEY: 'P',
    APPLE_TEAM_ID: 'T',
    APPLE_BUNDLE_ID: 'B',
  };

  // ⚠ 미설정이면 null — 호출부가 조용히 건너뛴다. 푸시가 없다고 보류 처리가 깨지면 안 된다.
  it.each(Object.keys(full))('%s 가 없으면 null', (missing) => {
    const env = { ...full } as Record<string, string>;
    delete env[missing];
    expect(apnsConfigFromEnv(env)).toBeNull();
  });

  it('production 만 프로덕션 APNs 를 쓴다', () => {
    expect(apnsConfigFromEnv({ ...full, ENVIRONMENT: 'production' })?.useSandbox).toBe(false);
    expect(apnsConfigFromEnv({ ...full, ENVIRONMENT: 'development' })?.useSandbox).toBe(true);
    expect(apnsConfigFromEnv(full)?.useSandbox).toBe(true);
  });
});
