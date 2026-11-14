import type { DbExecutor } from './transactions';

/**
 * **직접 입력 생성의 같은 요청 표식** — 앱이 '음성 만들기' 한 번마다 만든 `request_id` 를 재시도·중복 탭에도 그대로
 * 싣는다. 같은 요청이 동시에 두 번 합성·차감되지 않게 하는 자리다(`docs/spec/voice-and-message.md` §8 「같은 요청」).
 *
 * - **캐시를 보기 전에** 잡는다(2026-10-27 — 캐시 히트도 한 번 세므로, 끝난 요청의 재시도가 히트로 받으면서 또 세지
 *   않게 하려면 히트보다 먼저 '이미 셌다' 를 알아야 한다). 끝난 표식을 다시 잡으면(`reclaimedDone`) 세지 않고 결과를 준다.
 * - 잡혀 있는 동안 같은 id 가 오면 409 `TTS_REQUEST_IN_PROGRESS` — 앱은 잠시 뒤 다시 보낸다(그때는 끝난 표식이라 세지 않는다).
 * - 같은 id 에 **다른 입력**이면 409 `TTS_REQUEST_ID_CONFLICT`(앱의 버그다 — 문구를 바꾸면 새 id 다).
 * - 실패하면 표식을 지운다 — 다시 시도하면 새로 센다(실패는 돌려준 뒤다). 성공하면 `done` 으로 남겨 충돌을 가린다.
 *   셌던 요청의 재시도가 실패하면 지우지 않고 `done` 으로 되돌린다(지우면 다음 재시도가 또 센다).
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
   * 잡았다. `reclaimedDone` = **끝난 표식을 다시 잡았다** — 그 요청은 이미 성공해 셌다. 부른 쪽은 다시 세지 않고 결과를
   * 준다. 캐시에 없으면 서비스가 설정을 바꿔 다시 굽는 경우만 세지 않고, 결과가 지워진 것이면 새로 센다(`routes/tts.ts`).
   */
  | {
      kind: 'claimed';
      claim: ManualRequestClaim;
      reclaimedDone: boolean;
      /** 이 id 의 표식이 이미 있었다(끝났거나 버려진 표식을 다시 잡았다) — 사용량 장부가 재시도로 센다. */
      retried: boolean;
    }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

export async function claimManualRequest(
  db: DbExecutor,
  input: { userPk: string; requestId: string; fingerprint: string },
  now: Date = new Date(),
): Promise<ClaimOutcome> {
  const claimedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - MANUAL_REQUEST_STALE_MS).toISOString();
  const claim: ManualRequestClaim = { userPk: input.userPk, requestId: input.requestId, claimedAt };
  // ⚠ **잡는 것과 '잡기 직전에 무엇이었나' 를 한 문장으로 안다**(Codex #971). 예전에는 상태를 먼저 SELECT 하고 따로 UPSERT 로
  //   잡았다 — 그 사이 첫 요청이 표식을 `done` 으로 바꾸면 둘째의 UPSERT 가 끝난 표식을 가져가는데 `reclaimedDone` 은 앞서
  //   읽은 pending 그대로라, 같은 요청을 한 번 더 세거나(캐시 히트도 센다) 마지막 횟수였으면 이미 치른 결과 대신 429 를 줬다.
  //   그래서 갈래마다 **조건이 곧 이전 상태인** 문장을 따로 두고, 바뀐 행이 있는지(RETURNING)로 가른다.
  //   ① 없으면 넣는다 — 들어갔으면 처음 보는 id 다.
  const inserted = await db.execute({
    sql: `INSERT INTO manual_tts_requests (user_id, request_id, input_hash, status, claimed_at)
          VALUES (?, ?, ?, 'pending', ?)
          ON CONFLICT(user_id, request_id) DO NOTHING
          RETURNING claimed_at`,
    args: [input.userPk, input.requestId, input.fingerprint, claimedAt],
  });
  if (inserted.rows.length > 0) return { kind: 'claimed', claim, reclaimedDone: false, retried: false };
  //   ② 같은 입력의 끝난 표식을 가져간다 — `status = 'done'` 이 조건이라, 바뀌었으면 **잡기 직전에 끝나 있었다.**
  const reclaimDone = () =>
    db.execute({
      sql: `UPDATE manual_tts_requests SET status = 'pending', claimed_at = ?
            WHERE user_id = ? AND request_id = ? AND input_hash = ? AND status = 'done'
            RETURNING claimed_at`,
      args: [claimedAt, input.userPk, input.requestId, input.fingerprint],
    });
  if ((await reclaimDone()).rows.length > 0) return { kind: 'claimed', claim, reclaimedDone: true, retried: true };
  //   ③ 같은 입력의 버려진(2분) 표식을 가져간다 — 조건이 `status = 'pending'` 이라 끝난 표식은 여기서 가져가지 않는다.
  //     워커가 중간에 죽은 요청이라 셌는지 알 수 없다 — 새 요청으로 센다.
  const reclaimedStale = await db.execute({
    sql: `UPDATE manual_tts_requests SET claimed_at = ?
          WHERE user_id = ? AND request_id = ? AND input_hash = ? AND status = 'pending'
            AND julianday(claimed_at) <= julianday(?)
          RETURNING claimed_at`,
    args: [claimedAt, input.userPk, input.requestId, input.fingerprint, staleBefore],
  });
  if (reclaimedStale.rows.length > 0) return { kind: 'claimed', claim, reclaimedDone: false, retried: true };
  //   ④ ② 와 ③ 사이에 첫 요청이 끝났을 수 있다 — 한 번 더 본다. 그래도 못 잡으면 아직 만드는 중이거나 다른 입력이다.
  if ((await reclaimDone()).rows.length > 0) return { kind: 'claimed', claim, reclaimedDone: true, retried: true };
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
