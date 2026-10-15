import { Hono } from 'hono';
import type { AppEnv } from '../types';
import type { InStatement } from '@libsql/client';
import { getDB } from '../lib/db';
import { retryTransientTurso } from '../lib/turso-retry';

const push = new Hono<AppEnv>();

// 'ios' 는 마이그레이션 #94 가 push_tokens.platform CHECK 에 되돌려 놓은 값이다.
// ⚠ 배포가 마이그레이션보다 먼저 도는 창(최대 ~1분)에는 여기서 통과한 'ios' 가 DB
// CHECK 에 걸려 INSERT 가 실패한다 — 의도된 fail-closed 다. 등록이 500 으로 떨어지고
// 클라가 재시도하면 되며, 잘못된 행이 남지 않는다.
const PUSH_PLATFORMS = ['ios', 'android', 'web'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];
const TOKEN_MAX = 4096;

/**
 * `/register` 가 **한 번의 원자적 쓰기 batch** 로 보내는 두 문장 — 이 기기 토큰을 호출자 전용으로
 * 재배정한다(`DELETE 다른 소유자` → `UPSERT`).
 *
 * 같은 기기에서 A 로그아웃→B 로그인 시 Firebase 등록 토큰은 그대로라, 옛 소유자(A) 행이 남으면
 * A 의 알람 push 가 이 기기로 잘못 배달된다(P1). 두 문장이 따로 나가면 빠른 계정 전환으로 두
 * 세션의 등록이 동시에 도착했을 때 서로의 DELETE 가 상대 INSERT 앞에 실행돼 소유자 2행이 남는다
 * (Codex #567 P1) — 그래서 **둘은 언제나 한 쓰기 단위**다(`db.batch(…, 'write')` = `BEGIN IMMEDIATE`
 * 단일 writer 락, 전부 아니면 전무). 어떤 인터리빙에서도 마지막 커밋이 유일 승자다.
 *
 * ON CONFLICT 타깃은 #14 부터 존재하는 (user_id, token) 유니크를 유지한다 — deploy-backend.yml 이
 * 배포 '후' 마이그레이션을 돌리므로, ON CONFLICT(token) 을 쓰면 #71(token 전역 UNIQUE) 적용 전
 * 창에서 모든 등록이 500 난다(Codex #568 P2). #71 이후엔 token 전역 UNIQUE 가 DB 수준 이중 방어.
 *
 * ⚠ **두 문장 다 멱등이어야 한다 — 이 batch 는 게이트웨이 실패에서 다시 보내진다**(아래 라우트).
 * DELETE 는 조건으로 지우고, UPSERT 는 (user_id, token) 충돌에서 `id` 를 건드리지 않는다 — 같은
 * 인자로 두 번 실행해도 같은 한 행이 남는다. 멱등이 아닌 문장(카운터 증가·무조건 INSERT 등)을
 * 여기에 더하면 응답을 잃은 재시도가 그것을 두 번 적용한다.
 *
 * 라우트와 실 DB 테스트(`test/push-token-unique.test.ts`)가 **같은 문장**을 돌리도록 내보낸다 —
 * 테스트가 SQL 을 손으로 베끼면 라우트가 무엇으로 바뀌든 초록으로 남는다.
 */
