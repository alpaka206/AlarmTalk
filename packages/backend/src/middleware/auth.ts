/**
 * 인증 미들웨어. 모든 보호 라우트(`/api/*`)는 이 미들웨어를 통과한다.
 *
 * **앱 JWT 전용(B5).** 과거에는 Google ID Token 을 Bearer 로 직접 받아
 * 검증했으나, provider ID 토큰을 그대로 통과시키면 (a) 폐기/로그아웃 불가
 * (token_epoch 가 없음) (b) audience/만료가 provider 정책에 종속되는 문제가 있다.
 * 이제 provider 토큰은 오직 /auth/google 교환 엔드포인트에서만 쓰이고,
 * 그 외 모든 보호 라우트는 자체 발급 앱 JWT(APP_JWT_ISSUER) 만 받는다.
 *
 * 검증 후 `users` 행을 해석해(없으면 401) `userIdPK`(FK 기준 식별자)를
 * 컨텍스트에 심고, (1) JWT epoch < users.token_epoch 이면 폐기된 토큰으로 보아
 * 401(TOKEN_REVOKED), (2) 탈퇴 유예(pending_deletion) 계정은 본인조회/철회 외
 * API 를 막는다.
 */
import type { Context, Next } from 'hono';
import type { ErrorCode } from '@alarmtalk/shared';
import type { AppEnv } from '../types';
import { verifyAppJwt } from '../lib/jwt';

interface TokenPayload {
  sub: string;
  email?: string;
  name?: string;
  iss: string;
  aud: string;
  exp: number;
  epoch: number;
}

/**
 * 앱 JWT 전용 인증 미들웨어 (provider ID 토큰 직접 수용 제거됨).
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
    // 앱 JWT 만 수용한다. provider(Google) ID 토큰은 여기서 거부되고,
    // /auth/google 교환 라우트(authMiddleware 비적용)에서만 처리된다.
    // verifyAppJwt 가 iss/aud/exp/서명을 모두 검증하며 실패 시 throw → 401.
    const app = await verifyAppJwt(token, c.env.JWT_SECRET);
    const verified: TokenPayload = {
      sub: app.sub,
      email: app.email,
      name: app.name,
      iss: app.iss,
      aud: app.aud,
      exp: app.exp,
      epoch: app.epoch ?? 0,
    };

    // 토큰이 담고 있던 로그인 식별자. 아래에서 users.id 로 해석한 뒤 userId 는 PK 로
    // 덮어쓰므로, 레거시 행 보조 매칭이 필요한 곳은 이 값을 쓴다.
    c.set('userLoginId', verified.sub);
    c.set('userId', verified.sub);
    c.set('userEmail', verified.email || '');
    c.set('userName', verified.name || '');

    // `userId`(JWT sub)와 `userIdPK`(users.id)는 이제 같은 값이다 — sub 이 users.id 로
    // 통일됐다(auth.ts). FK 참조(voice_profiles.user_id, alarms.user_id, ...)에는
    // `userIdPK` 를 쓴다.
    try {
      const { getDB } = await import('../lib/db');
      const db = getDB(c.env);
      // sub 은 이제 항상 users.id 다. `OR google_id = ?` 는 이 변경 전에 발급돼 아직
      // 만료되지 않은 토큰(sub = google_id)을 위한 한시적 폴백이며, 토큰 만료 주기가
      // 한 번 지나면 제거할 수 있다.
      const found = await db.execute({
        sql: 'SELECT id, google_id, deletion_status, token_epoch FROM users WHERE google_id = ? OR id = ?',
        args: [verified.sub, verified.sub],
      });
      let pk: string;
      let googleId: string | null = null;
      let deletionStatus = 'active';
      let tokenEpoch = 0;
      if (found.rows.length > 0) {
        pk = String(found.rows[0]!.id);
        googleId = (found.rows[0]!.google_id as string | null) ?? null;
        deletionStatus = String(found.rows[0]!.deletion_status ?? 'active');
        tokenEpoch = Number(found.rows[0]!.token_epoch ?? 0);
      } else {
        // 사용자 행이 없으면 401 이다. 과거에는 여기서 users 행을 즉석 생성했는데,
        // 계정 행은 /auth/* 교환·가입 라우트가 이미 만들어 주므로 이 경로에 도달한다는 건
        // (a) 계정이 파기됐거나 (b) 토큰이 우리 DB 와 무관하다는 뜻이다. 자동 생성은
        // 탈퇴한 계정을 남은 토큰으로 되살리고, google_id = id = sub 인 행을 만들어
        // 식별자 규약(google_id 는 구글 계정 식별자 전용)을 다시 깨뜨렸다.
        return c.json({ error: 'User not found', error_code: 'AUTH_USER_NOT_FOUND' }, 401);
      }
      c.set('userIdPK', pk);
      // 호환 식별자는 토큰의 sub 이 아니라 DB 의 google_id 다. sub 은 이제 항상 users.id 라,
      // 구글 사용자가 한 번 재로그인하면 sub 만으로는 옛 google_id 를 알 수 없다 — 그러면
      // user_id 에 google_id 가 저장된 과거 알람·메시지·목소리를 영영 못 찾고, 계정 삭제도
      // 그 행들을 남긴다. 구글 계정이 아니면(google_id 없음) sub 을 그대로 쓴다.
      if (googleId && googleId.trim() !== '') c.set('userLoginId', googleId);
      // sub 이 google_id 인 구 토큰(이 브랜치 배포 전 발급분)이면 여기서 users.id 로
      // 맞춘다. 정규화하지 않으면 users.id 로만 조회하는 하류 경로에서 자기 데이터를
      // 못 찾는다 — 유료 구독이 null 로 보여 무료로 취급되고(그 결과 음성 알람이
      // sound-only 로 강등된다), 가족 그룹이 없다고 나오며, /code/register 가 404 다.
      c.set('userId', pk);

      // 토큰 폐기 검사(B5): JWT epoch 가 현재 users.token_epoch 보다 낮으면, 로그아웃
      // (전 기기) 또는 비밀번호 재설정으로 무효화된 구(舊) 토큰이다. 만료 전이라도 거부.
      if (verified.epoch < tokenEpoch) {
        return c.json(
          { error: 'Token has been revoked', error_code: 'TOKEN_REVOKED' },
          401,
        );
      }

      // 탈퇴 유예(pending_deletion) 계정은 탈퇴 철회(DELETE /user/me/deletion) 외의
      // 인증 API 사용을 차단한다(개인정보보호법 제21조, migrations #41 주석).
      // 클라이언트는 이 코드를 받으면 복구 화면으로 유도한다.
      if (deletionStatus === 'pending_deletion') {
        const path = c.req.path;
        const method = c.req.method;
        const isCancelDeletion = method === 'DELETE' && path.endsWith('/user/me/deletion');
        // FCM 토큰 해제는 허용한다 — 클라가 삭제 신청 '성공 후'(=pending 전환 후) 이 기기 토큰을 제거해
        // 유예 기간 push 를 막는데, 이걸 차단하면 토큰이 영구파기까지 남아 push 가 계속 온다.
        const isPushUnregister = method === 'POST' && path.endsWith('/push/unregister');
        if (!isCancelDeletion && !isPushUnregister) {
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
    const code: ErrorCode = message.includes('expired')
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
