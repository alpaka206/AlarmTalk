import type { Client } from '@libsql/client/web';

// 관리자 비밀번호를 맞춰 본 횟수 — IP 당 10분에 10번(`docs/spec/admin-console.md`). 로그인 폼과 스크립트용 Basic 이 한 통으로 쓴다.
//
// ⚠ 워커 메모리에 세지 말 것. 연결마다 다른 서버(isolate)로 가서 실제로는 막히지 않는다 — 2026-11-02 dev 실측: 한 연결로는 10번째에
// 막혔는데, 연결을 새로 맺은 15번은 2번만 막혔다. 그래서 DB 한 곳에 센다.

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 10;

/** 막혔을 때 알려 주는 기다림의 상한. 실제로는 첫 시도부터 10분이 지나면 풀린다. */
export const ADMIN_PASSWORD_RETRY_AFTER_SECONDS = WINDOW_MS / 1000;

/**
 * 비교하기 **전에** 한 번을 센다. 다 썼으면 false 다 — 맞는 값도 보지 않는다. 값을 먼저 보면 막힌 동안에도 계속 맞춰 볼 수 있다.
 * 세기와 판정이 SQL 한 문장이라 동시에 보내도 한도를 넘지 못한다. 다 쓴 뒤에는 행을 쓰지 않는다.
 */
export async function chargeAdminPasswordAttempt(db: Client, keyHash: string, nowMs = Date.now()): Promise<boolean> {
  await db.execute({ sql: 'DELETE FROM admin_password_attempts WHERE reset_at <= ?', args: [nowMs] });
  const charged = await db.execute({
    sql: `INSERT INTO admin_password_attempts (key_hash, attempts, reset_at) VALUES (?, 1, ?)
          ON CONFLICT(key_hash) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ?
          RETURNING attempts`,
    args: [keyHash, nowMs + WINDOW_MS, MAX_ATTEMPTS],
  });
  return charged.rows.length > 0;
}

/** 맞는 비밀번호였다 — 센 것을 지운다. 그래서 맞는 비밀번호로 클립 수만큼 부르는 스크립트(`import-voice-pack.ts`)가 막히지 않는다. */
export async function clearAdminPasswordAttempts(db: Client, keyHash: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM admin_password_attempts WHERE key_hash = ?', args: [keyHash] });
}
