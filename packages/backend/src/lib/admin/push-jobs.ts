/**
 * 관리자 알림 **발송** — `docs/spec/admin-console.md` 「알림 보내기」.
 *
 * 한 요청에 다 보내지 않는다. 워커는 요청당 하위 요청 수에 상한이 있고(무료 플랜 50 — FCM·APNs 는 기기마다
 * fetch 하나다), 그래서 발송은 **기록 하나 + 여러 번의 '한 걸음'** 이다. 콘솔 화면이 걸음을 이어 부르고,
 * 창을 닫았다가 다시 열면 '이어 보내기' 로 같은 커서에서 계속한다.
 *
 * 규칙:
 * - **전체 발송 전에 같은 문구로 시험 발송을 해야 한다**(60분 안, 한 대 이상 성공). 잘못 쓴 문구가 전원에게
 *   나가는 것을 막는 유일한 장치다 — 되돌릴 수 없는 발송이라서.
 * - **광고 알림**은 마케팅 수신 동의자에게만, 한국 시각 08:00~21:00 에만, 제목은 `(광고)` 로 시작하고 본문
 *   끝에 수신 거부 방법을 붙인다(정보통신망법 제50조). 시간 밖이면 걸음이 멈추고 다음 날 이어 보낼 수 있다.
 * - 같은 기록을 두 창이 동시에 걷지 않도록 커서를 **비교 후 교체**로 넘긴다 — 진 쪽은 보내지 않는다.
 */
import type { Client } from '@libsql/client/web';
import type { ErrorCode } from '@alarmtalk/shared';
import type { Env } from '../../types';
import {
  SOCIAL_CHANNEL_ID,
  pruneDeadApnsTokens,
  pruneStaleTokens,
  sendPushNotifications,
  type FcmMessage,
} from '../fcm';
import { apnsConfigFromEnv, sendApnsNotifications, type ApnsMessage } from '../apns';
import {
  DEFAULT_AUDIENCE,
  applyConsentFilters,
  nextAudiencePage,
  parseAudience,
  type Audience,
  type AudienceCandidate,
} from './audience';

export type PushKind = 'notice' | 'ad';

export const PUSH_TITLE_MAX = 50;
export const PUSH_BODY_MAX = 240;
export const AD_TITLE_PREFIX = '(광고) ';
/** 앱의 수신 거부 자리 — 안드로이드 `msg_voice_consent_required` 문구가 가리키는 메뉴 이름과 같다. */
export const AD_OPT_OUT_FOOTER = '수신 거부: 더보기 → 약관 및 동의';
/** 광고를 보낼 수 있는 한국 시각 [시작, 끝) — 앱의 마케팅 동의 안내 문구(오전 8시~오후 9시)와 같다. */
export const AD_HOURS_KST: readonly [number, number] = [8, 21];
const TEST_VALID_MS = 60 * 60 * 1000;
/** 한 걸음에 보내는 기기 수 — 하위 요청 상한(50) 안에 DB·OAuth·정리 몫을 남긴다. */
export const STEP_SEND_LIMIT = 30;
const STEP_SCAN_LIMIT = 120;

type PushEnv = Pick<
  Env,
  | 'FIREBASE_PROJECT_ID'
  | 'FIREBASE_SERVICE_ACCOUNT_JSON'
  | 'APNS_KEY_ID'
  | 'APNS_PRIVATE_KEY'
  | 'APPLE_TEAM_ID'
  | 'APPLE_BUNDLE_ID'
  | 'ENVIRONMENT'
>;

export interface PushCopy {
  kind: PushKind;
  title: string;
  body: string;
}

export class AdminPushError extends Error {
  constructor(
    readonly code: Extract<
      ErrorCode,
      | 'ADMIN_PUSH_COPY_INVALID'
      | 'ADMIN_PUSH_TEST_REQUIRED'
      | 'ADMIN_PUSH_OUTSIDE_AD_HOURS'
      | 'ADMIN_PUSH_JOB_NOT_FOUND'
      | 'ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND'
      | 'ADMIN_PUSH_TEST_RECIPIENT_NO_DEVICE'
      | 'ADMIN_PUSH_TEST_RECIPIENT_NO_MARKETING_CONSENT'
    >,
    message: string,
  ) {
    super(message);
  }
}

