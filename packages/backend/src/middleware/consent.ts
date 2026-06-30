/**
 * 서버측 동의 강제 미들웨어 (B4). authMiddleware 다음에 실행되며 userIdPK 를 사용한다.
 *
 * 데이터 수집/처리성 라우트에 대해 일반 필수 동의(GENERAL_REQUIRED_CONSENTS)가
 * 충족되지 않았으면 403 CONSENT_REQUIRED 로 막는다. 클라이언트는 온보딩에서
 * POST /user/consents 로 동의를 기록한 뒤 진입한다.
 *
 * 면제(EXEMPT) 경로 — 동의 없이도 통과해야 하는 라우트:
 *  - /auth/*                      (로그인/교환/로그아웃)
 *  - /api/health, '/'             (헬스체크)
 *  - GET /user/me                 (본인정보 조회)
 *  - /user/consents*              (동의 기록/조회/상태 — 동의 자체를 하러 오는 경로)
 *  - DELETE /user/me, /user/me/deletion (탈퇴/철회)
 *  - GET /app/version             (버전 정책)
 *  - /holiday                     (공휴일, 비인증)
 *
 * pending_deletion 면제와 동일한 스타일(경로/메서드 매칭)로 작성한다.
 */
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';
import { GENERAL_REQUIRED_CONSENTS, needsConsent } from '../lib/consent';

function isExempt(path: string, method: string): boolean {
  // '/api' prefix 가 있을 수도/없을 수도 있어 정규화 후 정확한 path-segment 로 매칭한다.
  // (substring 매칭은 향후 '/.../auth/...' 같은 데이터 라우트를 실수로 면제할 위험이 있어 지양.)
  const p = path.startsWith('/api/') ? path.slice(4) : path === '/api' ? '/' : path;

  // 인증/교환/로그아웃
  if (p === '/auth' || p.startsWith('/auth/')) return true;
  // 헬스체크
  if (p === '/' || p === '/health') return true;
  // 버전 정책
  if (p === '/app/version') return true;
  // 공휴일(비인증)
  if (p === '/holiday' || p.startsWith('/holiday/')) return true;
  // 동의 기록/조회/상태(동의 자체를 하러 오는 경로)
  if (p === '/user/consents' || p.startsWith('/user/consents/')) return true;
  // 본인정보 조회(GET /user/me)
  if (method === 'GET' && p === '/user/me') return true;
  // 탈퇴/철회: DELETE /user/me, POST·DELETE /user/me/deletion
  if (p === '/user/me/deletion') return true;
  if (method === 'DELETE' && p === '/user/me') return true;

  return false;
}

export async function consentMiddleware(c: Context<AppEnv>, next: Next) {
  if (isExempt(c.req.path, c.req.method)) {
    return next();
  }

  const userIdPK = c.get('userIdPK');
  if (!userIdPK) {
    // authMiddleware 가 먼저 돌아 userIdPK 를 심어야 한다. 없으면 구성 오류 — fail-closed.
    return c.json(
      { error: 'Consent state unavailable', error_code: 'CONSENT_STATE_UNAVAILABLE' },
      403,
    );
  }

  const { getDB } = await import('../lib/db');
  const db = getDB(c.env);
  if (await needsConsent(db, userIdPK, GENERAL_REQUIRED_CONSENTS)) {
    return c.json(
      {
        error: 'Required consents are missing',
        error_code: 'CONSENT_REQUIRED',
        required: GENERAL_REQUIRED_CONSENTS,
      },
      403,
    );
  }

  return next();
}
