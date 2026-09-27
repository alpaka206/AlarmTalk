import type { Client, InStatement } from '@libsql/client';
import type { PersonalPromoWindow } from '@alarmtalk/shared';
import { withWriteTransaction } from './transactions';
import {
  PAID_VOICE_RETENTION_DAYS,
  downgradeUserToFree,
  freeDowngradeWrites,
  isPaidEntitlementRow,
  paidEntitlementStatement,
  paidVoiceRetentionUpsertStatement,
} from './billing-cancel';
import { deleteSensitiveVoiceDataForOwners, type DowngradedAlarm } from './paid-voice-cleanup';
import {
  notifyDowngradedAlarms,
  personalPromoEndWarningBody,
  sendBillingStateSignals,
} from './fcm';
import {
  PERSONAL_PROMO_END_CRON,
  activeSubscriptionRowExistsSql,
  resolvePersonalPromo,
} from './personal-promo';
import { logStructured } from './logger';
import type { Env } from '../types';

/**
 * **기간 한정 개인 플랜 종료 — 전환과 보관 스윕.** 규칙 전문: `docs/spec/billing-lifecycle.md`
 * 「기간 한정 개인 플랜」 → 「종료」.
 *
 * 끝 시각에 서버 게이트는 시각 비교로 곧바로 닫히지만, 기간 중 목소리를 든 원시 무료 계정에는
 * 보관 행이 없다(기간 중 보관 판정이 프로모를 유료로 쳤다). 여기서 두 가지를 한다:
 * 1. **전환** — 대상마다 음성 보존 강등(클론 반납·공유 해제·남의 알람 강등) + 보관 행.
 * 2. **스윕** — 보관 기한이 온 사람을 묶어서 지운다.
 *
 * ⚠ **약속은 "끝 + 3일 동안 보관한 뒤 삭제" 다**(앱의 종료 안내·처리방침·제품 결정 — 스펙 D6).
 * 그래서 `delete_after` 는 **끝 + 3일보다 이르지 않다**([promoEndDeleteAfter]). 삭제는 그 시각에
 * 시작해 subrequest 가 허락하는 만큼 빨리 끝낸다(지체 없이 — 2,500명이면 몇 시간). 예전에는 끝 +
 * 3일 **전에** 다 지우려고 기한을 앞당겨 나눠 걸었는데, 그러면 먼저 전환된 사람이 3일을 못 채우고
 * 지워졌다(2,500명이면 끝 + 62시간, 2만 명이면 끝 + 4시간 — 리뷰). 3일째에 이용권을 시작하려던
 * 사람에게는 되돌릴 수 없는 약속 위반이다.
 * - **전용 크론**([PERSONAL_PROMO_END_CRON], 1분)이 이 일만 한다 — 실행마다 subrequest 를 따로
 *   받는다. 5분 틱은 전환 폴백(틱당 3명)만 한다.
 * - 전환·스윕 모두 **묶음**이다 — 사람 수와 무관하게 왕복 몇 번(`freeDowngradeWrites`·
 *   `deleteSensitiveVoiceDataForOwners` 가 사람마다와 같은 문장을 쓴다).
 * - 한 사람의 실패가 나머지를 굶기지 않는다 — 스윕이 아무도 못 지운 실행은 같은 실행에서 전환으로
 *   넘어가고(D10), 스윕 실패·기한 초과 경보는 시간당 한 번만 올린다([isPromoEndAlertSlot]).
 */

export { PERSONAL_PROMO_END_CRON };

/** 전용 크론의 주기([PERSONAL_PROMO_END_CRON] 과 짝) — 경보 창([isPromoEndAlertSlot])의 폭이다. */
const PROMO_END_CRON_PERIOD_MS = 60_000;

/**
 * 한 실행이 쓰는 subrequest 상한 — 워커 ~50 에서 로깅·재시도 여유를 남긴다. 묶음 크기는
 * 이 안에 들게 정했고 `test/personal-promo-end.test.ts` 가 실측으로 잠근다.
 */
export const PROMO_END_RUN_BUDGET = 45;

/**
 * 전용 크론의 전환 묶음 상한(사람). 전환 DB 왕복은 묶음 크기와 무관하게 넷이고, 나머지는
 * 알림이다(기기마다 두 통 — 보이는 예고 + 재조회 신호). 그래서 사람 수가 아니라 **기기 수**로
 * 자른다([PROMO_END_NOTIFY_MESSAGES]) — 이 값은 기기가 없는 사람만 이어질 때의 상한이다.
 */
export const PROMO_END_TRANSITION_BATCH = 15;

/** 5분 틱(전용 크론이 없을 때의 폴백)의 전환 묶음 — 그 틱은 다른 일로 이미 빠듯하다. */
export const PROMO_END_TRANSITION_BATCH_MAIN = 3;