/** 제어문자는 지우되 본문의 줄바꿈은 남긴다. 앞뒤 공백은 자른다. */
function cleanText(value: unknown, keepNewlines: boolean): string {
  let out = '';
  for (const ch of String(value ?? '').replace(/\r\n?/g, '\n')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x0a && keepNewlines) {
      out += ch;
    } else if (cp < 0x20 || cp === 0x7f) {
      // 제어문자: 줄바꿈·탭은 공백으로(붙어서 없던 낱말이 생기지 않게), 나머지는 지운다.
      if (cp === 0x0a || cp === 0x09) out += ' ';
    } else if (!isInvisible(cp)) {
      out += ch;
    }
  }
  return out.trim();
}

/** 제로폭(U+200B~U+200F, U+FEFF)과 양방향 제어(U+202A~U+202E, U+2066~U+2069) — 보이는 글자를 속인다. */
function isInvisible(cp: number): boolean {
  return (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff;
}

/** 폼 값 → 보낼 문구. 길이는 **사람이 쓴 부분**으로 센다(광고 표시·수신 거부 줄은 서버가 붙인다). */
export function parseCopy(raw: Record<string, unknown>): PushCopy {
  const kind: PushKind = raw.kind === 'ad' ? 'ad' : 'notice';
  const title = cleanText(raw.title, false).replace(/^\(광고\)\s*/, '');
  const body = cleanText(raw.body, true);
  if (!title || !body) throw new AdminPushError('ADMIN_PUSH_COPY_INVALID', '제목과 본문을 모두 적어 주세요.');
  if ([...title].length > PUSH_TITLE_MAX) {
    throw new AdminPushError('ADMIN_PUSH_COPY_INVALID', `제목은 ${PUSH_TITLE_MAX}자까지예요.`);
  }
  if ([...body].length > PUSH_BODY_MAX) {
    throw new AdminPushError('ADMIN_PUSH_COPY_INVALID', `본문은 ${PUSH_BODY_MAX}자까지예요.`);
  }
  return { kind, title, body };
}

/** 실제로 기기에 나가는 제목·본문. */
export function renderCopy(copy: PushCopy): { title: string; body: string } {
  if (copy.kind !== 'ad') return { title: copy.title, body: copy.body };
  return { title: `${AD_TITLE_PREFIX}${copy.title}`, body: `${copy.body}\n${AD_OPT_OUT_FOOTER}` };
}

export function kstHour(nowMs: number): number {
  return new Date(nowMs + 9 * 60 * 60 * 1000).getUTCHours();
}

export function isWithinAdHours(nowMs: number): boolean {
  const h = kstHour(nowMs);
  return h >= AD_HOURS_KST[0] && h < AD_HOURS_KST[1];
}

/** 광고면 마케팅 동의 조건을 강제한다 — 화면에서 체크를 풀어도 서버가 다시 건다. */
export function effectiveAudience(kind: PushKind, audience: Audience): Audience {
  return kind === 'ad' ? { ...audience, marketingOnly: true } : audience;
}

async function deliver(
  db: Client,
  env: PushEnv,
  targets: ReadonlyArray<Pick<AudienceCandidate, 'token' | 'platform'>>,
  copy: PushCopy,
): Promise<{ sent: number; failed: number }> {
  const { title, body } = renderCopy(copy);
  const fcm: FcmMessage[] = [];
  const apns: ApnsMessage[] = [];
  for (const t of targets) {
    if (t.platform === 'ios') {
      apns.push({ token: t.token, title, body, data: { type: 'admin_notice' } });
    } else {
      // 결제 안내와 같은 소셜 채널 — 기본 채널(`alarms`)로 보내면 알람 소리가 난다(`fcm.ts` 머리말).
      fcm.push({ token: t.token, title, body, data: { type: 'admin_notice', channelId: SOCIAL_CHANNEL_ID } });
    }
  }
  let sent = 0;
  let failed = 0;
  if (fcm.length > 0) {
    const results = await sendPushNotifications(fcm, env);
    sent += results.filter((r) => r.success).length;
    failed += results.filter((r) => !r.success).length;
    await pruneStaleTokens(db, results);
  }
  if (apns.length > 0) {
    const config = apnsConfigFromEnv(env);
    if (!config) {
      failed += apns.length;
    } else {
      const results = await sendApnsNotifications(apns, config);
      sent += results.filter((r) => r.success).length;
      failed += results.filter((r) => !r.success).length;
      await pruneDeadApnsTokens(db, results);
    }
  }
  return { sent, failed };
}

/** 시험 발송 — 한 계정의 모든 기기로. 기록은 남기되 받는 사람은 적지 않는다. */
export async function sendTestPush(
  db: Client,
  env: PushEnv,
  email: string,
  copy: PushCopy,
  nowMs: number = Date.now(),
): Promise<{ jobId: string; sent: number; failed: number; devices: number }> {
  // 시험이어도 광고는 광고다 — 시간 제한도 전체 발송과 같다.
  if (copy.kind === 'ad' && !isWithinAdHours(nowMs)) {
    throw new AdminPushError('ADMIN_PUSH_OUTSIDE_AD_HOURS', '광고 알림은 오전 8시부터 오후 9시 전까지만 보낼 수 있어요.');
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new AdminPushError('ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND', '받을 계정의 이메일을 적어 주세요.');
  const user = await db.execute({
    sql: `SELECT id FROM users WHERE lower(email) = ? LIMIT 1`,
    args: [normalized],
  });
  const userId = user.rows[0]?.id;
  if (!userId) throw new AdminPushError('ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND', '그 이메일로 가입한 계정이 없어요.');
  const tokens = await db.execute({
    sql: `SELECT token, platform FROM push_tokens WHERE user_id = ? AND platform IN ('android', 'ios')`,
    args: [String(userId)],
  });
  if (tokens.rows.length === 0) {
    throw new AdminPushError(
      'ADMIN_PUSH_TEST_RECIPIENT_NO_DEVICE',
      '그 계정에 알림을 받을 기기가 없어요. 앱에 로그인해 알림을 허용한 뒤 다시 보내 주세요.',
    );
  }
  const targets = tokens.rows.map((r) => ({
    token: String(r.token),
    platform: r.platform === 'ios' ? ('ios' as const) : ('android' as const),
  }));
  if (copy.kind === 'ad') {
    // 받는 사람은 누구든 될 수 있으니 전체 발송과 같은 동의 조건을 건다.
    const consented = await applyConsentFilters(db, effectiveAudience('ad', DEFAULT_AUDIENCE), [
      { pid: '', token: '', platform: 'android', userId: String(userId) },
    ]);
    if (consented.length === 0) {
      throw new AdminPushError(
        'ADMIN_PUSH_TEST_RECIPIENT_NO_MARKETING_CONSENT',
        '그 계정은 광고성 정보 수신에 동의하지 않았어요. 광고 시험 발송은 동의한 계정으로만 보낼 수 있어요.',
      );
    }
  }
  const { sent, failed } = await deliver(db, env, targets, copy);
  const jobId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO admin_push_jobs (id, kind, is_test, title, body, audience_json, estimated_total, sent, failed,
                                      status, finished_at)
          VALUES (?, ?, 1, ?, ?, '{"test":true}', ?, ?, ?, 'done', datetime('now'))`,
    args: [jobId, copy.kind, copy.title, copy.body, targets.length, sent, failed],
  });
  return { jobId, sent, failed, devices: targets.length };
}

/** 같은 문구의 시험 발송이 최근에 한 대 이상 닿았는가. */
export async function hasRecentPassingTest(db: Client, copy: PushCopy, nowMs: number): Promise<boolean> {
  const since = new Date(nowMs - TEST_VALID_MS).toISOString().replace('T', ' ').slice(0, 19);
  const res = await db.execute({
    sql: `SELECT 1 FROM admin_push_jobs
          WHERE is_test = 1 AND kind = ? AND title = ? AND body = ? AND sent > 0 AND created_at >= ?
          LIMIT 1`,
    args: [copy.kind, copy.title, copy.body, since],
  });
  return res.rows.length > 0;
}

/** 전체 발송 기록을 만든다. 실제 발송은 `runJobStep` 이 한 걸음씩 한다. */
export async function createPushJob(
  db: Client,
  copy: PushCopy,
  audience: Audience,
  estimatedTotal: number,
  nowMs: number,
): Promise<string> {
  if (copy.kind === 'ad' && !isWithinAdHours(nowMs)) {
    throw new AdminPushError('ADMIN_PUSH_OUTSIDE_AD_HOURS', '광고 알림은 오전 8시부터 오후 9시 전까지만 보낼 수 있어요.');
  }
  if (!(await hasRecentPassingTest(db, copy, nowMs))) {
    throw new AdminPushError(
      'ADMIN_PUSH_TEST_REQUIRED',
      '같은 제목·본문으로 시험 발송을 먼저 해 주세요. 시험 발송은 60분 동안 유효해요.',
    );
  }
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO admin_push_jobs (id, kind, is_test, title, body, audience_json, estimated_total)
          VALUES (?, ?, 0, ?, ?, ?, ?)`,
    args: [id, copy.kind, copy.title, copy.body, JSON.stringify(effectiveAudience(copy.kind, audience)), estimatedTotal],
  });
  return id;
}