export function pushRegisterStatements(
  userPk: string,
  token: string,
  platform: PushPlatform,
): InStatement[] {
  return [
    {
      sql: 'DELETE FROM push_tokens WHERE token = ? AND user_id != ?',
      args: [token, userPk],
    },
    {
      // ⚠ **계정이 아직 active 일 때만 적는다**(코덱스 #904). 탈퇴 신청은 같은 트랜잭션에서 그 계정의 `push_tokens` 를
      //   지우는데(user.ts), 미들웨어를 이미 통과해 쓰기를 기다리던 등록 요청이 그 뒤에 커밋되면 유예 계정에 푸시 행이
      //   되살아난다(앱은 실행마다 등록하므로 드문 경합이 아니다). 조건을 이 문장 안에 둬 원자적으로 막는다 — 0행이면
      //   아무것도 적지 않는다(요청은 200 이지만, 그 계정은 곧 모든 요청이 403 이다).
      // (SQLite 는 `INSERT … SELECT` 에 upsert 를 붙이려면 SELECT 에 WHERE 가 있어야 한다 — 아래 EXISTS 가 그 자리다.)
      sql: `INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
            SELECT ?, ?, ?, ?, datetime('now'), datetime('now')
            WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND deletion_status = 'active')
            ON CONFLICT(user_id, token) DO UPDATE SET
              platform = excluded.platform,
              updated_at = datetime('now')`,
      args: [crypto.randomUUID(), userPk, token, platform, userPk],
    },
  ];
}

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

  // 두 문장을 **왕복 한 번**(원자적 쓰기 batch)으로 보내고, Turso 게이트웨이의 일시 실패
  // (5xx·전송 실패)에서는 그 batch 를 통째로 다시 보낸다(150·450ms, 최대 3회).
  //
  // 2026-10-11 전에는 대화형 쓰기 트랜잭션이었다 — 왕복이 셋(`BEGIN+DELETE` / `INSERT` / `COMMIT`)
  // 이고 쓰기라 아무도 재시도하지 않았다. 2026-09-28·10-07 prod 에서 그 트랜잭션이 게이트웨이
  // 525·520 을 받아 그대로 500 이 됐다(BACKEND-E — 스택의 줄 위치로는 둘 다 첫 왕복이다).
  // 안드로이드는 프로세스가 뜰 때마다 다시 등록하지만 iOS 는 바인딩이 없거나 바뀌었다고 볼 때만
  // 올린다 — 실패한 한 번이 다음 올리기까지 그 기기의 푸시를 끊을 수 있다.
  //
  // ⚠ **쓰기 재시도는 좁은 예외다 — 조건 둘을 다 지킬 때만**(`docs/spec/error-codes.md` 구현 지도).
  //  ① 모든 문장이 멱등이다(`pushRegisterStatements` 주석). 애매한 5xx 뒤에 첫 회차가 실은
  //     커밋됐더라도 다시 보낸 결과가 같다.
  //  ② 다시 도는 클로저 안에 **DB 밖의 일이 없다**. 외부 API 호출·푸시 발송·R2 쓰기를 이 안에
  //     넣으면 재시도마다 그 일도 다시 일어난다. 문장도 클로저 **밖에서 한 번** 만든다.
  // batch 라 왕복이 하나뿐이어서 재시도가 싸고, 왕복 사이에 열어 둔 스트림이 없다(대화형
  // 트랜잭션은 그 스트림이 유휴로 롤백된 적이 있다 — 같은 라우트의 BACKEND-D, 2026-09-25).
  // 일반 규칙으로 넓히지 말 것 — `withWriteTransaction`·`getDB` 프록시는 여전히 쓰기를 재시도하지 않는다.
  //
  // fail-closed 는 그대로다: 세 번 다 실패하면(또는 SQL 오류면 즉시) 예외가 올라가 500 이고,
  // batch 는 전부 아니면 전무라 반쯤 적용된 상태가 남지 않는다.
  const statements = pushRegisterStatements(userPk, token, platform as PushPlatform);
  await retryTransientTurso(() => db.batch(statements, 'write'));

  return c.json({ success: true });
});

// 로그아웃/기기 해제 시 이 기기의 FCM 토큰을 제거해 더 이상 alarm push 가 오지 않게 한다.
// 로그아웃 시 클라가 token_epoch 무효화(/auth/logout) 전에 호출한다.
//
// ⚠ **호출자 소유의 행만 지운다**(2026-08-20 Codex #699 P2). 예전에는 토큰만 보고 지웠는데,
// 그 근거였던 "delete-on-register 로 전역 단일 소유자" 는 **범위를 좁혀도 그대로 성립**한다 —
// 지금 그 토큰의 주인이 곧 호출자이기 때문이다. 반대로 넓게 두면 실제 사고가 난다:
// A 의 해제 요청이 네트워크에 떠 있는 동안 B 가 같은 기기 토큰으로 등록을 마치면, 뒤늦게
// 도착한 A 의 요청이 **B 의 새 바인딩을 지운다** — B 는 다음 APNs/FCM 등록까지 가족 알람
// 알림을 놓친다. 클라이언트도 등록/해제를 직렬화하지만, 그건 한 기기 안에서만 유효하다.
push.post('/unregister', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const db = getDB(c.env);

  let body: { token?: unknown };
  try {
    body = (await c.req.json()) as { token?: unknown };
  } catch {
    return c.json({ error: 'Invalid JSON body', error_code: 'INVALID_JSON' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || token.length > TOKEN_MAX) {
    return c.json({ error: 'token is required', error_code: 'INVALID_PUSH_TOKEN' }, 400);
  }

  // 문장 하나짜리 쓰기는 그 자체로 원자적이다. 조건으로 지우는 DELETE 라 멱등이고 DB 밖의 일이
  // 없다 — `/register` 와 같은 좁은 예외로 게이트웨이 일시 실패에서 다시 보낸다. 실패한 해제는
  // 로그아웃한 기기를 떠난 계정에 묶어 둔다(안드로이드의 `unregisterCurrentToken` 은 실패를
  // 보고만 하고 다시 보내지 않는다).
  await retryTransientTurso(() =>
    db.execute({
      sql: 'DELETE FROM push_tokens WHERE token = ? AND user_id = ?',
      args: [token, userPk],
    }),
  );

  return c.json({ success: true });
});

export default push;