/**
 * 전환 한 번의 **알림 메시지 밖** 비용 — DB 왕복(후보 1 · 트랜잭션 3)·토큰 조회(1)·OAuth(1)·죽은
 * 토큰 정리(1).
 */
const PROMO_END_TRANSITION_OVERHEAD = 7;

/**
 * 전환 알림에 쓸 수 있는 메시지 수 — [PROMO_END_RUN_BUDGET] 에서 스윕 확인(1)과 전환의 나머지
 * 비용([PROMO_END_TRANSITION_OVERHEAD])을 뺀 값. 묶음은 `2 × 기기 수` 의 합이 이걸 넘지 않게
 * 자른다(최소 한 명은 한다). 실측은 `test/personal-promo-end.test.ts` 의 로그.
 */
const PROMO_END_NOTIFY_MESSAGES = PROMO_END_RUN_BUDGET - 1 - PROMO_END_TRANSITION_OVERHEAD;

/**
 * 묶음 스윕 한 번의 DB 왕복 상한 — 실측 28(사람 수와 무관하다) + 실패했을 때의 롤백 1. 스윕이
 * 아무도 못 지운 실행이 전환으로 넘어갈 때([PROMO_END_NOTIFY_MESSAGES_AFTER_SWEEP]) 스윕이 이미
 * 쓴 몫으로 뺀다 — 실패 지점을 모르니 최악으로 잡는다.
 */
const PROMO_END_SWEEP_DB_MAX = 29;

/**
 * 스윕이 아무도 못 지운 실행(실패·전원 유료)이 **이어서** 하는 전환의 알림 메시지 수 — 같은
 * 실행이라 스윕 몫([PROMO_END_SWEEP_DB_MAX])을 먼저 뺀다. 작지만(기기 하나인 사람 넷) 0 이 아니다
 * — 늘 실패하는 보관 행 하나가 전환을 통째로 멈추지 못한다(D10).
 */
const PROMO_END_NOTIFY_MESSAGES_AFTER_SWEEP =
  PROMO_END_RUN_BUDGET - PROMO_END_SWEEP_DB_MAX - PROMO_END_TRANSITION_OVERHEAD;

/** 묶음 전환이 실패했을 때 한 사람씩(격리) 다시 해 보는 인원 — 사람마다 왕복 다섯. */
const PROMO_END_TRANSITION_FALLBACK = 3;

/**
 * 전용 크론의 스윕 묶음(사람). 묶음 스윕의 DB 왕복은 사람 수와 거의 무관하고(실측 28), 나머지는
 * 지워진 목소리를 들고 있던 기기에 보내는 무음 신호다(사람마다 기기 수만큼). 이 속도(분당 약
 * 10명)가 끝 + 3일 이후 삭제가 끝나는 시간을 정한다 — 2,500명이면 네 시간 남짓.
 */
export const PROMO_END_SWEEP_BATCH = 10;

/**
 * 스윕 알림에 쓸 수 있는 메시지 수 — [PROMO_END_RUN_BUDGET] 에서 묶음 스윕의 DB 왕복(실측 28 —
 * 사람 수와 무관하다)·토큰 조회(1)·OAuth(1)·죽은 토큰 정리(1)를 뺀 값. 무음 신호는 기기마다 한
 * 통이다. 실측: 10명 · 기기 10대 = 40.
 */
const PROMO_END_SWEEP_NOTIFY_MESSAGES = PROMO_END_RUN_BUDGET - 31;

/**
 * 스윕 묶음을 **기한이 가장 먼저 온 `묶음 × 이 배수` 명** 안에서 무작위로 뽑는다. 매번 실패하는
 * 사람은 지워지지 않으니 언제나 이 창의 맨 앞에 남는다 — 창이 좁으면 거의 모든 묶음에 끼어
 * 스윕을 멈춘다. 넓게 두면(100명 창에 묶음 10명) 한 사람이 끼는 확률이 10% 로 떨어진다.
 */
const PROMO_END_SWEEP_WINDOW_FACTOR = 10;

/**
 * 끝 + 3일을 **넘겨** 전환된 사람의 보관 — 지금부터 이만큼(정시로 올림). 약속 시각을 그대로 걸면
 * 이미 지난 시각이라 삭제 예고 푸시보다 삭제가 먼저 온다.
 */
const PROMO_END_LATE_NOTICE_MS = 24 * 60 * 60 * 1000;

/** 전용 크론의 전환은 끝부터 이만큼만 한다 — 뒤늦게 대상이 된 사람은 5분 틱 폴백이 잇는다. */
const PROMO_END_DEDICATED_TRANSITION_MS = 24 * 60 * 60 * 1000;