export interface JobState {
  id: string;
  status: 'sending' | 'done' | 'canceled';
  sent: number;
  failed: number;
  estimatedTotal: number;
  /** 이번 걸음이 쉬었다면 그 이유. */
  paused?: 'outside_ad_hours' | 'busy';
}

function jobStateFrom(row: Record<string, unknown>): JobState {
  const status = row.status === 'done' || row.status === 'canceled' ? row.status : 'sending';
  return {
    id: String(row.id),
    status,
    sent: Number(row.sent ?? 0),
    failed: Number(row.failed ?? 0),
    estimatedTotal: Number(row.estimated_total ?? 0),
  };
}

/**
 * 맡은 걸음이 이만큼 지나도 끝나지 않았으면 끊긴 것으로 보고 다른 창이 그 구간을 다시 보낸다.
 * 한 걸음은 30대라 몇 초면 끝난다 — 2분은 느린 걸음을 가로채지 않을 만큼 넉넉하다.
 */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

/**
 * 한 걸음 — 다음 기기 묶음을 맡아 보내고 상태를 돌려준다.
 *
 * 맡기와 끝내기를 나눈다. 맡을 때 완료 커서를 넘기면서 그 구간(`claim_from`~`claim_to`)을 함께 적고,
 * 보낸 뒤 구간을 지운다. 맡기의 응답이 끊기면(쓰기는 됐는데 워커가 모름) 구간이 남으므로, 2분 뒤 다음
 * 걸음이 **그 구간을 다시 보낸다** — 커서만 넘기던 때는 그 30대가 말없이 빠졌다. 대가는 끊긴 걸음에서
 * 이미 닿은 기기가 한 번 더 받을 수 있다는 것이다(빠뜨리는 것보다 낫다).
 */
