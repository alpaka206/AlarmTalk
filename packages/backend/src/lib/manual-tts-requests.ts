import type { DbExecutor } from './transactions';

/**
 * **직접 입력 생성의 같은 요청 표식** — 앱이 '음성 만들기' 한 번마다 만든 `request_id` 를 재시도·중복 탭에도 그대로
 * 싣는다. 같은 요청이 동시에 두 번 합성·차감되지 않게 하는 자리다(`docs/spec/voice-and-message.md` §8 「같은 요청」).
 *
 * - 첫 요청이 **합성 직전**(캐시 미스가 확정된 뒤, 횟수를 세기 전)에 잡는다. 이미 만든 결과는 캐시 히트라 세지 않으므로
 *   끝난 요청의 재시도는 여기까지 오지 않고 그 결과를 그대로 받는다.
 * - 잡혀 있는 동안 같은 id 가 오면 409 `TTS_REQUEST_IN_PROGRESS` — 앱은 잠시 뒤 다시 보낸다(그때는 캐시 히트다).
 * - 같은 id 에 **다른 입력**이면 409 `TTS_REQUEST_ID_CONFLICT`(앱의 버그다 — 문구를 바꾸면 새 id 다).
 * - 실패하면 표식을 지운다 — 다시 시도하면 새로 센다(실패는 돌려준 뒤다). 성공하면 `done` 으로 남겨 충돌을 가린다.
 * - 2분 넘게 잡힌 표식은 버려진 것으로 보고 가져간다(워커가 중간에 죽은 경우). 이틀 지난 표식은 크론이 지운다.
 * - `request_id` 가 없는 요청(옛 앱)은 예전처럼 표식 없이 간다.
 */

export const MANUAL_REQUEST_STALE_MS = 2 * 60 * 1000;
export const MANUAL_REQUEST_RETENTION_DAYS = 2;
const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManualRequestClaim {
  userPk: string;
  requestId: string;
  claimedAt: string;
}

export function parseManualRequestId(value: unknown): string | null {
  return typeof value === 'string' && REQUEST_ID_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/** 입력 지문 — 목소리·언어·문구가 같으면 같은 요청이다. */
export async function manualRequestFingerprint(parts: {
  voiceProfileId: string;
  language: string;
  text: string;
}): Promise<string> {
  const data = new TextEncoder().encode(`${parts.voiceProfileId}\u0000${parts.language}\u0000${parts.text}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type ClaimOutcome =
  /**
   * 잡았다. `reclaimedDone` = **끝난 표식을 다시 잡았다** — 부른 쪽은 세기 전에 캐시를 한 번 더 본다. 두 회차가 함께 캐시
   * 미스를 보고 첫 회차가 먼저 끝냈으면, 둘째는 여기서 그 결과를 받는다(Codex #942). 결과가 정말 지워졌으면(30일 정리)
   * 그때만 새로 만든다.
   */
  | { kind: 'claimed'; claim: ManualRequestClaim; reclaimedDone: boolean }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

export async function claimManualRequest(
  db: DbExecutor,
  input: { userPk: string; requestId: string; fingerprint: string },
  now: Date = new Date(),
): Promise<ClaimOutcome> {
  const claimedAt = now.toISOString();
  const before = await db.execute({
    sql: `SELECT status FROM manual_tts_requests WHERE user_id = ? AND request_id = ?`,
    args: [input.userPk, input.requestId],
  });
  const wasDone = before.rows.length > 0 && String(before.rows[0]!.status) === 'done';
  const staleBefore = new Date(now.getTime() - MANUAL_REQUEST_STALE_MS).toISOString();
  // 없으면 넣고, 같은 입력의 버려진(2분) 표식·끝난 표식(결과가 지워져 다시 만드는 경우)이면 가져간다 — 한 문장이라
  // 동시에 온 두 요청 중 하나만 잡는다.
  const res = await db.execute({
    sql: `INSERT INTO manual_tts_requests (user_id, request_id, input_hash, status, claimed_at)
          VALUES (?, ?, ?, 'pending', ?)
          ON CONFLICT(user_id, request_id) DO UPDATE SET status = 'pending', claimed_at = excluded.claimed_at
          WHERE manual_tts_requests.input_hash = excluded.input_hash
            AND (manual_tts_requests.status = 'done'
                 OR julianday(manual_tts_requests.claimed_at) <= julianday(?))
          RETURNING claimed_at`,
    args: [input.userPk, input.requestId, input.fingerprint, claimedAt, staleBefore],
  });
  if (res.rows.length > 0) {
    return {
      kind: 'claimed',
      claim: { userPk: input.userPk, requestId: input.requestId, claimedAt },
      reclaimedDone: wasDone,
    };
  }
  const existing = await db.execute({
    sql: `SELECT input_hash FROM manual_tts_requests WHERE user_id = ? AND request_id = ?`,
    args: [input.userPk, input.requestId],
  });
  if (existing.rows.length > 0 && String(existing.rows[0]!.input_hash) !== input.fingerprint) {
    return { kind: 'conflict' };
  }
  return { kind: 'in_progress' };
}

/** 성공 — 표식을 끝냄으로 남긴다(이 요청이 잡은 표식일 때만). */
export async function completeManualRequest(db: DbExecutor, claim: ManualRequestClaim): Promise<void> {
  await db.execute({
    sql: `UPDATE manual_tts_requests SET status = 'done'
          WHERE user_id = ? AND request_id = ? AND claimed_at = ? AND status = 'pending'`,
    args: [claim.userPk, claim.requestId, claim.claimedAt],
  });
}

/** 실패·거절 — 표식을 지운다(이 요청이 잡은 표식일 때만). 다시 시도하면 새로 잡는다. */
export async function releaseManualRequest(db: DbExecutor, claim: ManualRequestClaim): Promise<void> {
  await db.execute({
    sql: `DELETE FROM manual_tts_requests
          WHERE user_id = ? AND request_id = ? AND claimed_at = ? AND status = 'pending'`,
    args: [claim.userPk, claim.requestId, claim.claimedAt],
  });
}

/** 크론 — 이틀 지난 표식을 지운다. */
export async function pruneManualRequests(db: DbExecutor, now: Date = new Date()): Promise<void> {
  await db.execute({
    sql: `DELETE FROM manual_tts_requests WHERE julianday(claimed_at) < julianday(?)`,
    args: [new Date(now.getTime() - MANUAL_REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()],
  });
}
