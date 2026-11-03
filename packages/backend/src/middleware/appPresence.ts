/**
 * **앱 빌드·접속 기록**(`user_app_presence`, 마이그레이션 #133 — `docs/spec/admin-console.md`).
 *
 * 두 앱은 모든 요청에 `X-App-Platform`(android|ios)·`X-App-Version`(안드로이드 versionCode, iOS 빌드 번호)을
 * 싣는다. 서버는 그 값을 버전 정책(`/app/version`)에만 쓰고 적지 않아서, "몇 버전 아래 사람에게 알리기" 를
 * 할 수 없었다. 여기서 사람 × 플랫폼마다 마지막 값을 적는다.
 *
 * - **동의 검사 앞**에 둔다. 재동의를 안 해 모든 요청이 403 인 사람(2026-10-23 날씨 사고의 그 사람들)이야말로
 *   알림으로 찾아야 할 대상이다 — 동의 뒤에 두면 바로 그 사람들의 버전만 비게 된다.
 * - **쓰기는 응답을 기다리게 하지 않는다**(`waitUntil`). 같은 isolate 안에서 같은 값이면 한 시간에 한 번만
 *   쓴다 — 요청마다 DB 왕복을 늘리지 않으려고.
 * - **보관은 마지막 접속 뒤 90일**(처리방침 3장 '접속 로그 3개월' — `index.ts` 의 `APP_PRESENCE_RETENTION_DAYS`).
 *   행은 덮어쓰므로 접속 이력이 쌓이지 않는다.
 * - 실패해도 요청은 그대로 간다. 이 행은 통계·대상 고르기용이라 한 번 못 적어도 다음 요청이 다시 적는다
 *   (CLAUDE.md 「배포가 마이그레이션보다 먼저 돈다」의 fail-closed 는 **잘못된 행이 영구히 남는** 쓰기의
 *   규칙이다 — 여기서 잃는 것은 길어야 1분 남짓의 접속 시각뿐이다).
 */
import type { Context, Next } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logStructured } from '../lib/logger';

const REWRITE_AFTER_MS = 60 * 60 * 1000;
/** isolate 메모리 상한 — 넘치면 비운다(다음 요청이 한 번씩 더 쓸 뿐이다). */
const MEMO_LIMIT = 5000;
const memo = new Map<string, { version: number; at: number }>();

const UPSERT_SQL = `INSERT INTO user_app_presence (user_id, platform, app_version, last_seen_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT (user_id, platform) DO UPDATE SET
    app_version = excluded.app_version,
    last_seen_at = excluded.last_seen_at`;

/** 헤더의 빌드 번호. 숫자만, 1 ~ 1,000,000 — 그 밖은 기록하지 않는다(헤더는 누구나 꾸밀 수 있다). */
export function parseAppVersionHeader(raw: string | undefined): number | null {
  const value = (raw ?? '').trim();
  if (!/^\d{1,7}$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 1_000_000 ? n : null;
}

export function parseAppPlatformHeader(raw: string | undefined): 'android' | 'ios' | null {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'android' || value === 'ios' ? value : null;
}

/** 테스트 전용 — isolate 메모를 비운다. */
export function resetAppPresenceMemo(): void {
  memo.clear();
}

export async function appPresenceMiddleware(c: Context<AppEnv>, next: Next) {
  const userId = c.get('userIdPK');
  const platform = parseAppPlatformHeader(c.req.header('X-App-Platform'));
  const version = parseAppVersionHeader(c.req.header('X-App-Version'));
  if (userId && platform && version !== null) {
    const key = `${userId}|${platform}`;
    const now = Date.now();
    const prev = memo.get(key);
    if (!prev || prev.version !== version || now - prev.at >= REWRITE_AFTER_MS) {
      if (memo.size >= MEMO_LIMIT) memo.clear();
      memo.set(key, { version, at: now });
      const write = getDB(c.env)
        .execute({ sql: UPSERT_SQL, args: [userId, platform, version] })
        .then(
          () => undefined,
          (err: unknown) => {
            // 다음 요청이 다시 적도록 메모를 되돌린다.
            memo.delete(key);
            logStructured('warn', {
              at: 'app_presence.write',
              error: err instanceof Error ? err.name : typeof err,
              missingTable: /no such table/i.test(String(err)),
            });
          },
        );
      try {
        c.executionCtx.waitUntil(write);
      } catch {
        // 실행 컨텍스트가 없는 환경(테스트) — 위 promise 는 스스로 오류를 삼킨다.
      }
    }
  }
  return next();
}
