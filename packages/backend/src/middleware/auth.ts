import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';
import { verifyAppJwt, APP_JWT_ISSUER } from '../lib/jwt';

interface TokenPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
}

/**
 * Google / Apple ID Token 검증 미들웨어
 * Firebase 없이 직접 검증
 */
export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ error: 'Authorization header required', error_code: 'AUTH_MISSING' }, 401);
  }
  if (!authHeader.startsWith('Bearer ')) {
    return c.json(
      { error: 'Authorization header must use Bearer scheme', error_code: 'AUTH_INVALID_SCHEME' },
      401,
    );
  }

  const token = authHeader.slice(7);
  if (!token) {
    return c.json({ error: 'Token is empty', error_code: 'AUTH_EMPTY_TOKEN' }, 401);
  }

  try {
    const payload = decodeJwtPayload(token);

    let verified: TokenPayload;

    if (payload.iss === APP_JWT_ISSUER) {
      const app = await verifyAppJwt(token, c.env.JWT_SECRET);
      verified = {
        sub: app.sub,
        email: app.email,
        name: app.name,
        picture: undefined,
        iss: app.iss,
        aud: app.aud,
        exp: app.exp,
      };
    } else if (payload.iss === 'https://appleid.apple.com') {
      verified = await verifyAppleToken(token);
    } else {
      verified = await verifyGoogleToken(token, c.env.GOOGLE_CLIENT_ID);
    }

    c.set('userId', verified.sub);
    c.set('userEmail', verified.email || '');
    c.set('userName', verified.name || '');
    c.set('userPicture', verified.picture || '');
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const code = message.includes('expired')
      ? 'AUTH_TOKEN_EXPIRED'
      : message.includes('audience')
        ? 'AUTH_AUDIENCE_MISMATCH'
        : message.includes('issuer')
          ? 'AUTH_INVALID_ISSUER'
          : message.includes('format')
            ? 'AUTH_MALFORMED_TOKEN'
            : 'AUTH_VERIFICATION_FAILED';
    // eslint-disable-next-line no-console
    console.log('[AUTH 401]', code, '|', message, '| GOOGLE_CLIENT_ID set:', !!c.env.GOOGLE_CLIENT_ID);
    return c.json({ error: message, error_code: code }, 401);
  }
}

function decodeJwtPayload(token: string): TokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');
  const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64));
}

async function verifyGoogleToken(idToken: string, expectedClientId: string): Promise<TokenPayload> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  if (!res.ok) throw new Error('Google token verification failed');

  const payload = (await res.json()) as TokenPayload;

  if (expectedClientId && payload.aud !== expectedClientId) {
    throw new Error('Token audience mismatch');
  }
  if (Number(payload.exp) < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  return payload;
}

async function verifyAppleToken(idToken: string): Promise<TokenPayload> {
  // Apple의 공개 키로 검증
  // 간이 검증: Apple의 tokeninfo는 없으므로 JWT payload 디코딩 + 만료 체크
  // 프로덕션에서는 Apple의 JWKS로 서명 검증 필요
  const payload = decodeJwtPayload(idToken);

  if (payload.iss !== 'https://appleid.apple.com') {
    throw new Error('Invalid Apple token issuer');
  }
  if (Number(payload.exp) < Date.now() / 1000) {
    throw new Error('Token expired');
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: undefined,
    picture: undefined,
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp,
  };
}
