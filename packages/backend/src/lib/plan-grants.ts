import type { Client } from '@libsql/client';
import {
  clearPaidVoiceRetention,
  downgradeUserToFree,
  hasActivePaidEntitlement,
  notifyBillingStateChanged,
  PAID_VOICE_RETENTION_DAYS,
} from './billing-cancel';
import { logStructured } from './logger';
import { personalPromoCoversFree } from './personal-promo';
import { withWriteTransaction, type DbExecutor } from './transactions';

/**
 * **관리자 기간 지급** — 관리자 콘솔에서 한 사람에게 기간을 정해 플러스를 준다. 규칙 전문:
 * `docs/spec/billing-lifecycle.md` 「관리자 기간 지급」.
 *
 * ⚠ **CLAUDE.md 「유료 기능은 스토어 결제로만」의 유일한 운영 예외**(2026-10-26 오너 승인). 코드를 쳐서 여는 길이 아니다 —
 * 앱에는 입력 칸이 없고, 관리자만 준다. 고객 지원·보정·운영 시험·전환 보호 용도다.
 *
 * - **원시 `users.plan` 을 쓰지 않는다.** 읽을 때 `planWithGrantSql`(원시 free + 유효 지급 → plus)로 계산한다. 원시
 *   plan 을 올리면 `repairOrphanedPaidPlan` 이 "활성 구독 없는 유료" 로 보고 되돌리고, 결제 해지·만료가 지급 중인 사람을
 *   무료로 내린다.
 * - **스토어 구독 행·영수증·청구일을 건드리지 않는다.** 결제자에게 줘도 환급·청구일 연기는 없다.
 * - 겹친 지급은 **합집합**으로 본다 — 기간을 더하지 않는다. 월 직접 입력 한도도 새로 채우지 않는다(같은 달 사용량 유지).
 * - 회수는 그 지급 하나만 끝낸다. 다른 지급·구독은 그대로다.
 * - 끝나거나 회수된 지급의 뒷정리(다른 권한이 없으면 클론 반납 + 그때부터 3일 보관)는 크론이 한 번만 한다
 *   ([settleEndedPlanGrants]). 이미 더 늦은 보관 기한이 걸려 있으면 앞당기지 않는다.
 */

export const PLAN_GRANT_REASONS = ['support', 'compensation', 'test', 'transition'] as const;
export type PlanGrantReason = (typeof PLAN_GRANT_REASONS)[number];

export const PLAN_GRANT_REASON_LABELS: Record<PlanGrantReason, string> = {
  support: '고객 지원',
  compensation: '보정',
  test: '운영 시험',
  transition: '전환 보호',
};

/** 한 번에 줄 수 있는 가장 긴 기간 — 오타로 수십 년을 주지 않게. */
export const PLAN_GRANT_MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export class PlanGrantError extends Error {
  constructor(
    readonly code:
      | 'ADMIN_GRANT_USER_NOT_FOUND'
      | 'ADMIN_GRANT_INVALID'
      | 'ADMIN_GRANT_NOT_FOUND'
      | 'ADMIN_GRANT_ALREADY_REVOKED',
    message: string,
  ) {
    super(message);
  }
}

export interface PlanGrantRow {
  id: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  reason: PlanGrantReason;
  note: string;
  grantedBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  settledAt: string | null;
  createdAt: string;
}

function rowToGrant(r: Record<string, unknown>): PlanGrantRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    startsAt: String(r.starts_at),
    endsAt: String(r.ends_at),
    reason: String(r.reason) as PlanGrantReason,
    note: String(r.note ?? ''),
    grantedBy: String(r.granted_by ?? ''),
    revokedAt: r.revoked_at == null ? null : String(r.revoked_at),
    revokedBy: r.revoked_by == null ? null : String(r.revoked_by),
    settledAt: r.settled_at == null ? null : String(r.settled_at),
    createdAt: String(r.created_at ?? ''),
  };
}

/**
 * 한국 시간 달력으로 `months` 달 뒤의 같은 시각. 다음 달에 같은 날짜가 없으면 그 달 말일의 같은 시각이다
 * (10월 31일 14:00 → 11월 30일 14:00).
 */
