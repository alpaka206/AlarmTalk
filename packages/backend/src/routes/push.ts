import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';

const push = new Hono<AppEnv>();

const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;
type PushPlatform = (typeof PUSH_PLATFORMS)[number];
const TOKEN_MAX = 4096;

// 클라가 FCM 등록 토큰을 서버에 저장한다(가족 알람 등 push 대상). 로그인·토큰 갱신(onNewToken) 시 호출.
// push_tokens 에 INSERT 하는 유일한 경로 — 이게 없어서 테이블이 항상 비어 모든 push 가 no-op 이던 갭을 채운다.
// user_id 는 users.id(PK) — push_tokens.user_id FK(REFERENCES users(id)) 와 정합하도록 userIdPK 를 쓴다.
push.post('/register', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const db = getDB(c.env);

  let body: { token?: unknown; platform?: unknown };
  try {
    body = (await c.req.json()) as { token?: unknown; platform?: unknown };
  } catch {
    return c.json({ error: 'Invalid JSON body', error_code: 'INVALID_JSON' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || token.length > TOKEN_MAX) {
    return c.json({ error: 'token is required', error_code: 'INVALID_PUSH_TOKEN' }, 400);
  }
  const platform = typeof body.platform === 'string' ? body.platform : '';
  if (!PUSH_PLATFORMS.includes(platform as PushPlatform)) {
    return c.json(
      {
        error: `platform must be one of: ${PUSH_PLATFORMS.join(', ')}`,
        error_code: 'INVALID_PLATFORM',
      },
      400,
    );
  }

  // 이 기기 토큰을 현재 사용자 전용으로 재배정한다. 같은 기기에서 A 로그아웃→B 로그인 시 Firebase 등록
  // 토큰은 그대로라, 옛 소유자(A) 행이 남으면 A 의 알람 push 가 이 기기로 잘못 배달된다(P1). 그러니 이
  // 토큰의 다른 소유자 행을 먼저 제거해 (user, token) 이 전역에서 현재 사용자 하나만 남게 한다.
  await db.execute({
    sql: 'DELETE FROM push_tokens WHERE token = ? AND user_id != ?',
    args: [token, userPk],
  });
  // 같은 (user, token) 이면 platform/updated_at 만 갱신(멱등). 고유 인덱스 idx_push_tokens_unique(user_id, token).
  await db.execute({
    sql: `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(user_id, token) DO UPDATE SET
            platform = excluded.platform,
            updated_at = datetime('now')`,
    args: [crypto.randomUUID(), userPk, token, platform],
  });

  return c.json({ success: true });
});

export default push;