/** 전용 크론은 약속 시각(끝 + 3일)에서 이만큼 지나면 멈춘다 — 남은 건 5분 틱 스윕이 잇는다. */
const PROMO_END_DEDICATED_TAIL_MS = 24 * 60 * 60 * 1000;

/**
 * 기한이 이만큼 지난 보관 행이 남아 있으면 경보한다(스윕이 밀리거나 막혔다는 뜻). 끝 + 3일에는
 * 대상 전원의 기한이 한꺼번에 오고 스윕이 몇 시간에 걸쳐 지우므로(2,500명이면 네 시간 남짓),
 * 그 정상 적체로는 울리지 않게 둔다.
 */
const RETENTION_OVERDUE_ALERT_MS = 6 * 60 * 60 * 1000;

/**
 * 시간당 한 번만 올리는 경보 갈래 — 전용 크론은 1분마다 돌아서, 늘 실패하는 행 하나가 하루
 * 1,440건씩 같은 경보를 쌓는다(리뷰). 로그는 매번 남는다.
 */
const PROMO_END_HOURLY_ALERT_STAGES: ReadonlySet<string> = new Set([
  'sweep_batch',
  'retention_overdue',
]);

const HOUR_MS = 60 * 60 * 1000;

/**
 * 종료 전환 대상 — `u` 는 `users` 별칭. **보관 행이 생기면 스스로 빠진다**(멱등, 새 표·컬럼 없음).
 *
 * - 원시 `plan = 'free'` — 결제자는 대상이 아니다. **기간 전부터 무료였던 계정(베타 계정 포함)도
 *   목소리가 있으면 대상이다** — 무료 계정의 목소리는 3일 보관 후 삭제라는 처리방침과 같은 결론이다.
 * - `status = 'active'` 구독 행이 **하나도 없다** — `activeSubscriptionRowExistsSql` 이 유일한
 *   조건이고, 응답의 `personal_promo.deletes_voices_at_end` 도 같은 조건을 본다(둘이 갈라지면 앱이
 *   말한 것과 서버가 하는 일이 다르다). 결제 보류(ON_HOLD·PAUSED)는 행을 `active` 로 남긴다.
 * - 삭제·시스템·초안이 아닌 목소리가 있다 — 지울 것이 없는 사람은 건드리지도, 알리지도 않는다.
 *   목소리의 주인 id 는 PK 이거나 로그인 id(google_id)다.
 * - 보관 행이 없다.
 */
const PROMO_END_TARGET = `u.plan = 'free'
  AND NOT ${activeSubscriptionRowExistsSql('u.id')}
  AND NOT EXISTS (SELECT 1 FROM paid_voice_retention r WHERE r.user_id = u.id)
  AND EXISTS (
    SELECT 1 FROM voice_profiles vp
    WHERE (vp.user_id = u.id OR (u.google_id IS NOT NULL AND vp.user_id = u.google_id))
      AND vp.deleted_at IS NULL
      AND COALESCE(vp.is_system, 0) = 0
      AND COALESCE(vp.is_draft, 0) = 0
  )`;

/**
 * 약속 시각 — 끝 + 보관 일수(3일). 종료 전환 대상의 목소리는 **이보다 먼저 지우지 않는다**(D6).
 */
export function promoEndRetentionDeadline(window: PersonalPromoWindow): Date {
  return new Date(window.endsAt.getTime() + PAID_VOICE_RETENTION_DAYS * 24 * HOUR_MS);
}

/**
 * 종료 전환이 거는 `delete_after` — **약속 시각(끝 + 3일)보다 이르지 않다**(D6).
 *
 * - 약속 시각 전에 전환된 사람: 약속 시각 그대로. 앱의 종료 안내("3일 보관 후 삭제")·처리방침과
 *   같은 시각이고, 스윕은 그때부터 지운다.
 * - 약속 시각을 **넘겨** 전환된 사람(전용 크론이 빠져 폴백만 돈 경우 등): 지금 + 24시간. 약속
 *   시각을 그대로 걸면 이미 지난 시각이라 삭제 예고 푸시보다 삭제가 먼저 온다.
 * - 둘 다 **정시로 올린다** — 푸시가 적는 시각(분을 버린 한국 시간)이 실제 삭제 시작과 같게.
 *   운영의 끝은 정시라 약속 시각은 그대로이고, 올리는 쪽이라 약속보다 이르지 않다.
 */
export function promoEndDeleteAfter(window: PersonalPromoWindow, now: Date): Date {
  const deadline = promoEndRetentionDeadline(window).getTime();
  const at = now.getTime() < deadline ? deadline : now.getTime() + PROMO_END_LATE_NOTICE_MS;
  return new Date(Math.ceil(at / HOUR_MS) * HOUR_MS);
}

