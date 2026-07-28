export interface ExternalTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  nonce?: string;
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
): Promise<ExternalTokenPayload> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!res.ok) throw new Error('Google token verification failed');

  const payload = (await res.json()) as ExternalTokenPayload & { exp: number | string };

  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
    throw new Error('Invalid Google token issuer');
  }
  // fail-closed: client ID 미설정 시 aud 검증을 건너뛰지 않고 명시 실패시킨다.
  // (aud 검증이 스킵되면 다른 OAuth 클라이언트용으로 발급된 유효 토큰도 수용돼
  //  이메일 기준 계정 생성/연동 사칭이 가능해진다.)
  if (!expectedClientId) {
    throw new Error('Google client ID is not configured');
  }
  if (payload.aud !== expectedClientId) {
    throw new Error('Token audience mismatch');
  }
  if (Number(payload.exp) < Date.now() / 1000) {
    throw new Error('Token expired');
  }
  // email_verified 미검증 시 email 클레임을 신뢰하면 안 된다(OAuth 계정 연동 탈취
  // 방지). 다운스트림이 email 로 기존 계정과 연동하므로, 검증된 이메일만 통과시킨다.
  if (
    payload.email !== undefined &&
    payload.email_verified !== true &&
    payload.email_verified !== 'true'
  ) {
    throw new Error('Google token email not verified');
  }

  return { ...payload, exp: Number(payload.exp) };
}
