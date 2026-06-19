/**
 * 인증 미들웨어. 모든 보호 라우트(`/api/*`)는 이 미들웨어를 통과한다.
 *
 * Firebase 없이 Bearer 토큰을 직접 검증한다. 토큰의 `iss`(발급자)를 보고
 * 세 가지 경로로 분기한다:
 *  - 자체 발급 앱 JWT(APP_JWT_ISSUER)  → verifyAppJwt
 *  - Google ID Token                   → verifyGoogleIdToken
 *  - Apple ID Token                    → verifyAppleIdToken
 *
 * 검증 후 `users` 행을 해석(없으면 즉석 생성)해 `userIdPK`(FK 기준 식별자)를
 * 컨텍스트에 심고, 탈퇴 유예(pending_deletion) 계정은 본인조회/철회 외 API를 막는다.
 */
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';
import { verifyAppJwt, APP_JWT_ISSUER } from '../lib/jwt';
import { decodeJwtPayload, verifyAppleIdToken, verifyGoogleIdToken } from '../lib/oauth';

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
      if (!c.env.APPLE_CLIENT_ID) {
        throw new Error('Apple client ID is not configured');
      }
      verified = await verifyAppleIdToken(token, c.env.APPLE_CLIENT_ID);
    } else if (
      payload.iss === 'accounts.google.com' ||
      payload.iss === 'https://accounts.google.com'
    ) {
      verified = await verifyGoogleIdToken(token, c.env.GOOGLE_CLIENT_ID);
    } else {
      throw new Error('Invalid token issuer');
    }

    // Legacy convention: most routes still query `WHERE google_id = ?`, so
    // `userId` keeps that meaning (the JWT sub).
    c.set('userId', verified.sub);
    c.set('userEmail', verified.email || '');
    c.set('userName', verified.name || '');
    c.set('userPicture', verified.picture || '');

    // New convention: `userIdPK` is the actual users.id (UUID for legacy
    // accounts, sub for newly-created ones). Use this for any FOREIGN KEY
    // refs (voice_profiles.user_id, alarms.user_id, ...).
    try {
      const { getDB } = await import('../lib/db');
      const db = getDB(c.env);
      const isApple = verified.iss === 'https://appleid.apple.com';
      const found = await db.execute({
        sql: 'SELECT id, deletion_status FROM users WHERE google_id = ? OR apple_id = ? OR id = ?',
        args: [verified.sub, isApple ? verified.sub : null, verified.sub],
      });
      let pk: string;
      let deletionStatus = 'active';
      if (found.rows.length > 0) {
        pk = String(found.rows[0]!.id);
        deletionStatus = String(found.rows[0]!.deletion_status ?? 'active');
      } else {
        // 최초 인증 시 users 행을 즉석에서 생성한다. 동일 사용자의 동시 첫 요청이
        // 둘 다 INSERT 를 시도해도 중복키 예외로 죽지 않도록 ON CONFLICT DO NOTHING
        // 으로 멱등화한다. 신규 계정은 id = sub 이므로 경쟁 상황에서도 pk 는 일관된다.
        await db.execute({
          sql: `INSERT INTO users (id, google_id, apple_id, email, name, picture)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING`,
          args: [
            verified.sub,
            verified.sub,
            isApple ? verified.sub : null,
            verified.email || `${verified.sub}@unknown`,
            verified.name || null,
            verified.picture || null,
          ],
        });
        pk = verified.sub;
      }
      c.set('userIdPK', pk);

      // 탈퇴 유예(pending_deletion) 계정은 본인정보 조회(GET /user/me)와 탈퇴 철회
      // (DELETE /user/me/deletion) 외의 인증 API 사용을 차단한다(개인정보보호법 제21조,
      // migrations #41 주석). 클라이언트는 이 코드를 받으면 복구 화면으로 유도한다.
      if (deletionStatus === 'pending_deletion') {
        const path = c.req.path;
        const method = c.req.method;
        const isCancelDeletion = method === 'DELETE' && path.endsWith('/user/me/deletion');
        const isReadMe = method === 'GET' && path.endsWith('/user/me');
        if (!isCancelDeletion && !isReadMe) {
          return c.json(
            {
              error: 'Account is scheduled for deletion',
              error_code: 'ACCOUNT_PENDING_DELETION',
            },
            403,
          );
        }
      }
    } catch (err) {
      // 사용자 행 해석에 실패하면 탈퇴 유예(pending_deletion) 여부를 확인할 수 없다.
      // 이때 요청을 계속 처리(fail-open)하면 유예 계정이 차단을 우회할 수 있으므로,
      // 상태 확인 불가 시에는 요청을 거부한다(fail-closed). PII 는 로그에 남기지 않는다.
      const { logStructured } = await import('../lib/logger');
      logStructured('error', {
        at: 'auth.user_resolve',
        error: err instanceof Error ? err.message : String(err),
      });
      return c.json(
        { error: 'Unable to verify account status', error_code: 'ACCOUNT_STATUS_UNVERIFIED' },
        503,
      );
    }

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
    // 검증 실패 상세(토큰 발급자/audience)·구성 단서(GOOGLE_CLIENT_ID 설정 여부)를
    // 평문 콘솔에 남기면 토큰 위조 탐색에 악용될 수 있어, 코드만 구조화 로그로 남긴다.
    const { logStructured } = await import('../lib/logger');
    logStructured('warn', { at: 'auth.verify_failed', code });
    return c.json({ error: message, error_code: code }, 401);
  }
}
