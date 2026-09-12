// iOS 푸시(APNs) — 서버가 직접 보내는 경로.
//
// 실제 P-256 키로 JWT 서명을 진짜로 태우고 애플 응답만 목킹한다.
// **유료 계정 없이 전부 검증된다** — 계정에서 오는 값(Key ID / Team ID / .p8)은 형식만
// 맞으면 되고, 실제 값은 발급받은 뒤에 넣는다.
import { describe, it, expect } from 'vitest';
import {
  signApnsJwt,
  getApnsProviderToken,
  __resetApnsProviderTokenCacheForTests,
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

// ---------------------------------------------------------------------------
// 조용한 푸시(background) — **알림 권한 없이도 앱을 깨우는** 경로.
//
// ⚠ 가족 알람이 여기 해당한다. iOS 에는 안드로이드 WorkManager 같은 보장된 주기 실행이
// 없어서, 이 푸시가 받은 알람을 제때 예약하는 실질적으로 유일한 즉시 경로다.
// ---------------------------------------------------------------------------
describe('조용한 푸시(silent)', () => {
  it('애플 규격대로 content-available + background + priority 5 로 보낸다', async () => {
    const config = await makeConfig();
    let headers: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const fetchMock = async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      body = JSON.parse(String(init.body));
      return new Response('', { status: 200 });
    };

    await sendApnsNotifications(
      [{ token: 't', title: '', body: '', data: { type: 'family_alarm', alarmId: 'a1' }, silent: true }],
      config,
      fetchMock as unknown as typeof fetch,
    );

    expect(headers['apns-push-type']).toBe('background');
    // ⚠ **반드시 5.** priority 10 으로 보내면 애플이 조용한 푸시를 거절한다.
    expect(headers['apns-priority']).toBe('5');
    expect(body.aps).toEqual({ 'content-available': 1 });
    // 배너를 띄우지 않는다 — alert 가 있으면 권한이 필요해진다.
    expect(JSON.stringify(body.aps)).not.toContain('alert');
    // 앱이 무엇을 할지 알아야 하므로 data 는 실린다.
    expect(body.type).toBe('family_alarm');
    expect(body.alarmId).toBe('a1');
  });

  it('표시용과 조용한 푸시가 같은 함수에서 갈린다', async () => {
    const config = await makeConfig();
    const seen: Array<Record<string, string>> = [];
    const fetchMock = async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response('', { status: 200 });
    };

    await sendApnsNotifications(
      [
        { token: 'a', title: '제목', body: '내용' },
        { token: 'b', title: '', body: '', silent: true },
      ],
      config,
      fetchMock as unknown as typeof fetch,
    );

    expect(seen[0]!['apns-push-type']).toBe('alert');
    expect(seen[0]!['apns-priority']).toBe('10');
    expect(seen[1]!['apns-push-type']).toBe('background');
    expect(seen[1]!['apns-priority']).toBe('5');
  });
});


// ── provider 토큰 재사용 (2026-08-18 Codex #697 P1)
//
// 애플은 provider 토큰을 자주 갈면 `TooManyProviderTokenUpdates` 로 막는다. 예전에는
// `sendApnsNotifications` 가 배치마다 `signApnsJwt` 를 새로 불러 `iat` 가 매번 달랐다 —
// 재사용 규약이 **주석에만** 있고 그렇게 하는 호출부가 없었다.
describe('getApnsProviderToken — 재사용 창', () => {
  it('20분 안에는 같은 토큰을 돌려준다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const config = await makeConfig();
    const t0 = 1_700_000_000_000;

    const first = await getApnsProviderToken(config, t0);
    const soon = await getApnsProviderToken(config, t0 + 19 * 60 * 1000);

    expect(soon).toBe(first);
  });

  it('20분이 지나면 새로 서명한다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const config = await makeConfig();
    const t0 = 1_700_000_000_000;

    const first = await getApnsProviderToken(config, t0);
    const later = await getApnsProviderToken(config, t0 + 21 * 60 * 1000);

    expect(later).not.toBe(first);
    // `iat` 가 실제로 전진했는지 — 같은 값 재서명이 아니다.
    const iat = (jwt: string) => decodeSeg<{ iat: number }>(jwt.split('.')[1]!).iat;
    expect(iat(later)).toBeGreaterThan(iat(first));
  });

  it('설정이 다르면 서로의 토큰을 쓰지 않는다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const t0 = 1_700_000_000_000;
    const a = await getApnsProviderToken(await makeConfig(), t0);
    const b = await getApnsProviderToken(await makeConfig({ keyId: 'OTHERKEY99' }), t0);

    expect(b).not.toBe(a);
  });

  it('시계가 뒤로 가면 다시 서명한다 — 미래 발급 토큰은 애플이 거절한다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const config = await makeConfig();
    const t0 = 1_700_000_000_000;

    const first = await getApnsProviderToken(config, t0);
    const backwards = await getApnsProviderToken(config, t0 - 60_000);

    expect(backwards).not.toBe(first);
  });

  it('여러 배치가 같은 authorization 헤더를 쓴다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const config = await makeConfig();
    const seen: string[] = [];
    const fetchMock = async (_url: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).authorization!);
      return new Response('', { status: 200, headers: { 'apns-id': 'x' } });
    };
    const msg = { token: 'a'.repeat(64), title: 't', body: 'b' };

    const t0 = 1_700_000_000_000;
    await sendApnsNotifications([msg], config, fetchMock as unknown as typeof fetch, t0);
    await sendApnsNotifications([msg], config, fetchMock as unknown as typeof fetch, t0 + 60_000);

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
  });

  it('동시에 밀려와도 하나만 서명한다 — await 이전에 캐시에 넣는다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const config = await makeConfig();
    const t0 = 1_700_000_000_000;

    // 캐시가 비어 있는 상태에서 **동시에** 8개가 들어온다(워커 isolate 의 실제 모양).
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => getApnsProviderToken(config, t0)),
    );

    expect(new Set(tokens).size).toBe(1);
  });

  it('서명이 실패하면 캐시에 남기지 않는다 — 20분간 전부 죽으면 안 된다', async () => {
    __resetApnsProviderTokenCacheForTests();
    const broken = await makeConfig({ privateKeyPem: 'not-a-pem' });
    const t0 = 1_700_000_000_000;

    await expect(getApnsProviderToken(broken, t0)).rejects.toBeDefined();

    // 같은 창 안이라도 다시 시도할 수 있어야 한다(캐시에 실패가 남았으면 즉시 같은 오류).
    await expect(getApnsProviderToken(broken, t0 + 1000)).rejects.toBeDefined();

    // 키가 고쳐지면 곧바로 회복된다.
    const fixed = await getApnsProviderToken(await makeConfig(), t0 + 2000);
    expect(typeof fixed).toBe('string');
  });
});
