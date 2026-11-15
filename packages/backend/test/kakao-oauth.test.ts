// 카카오 액세스 토큰 확인(`lib/kakao-oauth.ts`) — 우리 앱의 토큰인지, 회원번호가 맞는지, **인증된 이메일만** 쓰는지.
import { describe, it, expect } from 'vitest';
import { unlinkKakaoUser, verifyKakaoAccessToken } from '../src/lib/kakao-oauth';

const APP_ID = '1500680';

/** 경로별 응답을 정해 둔 가짜 fetch. 부른 경로와 헤더를 적어 둔다. */
function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = async (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: input, auth: headers.get('Authorization') });
    const key = Object.keys(routes).find((path) => input.includes(path));
    const route = key ? routes[key]! : { status: 404 };
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status });
  };
  return { impl, calls };
}

function okRoutes(account: Record<string, unknown>, overrides: Partial<{ appId: number; tokenUser: number; meUser: number }> = {}) {
  return {
    '/v1/user/access_token_info': { status: 200, body: { id: overrides.tokenUser ?? 4242, app_id: overrides.appId ?? 1500680, expires_in: 100 } },
    '/v2/user/me': { status: 200, body: { id: overrides.meUser ?? 4242, kakao_account: account } },
  };
}

describe('verifyKakaoAccessToken', () => {
  it('우리 앱의 토큰이면 회원번호와 인증된 이메일(소문자)을 돌려준다', async () => {
    const { impl, calls } = fakeFetch(okRoutes({ email: ' User@Example.COM ', is_email_valid: true, is_email_verified: true }));
    const user = await verifyKakaoAccessToken('tok-1', APP_ID, impl);
    expect(user).toEqual({ kakaoId: '4242', verifiedEmail: 'user@example.com' });
    // 사용자의 토큰으로만 묻는다 — 앱 키·어드민 키를 쓰지 않는다.
    expect(calls.every((call) => call.auth === 'Bearer tok-1')).toBe(true);
    expect(calls[1]!.url).toContain('property_keys=');
  });

  it('카카오가 인증하지 않은 이메일은 쓰지 않는다', async () => {
    const { impl } = fakeFetch(okRoutes({ email: 'user@example.com', is_email_valid: true, is_email_verified: false }));
    expect(await verifyKakaoAccessToken('tok', APP_ID, impl)).toEqual({ kakaoId: '4242', verifiedEmail: null });
  });

  it('유효하지 않은 이메일·이메일 없음도 null 이다', async () => {
    const invalid = fakeFetch(okRoutes({ email: 'user@example.com', is_email_valid: false, is_email_verified: true }));
    expect((await verifyKakaoAccessToken('tok', APP_ID, invalid.impl)).verifiedEmail).toBeNull();
    const none = fakeFetch(okRoutes({ has_email: false }));
    expect((await verifyKakaoAccessToken('tok', APP_ID, none.impl)).verifiedEmail).toBeNull();
  });

  it('다른 카카오 앱에게 발급된 토큰은 거절한다(401 갈래)', async () => {
    const { impl, calls } = fakeFetch(okRoutes({}, { appId: 999 }));
    await expect(verifyKakaoAccessToken('tok', APP_ID, impl)).rejects.toThrow(/^Kakao token issued for another app/);
    // 남의 토큰으로 사용자 정보를 더 묻지 않는다.
    expect(calls).toHaveLength(1);
  });

  it('토큰 정보와 사용자 정보의 회원번호가 다르면 거절한다', async () => {
    const { impl } = fakeFetch(okRoutes({}, { tokenUser: 1, meUser: 2 }));
    await expect(verifyKakaoAccessToken('tok', APP_ID, impl)).rejects.toThrow(/^Kakao token user mismatch/);
  });

  it('카카오가 400·401 로 거절한 토큰은 "Kakao token" 으로 시작하는 오류다', async () => {
    for (const status of [400, 401]) {
      const { impl } = fakeFetch({ '/v1/user/access_token_info': { status, body: { code: -401 } } });
      await expect(verifyKakaoAccessToken('bad', APP_ID, impl)).rejects.toThrow(/^Kakao token rejected/);
    }
  });

  it('카카오 장애(5xx)는 토큰 거절이 아니다 — 500 갈래로 간다', async () => {
    const { impl } = fakeFetch({ '/v1/user/access_token_info': { status: 503 } });
    await expect(verifyKakaoAccessToken('tok', APP_ID, impl)).rejects.toThrow(/^Kakao API failed/);
  });
});

// 탈퇴 파기 뒤 연결 끊기 — 카카오 정책상 탈퇴 과정에 반드시 넣는다(`index.ts` 의 유예 파기).
describe('unlinkKakaoUser', () => {
  it('어드민 키로 회원번호를 지정해 끊는다', async () => {
    let seen: { url: string; auth: string | null; body: string } | null = null;
    const impl = async (input: string, init?: RequestInit) => {
      seen = { url: input, auth: new Headers(init?.headers).get('Authorization'), body: String(init?.body) };
      return new Response(JSON.stringify({ id: 4242 }), { status: 200 });
    };
    await unlinkKakaoUser('admin-key', '4242', impl);
    expect(seen).toEqual({
      url: 'https://kapi.kakao.com/v1/user/unlink',
      auth: 'KakaoAK admin-key',
      body: 'target_id_type=user_id&target_id=4242',
    });
  });

  it('이미 끊긴 사용자(-101)는 성공으로 본다 — 사용자가 카카오계정 설정에서 먼저 끊었다', async () => {
    const impl = async () => new Response(JSON.stringify({ code: -101, msg: 'NotRegisteredUserException' }), { status: 400 });
    await expect(unlinkKakaoUser('admin-key', '4242', impl)).resolves.toBeUndefined();
  });

  it('그 밖의 실패는 던진다 — 파기 크론이 경보로 올린다', async () => {
    const impl = async () => new Response(JSON.stringify({ code: -401, msg: 'InvalidTokenException' }), { status: 401 });
    await expect(unlinkKakaoUser('wrong-key', '4242', impl)).rejects.toThrow(/^Kakao unlink failed \(401 -401\)/);
  });
});
