export interface ExternalTokenPayload {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
}

export function decodeJwtPayload(token: string): ExternalTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64));
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
  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new Error('Token audience mismatch');
  }
  if (Number(payload.exp) < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  return { ...payload, exp: Number(payload.exp) };
}