export async function runJobStep(db: Client, env: PushEnv, jobId: string, nowMs: number): Promise<JobState> {
  const res = await db.execute({
    sql: `SELECT id, kind, title, body, audience_json, estimated_total, cursor, sent, failed, status,
                 claim_from, claim_to, claim_at, claim_finishes
          FROM admin_push_jobs WHERE id = ? AND is_test = 0`,
    args: [jobId],
  });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new AdminPushError('ADMIN_PUSH_JOB_NOT_FOUND', '발송 기록을 찾지 못했어요.');
  const state = jobStateFrom(row);
  if (state.status !== 'sending') return state;
  const copy: PushCopy = {
    kind: row.kind === 'ad' ? 'ad' : 'notice',
    title: String(row.title),
    body: String(row.body),
  };
  if (copy.kind === 'ad' && !isWithinAdHours(nowMs)) return { ...state, paused: 'outside_ad_hours' };

  let audience: Audience;
  try {
    audience = effectiveAudience(copy.kind, parseAudience(JSON.parse(String(row.audience_json)) as Record<string, unknown>));
  } catch {
    audience = effectiveAudience(copy.kind, parseAudience({}));
  }

  const claimAt = new Date(nowMs).toISOString();
  let claimFrom: string;
  let claimTo: string;
  let finished: boolean;
  let batch: AudienceCandidate[];
  /** 다시 맡은 구간이 한 걸음보다 클 때, 이번에 보내지 못한 나머지의 시작점(이번 묶음의 마지막 기기). */
  let remainderFrom: string | null = null;
  if (row.claim_from !== null && row.claim_from !== undefined) {
    // 앞 걸음이 맡은 채 끝나지 않았다 — 아직 도는 중이면 기다리고, 끊겼으면 그 구간을 다시 맡는다.
    const previousAt = String(row.claim_at ?? '');
    const previousMs = Date.parse(previousAt);
    if (Number.isFinite(previousMs) && nowMs - previousMs < CLAIM_STALE_MS) return { ...state, paused: 'busy' };
    const reclaim = await db.execute({
      sql: `UPDATE admin_push_jobs SET claim_at = ?
            WHERE id = ? AND claim_from = ? AND COALESCE(claim_at, '') = ? AND status = 'sending'`,
      args: [claimAt, jobId, String(row.claim_from), previousAt],
    });
    if (reclaim.rowsAffected !== 1) return { ...state, paused: 'busy' };
    claimFrom = String(row.claim_from);
    claimTo = String(row.claim_to ?? row.claim_from);
    finished = Number(row.claim_finishes ?? 0) === 1;
    const page = await nextAudiencePage(db, audience, claimFrom, STEP_SCAN_LIMIT, claimTo);
    batch = page.targets.slice(0, STEP_SEND_LIMIT);
    // 그 사이 조건·동의가 바뀌어 같은 구간이 커졌을 수 있다 — 나머지는 버리지 않고 구간으로 남긴다.
    // 보낼 대상이 30대를 넘었거나(이번 묶음의 끝부터), 후보를 끝까지 훑지 못했으면(훑은 끝부터) 이어 간다.
    // 동의 조건에 걸러져 이번 대상이 0대여도 훑지 못한 뒤쪽에 원래 받을 기기가 남아 있을 수 있다.
    if (page.targets.length > STEP_SEND_LIMIT) remainderFrom = batch[batch.length - 1]!.pid;
    else if (!page.exhausted) remainderFrom = page.nextCursor;
  } else {
    claimFrom = String(row.cursor ?? '');
    const page = await nextAudiencePage(db, audience, claimFrom, STEP_SCAN_LIMIT);
    batch = page.targets.slice(0, STEP_SEND_LIMIT);
    const overflow = page.targets.length > STEP_SEND_LIMIT;
    claimTo = overflow ? batch[batch.length - 1]!.pid : page.nextCursor;
    finished = page.exhausted && !overflow;
    // 같은 걸음을 두 창이 동시에 밟으면 커서 비교로 한쪽만 이긴다.
    const claim = await db.execute({
      sql: `UPDATE admin_push_jobs
            SET cursor = ?, claim_from = ?, claim_to = ?, claim_at = ?, claim_finishes = ?
            WHERE id = ? AND cursor = ? AND claim_from IS NULL AND status = 'sending'`,
      args: [claimTo, claimFrom, claimTo, claimAt, finished ? 1 : 0, jobId, claimFrom],
    });
    if (claim.rowsAffected !== 1) return { ...state, paused: 'busy' };
  }

  const { sent, failed } = batch.length > 0 ? await deliver(db, env, batch, copy) : { sent: 0, failed: 0 };
  if (remainderFrom !== null) {
    // 구간을 앞에서부터 줄인다. 맡은 시각을 비워 두면 다음 걸음이 기다리지 않고 나머지를 곧바로 맡는다.
    const narrowed = await db.execute({
      sql: `UPDATE admin_push_jobs SET sent = sent + ?, failed = failed + ?, claim_from = ?, claim_at = NULL
            WHERE id = ? AND claim_from = ? AND claim_at = ?`,
      args: [sent, failed, remainderFrom, jobId, claimFrom, claimAt],
    });
    if (narrowed.rowsAffected !== 1) return { ...state, paused: 'busy' };
    return { ...state, sent: state.sent + sent, failed: state.failed + failed, status: 'sending' };
  }
  // 이 걸음을 아직 내가 맡고 있을 때만 끝낸다 — 늦어서 다른 창이 다시 맡았으면 그쪽이 센다.
  const done = await db.execute({
    sql: `UPDATE admin_push_jobs
          SET sent = sent + ?, failed = failed + ?,
              claim_from = NULL, claim_to = NULL, claim_at = NULL, claim_finishes = 0,
              status = CASE WHEN ? = 1 AND status = 'sending' THEN 'done' ELSE status END,
              finished_at = CASE WHEN ? = 1 AND status = 'sending' THEN datetime('now') ELSE finished_at END
          WHERE id = ? AND claim_from = ? AND claim_at = ?`,
    args: [sent, failed, finished ? 1 : 0, finished ? 1 : 0, jobId, claimFrom, claimAt],
  });
  if (done.rowsAffected !== 1) return { ...state, paused: 'busy' };
  return {
    ...state,
    sent: state.sent + sent,
    failed: state.failed + failed,
    status: finished ? 'done' : 'sending',
  };
}

export async function cancelPushJob(db: Client, jobId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE admin_push_jobs SET status = 'canceled', finished_at = datetime('now')
          WHERE id = ? AND is_test = 0 AND status = 'sending'`,
    args: [jobId],
  });
}