/**
 * 경보 창 — **매시 첫 크론 주기**에만 참이다. 상태(표·기억) 없이 경보 갈래마다 시간당 최대 한
 * 번을 보장한다([PROMO_END_HOURLY_ALERT_STAGES]). 늘 실패하는 행은 다음 정시에 다시 잡히고,
 * 스윕 묶음에 드물게 끼는 행은 기한 초과 경보(가장 이른 행의 `uid`)가 드러낸다.
 */
export function isPromoEndAlertSlot(now: Date): boolean {
  return now.getTime() % HOUR_MS < PROMO_END_CRON_PERIOD_MS;
}

/** [PROMO_END_HOURLY_ALERT_STAGES] 를 경보 창 밖에서 삼키는 훅. 나머지 갈래는 그대로 올린다. */
function hourlyAlertHooks(hooks: PromoEndHooks | undefined, now: Date): PromoEndHooks | undefined {
  const onError = hooks?.onError;
  if (!onError) return hooks;
  const open = isPromoEndAlertSlot(now);
  return {
    onError: (stage, err, tags) => {
      if (!open && PROMO_END_HOURLY_ALERT_STAGES.has(stage)) return;
      onError(stage, err, tags);
    },
  };
}

export interface PromoEndTransitioned {
  userPk: string;
  deleteAfter: Date;
}

export interface PromoEndHooks {
  /**
   * 경보로 올릴 실패 — 호출부(`index.ts` 크론)가 Sentry 로 보낸다. `stage` 는 갈래, `tags` 는
   * 식별자만(사람 id·묶음 크기). 같은 사람이 계속 실패하면 같은 갈래로 반복돼 드러난다.
   */
  onError?: (stage: string, err: unknown, tags?: Record<string, string>) => void;
}

/**
 * 종료 전환 한 묶음.
 *
 * ⚠ **한 사람이 전환을 멈추지 않게**(리뷰): 예전에는 `ORDER BY u.id LIMIT 3` 이라 매번 실패하는
 * 사람이 매 틱 같은 자리를 차지했다 — 셋이면 전환이 통째로 멈춘다. 지금은
 * - 후보를 **무작위 기준점**부터 id 순으로 고른다(`pivot` — 끝에 닿으면 처음으로 감는다). 한
 *   사람이 매번 뽑히지 않는다.
 * - 묶음이 실패하면 앞의 몇 명만 한 사람씩(격리) 다시 한다. 실패한 사람은 이 실행에서 빼고
 *   (`exclude`) `onError('transition_user')` 로 경보한다.
 *
 * 사람마다 조건을 쓰기 트랜잭션 안에서 **다시 본다**(조회와 쓰기 사이에 결제·쿠폰 등록이 끼어들 수
 * 있다) — 묶음은 조건을 통과한 사람만 쓴다.
 */
