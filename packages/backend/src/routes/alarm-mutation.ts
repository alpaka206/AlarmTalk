import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';
import { R2VoiceStorage } from '../lib/r2-storage';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import { sendFamilyAlarmPush } from '../lib/fcm';
import { familyAlarmSettingsFromRow } from '../lib/family-alarm-settings';
import {
  validateAlarmFields,
  normalizeAlarmRow,
  normalizeTimezone,
  claimTargetedAlarmSlot,
  evaluateFamilyAlarmTimingGuard,
  type AlarmRow,
  type AlarmMode,
  type VibrationPattern,
  type WakeMode,
} from './alarm-helpers';
import { isPaidVoicePlan } from './billing-helpers';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { callerOwnerIds, inPlaceholders } from '../lib/caller-ids';
import { STOCK_GREETING_CATEGORY } from '../lib/stock-clips';

const alarmMutation = new Hono<AppEnv>();

function alarmUsesPaidVoice(body: {
  mode?: string | null;
  wake_mode?: string | null;
  message_id?: string | null;
  voice_profile_id?: string | null;
}): boolean {
  return (
    body.mode === 'tts' ||
    body.wake_mode === 'voice_only' ||
    !!body.message_id ||
    !!body.voice_profile_id
  );
}

/**
 * 무료 플랜도 시스템 스톡 보이스 기반 TTS 알람은 허용한다.
 * 그 외 사용자 목소리(클론) 기반 알람은 유료 전용.
 */
async function usesOnlySystemStockVoice(
  db: ReturnType<typeof getDB>,
  body: {
    message_id?: string | null;
    voice_profile_id?: string | null;
  },
): Promise<boolean> {
  if (body.voice_profile_id) {
    const res = await db.execute({
      sql: `SELECT 1 FROM voice_profiles
            WHERE id = ? AND COALESCE(is_system, 0) = 1 AND deleted_at IS NULL
            LIMIT 1`,
      args: [body.voice_profile_id],
    });
    return res.rows.length > 0;
  }
  if (body.message_id) {
    const res = await db.execute({
      sql: `SELECT 1 FROM messages m
            JOIN voice_profiles vp ON vp.id = m.voice_profile_id
            WHERE m.id = ? AND COALESCE(vp.is_system, 0) = 1
            LIMIT 1`,
      args: [body.message_id],
    });
    return res.rows.length > 0;
  }
  return false;
}

/**
 * message_id 가 호출자(ownerIds) 소유이거나 시스템 스톡 프리셋인지 확인한다.
 * POST 생성 경로(아래)와 GET /tts/messages/:id/audio 의 허용 규칙과 동일하게
 * 맞춰, PATCH 에서 타인 메시지 id 를 알람에 끼워 넣는 IDOR 을 막는다.
 */
async function messageBelongsToCaller(
  db: DbExecutor,
  messageId: string,
  ownerIds: [string, string],
): Promise<boolean> {
  const msg = await db.execute({
    sql: `SELECT 1 FROM messages
          WHERE id = ?
            AND NOT EXISTS (
              SELECT 1 FROM voice_profiles draft_vp
              WHERE draft_vp.id = messages.voice_profile_id
                AND COALESCE(draft_vp.is_draft, 0) = 1
            )
            AND (
              user_id IN (?, ?)
              OR (
                COALESCE(is_preset, 0) = 1
                AND EXISTS (
                  SELECT 1 FROM voice_profiles vp
                  WHERE vp.id = messages.voice_profile_id
                    AND COALESCE(vp.is_system, 0) = 1
                )
              )
            )
          LIMIT 1`,
    args: [messageId, ...ownerIds],
  });
  return msg.rows.length > 0;
}

/**
 * voice_profile_id 가 호출자 소유이거나 시스템 보이스인지 확인한다.
 * 타인 voice_profile_id 를 알람에 기록하는 IDOR 을 막는다.
 */
async function voiceProfileBelongsToCaller(
  db: DbExecutor,
  voiceProfileId: string,
  ownerIds: [string, string],
): Promise<boolean> {
  // 본인 소유 또는 시스템 스톡 보이스.
  const owned = await db.execute({
    sql: `SELECT 1 FROM voice_profiles
          WHERE id = ?
            AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 0
            AND (user_id IN (?, ?) OR COALESCE(is_system, 0) = 1)
          LIMIT 1`,
    args: [voiceProfileId, ...ownerIds],
  });
  if (owned.rows.length > 0) return true;

  // 가족/그룹 공유 보이스(is_shared=1, non-draft): 소유자가 호출자와 같은 plan group 이면
  // 허용한다. tts.ts findUsableVoiceProfile 의 접근 모델과 일치시켜, 공유 음성으로 만든
  // 알람의 POST/PATCH 가 404 로 막히지 않게 한다(무관한 타인 비공개 프로필은 계속 차단).
  const shared = await db.execute({
    sql: `SELECT u.id AS owner_pk
          FROM voice_profiles vp
          LEFT JOIN users u ON u.google_id = vp.user_id OR u.id = vp.user_id
          WHERE vp.id = ? AND COALESCE(vp.is_shared, 0) = 1
            AND COALESCE(vp.is_draft, 0) = 0
            AND vp.deleted_at IS NULL
          LIMIT 1`,
    args: [voiceProfileId],
  });
  if (shared.rows.length === 0) return false;
  const ownerPk =
    typeof shared.rows[0]!.owner_pk === 'string' ? (shared.rows[0]!.owner_pk as string) : null;
  const viewerPk = ownerIds[0];
  if (!ownerPk || !viewerPk || viewerPk === ownerPk) return false;
  return assertSameGroup(db, viewerPk, ownerPk);
}

