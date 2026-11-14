// 카카오 로그인 — 앱이 카카오 SDK 로 받은 **액세스 토큰**을 카카오 API 에 물어 확인한다(2026-11-14).
//
// 구글·애플은 서명된 ID 토큰을 공개키로 검증하지만, 카카오는 액세스 토큰을 카카오에 직접 묻는다:
//  1) `GET /v1/user/access_token_info` — 이 토큰이 **우리 앱(KAKAO_APP_ID)** 에게 발급됐는가. 다른 앱용으로
//     발급된 유효한 토큰을 받아 주면 그 앱 사용자가 우리 계정을 차지할 수 있다(애플의 aud 대조와 같은 이유).
//     앱 안의 네이티브 키가 여럿이어도(정식 / dev 앱) 같은 카카오 앱이라 app_id 는 하나다.
//  2) `GET /v2/user/me` — 회원번호와 카카오계정 이메일. 이메일은 **카카오가 인증한 주소일 때만** 쓴다
//     (`is_email_valid`·`is_email_verified`). 인증 안 된 주소로 기존 계정에 붙이면 남의 이메일을 적어 둔
//     카카오계정이 그 계정을 차지한다.
//
// 로그인 확인에는 비밀값이 필요 없다 — 사용자의 토큰으로만 묻는다(REST API 키·어드민 키를 쓰지 않는다).
// 실패 메시지는 401 로 갈 것(토큰이 틀린 것)만 `Kakao token` 으로 시작한다 — 라우트가 그것으로 401/500 을 가른다.
// 어드민 키는 탈퇴 파기 뒤 연결을 끊을 때(`unlinkKakaoUser`)만 쓴다.

const KAKAO_API = 'https://kapi.kakao.com';
const REQUEST_TIMEOUT_MS = 10_000;

export interface KakaoUser {
  /** 카카오 회원번호(앱마다 고정). 숫자지만 문자열로 다룬다 — 자릿수가 JS 정수 한계에 가까워질 수 있다. */
  kakaoId: string;
  /** 카카오가 인증한 이메일(소문자·공백 제거). 없거나 인증되지 않았으면 null. */
  verifiedEmail: string | null;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function kakaoGet(path: string, accessToken: string, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  const res = await fetchImpl(`${KAKAO_API}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // 400(형식이 틀린 토큰)·401(만료·폐기된 토큰)은 사용자가 보낸 토큰의 문제다 — 다시 로그인하면 된다.
  if (res.status === 400 || res.status === 401) {
    throw new Error(`Kakao token rejected (${path} ${res.status})`);
  }
  if (!res.ok) {
    // 카카오 쪽 장애·한도 — 우리가 볼 일이라 500 으로 간다.
    throw new Error(`Kakao API failed (${path} ${res.status})`);
  }
  const json = (await res.json()) as unknown;
  if (json == null || typeof json !== 'object') {
    throw new Error(`Kakao API returned no object (${path})`);
  }
  return json as Record<string, unknown>;
}

function idOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

export async function verifyKakaoAccessToken(
  accessToken: string,
  expectedAppId: string,
  fetchImpl: FetchLike = fetch,
): Promise<KakaoUser> {
  const info = await kakaoGet('/v1/user/access_token_info', accessToken, fetchImpl);
  const appId = idOf(info.app_id);
  if (appId == null || appId !== expectedAppId.trim()) {
    throw new Error('Kakao token issued for another app');
  }
  const tokenUserId = idOf(info.id);
  if (tokenUserId == null) {
    throw new Error('Kakao API returned no user id');
  }

  const me = await kakaoGet(
    `/v2/user/me?property_keys=${encodeURIComponent('["kakao_account.email"]')}`,
    accessToken,
    fetchImpl,
  );
  const kakaoId = idOf(me.id);
  if (kakaoId == null || kakaoId !== tokenUserId) {
    throw new Error('Kakao token user mismatch');
  }

  const account = (me.kakao_account ?? {}) as Record<string, unknown>;
  const rawEmail = typeof account.email === 'string' ? account.email.trim().toLowerCase() : '';
  const verified = account.is_email_valid === true && account.is_email_verified === true;
  return { kakaoId, verifiedEmail: rawEmail && verified ? rawEmail : null };
}

/**
 * 탈퇴 파기 뒤 카카오 연결을 끊는다. 카카오 정책이 탈퇴 과정에 연결 해제를 **반드시** 넣으라고 한다
 * (카카오 로그인 이해하기 「서비스의 탈퇴 절차」). 서버에는 사용자 토큰이 없으므로 어드민 키로 회원번호를 지정한다.
 *
 * 이미 끊긴 사용자(카카오계정 설정에서 사용자가 먼저 끊었다 — 오류 코드 -101)는 성공으로 본다.
 */
export async function unlinkKakaoUser(adminKey: string, kakaoId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const res = await fetchImpl(`${KAKAO_API}/v1/user/unlink`, {
    method: 'POST',
    headers: {
      Authorization: `KakaoAK ${adminKey}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ target_id_type: 'user_id', target_id: kakaoId }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  if (body?.code === KAKAO_NOT_REGISTERED_USER) return;
  throw new Error(`Kakao unlink failed (${res.status} ${String(body?.code ?? '')})`);
}

/** 앱과 연결되지 않은 사용자 — 이미 끊겼다. */
const KAKAO_NOT_REGISTERED_USER = -101;