export async function transitionPersonalPromoEnd(
  db: Client,
  window: PersonalPromoWindow | null,
  now: Date,
  options: {
    limit?: number;
    /** 알림 메시지 상한 — 기기 수로 묶음을 자른다. `null` 이면 자르지 않는다(테스트·푸시 꺼짐). */
    notifyMessages?: number | null;
    pivot?: string;
    exclude?: Set<string>;
    /** 묶음이 실패했을 때 한 사람씩 다시 해 볼 인원 — 기본 [PROMO_END_TRANSITION_FALLBACK]. */
    isolate?: number;
    hooks?: PromoEndHooks;
  } = {},
): Promise<PromoEndTransitioned[]> {
  if (!window || now.getTime() < window.endsAt.getTime()) return [];
  const limit = options.limit ?? PROMO_END_TRANSITION_BATCH_MAIN;
  const isolate = options.isolate ?? PROMO_END_TRANSITION_FALLBACK;
  const exclude = options.exclude ?? new Set<string>();
  const pivot = options.pivot ?? crypto.randomUUID();
  const notifyMessages =
    options.notifyMessages === undefined ? PROMO_END_NOTIFY_MESSAGES : options.notifyMessages;

  const fetchCount = limit + exclude.size;
  const devicesOf = `(SELECT COUNT(*) FROM push_tokens pt WHERE pt.user_id = u.id)`;
  const candidates = await db.execute({
    sql: `SELECT id, devices, part FROM (
            SELECT u.id AS id, ${devicesOf} AS devices, 0 AS part FROM users u
            WHERE u.id >= ? AND ${PROMO_END_TARGET} ORDER BY u.id LIMIT ?
          )
          UNION ALL
          SELECT id, devices, part FROM (
            SELECT u.id AS id, ${devicesOf} AS devices, 1 AS part FROM users u
            WHERE u.id < ? AND ${PROMO_END_TARGET} ORDER BY u.id LIMIT ?
          )`,
    args: [pivot, fetchCount, pivot, fetchCount],
  });
  const ordered = candidates.rows
    .map((r) => ({ id: String(r.id), devices: Number(r.devices ?? 0), part: Number(r.part) }))
    .filter((r) => !exclude.has(r.id))
    .sort((a, b) => a.part - b.part || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const batch: string[] = [];
  let messages = 0;
  for (const row of ordered) {
    if (batch.length >= limit) break;
    const cost = 2 * row.devices;
    if (notifyMessages !== null && batch.length > 0 && messages + cost > notifyMessages) break;
    batch.push(row.id);
    messages += cost;
  }
  if (batch.length === 0) return [];

  // 남은 대상 수를 세지 않는다 — 기한은 사람 수와 무관하게 약속 시각이다(D6).
  const deleteAfter = promoEndDeleteAfter(window, now);
  const deleteAfterIso = deleteAfter.toISOString();

  try {
    const done = await withWriteTransaction(db, async (tx) => {
      const ph = batch.map(() => '?').join(', ');
      const [confirmedRes, voiceRes] = await tx.batch([
        {
          sql: `SELECT u.id, u.google_id FROM users u WHERE u.id IN (${ph}) AND ${PROMO_END_TARGET}`,
          args: batch,
        },
        {
          // `downgradeUserToFree` 의 클론 조회와 같은 범위 — 주인 id 는 PK 이거나 로그인 id 다.
          sql: `SELECT u.id AS owner_pk, vp.elevenlabs_voice_id FROM voice_profiles vp
                JOIN users u ON vp.user_id = u.id
                  OR (u.google_id IS NOT NULL AND vp.user_id = u.google_id)
                WHERE u.id IN (${ph}) AND vp.elevenlabs_voice_id IS NOT NULL`,
          args: batch,
        },
      ]);
      const writes: InStatement[] = [];
      const confirmed: string[] = [];
      for (const row of confirmedRes!.rows) {
        const userPk = String(row.id);
        const providerVoiceIds = voiceRes!.rows
          .filter((v) => String(v.owner_pk) === userPk)
          .map((v) => v.elevenlabs_voice_id as string);
        writes.push(
          ...freeDowngradeWrites(
            userPk,
            (row.google_id as string | null) ?? null,
            providerVoiceIds,
          ),
          paidVoiceRetentionUpsertStatement(userPk, deleteAfterIso),
        );
        confirmed.push(userPk);
      }
      if (writes.length > 0) await tx.batch(writes);
      return confirmed;
    });
    if (done.length > 0) {
      logStructured('info', {
        at: 'billing.personal_promo_end',
        transitioned: done.length,
        delete_after: deleteAfterIso,
      });
    }
    return done.map((userPk) => ({ userPk, deleteAfter }));
  } catch (batchErr) {
    logStructured('error', {
      at: 'billing.personal_promo_end',
      action: 'TRANSITION_BATCH_FAILED',
      size: batch.length,
      error: String(batchErr),
    });
  }

  // 묶음이 실패했다 — 앞의 몇 명만 한 사람씩(격리) 다시 한다. 실패한 사람은 이 실행에서 빼고
  // 경보한다. 나머지는 다음 실행이 다른 기준점에서 다시 고른다.
  const transitioned: PromoEndTransitioned[] = [];
  for (const userPk of batch.slice(0, isolate)) {
    try {
      const done = await withWriteTransaction(db, async (tx) => {
        const still = await tx.execute({
          sql: `SELECT 1 FROM users u WHERE u.id = ? AND ${PROMO_END_TARGET} LIMIT 1`,
          args: [userPk],
        });
        if (still.rows.length === 0) return false;
        await downgradeUserToFree(tx, userPk, { deleteVoiceData: false });
        await tx.execute(paidVoiceRetentionUpsertStatement(userPk, deleteAfterIso));
        return true;
      });
      if (done) transitioned.push({ userPk, deleteAfter });
    } catch (err) {
      exclude.add(userPk);
      logStructured('error', {
        at: 'billing.personal_promo_end',
        action: 'TRANSITION_FAILED',
        uid: userPk,
        error: String(err),
      });
      options.hooks?.onError?.('transition_user', err, { uid: userPk });
    }
  }
  return transitioned;
}

/**
 * 전환된 사람에게 **커밋 뒤** 알린다 — `plan_changed` + 삭제 예고(사람마다 자기 기한). 이용권이
 * 끝난 사람의 문구("이용권이 끝나 … 3일간만")가 아니라 [personalPromoEndWarningBody] 다.
 * ⚠ 던지지 않는다(알림은 즉시성만 맡는다 — 앱은 들어올 때 `/auth/me` 로 따라잡는다).
 */
export async function notifyPromoEndTransitioned(
  db: Client,
  env: Parameters<typeof sendBillingStateSignals>[1] | undefined,
  transitioned: readonly PromoEndTransitioned[],
  now: Date = new Date(),
): Promise<void> {
  if (!env || transitioned.length === 0) return;
  const hasFirebase = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const hasApns = Boolean(env.APNS_KEY_ID && env.APNS_PRIVATE_KEY && env.APPLE_TEAM_ID);
  if (!hasFirebase && !hasApns) return;
  const deleteAfterOf = new Map(transitioned.map((t) => [t.userPk, t.deleteAfter]));
  const userPks = Array.from(deleteAfterOf.keys());
  try {
    await sendBillingStateSignals(db, env, {
      planChangedUserIds: userPks,
      deletionWarningUserPks: userPks,
      retentionDays: PAID_VOICE_RETENTION_DAYS,
      warningBodyFor: (userPk) => personalPromoEndWarningBody(deleteAfterOf.get(userPk)!, now),
    });
  } catch (err) {
    logStructured('error', {
      at: 'billing.personal_promo_end',
      action: 'PUSH_FAILED',
      error: String(err),
    });
  }
}

export interface BulkSweepResult {
  /** 이번에 묶음으로 시도한 사람들(실패해도 채운다). */
  attempted: string[];
  /** 묶음 트랜잭션이 실패해 통째로 롤백됐는가. */
  failed: boolean;
  cleanedUserPks: string[];
  targets: DowngradedAlarm[];
  voiceAccessRevokedUserIds: string[];
  /** 기한이 가장 먼저 온 보관 행의 기한 — 밀림 경보에 쓴다. 없으면 null. */
  oldestDueAt: string | null;
  /** 그 행의 사람(PK) — 경보에 식별자로 싣는다. 늘 실패하는 행은 언제나 여기 남는다. */
  oldestDueUserPk: string | null;
}

/**
 * **보관 기한 스윕 — 묶음.** `sweepPaidVoiceRetention`(5분 틱, 사람마다 한 트랜잭션·틱당 2명)과
 * 같은 일을 사람 여럿에 한 트랜잭션으로 한다:
 * 1. 사람마다 "지금도 무료인가" 를 다시 묻는다 — `hasActivePaidEntitlement` 와 **같은 문장**을
 *    한 묶음으로(`paidEntitlementStatement`). 유료면 보관 행만 지우고 데이터는 남긴다.
 * 2. 무료인 사람들의 주인 id(PK·로그인 id)를 모아 `deleteSensitiveVoiceDataForOwners` 한 번 —
 *    사람마다와 같은 문장이고 결과는 합집합이다.
 * 3. 묶음 전원의 보관 행을 지운다.
 *
 * 묶음은 **가장 급한 `limit × 10` 명 안에서 무작위로** 고른다 — 매번 실패하는 사람이 있어도 모든
 * 실행을 망치지 않는다. 실패한 묶음은 통째로 롤백되고(사람마다 스윕과 같은 원자성), 경보한 뒤
 * 다음 실행이 다시 뽑는다. 5분 틱의 사람마다 스윕은 그대로 돌아 한 사람씩 격리하는 그물로 남는다.
 */
export async function sweepDueRetentionInBulk(
  db: Client,
  now: Date,
  options: {
    limit?: number;
    promoCoversFree: boolean;
    /** 알림 메시지 상한 — 기기 수로 묶음을 자른다. `null` 이면 자르지 않는다(푸시 꺼짐). */
    notifyMessages?: number | null;
    random?: () => number;
    hooks?: PromoEndHooks;
  },
): Promise<BulkSweepResult> {
  const limit = options.limit ?? PROMO_END_SWEEP_BATCH;
  const random = options.random ?? Math.random;
  const notifyMessages =
    options.notifyMessages === undefined ? PROMO_END_SWEEP_NOTIFY_MESSAGES : options.notifyMessages;
  const empty: BulkSweepResult = {
    attempted: [],
    failed: false,
    cleanedUserPks: [],
    targets: [],
    voiceAccessRevokedUserIds: [],
    oldestDueAt: null,
    oldestDueUserPk: null,
  };
  const due = await db.execute({
    sql: `SELECT r.user_id, r.delete_after,
                 (SELECT COUNT(*) FROM push_tokens pt WHERE pt.user_id = r.user_id) AS devices
          FROM paid_voice_retention r WHERE r.delete_after <= ?
          ORDER BY r.delete_after, r.user_id LIMIT ?`,
    args: [now.toISOString(), limit * PROMO_END_SWEEP_WINDOW_FACTOR],
  });
  if (due.rows.length === 0) return empty;
  const oldestDueAt = String(due.rows[0]!.delete_after);
  const oldestDueUserPk = String(due.rows[0]!.user_id);
  const pool = due.rows.map((r) => ({ id: String(r.user_id), devices: Number(r.devices ?? 0) }));
  // 피셔–예이츠 — 가장 급한 창 안에서 순서를 섞는다.
  for (let i = 0; i < pool.length - 1; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  // 창이 작으면(끝물) 묶음을 창의 절반으로 줄인다 — 매번 실패하는 사람이 남아 있어도 절반의
  // 확률로는 그 사람을 뺀 묶음이 나와 나머지가 지워진다(상태를 남기지 않는 회피).
  const size = Math.min(limit, Math.max(1, Math.ceil(pool.length / 2)));
  // 지워진 목소리를 들고 있던 기기에 신호가 간다(기기마다 한 통) — 기기 수로 자른다.
  const batch: string[] = [];
  let messages = 0;
  for (const row of pool) {
    if (batch.length >= size) break;
    if (notifyMessages !== null && batch.length > 0 && messages + row.devices > notifyMessages) {
      continue;
    }
    batch.push(row.id);
    messages += row.devices;
  }

  try {
    const outcome = await withWriteTransaction(db, async (tx) => {
      const paidRes = await tx.batch(batch.map((userPk) => paidEntitlementStatement(userPk)));
      const unpaid = batch.filter(
        (_, i) => !isPaidEntitlementRow(paidRes[i]!.rows[0], options.promoCoversFree),
      );
      let revocation: Awaited<ReturnType<typeof deleteSensitiveVoiceDataForOwners>> = {
        downgradedAlarms: [],
        voiceAccessRevokedUserIds: [],
      };
      const pkOfLogin = new Map<string, string>();
      if (unpaid.length > 0) {
        const ph = unpaid.map(() => '?').join(', ');
        const logins = await tx.execute({
          sql: `SELECT id, google_id FROM users WHERE id IN (${ph}) AND google_id IS NOT NULL`,
          args: unpaid,
        });
        for (const r of logins.rows) pkOfLogin.set(String(r.google_id), String(r.id));
        revocation = await deleteSensitiveVoiceDataForOwners(tx, [...unpaid, ...pkOfLogin.keys()]);
      }
      await tx.execute({
        sql: `DELETE FROM paid_voice_retention WHERE user_id IN (${batch.map(() => '?').join(', ')})`,
        args: batch,
      });
      return { unpaid, revocation, pkOfLogin };
    });
    // 접근권 재확인 대상에는 주인의 PK 와 로그인 id 가 **둘 다** 들어 있다. 토큰 조회는 둘 중 어느
    // 쪽으로도 같은 기기를 찾으므로, 그대로 보내면 한 기기에 같은 신호가 두 통 간다 — PK 로 접는다.
    const revokedUserIds = Array.from(
      new Set(
        outcome.revocation.voiceAccessRevokedUserIds.map((id) => outcome.pkOfLogin.get(id) ?? id),
      ),
    );
    return {
      attempted: batch,
      failed: false,
      cleanedUserPks: outcome.unpaid,
      targets: outcome.revocation.downgradedAlarms,
      voiceAccessRevokedUserIds: revokedUserIds,
      oldestDueAt,
      oldestDueUserPk,
    };
  } catch (err) {
    logStructured('error', {
      at: 'billing.paid_voice_retention_bulk_sweep',
      action: 'RETENTION_BULK_CLEANUP_FAILED',
      size: batch.length,
      error: String(err),
    });
    options.hooks?.onError?.('sweep_batch', err, {
      size: String(batch.length),
      // 식별자만 — 어느 묶음이 실패했는지 되짚을 수 있게(앞 몇 명).
      uids: batch.slice(0, 5).join(','),
    });
    return { ...empty, attempted: batch, failed: true, oldestDueAt, oldestDueUserPk };
  }
}

type PromoEndEnv = Partial<
  Pick<
    Env,
    | 'PERSONAL_PROMO_STARTS_AT'
    | 'PERSONAL_PROMO_ENDS_AT'
    | 'ENVIRONMENT'
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_SERVICE_ACCOUNT_JSON'
    | 'APNS_KEY_ID'
    | 'APNS_PRIVATE_KEY'
    | 'APPLE_TEAM_ID'
    | 'APPLE_BUNDLE_ID'
  >
>;

export interface PromoEndRunResult {
  transitioned: PromoEndTransitioned[];
  sweep: BulkSweepResult | null;
}

/**
 * 크론 한 실행 몫.
 *
 * - `dedicated`(전용 1분 크론): 기한이 온 보관 행이 있으면 **스윕 먼저**. 스윕이 누군가를 지웠으면
 *   그 실행은 거기서 끝이다(스윕이 subrequest 를 거의 다 쓴다). 스윕이 **아무도 못 지웠으면**(묶음
 *   실패·전원 유료라 풀어 주기만 함) 같은 실행에서 전환으로 넘어간다 — 스윕이 쓴 몫을 빼고 작은
 *   묶음으로(D10). 예전에는 "스윕 또는 전환" 이라, 늘 실패하는 보관 행 **하나**가 기한이 온 채
 *   남아 있으면 매 실행 스윕만 시도하다 실패해 전용 크론의 전환이 통째로 멈췄다(리뷰).
 *   전환은 끝부터 하루 동안만, 실행 전체는 약속 시각 + 하루까지만 한다(그 뒤는 5분 틱이 잇는다).
 * - `main`(5분 틱): 전환 폴백(틱당 3명). 전용 크론이 빠져 있어도 전환은 멈추지 않는다 — 스윕은
 *   원래 있던 사람마다 스윕이 한다.
 * - 스윕 실패(`sweep_batch`)·기한 초과(`retention_overdue`) 경보는 **매시 한 번**만 올린다
 *   ([isPromoEndAlertSlot]) — 로그는 매 실행 남긴다.
 *
 * 끝 전이거나 스위치가 꺼져 있으면 **DB 를 부르지 않는다**(기간 내내 1분마다 도는 실행이다).
 */
export async function runPersonalPromoEnd(
  db: Client,
  env: PromoEndEnv | undefined,
  now: Date,
  options: { role: 'dedicated' | 'main'; hooks?: PromoEndHooks },
): Promise<PromoEndRunResult> {
  const result: PromoEndRunResult = { transitioned: [], sweep: null };
  const window = resolvePersonalPromo(env, now).window;
  if (!window || now.getTime() < window.endsAt.getTime()) return result;
  const sinceEnd = now.getTime() - window.endsAt.getTime();
  const hooks = hourlyAlertHooks(options.hooks, now);
  const pushEnv = env ?? {};
  const pushConfigured = Boolean(
    (pushEnv.FIREBASE_PROJECT_ID && pushEnv.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    (pushEnv.APNS_KEY_ID && pushEnv.APNS_PRIVATE_KEY && pushEnv.APPLE_TEAM_ID),
  );
  let notifyMessages: number | null = pushConfigured ? PROMO_END_NOTIFY_MESSAGES : null;
  let isolate = PROMO_END_TRANSITION_FALLBACK;

  if (options.role === 'dedicated') {
    if (now.getTime() > promoEndRetentionDeadline(window).getTime() + PROMO_END_DEDICATED_TAIL_MS) {
      return result;
    }
    const sweep = await sweepDueRetentionInBulk(db, now, {
      promoCoversFree: false,
      notifyMessages: pushConfigured ? PROMO_END_SWEEP_NOTIFY_MESSAGES : null,
      hooks,
    });
    result.sweep = sweep;
    if (sweep.oldestDueAt) {
      const overdue = now.getTime() - Date.parse(sweep.oldestDueAt);
      if (overdue > RETENTION_OVERDUE_ALERT_MS) {
        const overdueMinutes = String(Math.round(overdue / 60_000));
        const uid = sweep.oldestDueUserPk ?? '';
        logStructured('warn', {
          at: 'billing.personal_promo_end',
          action: 'RETENTION_OVERDUE',
          overdue_minutes: overdueMinutes,
          uid,
        });
        hooks?.onError?.(
          'retention_overdue',
          new Error(`paid_voice_retention overdue by ${overdueMinutes} min`),
          { overdue_minutes: overdueMinutes, uid },
        );
      }
    }
    if (sweep.cleanedUserPks.length > 0) {
      await notifyDowngradedAlarms(
        db,
        pushConfigured ? pushEnv : undefined,
        sweep.targets,
        sweep.voiceAccessRevokedUserIds,
      );
      return result;
    }
    if (sinceEnd > PROMO_END_DEDICATED_TRANSITION_MS) return result;
    if (sweep.attempted.length > 0) {
      // 스윕이 아무도 못 지웠다 — 그 몫(최악)을 빼고 작은 묶음으로 전환을 잇는다(D10). 격리 재시도도
      // 한 사람만: 스윕 실패 뒤 전환 묶음까지 실패하면 남은 subrequest 가 거의 없다.
      notifyMessages = pushConfigured ? PROMO_END_NOTIFY_MESSAGES_AFTER_SWEEP : null;
      isolate = 1;
    }
  }

  result.transitioned = await transitionPersonalPromoEnd(db, window, now, {
    limit:
      options.role === 'dedicated' ? PROMO_END_TRANSITION_BATCH : PROMO_END_TRANSITION_BATCH_MAIN,
    notifyMessages,
    isolate,
    hooks,
  });
  await notifyPromoEndTransitioned(db, pushEnv, result.transitioned, now);
  return result;
}