/**
 * greeting 버킷 정책: 알람이 쓰는 보이스가 non-system 클론인지 판정한다.
 * greeting 문구는 목소리 미리듣기 전용이지만, '유료 클론의 기본(기상 인사) 알람 버킷'
 * 으로만 예외 허용한다(validateAlarmFields 의 greeting 허용 주석 참고). 시스템 스톡
 * 보이스 + greeting 조합은 미리듣기 클립을 무료 알람으로 돌려 쓰는 우회라 차단한다.
 * 접근 가능 여부(소유/공유/프리셋)는 voiceProfileBelongsToCaller /
 * messageBelongsToCaller 가 별도로 강제하므로 여기서는 클론(비-시스템) 여부만 본다.
 */
async function messageGreetingUsesCloneVoice(db: DbExecutor, messageId: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM messages m
          JOIN voice_profiles vp ON vp.id = m.voice_profile_id
          WHERE m.id = ? AND COALESCE(vp.is_system, 0) = 0 AND vp.deleted_at IS NULL
          LIMIT 1`,
    args: [messageId],
  });
  return res.rows.length > 0;
}

async function greetingBucketUsesCloneVoice(
  db: DbExecutor,
  fields: { voice_profile_id?: string | null; message_id?: string | null },
): Promise<boolean> {
  if (fields.voice_profile_id) {
    const res = await db.execute({
      sql: `SELECT 1 FROM voice_profiles
            WHERE id = ? AND COALESCE(is_system, 0) = 0 AND deleted_at IS NULL
              AND COALESCE(is_draft, 0) = 0
            LIMIT 1`,
      args: [fields.voice_profile_id],
    });
    if (res.rows.length === 0) return false;
    // vp 는 클론이지만 message_id 가 함께 지정되면(클론 vp + 시스템 greeting 메시지 혼합)
    // 그 message 의 voice_profile 도 비-시스템(클론)인지 AND 로 검증한다 — 시스템 greeting
    // 미리듣기 클립을 클론 vp 뒤에 끼워 무료 알람으로 돌려 쓰는 우회를 방어심화한다.
    if (fields.message_id) return messageGreetingUsesCloneVoice(db, fields.message_id);
    return true;
  }
  if (fields.message_id) {
    return messageGreetingUsesCloneVoice(db, fields.message_id);
  }
  // 보이스 지정이 전혀 없는 알람(alarm-only 등)은 greeting 버킷을 가질 이유가 없다.
  return false;
}

alarmMutation.post('/', async (c) => {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userId;
  // [users.id, 토큰 로그인 식별자] — 통일 이전에 만들어진 행까지 매칭한다.
  const ownerIds = callerOwnerIds(c) as [string, string];
  const db = getDB(c.env);

  const body = await c.req.json<{
    message_id?: string;
    time: string;
    repeat_days?: number[];
    snooze_minutes?: number;
    target_user_id?: string;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string;
    timezone?: string;
    // 무료 버킷 회전 알람이 가리키는 버킷(예: 'morning'·'medication'). message_id 는
    // 대표(변형0) 스톡 클립을 그대로 유지하므로 회전 미지원 경로에선 폴백 단일 재생.
    bucket_id?: string | null;
  }>();

  if (!body.time) {
    return c.json({ error: 'time is required', error_code: 'REQUIRED_FIELDS_MISSING' }, 400);
  }
  const timezone = normalizeTimezone(body.timezone);
  // Two valid sources for what the alarm plays:
  //   1. message_id → TTS / 저장된 음성 클립 (가족 전송 포함)
  //   2. neither    → "alarm-only" 모드: 기기 기본 알람음
  // 내 알람용 로컬 녹음/파일은 폰에만 두고 서버로 올리지 않는다.

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  let targetUserIdForAlarm: string | null = null;
  // 타깃 경로에서 (수신자 PK, 수신자 로그인 id) — 슬롯 교체(claimTargetedAlarmSlot)에 쓴다.
  let targetIdsForReplace: [string, string] | null = null;
  // 타깃 경로 검증에 쓴 효과 시간대 — 행 저장에도 그대로 쓴다(검증≠저장 불일치 방지).
  let targetEffectiveTimezone: string | null = null;
  if (body.target_user_id) {
    const rawTargetUserId = body.target_user_id.trim();
    if (!rawTargetUserId) {
      return c.json({ error: 'Invalid target_user_id', error_code: 'INVALID_TARGET_USER' }, 400);
    }
    if (rawTargetUserId !== userId) {
      const targetRes = await db.execute({
        sql: `SELECT id, google_id, allow_family_alarms,
                     family_alarm_quiet_windows
              FROM users
              WHERE google_id = ? OR id = ?
              LIMIT 1`,
        args: [rawTargetUserId, rawTargetUserId],
      });
      if (targetRes.rows.length === 0) {
        return c.json(
          {
            error: '같은 커플/가족 그룹 멤버에게만 알람을 설정할 수 있습니다.',
            error_code: 'NOT_CONNECTED',
          },
          403,
        );
      }

      const target = targetRes.rows[0]!;
      const targetPk = String(target.id);
      // 읽기(기존 행 매칭)용 보조 식별자. 이 통일 이전에 만들어진 알람은
      // target_user_id 에 google_id 가 들어 있을 수 있어 조회 때 둘 다 본다.
      // **쓰기에는 쓰지 않는다** — 저장은 항상 users.id(targetPk).
      const targetLegacyId = (target.google_id as string | null) ?? targetPk;

      // 상대 알람 권한(같은 커플/가족 그룹)을 '먼저' 확인한다. 아래 타이밍 가드는 수신자의
      // 설정(allow_family_alarms·quiet 창)에 따라 서로 다른 error_code 를 돌려주므로, 권한
      // 확인보다 앞서 실행하면 그룹 밖 호출자가 임의 target_user_id 의 계정 존재·quiet 설정을
      // 응답 코드로 구분하는 오라클이 된다. 권한 없으면 타이밍 판정 전에 NOT_CONNECTED 로 끊는다.
      const senderPk = await resolveUserPk(db, userId);
      const allowed =
        !!senderPk && targetPk !== senderPk && (await assertSameGroup(db, senderPk, targetPk));

      if (!allowed) {
        return c.json(
          {
            error: '같은 커플/가족 그룹 멤버에게만 알람을 설정할 수 있습니다.',
            error_code: 'NOT_CONNECTED',
          },
          403,
        );
      }

      const targetSettings = familyAlarmSettingsFromRow(target as Record<string, unknown>);
      // 수신자 기준 시각 가드(허용 여부·30분 리드타임·quiet 요일). 발신자 body.timezone 은
      // 판정·저장 어디에도 쓰지 않고, 헬퍼가 산출한 효과 시간대(수신자 최근 알람 tz →
      // Asia/Seoul)로 판정한다. PATCH 수정 경로와 동일 헬퍼를 공유한다(중복 구현 방지).
      const guard = await evaluateFamilyAlarmTimingGuard(
        db,
        [targetPk, targetLegacyId],
        targetSettings,
        body.time,
        body.repeat_days ?? [],
      );
      if (!guard.ok) {
        return c.json({ error: guard.error, error_code: guard.error_code }, guard.status);
      }
      const effectiveTimezone = guard.effectiveTimezone;

      // 저장은 users.id 로 고정한다. 과거에는 google_id 를 넣었는데, JWT sub 이 users.id 로
      // 통일된 뒤로는 수신자 세션의 식별자가 users.id 라 google_id 로 저장하면 수신자가
      // 자기 알람을 조회하지 못한다(= 가족 알람이 배달되지 않는다).
      targetUserIdForAlarm = targetPk;
      targetIdsForReplace = [targetPk, targetLegacyId];
      targetEffectiveTimezone = effectiveTimezone;
    }
  }

  const alarmOwner = targetUserIdForAlarm || userId;

  const user = await db.execute({
    sql: 'SELECT plan FROM users WHERE id = ?',
    args: [alarmOwner],
  });
  let creatorPlanValue =
    alarmOwner === userId && user.rows.length > 0 ? user.rows[0]!.plan : undefined;
  if (resolvedUserPk && alarmOwner !== userId) {
    const creatorPlan = await db.execute({
      sql: 'SELECT plan FROM users WHERE google_id = ? OR id = ? LIMIT 1',
      args: [userId, userPk],
    });
    creatorPlanValue = creatorPlan.rows[0]?.plan;
  }
  const creatorHasPaidVoice =
    !resolvedUserPk || creatorPlanValue === undefined || isPaidVoicePlan(creatorPlanValue);
  if (
    !creatorHasPaidVoice &&
    alarmUsesPaidVoice(body) &&
    !(await usesOnlySystemStockVoice(db, body))
  ) {
    return c.json(
      {
        error: 'Voice alarms require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }

  const resolvedMessageId: string | null = body.message_id ?? null;
  if (
    body.voice_profile_id &&
    !(await voiceProfileBelongsToCaller(db, body.voice_profile_id, ownerIds))
  ) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  if (resolvedMessageId) {
    // 본인 소유 메시지뿐 아니라 시스템 스톡 클립(is_preset=1 + 시스템 보이스)도
    // 허용한다. 무료 플랜은 스톡 클립으로 알람을 만들 수 있어야 하는데, 기존
    // 검증은 user_id 만 봐서 스톡 클립 알람을 404 로 막고 있었다
    // (GET /tts/messages/:id/audio 의 허용 규칙과 일치시킨다).
    if (!(await messageBelongsToCaller(db, resolvedMessageId, ownerIds))) {
      return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
    }
  }

  // greeting 버킷 정책: greeting 은 '유료 클론의 기본(기상 인사) 알람'으로만 예외 허용.
  // 시스템 스톡 보이스 + greeting 조합(무료 우회)은 400 으로 차단한다.
  if (body.bucket_id === STOCK_GREETING_CATEGORY) {
    const usesClone = await greetingBucketUsesCloneVoice(db, {
      voice_profile_id: body.voice_profile_id ?? null,
      message_id: resolvedMessageId,
    });
    if (!usesClone) {
      return c.json(
        {
          error: 'greeting 버킷은 클론 보이스 알람에만 쓸 수 있습니다',
          error_code: 'INVALID_BUCKET_ID',
        },
        400,
      );
    }
  }

  let alarmId = crypto.randomUUID();
  const mode: AlarmMode =
    (body.mode as AlarmMode | undefined) ?? (creatorHasPaidVoice ? 'tts' : 'sound-only');
  const vibPattern: VibrationPattern =
    (body.vibration_pattern as VibrationPattern | undefined) ?? 'default';
  const wakeMode: WakeMode = (body.wake_mode as WakeMode | undefined) ?? 'sound_then_voice';
  // 저장 timezone: 타깃 경로는 검증에 쓴 효과 시간대를 그대로 저장해 cron 스케줄러가
  // 검증과 같은 시간대로 HH:mm 을 해석하게 한다(발신자 body.timezone 불신).
  // 본인 알람(비-target)은 기존대로 본인 기기 timezone(body)을 저장한다.
  const storedTimezone = targetUserIdForAlarm ? targetEffectiveTimezone : timezone;
  const insertAlarm = (executor: DbExecutor) =>
    executor.execute({
      sql: `INSERT INTO alarms
            (id, user_id, target_user_id, message_id, time, repeat_days, snooze_minutes,
             mode, vibration_pattern, wake_mode, voice_profile_id,
             timezone, bucket_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        alarmId,
        userId,
        targetUserIdForAlarm,
        resolvedMessageId,
        body.time,
        JSON.stringify(body.repeat_days ?? []),
        body.snooze_minutes ?? 5,
        mode,
        vibPattern,
        wakeMode,
        body.voice_profile_id ?? null,
        storedTimezone,
        body.bucket_id ?? null,
      ],
    });
  // 타인 발신 알람: 같은 (수신자, time) 슬롯을 멱등·교체 규칙으로 원자 점유한다.
  // 같은 발신자의 재전송이면 기존 행을 새 내용으로 UPDATE(id 유지), 다른 발신자의 기존
  // 발신 알람은 비활성화(최신 우선). 수신자 본인 알람(target 없음)은 건드리지 않는다 —
  // 클라 로컬 교체 확인창이 담당(claimTargetedAlarmSlot 주석 참고).
  const upsertTargetedAlarm = async (
    executor: DbExecutor,
    recipientIds: [string, string],
  ): Promise<string> => {
    const claimed = await claimTargetedAlarmSlot(executor, userId, recipientIds, body.time, alarmId);
    if (claimed.reused) {
      await executor.execute({
        sql: `UPDATE alarms SET
                message_id = ?, repeat_days = ?, snooze_minutes = ?, mode = ?,
                vibration_pattern = ?, wake_mode = ?, voice_profile_id = ?,
                timezone = ?, bucket_id = ?,
                is_active = 1, updated_at = datetime('now')
              WHERE id = ?`,
        args: [
          resolvedMessageId,
          JSON.stringify(body.repeat_days ?? []),
          body.snooze_minutes ?? 5,
          mode,
          vibPattern,
          wakeMode,
          body.voice_profile_id ?? null,
          storedTimezone,
          body.bucket_id ?? null,
          claimed.alarmId,
        ],
      });
    } else {
      await insertAlarm(executor);
    }
    return claimed.alarmId;
  };
  const inserted =
    targetUserIdForAlarm || body.voice_profile_id || resolvedMessageId
      ? await withWriteTransaction(db, async (tx) => {
          if (
            body.voice_profile_id &&
            !(await voiceProfileBelongsToCaller(tx, body.voice_profile_id, ownerIds))
          ) {
            return { status: 'voice_not_found' as const, result: null };
          }
          if (
            resolvedMessageId &&
            !(await messageBelongsToCaller(tx, resolvedMessageId, ownerIds))
          ) {
            return { status: 'message_not_found' as const, result: null };
          }
          if (targetUserIdForAlarm && targetIdsForReplace) {
            alarmId = await upsertTargetedAlarm(tx, targetIdsForReplace);
            return { status: 'ok' as const, result: null };
          }
          return { status: 'ok' as const, result: await insertAlarm(tx) };
        })
      : { status: 'ok' as const, result: await insertAlarm(db) };
  if (inserted.status === 'voice_not_found') {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }
  if (inserted.status === 'message_not_found') {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  // 가족 알람(target_user_id 지정)이면 수신자에게 즉시 push — /family/alarms 뿐 아니라 이 일반 생성
  // 경로(stock/TTS/녹음 가족 알람, 클라 createAlarm)도 즉시 배달한다. getTokensForUser 가
  // fcm 이 id/google_id 를 모두 매칭하므로 users.id 그대로 전달. 논블로킹(waitUntil), executionCtx
  // 없는 컨텍스트(테스트)에선 c.executionCtx 접근이 던지므로 try 로 감싸 생략(그 경우 쿼리도 안 돌아 mock
  // FIFO 도 안 밀림), 15분 주기 pull 폴백.
  if (targetUserIdForAlarm) {
    try {
      c.executionCtx.waitUntil(
        sendFamilyAlarmPush(db, c.env, targetUserIdForAlarm, alarmId).catch(() => {}),
      );
    } catch {
      // executionCtx 없음(비-fetch/테스트) → push 생략, pull 폴백.
    }
  }

  return c.json(
    {
      alarm: {
        id: alarmId,
        ...body,
        target_user_id: targetUserIdForAlarm,
        mode,
        vibration_pattern: vibPattern,
        voice_profile_id: body.voice_profile_id ?? null,
      },
    },
    201,
  );
});