export function addKstCalendarMonths(from: Date, months: number): Date {
  const kst = new Date(from.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(kst.getUTCDate(), lastDay);
  const shifted = Date.UTC(
    y,
    m,
    day,
    kst.getUTCHours(),
    kst.getUTCMinutes(),
    kst.getUTCSeconds(),
    kst.getUTCMilliseconds(),
  );
  return new Date(shifted - KST_OFFSET_MS);
}

/** 한국 날짜(`YYYY-MM-DD`)가 끝나는 순간 = 다음 날 0시 KST(배타 경계). */
export function endOfKstDate(date: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const probe = new Date(Date.UTC(y, mo, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo || probe.getUTCDate() !== d) return null;
  return new Date(Date.UTC(y, mo, d + 1) - KST_OFFSET_MS);
}

export type PlanGrantLength = { kind: 'days'; days: number } | { kind: 'months'; months: number } | { kind: 'until'; date: string };

/** 지금부터의 기간 → 끝 시각. 시작은 언제나 **지금**이다(미래 시작 지급은 두지 않는다 — 켜 주는 크론이 필요해진다). */
export function grantEndFor(length: PlanGrantLength, now: Date): Date {
  let end: Date | null;
  if (length.kind === 'days') {
    end = Number.isInteger(length.days) && length.days > 0 ? new Date(now.getTime() + length.days * DAY_MS) : null;
  } else if (length.kind === 'months') {
    end = Number.isInteger(length.months) && length.months > 0 ? addKstCalendarMonths(now, length.months) : null;
  } else {
    end = endOfKstDate(length.date);
  }
  if (!end || end.getTime() <= now.getTime()) {
    throw new PlanGrantError('ADMIN_GRANT_INVALID', '끝나는 날이 지금보다 뒤여야 해요.');
  }
  if (end.getTime() - now.getTime() > PLAN_GRANT_MAX_DAYS * DAY_MS) {
    throw new PlanGrantError('ADMIN_GRANT_INVALID', `한 번에 ${PLAN_GRANT_MAX_DAYS}일까지만 줄 수 있어요.`);
  }
  return end;
}

export function isPlanGrantReason(value: unknown): value is PlanGrantReason {
  return typeof value === 'string' && (PLAN_GRANT_REASONS as readonly string[]).includes(value);
}

/**
 * 지금을 포함하는 **이어진 지급 구간의 끝**. 겹치거나 맞닿은 지급은 하나로 잇고(합집합), 지금을 덮는 지급이 없으면
 * `null`. 표시용이다 — 권한 판정은 SQL(`activePlanGrantExistsSql`)이 한다.
 */
export function mergedGrantEnd(
  grants: Array<Pick<PlanGrantRow, 'startsAt' | 'endsAt' | 'revokedAt'>>,
  now: Date,
): Date | null {
  const spans = grants
    .filter((g) => g.revokedAt == null)
    .map((g) => ({ start: Date.parse(g.startsAt), end: Date.parse(g.endsAt) }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let end: number | null = null;
  const at = now.getTime();
  for (const s of spans) {
    if (end == null) {
      if (s.start <= at && at < s.end) end = s.end;
      continue;
    }
    if (s.start <= end) end = Math.max(end, s.end);
  }
  return end == null ? null : new Date(end);
}

export async function listPlanGrants(db: Pick<DbExecutor, 'execute'>, userPk: string): Promise<PlanGrantRow[]> {
  const res = await db.execute({
    sql: `SELECT * FROM plan_grants WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
    args: [userPk],
  });
  return res.rows.map((r) => rowToGrant(r as Record<string, unknown>));
}

/**
 * 응답의 **등급과 `plan_grant` 를 한 순간에** 계산한다(Codex #941 — 따로 계산하면 그 사이 지급이 끝났을 때 `plan: plus` 가
 * 기한 없이 나가, 오프라인 앱이 끝난 지급을 영영 자르지 못한다). 원시 plan 과 지급 행을 **한 문장**으로 읽고 같은 `now` 로
 * 가른다. 기간 한정 개인 플랜(`computedUserPlan`)은 이 `plan` 위에 같은 `promo.now` 로 얹는다.
 *
 * @param fallbackPlan 계정 행을 못 읽었을 때(방금 만든 계정의 다른 트랜잭션 등) 쓸 원시 plan.
 */
export async function loadPlanGrantAnswer<P extends string | null>(
  db: Pick<DbExecutor, 'execute'>,
  userPk: string,
  fallbackPlan: P,
  now: Date = new Date(),
): Promise<{ plan: P | string; planGrant: { ends_at: string; computed_at: string } | null }> {
  const res = await db.execute({
    sql: `SELECT u.plan AS raw_plan, g.starts_at, g.ends_at
          FROM users u
          LEFT JOIN plan_grants g ON g.user_id = u.id AND g.revoked_at IS NULL
            AND julianday(g.ends_at) > julianday(?)
          WHERE u.id = ?`,
    args: [now.toISOString(), userPk],
  });
  // 계정 행을 못 읽으면(방금 만든 계정·열이 없는 응답) 부른 쪽이 이미 읽은 원시 plan 을 그대로 쓴다.
  if (res.rows.length === 0 || !('raw_plan' in res.rows[0]!)) return { plan: fallbackPlan, planGrant: null };
  const raw = res.rows[0]!.raw_plan == null ? null : String(res.rows[0]!.raw_plan);
  if (raw !== 'free') return { plan: raw as P | string, planGrant: null };
  const end = mergedGrantEnd(
    res.rows
      .filter((r) => r.ends_at != null)
      .map((r) => ({ startsAt: String(r.starts_at), endsAt: String(r.ends_at), revokedAt: null })),
    now,
  );
  if (!end) return { plan: 'free', planGrant: null };
  const seconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { plan: 'plus', planGrant: { ends_at: seconds(end), computed_at: seconds(now) } };
}

export interface CreatePlanGrantInput {
  userPk: string;
  endsAt: Date;
  reason: PlanGrantReason;
  note: string;
  actor: string;
  /** 확인 화면이 만든 멱등 키 — 같은 화면을 두 번 보내도 한 번만 준다. */
  requestKey: string;
}

/**
 * 지급한다. 같은 `requestKey` 로 다시 부르면 **새로 주지 않고** 처음 지급을 돌려준다(`created=false`).
 * 지급과 함께 그 사람에게 걸려 있던 목소리 보관 예약을 푼다(지금 플러스다). 반납된 클론은 다음 사용 때 원본으로
 * 다시 만든다(`recloneEvictedVoiceProfile`).
 */
export async function createPlanGrant(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  input: CreatePlanGrantInput,
  now: Date = new Date(),
): Promise<{ grant: PlanGrantRow; created: boolean }> {
  if (!isPlanGrantReason(input.reason)) {
    throw new PlanGrantError('ADMIN_GRANT_INVALID', '지급 사유를 골라 주세요.');
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.requestKey)) {
    throw new PlanGrantError('ADMIN_GRANT_INVALID', '확인 화면을 다시 열어 주세요.');
  }
  if (input.endsAt.getTime() <= now.getTime()) {
    throw new PlanGrantError('ADMIN_GRANT_INVALID', '끝나는 날이 지금보다 뒤여야 해요.');
  }
  const note = input.note.trim().slice(0, 200);
  const outcome = await withWriteTransaction(db, async (tx) => {
    const existing = await tx.execute({
      sql: `SELECT * FROM plan_grants WHERE request_key = ? LIMIT 1`,
      args: [input.requestKey],
    });
    if (existing.rows.length > 0) {
      return { grant: rowToGrant(existing.rows[0] as Record<string, unknown>), created: false };
    }
    const user = await tx.execute({
      sql: `SELECT id FROM users WHERE id = ? AND deletion_status = 'active'
              AND COALESCE(google_id, '') NOT LIKE 'system:%' LIMIT 1`,
      args: [input.userPk],
    });
    if (user.rows.length === 0) {
      throw new PlanGrantError('ADMIN_GRANT_USER_NOT_FOUND', '지급할 계정을 찾지 못했어요. 탈퇴 대기 계정에는 줄 수 없어요.');
    }
    const id = crypto.randomUUID();
    const inserted = await tx.execute({
      sql: `INSERT INTO plan_grants (id, user_id, starts_at, ends_at, reason, note, granted_by, request_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      args: [
        id,
        input.userPk,
        now.toISOString(),
        input.endsAt.toISOString(),
        input.reason,
        note,
        input.actor,
        input.requestKey,
      ],
    });
    await clearPaidVoiceRetention(tx, input.userPk);
    return { grant: rowToGrant(inserted.rows[0] as Record<string, unknown>), created: true };
  });
  if (outcome.created) {
    logStructured('info', {
      at: 'admin.plan_grant',
      action: 'GRANTED',
      grant_id: outcome.grant.id,
      reason: outcome.grant.reason,
      ends_at: outcome.grant.endsAt,
    });
    await notifyBillingStateChanged(db, env, [input.userPk]);
  }
  return outcome;
}

/** 지급 하나를 회수한다 — 그 지급만 끝내고, 뒷정리(다른 권한이 없으면 보관 예약)는 곧바로 한다. */
export async function revokePlanGrant(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  grantId: string,
  actor: string,
  now: Date = new Date(),
): Promise<PlanGrantRow> {
  const res = await db.execute({
    sql: `UPDATE plan_grants SET revoked_at = ?, revoked_by = ?
          WHERE id = ? AND revoked_at IS NULL RETURNING *`,
    args: [now.toISOString(), actor, grantId],
  });
  if (res.rows.length === 0) {
    const found = await db.execute({ sql: `SELECT revoked_at FROM plan_grants WHERE id = ?`, args: [grantId] });
    throw found.rows.length === 0
      ? new PlanGrantError('ADMIN_GRANT_NOT_FOUND', '지급 기록을 찾지 못했어요.')
      : new PlanGrantError('ADMIN_GRANT_ALREADY_REVOKED', '이미 회수한 지급이에요.');
  }
  const grant = rowToGrant(res.rows[0] as Record<string, unknown>);
  logStructured('info', { at: 'admin.plan_grant', action: 'REVOKED', grant_id: grant.id });
  const downgraded = await settleEndedPlanGrants(db, env, now, { grantIds: [grant.id] });
  // 다른 지급이 남아 등급이 그대로여도 **끝이 당겨졌을 수 있다**(30일·7일이 겹친 채 30일을 회수) — 앱이 새 끝을 받아
  // 오프라인 기한을 고치게 알린다(Codex #941). 등급이 내려간 경우는 뒷정리가 이미 알렸다.
  if (!downgraded.includes(grant.userId)) await notifyBillingStateChanged(db, env, [grant.userId]);
  return grant;
}

const SETTLE_BATCH_LIMIT = 5;

/**
 * **끝났거나 회수된 지급의 뒷정리** — 5분 크론과 회수 직후에 돈다. 지급마다 한 번(`settled_at`).
 *
 * 그 사람에게 다른 유료 권한(구독·다른 지급·기간 한정 개인 플랜)이 없으면 결제 만료와 같은 일을 한다: 제공자 클론을
 * 반납하고, **지금부터** 3일 보관을 건다(이미 더 늦은 기한이 걸려 있으면 그대로 둔다 — 안내한 기한을 앞당기지 않는다).
 * 처리가 늦었다고 지난 끝 시각으로 소급해 보관을 줄이지 않는다. 실제 삭제 직전에 스윕이 권한을 한 번 더 본다.
 */
export async function settleEndedPlanGrants(
  db: Client,
  env: Parameters<typeof notifyBillingStateChanged>[1],
  now: Date = new Date(),
  options: { grantIds?: string[] } = {},
): Promise<string[]> {
  const due = options.grantIds?.length
    ? await db.execute({
        sql: `SELECT id, user_id FROM plan_grants WHERE settled_at IS NULL
                AND id IN (${options.grantIds.map(() => '?').join(', ')})
                AND (revoked_at IS NOT NULL OR julianday(ends_at) <= julianday(?))`,
        args: [...options.grantIds, now.toISOString()],
      })
    : await db.execute({
        sql: `SELECT id, user_id FROM plan_grants WHERE settled_at IS NULL
                AND (revoked_at IS NOT NULL OR julianday(ends_at) <= julianday(?))
              ORDER BY ends_at, id LIMIT ?`,
        args: [now.toISOString(), SETTLE_BATCH_LIMIT],
      });
  const promoCoversFree = personalPromoCoversFree(env as Parameters<typeof personalPromoCoversFree>[0], now);
  const changed: string[] = [];
  for (const row of due.rows) {
    const grantId = String(row.id);
    const userPk = String(row.user_id);
    try {
      const downgraded = await withWriteTransaction(db, async (tx) => {
        const claimed = await tx.execute({
          sql: `UPDATE plan_grants SET settled_at = ? WHERE id = ? AND settled_at IS NULL RETURNING id`,
          args: [now.toISOString(), grantId],
        });
        if (claimed.rows.length === 0) return false;
        if (await hasActivePaidEntitlement(tx, userPk, promoCoversFree)) return false;
        // 탈퇴 대기 계정도 똑같이 정리한다 — 건너뛰고 끝냄으로 적으면, 유예 중 다시 로그인해 철회했을 때 클론 반납·보관
        // 예약 없이 남는다(Codex #941). 계정 행이 없으면(이미 파기됐다) 할 일이 없다.
        const user = await tx.execute({ sql: `SELECT 1 FROM users WHERE id = ? LIMIT 1`, args: [userPk] });
        if (user.rows.length === 0) return false;
        await downgradeUserToFree(tx, userPk, { deleteVoiceData: false });
        const deleteAfter = new Date(now.getTime() + PAID_VOICE_RETENTION_DAYS * DAY_MS).toISOString();
        await tx.execute({
          sql: `INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                  delete_after = CASE WHEN julianday(paid_voice_retention.delete_after) > julianday(excluded.delete_after)
                                      THEN paid_voice_retention.delete_after ELSE excluded.delete_after END`,
          args: [userPk, deleteAfter],
        });
        return true;
      });
      if (downgraded) changed.push(userPk);
    } catch (err) {
      logStructured('error', {
        at: 'admin.plan_grant_settle',
        action: 'SETTLE_FAILED',
        grant_id: grantId,
        error: String(err),
      });
    }
  }
  if (changed.length > 0) await notifyBillingStateChanged(db, env, changed);
  return changed;
}