/** 저장된 repeat_days JSON 문자열('[1,3,5]')을 number[] 로 파싱한다(0-6 정수만). */
function parseStoredRepeatDays(raw: unknown): number[] {
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((n): n is number => Number.isInteger(n));
    } catch {
      // 손상 값은 빈 배열로 취급.
    }
  }
  return [];
}

alarmMutation.patch('/:id', async (c) => {
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const body = await c.req.json<{
    time?: string;
    repeat_days?: number[];
    is_active?: boolean;
    snooze_minutes?: number;
    message_id?: string | null;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string | null;
    timezone?: string | null;
    bucket_id?: string | null;
  }>();

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  // 소유권 게이트는 두 식별자를 모두 본다 — 통일 이전에 만들어진 알람은 user_id 에
  // 로그인 식별자가 들어 있어, users.id 하나로만 걸면 자기 알람을 수정할 수 없다.
  const patchOwnerIds = callerOwnerIds(c);
  const existing = await db.execute({
    sql: `SELECT a.id, a.target_user_id, a.time, a.repeat_days, a.is_active,
                 a.message_id, a.mode, a.wake_mode, a.voice_profile_id,
                 a.bucket_id, u.plan AS user_plan
          FROM alarms a
          LEFT JOIN users u ON u.google_id = a.user_id OR u.id = a.user_id
          WHERE a.id = ? AND a.user_id IN (${inPlaceholders(patchOwnerIds)})`,
    args: [id, ...patchOwnerIds],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  const current = typedRow<{
    target_user_id?: string | null;
    time?: string | null;
    repeat_days?: string | null;
    is_active?: number | null;
    message_id: string | null;
    mode: string | null;
    wake_mode: string | null;
    voice_profile_id: string | null;
    bucket_id?: string | null;
    user_plan?: string | null;
  }>(existing.rows[0]!);
  const resolvedUserPk = c.get('userIdPK');
  const creatorHasPaidVoice =
    !resolvedUserPk || current.user_plan === undefined || isPaidVoicePlan(current.user_plan);
  const effectiveVoiceFields = {
    mode: body.mode !== undefined ? body.mode : current.mode,
    wake_mode: body.wake_mode !== undefined ? body.wake_mode : current.wake_mode,
    message_id: body.message_id !== undefined ? body.message_id : current.message_id,
    voice_profile_id:
      body.voice_profile_id !== undefined ? body.voice_profile_id : current.voice_profile_id,
  };
  if (
    !creatorHasPaidVoice &&
    alarmUsesPaidVoice(effectiveVoiceFields) &&
    !(await usesOnlySystemStockVoice(db, effectiveVoiceFields))
  ) {
    return c.json(
      {
        error: 'Voice alarms require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }

  // IDOR 방어: PATCH 로 새 message_id / voice_profile_id 를 기록하기 전에,
  // POST 생성 경로와 동일한 소유권/프리셋 검증을 다시 수행한다. 이 검증이
  // 없으면 호출자가 타인 소유 message_id(타인 음성 클립)나 voice_profile_id 를
  // 자기 알람에 끼워 넣어 cross-tenant 리소스를 참조/재생할 수 있다.
  const ownerIds = callerOwnerIds(c) as [string, string];
  if (
    body.message_id !== undefined &&
    body.message_id !== null &&
    !(await messageBelongsToCaller(db, body.message_id, ownerIds))
  ) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }
  if (
    body.voice_profile_id !== undefined &&
    body.voice_profile_id !== null &&
    !(await voiceProfileBelongsToCaller(db, body.voice_profile_id, ownerIds))
  ) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }


  // greeting 버킷 정책: PATCH 로 bucket/voice/message 를 바꿔 '시스템 보이스 + greeting'
  // 조합(무료 우회)을 만들 수 없게, 수정 결과(effective) 기준으로 클론 여부를 검증한다.
  // 관련 필드를 건드리지 않는 PATCH(예: time 만 변경)는 검사하지 않는다.
  const effectiveBucketId =
    body.bucket_id !== undefined ? body.bucket_id : (current.bucket_id ?? null);
  if (
    effectiveBucketId === STOCK_GREETING_CATEGORY &&
    (body.bucket_id !== undefined ||
      body.voice_profile_id !== undefined ||
      body.message_id !== undefined)
  ) {
    const usesClone = await greetingBucketUsesCloneVoice(db, {
      voice_profile_id: effectiveVoiceFields.voice_profile_id,
      message_id: effectiveVoiceFields.message_id,
    });
    if (!usesClone) {
      return c.json(
        {
          error: 'greeting 버킷은 클론 보이스 알람에만 쓸 수 있습니다',
          error_code: 'INVALID_BUCKET_ID',
        },
        400,
      );
    }
  }

  // 타인 발신(가족/친구) 알람 가드 재실행(A): 발신자가 PATCH 로 time/repeat_days/timezone 을
  // 바꾸거나 비활성 알람을 재활성(is_active 0→1)해 POST 의 리드타임·quiet·수신자 시간대 가드를
  // 우회하지 못하게, 수정 결과(effective)가 '활성'이 되는 경우에 한해 POST 와 동일한 헬퍼를 다시
  // 돈다. 본인 알람(target_user_id 없음)·최종 비활성 알람은 대상 아님(울리지 않으므로).
  const patchTargetUserId =
    typeof current.target_user_id === 'string' && current.target_user_id.length > 0
      ? current.target_user_id
      : null;
  const reactivating = body.is_active === true && Number(current.is_active) === 0;
  const willBeActive =
    body.is_active !== undefined ? body.is_active : Number(current.is_active) === 1;
  const changesTiming =
    body.time !== undefined || body.repeat_days !== undefined || body.timezone !== undefined;
  // 통과 시 저장할 효과 시간대(발신자 body.timezone 대신 이 값을 행에 기록).
  let familyGuardTimezone: string | null = null;
  // (수신자, 새 time) 슬롯 원자 재점유 파라미터(time 변경 또는 재활성화 시).
  let familyReclaim: { ids: [string, string]; time: string } | null = null;
  if (patchTargetUserId && willBeActive && (changesTiming || reactivating)) {
    // 수신자 재조회(allowFamilyAlarms·quiet). target_user_id 는 로그인 id(google_id) 또는 pk.
    const recipientRes = await db.execute({
      sql: `SELECT id, google_id, allow_family_alarms,
                   family_alarm_quiet_windows
            FROM users WHERE google_id = ? OR id = ? LIMIT 1`,
      args: [patchTargetUserId, patchTargetUserId],
    });
    if (recipientRes.rows.length === 0) {
      // 수신자를 확인할 수 없으면 수신 허용·quiet 를 검증할 수 없어 시각 변경/재활성화를 거부한다.
      return c.json(
        { error: '상대방이 알람 설정을 허용하지 않았습니다.', error_code: 'FAMILY_ALARM_DISABLED' },
        403,
      );
    }
    const recipient = recipientRes.rows[0]!;
    const recipientPk = String(recipient.id);
    // 읽기(기존 행 매칭)용 — 저장은 하지 않는다.
    const recipientLegacyId = (recipient.google_id as string | null) ?? recipientPk;
    const recipientSettings = familyAlarmSettingsFromRow(recipient as Record<string, unknown>);
    // effective 값: PATCH 로 안 바꾼 필드는 기존 행 값을 쓴다(수정 결과 기준 판정).
    const effectiveTime = body.time !== undefined ? body.time : String(current.time ?? '');
    const effectiveRepeatDays =
      body.repeat_days !== undefined
        ? body.repeat_days
        : parseStoredRepeatDays(current.repeat_days);
    const guard = await evaluateFamilyAlarmTimingGuard(
      db,
      [recipientPk, recipientLegacyId],
      recipientSettings,
      effectiveTime,
      effectiveRepeatDays,
    );
    if (!guard.ok) {
      return c.json({ error: guard.error, error_code: guard.error_code }, guard.status);
    }
    familyGuardTimezone = guard.effectiveTimezone;
    // time 변경 또는 재활성화면 (수신자, 새 time) 슬롯을 원자 재점유해 이 알람만 활성으로 남긴다.
    if (body.time !== undefined || reactivating) {
      familyReclaim = { ids: [recipientPk, recipientLegacyId], time: effectiveTime };
    }
  }

  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (body.time !== undefined) {
    updates.push('time = ?');
    args.push(body.time);
  }
  if (body.repeat_days !== undefined) {
    updates.push('repeat_days = ?');
    args.push(JSON.stringify(body.repeat_days));
  }
  if (body.is_active !== undefined) {
    updates.push('is_active = ?');
    args.push(body.is_active ? 1 : 0);
  }
  if (body.snooze_minutes !== undefined) {
    updates.push('snooze_minutes = ?');
    args.push(body.snooze_minutes);
  }
  if (body.message_id !== undefined) {
    updates.push('message_id = ?');
    args.push(body.message_id);
  }
  if (body.mode !== undefined) {
    updates.push('mode = ?');
    args.push(body.mode);
  }
  if (body.vibration_pattern !== undefined) {
    updates.push('vibration_pattern = ?');
    args.push(body.vibration_pattern);
  }
  if (body.wake_mode !== undefined) {
    updates.push('wake_mode = ?');
    args.push(body.wake_mode);
  }
  if (body.voice_profile_id !== undefined) {
    updates.push('voice_profile_id = ?');
    args.push(body.voice_profile_id);
  }
  if (body.timezone !== undefined) {
    updates.push('timezone = ?');
    args.push(normalizeTimezone(body.timezone));
  }
  if (body.bucket_id !== undefined) {
    updates.push('bucket_id = ?');
    args.push(body.bucket_id);
  }

  // 타인 발신 알람 가드가 돌았으면 저장 timezone 을 효과 시간대로 강제한다(발신자 body.timezone
  // 무시 — 검증=저장 정합, cron 이 검증과 같은 시간대로 해석). body.timezone 절이 이미 있으면
  // 그 값을 효과 시간대로 덮고, 없으면 새 절을 추가한다.
  if (familyGuardTimezone !== null) {
    const tzIdx = updates.indexOf('timezone = ?');
    if (tzIdx >= 0) {
      args[tzIdx] = familyGuardTimezone;
    } else {
      updates.push('timezone = ?');
      args.push(familyGuardTimezone);
    }
  }

  // 슬롯 재점유 경로에서는 PATCH 대상이 (수신자, time) 슬롯의 유일 승자이므로 반드시 활성으로
  // 남긴다. time 만 바꾸는 경우 is_active 가 updates 에 없어 기존 활성값이 유지되지만, 명시적으로
  // 1 을 보장해 아래 슬롯 비활성화 UPDATE 로 대상이 함께 꺼지는 일이 없게 한다.
  if (familyReclaim && !updates.includes('is_active = ?')) {
    updates.push('is_active = ?');
    args.push(1);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update', error_code: 'NO_UPDATE_FIELDS' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  args.push(id);

  const updateAlarm = (executor: DbExecutor) =>
    executor.execute({
      sql: `UPDATE alarms SET ${updates.join(', ')} WHERE id = ?`,
      args,
    });
  const updateResult =
    (body.voice_profile_id !== undefined && body.voice_profile_id !== null) ||
    (body.message_id !== undefined && body.message_id !== null) ||
    familyReclaim
      ? await withWriteTransaction(db, async (tx) => {
          if (
            body.voice_profile_id !== undefined &&
            body.voice_profile_id !== null &&
            !(await voiceProfileBelongsToCaller(tx, body.voice_profile_id, ownerIds))
          ) {
            return { status: 'voice_not_found' as const, result: null };
          }
          if (
            body.message_id !== undefined &&
            body.message_id !== null &&
            !(await messageBelongsToCaller(tx, body.message_id, ownerIds))
          ) {
            return { status: 'message_not_found' as const, result: null };
          }
          if (familyReclaim) {
            // (수신자, 새 time) 슬롯을 PATCH 대상(id)이 유일 승자가 되도록 원자 재점유한다.
            // 같은 슬롯의 다른 활성 발신 알람(다른 발신자 + 같은 발신자의 같은 시각 이중 예약
            // 포함)을 전부 비활성화하되 PATCH 대상(id != ?)은 제외한다. 대상은 위에서 is_active=1
            // 을 보장했으므로 아래 updateAlarm 으로 활성 상태로 확정된다.
            // (POST 용 claimTargetedAlarmSlot 은 '기존 행을 keeper 로 재사용'하는 의미라 특정
            //  행을 수정하는 PATCH 에는 부적합 — 대상이 아닌 행이 keeper 로 뽑혀 대상까지
            //  비활성화돼 두 알람이 모두 꺼지는 버그가 있었다: Codex #563.)
            await tx.execute({
              sql: `UPDATE alarms SET is_active = 0, updated_at = datetime('now')
                    WHERE target_user_id IN (?, ?) AND time = ? AND is_active = 1 AND id != ?`,
              args: [familyReclaim.ids[0], familyReclaim.ids[1], familyReclaim.time, id],
            });
          }
          return { status: 'ok' as const, result: await updateAlarm(tx) };
        })
      : { status: 'ok' as const, result: await updateAlarm(db) };
  if (updateResult.status === 'voice_not_found') {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }
  if (updateResult.status === 'message_not_found') {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  const updated = await db.execute({
    sql: `SELECT id, user_id, target_user_id, message_id, time, repeat_days,
                 is_active, snooze_minutes, mode, vibration_pattern, wake_mode,
                 voice_profile_id, bucket_id, created_at, updated_at
          FROM alarms WHERE id = ?`,
    args: [id],
  });

  return c.json({
    success: true,
    alarm: normalizeAlarmRow(updated.rows[0] as AlarmRow, ownerIds),
  });
});

// 수신자 '그만받기'(opt-out). 자기가 대상(target_user_id)인 알람만 가능하며, 생성자 소유의
// 알람 행은 건드리지 않고 alarm_recipient_state 에 수신자별 decline 만 영구 기록한다. 이후
// list/tick/cron 이 이 수신자에게는 해당 알람을 배달하지 않는다(재설치·동기화로 부활 안 함).
async function resolveDeclineTarget(
  c: Context<AppEnv>,
): Promise<{ id: string; target: string } | { error: Response }> {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  // 레거시 행(user_id 에 로그인 식별자가 저장된 과거 알람)까지 매칭한다.
  const viewer = Array.from(new Set([userPk, c.get('userLoginId')].filter(Boolean)));
  const db = getDB(c.env);
  const id = c.req.param('id');
  if (!id || !UUID_RE.test(id)) {
    return {
      error: c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400),
    };
  }
  const res = await db.execute({
    sql: 'SELECT target_user_id FROM alarms WHERE id = ? LIMIT 1',
    args: [id],
  });
  const target =
    res.rows.length > 0
      ? (typedRow<{ target_user_id: string | null }>(res.rows[0]!).target_user_id ?? null)
      : null;
  // 대상이 아니면(생성자/무관자 포함) 존재 노출 최소화로 404. 생성자는 일반 삭제(DELETE /:id)를 쓴다.
  if (!target || !viewer.includes(target)) {
    return { error: c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404) };
  }
  return { id, target };
}

alarmMutation.post('/:id/decline', async (c) => {
  const resolved = await resolveDeclineTarget(c);
  if ('error' in resolved) return resolved.error;
  const db = getDB(c.env);
  await db.execute({
    sql: `INSERT INTO alarm_recipient_state (alarm_id, recipient_user_id, declined, created_at, updated_at)
          VALUES (?, ?, 1, datetime('now'), datetime('now'))
          ON CONFLICT(alarm_id, recipient_user_id)
          DO UPDATE SET declined = 1, updated_at = datetime('now')`,
    args: [resolved.id, resolved.target],
  });
  return c.json({ success: true, declined: true });
});

alarmMutation.delete('/:id', async (c) => {
  // 조회·삭제·에셋 정리가 모두 같은 식별자 집합을 본다. 통일 이전에 만들어진 알람은
  // user_id 에 로그인 식별자가 들어 있어, users.id 하나로만 걸면 소유권 조회는 통과해도
  // 정작 DELETE 가 0행이라 ALARM_NOT_FOUND 로 끝난다.
  const ownerIds = callerOwnerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const targetRes = await db.execute({
    sql: `SELECT message_id FROM alarms WHERE id = ? AND user_id IN (${inPlaceholders(ownerIds)}) LIMIT 1`,
    args: [id, ...ownerIds],
  });
  const targetAlarm =
    targetRes.rows.length > 0
      ? typedRow<{ message_id: string | null }>(targetRes.rows[0]!)
      : null;
  const messageId = targetAlarm?.message_id ?? null;

  const result = await db.execute({
    sql: `DELETE FROM alarms WHERE id = ? AND user_id IN (${inPlaceholders(ownerIds)})`,
    args: [id, ...ownerIds],
  });

  if (result.rowsAffected === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  if (messageId) {
    const refRes = await db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM alarms WHERE message_id = ?',
      args: [messageId],
    });
    const cnt = Number(typedRow<{ cnt: number }>(refRes.rows[0]!).cnt ?? 0);
    if (cnt === 0) {
      // 소유권 스코프(user_id IN ownerIds)를 걸어 호출자 소유 에셋만 정리한다.
      // SYSTEM_VOICE_LIBRARY_USER_ID 소유의 공유 스톡 클립 에셋/R2 오브젝트를
      // 전역 삭제하는 cross-tenant 파괴를 막는다(tts.ts:1284-1298 과 동일 패턴).
      const assetsRes = await db.execute({
        sql: `SELECT audio_object_key FROM generated_audio_assets
              WHERE message_id = ? AND user_id IN (?, ?) AND audio_object_key IS NOT NULL`,
        args: [messageId, ...ownerIds],
      });
      const bucket = c.env?.VOICE_BUCKET;
      if (bucket && assetsRes.rows.length > 0) {
        const storage = new R2VoiceStorage(bucket);
        for (const row of assetsRes.rows) {
          const key = typedRow<{ audio_object_key: string | null }>(row).audio_object_key;
          if (!key) continue;
          try {
            await storage.delete(key);
          } catch (err) {
            logRouteError(c, err);
          }
        }
      }
      await db.execute({
        sql: 'DELETE FROM generated_audio_assets WHERE message_id = ? AND user_id IN (?, ?)',
        args: [messageId, ...ownerIds],
      });
    }
  }

  return c.json({ success: true });
});

export default alarmMutation;
