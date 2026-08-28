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
  alarmDeliveryVersionSupported,
  evaluateFamilyAlarmTimingGuard,
  type AlarmRow,
  type AlarmMode,
  type VibrationPattern,
  type WakeMode,
} from './alarm-helpers';
import { isPaidVoicePlan } from './billing-helpers';
import { enqueueExternalDeletionsBatch } from '../lib/audio-retention';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { callerOwnerIds, inPlaceholders } from '../lib/caller-ids';
import { STOCK_GREETING_CATEGORY } from '../lib/stock-clips';
import { resolveAlarmVoiceRevocationSource } from '../lib/voice-revocation';

const alarmMutation = new Hono<AppEnv>();

/**
 * 이 알람이 **서버가 값을 매기는 목소리 자산**을 쓰는가.
 *
 * ⚠ **`wake_mode === 'voice_only'` 를 여기에 넣지 말 것**(2026-08-12 제거).
 * 그건 "목소리로 깨운다" 는 뜻일 뿐 **무엇으로** 깨우는지를 말하지 않는다.
 * 사용자가 자기 폰에 직접 녹음한 소리로 깨우는 알람도 `voice_only` 로 오는데,
 * 그 음원은 **서버에 올라오지 않는다**(양 앱의 `RemoteAlarmMapper` 가
 * `mode: hasRemoteVoice ? 'tts' : 'sound-only'`, `hasRemoteVoice = ttsMessageId != nil`).
 * 그래서 이 항이 있으면 **무료 사용자의 직접 녹음 알람이 403 으로 거절**되고,
 * 앱은 로컬에만 저장돼 sync 가 영구히 실패한다.
 *
 * 유료 자산은 `message_id`(우리가 만든 클립)와 `voice_profile_id`(클론 목소리)뿐이다.
 * `mode === 'tts'` 는 그 둘 중 하나가 있을 때만 붙지만, 옛 클라이언트가 단독으로 보낼
 * 여지가 있어 남겨 둔다 — 남겨도 녹음 알람은 `sound-only` 라 걸리지 않는다.
 */
function alarmUsesPaidVoice(body: {
  mode?: string | null;
  wake_mode?: string | null;
  message_id?: string | null;
  voice_profile_id?: string | null;
}): boolean {
  return body.mode === 'tts' || !!body.message_id || !!body.voice_profile_id;
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
 * message_id 가 호출자(ownerIds) 가 쓸 수 있는 메시지인지 확인한다. 허용 갈래는 셋:
 * 본인 소유 / 시스템 스톡 프리셋 / **같은 플랜 그룹이 공유한 목소리의 프리셋 클립(소유자가
 * 유료일 때만)**.
 *
 * GET /tts/messages/:id/audio 와 **같은 규칙이어야 한다.** 어긋나면 두 방향 모두 사고가 난다:
 * 여기가 좁으면 '들리는데 저장이 안 되고'(공유 클론 갈래 누락 — 2026-08-05), 여기가 넓으면
 * '저장은 되는데 받을 수 없는' 알람이 생긴다(소유자 플랜 게이트 누락 — Codex #685).
 * 규칙을 고칠 땐 두 곳을 같이 고칠 것. 목소리 쪽 짝은 [voiceProfileBelongsToCaller] 다.
 *
 * 넓히더라도 타인 메시지 id 를 알람에 끼워 넣는 IDOR 은 계속 막는다 — 접근 근거는 언제나
 * '그 목소리를 쓸 수 있는가' 이고, 초안(is_draft) 보이스의 메시지는 어느 갈래로도 못 지난다.
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
  if (msg.rows.length > 0) return true;

  // 공유받은 가족 클론의 사전렌더 클립. 이 갈래가 없으면 **재생은 되는데 알람은 저장이
  // 안 된다** — GET /tts/messages/:id/audio 는 같은 조건을 이미 허용하므로 클라는 클립을
  // 받아 재생까지 해 놓고, POST /alarm 만 404(MESSAGE_NOT_FOUND) 로 막혀 알람이 로컬에만
  // 남는다(2026-08-05 실기기 재현). 목소리 자체는 voiceProfileBelongsToCaller 가 이미 같은
  // 이유로 공유를 허용하고 있었다 — 한 함수 건너뛴 같은 구멍이었다.
  //
  // ⚠ **소유자 플랜 게이트까지 같이 봐야 한다.** ON_HOLD/PAUSED 는 회복형 상태라 그룹·
  // is_shared 구조를 그대로 두고 소유자 users.plan 만 free 로 회수하는데(billing-cancel.ts
  // 의 resolvePlanAfterSuspend), 오디오 라우트는 그때 비시스템 클립을 VOICE_LOCKED_FREE_PLAN
  // 으로 막는다. 여기서 플랜을 안 보면 **받을 수 없는 클립을 가리키는 알람**이 저장된다.
  const shared = await db.execute({
    sql: `SELECT owner.plan AS owner_plan
          FROM messages
          JOIN voice_profiles vp ON vp.id = messages.voice_profile_id
          JOIN users owner ON owner.id = vp.user_id OR owner.google_id = vp.user_id
          JOIN plan_group_members pgm_owner ON pgm_owner.user_id = owner.id
          JOIN plan_group_members pgm_me ON pgm_me.plan_group_id = pgm_owner.plan_group_id
          WHERE messages.id = ?
            AND COALESCE(messages.is_preset, 0) = 1
            AND COALESCE(vp.is_shared, 0) = 1
            AND COALESCE(vp.is_draft, 0) = 0
            AND vp.deleted_at IS NULL
            AND pgm_me.user_id = ?
          LIMIT 1`,
    // 두 번째 인자는 **PK 하나** — plan_group_members 는 google_id 가 아니라 users.id 로 묶인다.
    args: [messageId, ownerIds[0]],
  });
  if (shared.rows.length === 0) return false;
  // 판정은 오디오 라우트와 같은 헬퍼로 한다 — 유료 플랜 목록을 SQL 에 베껴 두면 둘이 갈라진다.
  return isPaidVoicePlan(shared.rows[0]!.owner_plan);
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
    // 무료 버킷 회전 알람이 가리키는 버킷(예: 'weather'·'medication'). message_id 는
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
      // 수신자 기준 시각 가드(허용 여부·최소 리드타임·quiet 요일). 발신자 body.timezone 은
      // 판정·저장 어디에도 쓰지 않고, 헬퍼가 산출한 효과 시간대(수신자 최근 알람 tz →
      // Asia/Seoul)로 판정한다. 보낸 뒤 PATCH는 금지되므로 생성·재전송에서만 이 가드를 돈다.
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
  const deliveryVersionSupported = targetUserIdForAlarm
    ? await alarmDeliveryVersionSupported(db)
    : false;
  if (targetUserIdForAlarm && !deliveryVersionSupported) {
    return c.json(
      { error: 'Alarm schema is upgrading', error_code: 'ALARM_SCHEMA_UPGRADING' },
      503,
    );
  }
  const deliveryVersion = targetUserIdForAlarm ? crypto.randomUUID() : null;
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
             timezone, bucket_id${targetUserIdForAlarm ? ', delivery_version' : ''})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${targetUserIdForAlarm ? ', ?' : ''})`,
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
        ...(targetUserIdForAlarm ? [deliveryVersion] : []),
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
    const claimed = await claimTargetedAlarmSlot(
      executor,
      // 조회용 발신자 쌍 — 저장에는 계속 `userId`(PK) 하나만 쓴다.
      ownerIds,
      recipientIds,
      body.time,
      alarmId,
    );
    if (claimed.reused) {
      await executor.execute({
        sql: `UPDATE alarms SET
                message_id = ?, repeat_days = ?, snooze_minutes = ?, mode = ?,
                vibration_pattern = ?, wake_mode = ?, voice_profile_id = ?,
                timezone = ?, bucket_id = ?, delivery_version = ?,
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
          deliveryVersion,
          claimed.alarmId,
        ],
      });
    } else {
      // ⚠ **삽입도 확정된 슬롯 id 로 한다.** `insertAlarm` 은 바깥 `alarmId` 를 쓰는데,
      // 전달이 끝난 슬롯을 이어받을 때 그 값은 방금 만든 난수이고 확정 id 는 기억해 둔
      // 옛 id 다 — 맞추지 않으면 **행은 난수 id 로 들어가고 응답만 옛 id** 를 돌려줘,
      // 201 을 받고도 그 id 로는 알람을 찾을 수 없다.
      alarmId = claimed.alarmId;
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
  // ⚠⚠ **보낸 알람은 절대 수정할 수 없다 — 이 게이트를 완화하지 말 것.**
  //
  // `docs/spec/family-alarm.md` 의 「보내면 끝」이 이 한 줄로 강제된다. 지우거나 조건을
  // 좁히면 **앱을 고치지 않아도** 보낸 알람이 수정 가능해진다 — 아래 소유권 조건
  // (`a.user_id IN (호출자)`)만으로는 못 막기 때문이다. 보낸 가족 알람의 `user_id` 는
  // **발신자 자신**이라 그 조건을 그냥 통과한다. 2026-08-24 이전이 정확히 그 상태였고,
  // 앱에 화면이 없었을 뿐 API 를 직접 부르면 시각·요일·켜기끄기·음성이 다 바뀌었다.
  //
  // 왜 막아야 하는가: 받는 쪽은 「받은 뒤엔 전부 받은 사람 것」이라 발신자의 변경을
  // 의도적으로 무시한다(`locallyEditedByRecipient`·`merge`). 그래서 수정을 받아 주면
  // **발신자는 고쳤다고 믿고 수신자는 옛 시각에 일어난다** — 조용히 어긋나는 쪽이라
  // 아무도 못 알아챈다. 게다가 클라가 새 세대를 적용하지 않은 채 ack 해 서버 행이
  // 영구히 사라질 수 있다(Codex #703 리뷰 25번).
  //
  // ⚠ **"푸시를 보내면 되지 않나" 는 이미 시도했다가 되돌린 길이다.** 2026-08-24 에
  // PATCH 마다 세대를 회전하고 수신자에게 push 하는 코드를 넣었는데(같은 리뷰 14번),
  // 다음 회차에 스펙 위반으로 통째로 걷어냈다. 내용을 바꾸려면 **새로 보내는 것**이
  // 유일한 길이다(`claimTargetedAlarmSlot` 이 같은 슬롯을 교체한다).
  if (typeof current.target_user_id === 'string' && current.target_user_id.length > 0) {
    return c.json(
      { error: 'Sent alarms cannot be edited', error_code: 'TARGETED_ALARM_IMMUTABLE' },
      409,
    );
  }
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

  // ⚠ **이 검사를 "트랜잭션 안에서 또 하니 중복" 이라며 지우지 말 것.** 두 검사는
  // 역할이 다르다. 트랜잭션 안쪽은 TOCTOU 방어이고, **바깥쪽은 검증되지 않은 id 로
  // 뒤따르는 쿼리가 도는 것을 막는 게이트**다 — 아래 greeting 버킷 정책은
  // `messageGreetingUsesCloneVoice` 로 소유권 스코프 없이 messageId 를 조회하므로,
  // 바깥 검사를 빼면 남의 메시지 id 를 넣었을 때 404 대신 400(INVALID_BUCKET_ID)이
  // 나가 **그 메시지가 클론 보이스를 쓰는지 여부가 에러 코드로 새어 나간다.**
  // 실제로 지워 봤다가 회귀 테스트 8건이 깨져 되돌렸다(2026-08-08).
  // 쿼리 2~4회를 아끼자고 IDOR 라우트의 실패 순서를 바꿀 이유가 없다.
  //
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
    (body.message_id !== undefined && body.message_id !== null)
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

// **수신 대상 검증만 하는 공용 헬퍼** — `POST /:id/decline` 과 `POST /:id/received` 가 쓴다.
// "이 호출자가 이 알람의 수신자인가" 만 답하고, 그 뒤에 무엇을 하는지는 각 라우트가 정한다
// (decline 은 알람 행을 그대로 두고 거절만 기록하고, received 는 행을 지운다).
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
  // **알람이 이미 없으면 그래도 그만받기를 기록한다.**
  //
  // 발신자가 먼저 지운 뒤 수신자가 '그만받기' 를 누르면 여기서 404 가 났고, 클라는 그걸
  // 멱등 성공으로 보고 로컬 행만 지웠다. 기록이 안 남으니 **같은 계정의 다른 기기**는
  // 그 알람을 계속 갖고 울렸다 — 사용자는 껐다고 믿는다(Codex #675 P1).
  // 기록은 (alarm_id, recipient_user_id) 한 행이라 알람이 없어도 쓸 수 있다.
  //
  // 트레이드오프: 존재하지 않는 id 로도 한 행이 써진다. 호출자 본인 id 로만 쌓이고 행이
  // 작으며, 읽는 쪽(GET /alarm/declined)은 페이지 상한이 있어 감수한다.
  if (res.rows.length === 0) {
    return { id, target: userPk };
  }
  // 알람은 있는데 대상이 아니면(생성자/무관자 포함) 존재 노출 최소화로 404.
  // 생성자는 일반 삭제(DELETE /:id)를 쓴다.
  if (!target || !viewer.includes(target)) {
    return { error: c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404) };
  }
  return { id, target };
}

// 수신자 '그만받기'(opt-out). 자기가 대상(target_user_id)인 알람만 가능하며, 생성자 소유의
// 알람 행은 건드리지 않고 alarm_recipient_state 에 수신자별 decline 만 영구 기록한다. 이후
// list/tick/cron 이 이 수신자에게는 해당 알람을 배달하지 않는다(재설치·동기화로 부활 안 함).
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

// 수신자 '다 받았어요'(delivery ack) — **전달이 끝난 알람은 서버에 남길 이유가 없다.**
//
// ⚠ 왜 지우나: 서버의 알람 행은 **전달 수단**이다. 수신자가 행을 받아 로컬에 세우고
// 음원까지 내려받으면 전달은 끝났고, 내 알람은 서버에서 다시 받아오지 않는다
// (pull 이 `isReceived` 만 임포트한다). 남겨 두면 `audio-retention` 이 "아직 쓰는 알람이
// 있다" 고 보아 **클론 음원을 TTL 이 지나도 영구 보존**한다 — 생체정보에서 파생된 데이터다.
//
// ⚠ **행은 음원을 받을 권리이기도 하다.** `GET /tts/messages/:id/audio` 의 수신자 갈래가
// `EXISTS (SELECT 1 FROM alarms WHERE message_id = ? AND target_user_id = 나)` 로 판정한다
// (routes/tts.ts). 그래서 이 라우트는 **음원 확보와 켜진 알람의 OS 예약이 끝난 뒤에만**
// 불려야 하고, 양 앱이 그렇게 한다(안드로이드 `receivedAlarmDeliveryComplete`, iOS
// `MergeOutcome.deliveryComplete`).
// 서버는 그 판단을 강제할 수 없다 — 클라가 일찍 부르면 그 알람은 목소리를 잃는다.
//
// ⚠ **지우기 전에 tombstone 을 남긴다.** 행이 없어지면 나중에 발신자가 목소리를 지우거나
// 탈퇴했을 때 **어느 수신 알람을 걷어내야 하는지** 알 방법이 사라진다. 그래서 두 가지를
// 옮겨 적는다: 발신자(`sender_user_id`)와 **그 알람이 쓰는 클론 목소리**
// (`voice_profile_id`). 걷어내기는 목소리 기준이다 — `lib/voice-revocation.ts` 참조.
//
// ⚠ **여러 기기로 받는 경우 첫 기기에서만 받는다.** ack 는 기기 단위가 아니라 사용자
// 단위라, 두 번째 기기는 그 알람을 받지 못한다(`docs/spec/family-alarm.md` 「받은 뒤에는
// 전부 받은 사람 것이다」에 규칙으로 적어 두었다).
/**
 * 전달이 끝나 알람 행이 사라진 뒤, **그 전달만을 위해 만들어졌던 메시지 행**을 정리한다.
 *
 * 가족 알람은 전달마다 `messages` 행을 하나 만든다. ACK 가 `alarms` 행을 지우면 그 행이
 * 유일한 참조였는데, 예전에는 메시지와 그 생성 오디오 기록이 **그대로 남아 계속 쌓였다**
 * (Codex #703 P2). 문구와 메타데이터는 사용자가 보낸 내용이므로 남길 이유가 없다.
 *
 * ⚠ **지워도 되는 것만 지운다.** 판정 세 가지를 모두 만족할 때만이다:
 *  1. **프리셋이 아니다**(`is_preset = 0`) — 프리셋은 여러 사람이 나눠 쓰는 공용 클립이라
 *     참조가 잠깐 0 이어도 지우면 안 된다. 이게 가장 중요한 방어다.
 *  2. **어떤 알람도 더는 가리키지 않는다** — 같은 메시지를 재전송이나 다른 수신자가 아직
 *     쓰고 있으면 남긴다.
 *  3. 방금 지운 그 전달의 메시지 id 하나만 본다 — 넓게 쓸어 담지 않는다.
 *
 * 실패해도 트랜잭션을 깨지 않는다면 tombstone·삭제가 롤백돼 전달이 되살아나므로, 같은
 * 트랜잭션 안에서 그대로 던진다(정리 실패는 재시도로 해결된다 — ACK 는 멱등이다).
 */
async function deleteOrphanedDeliveryMessage(tx: DbExecutor, messageId: string): Promise<void> {
  if (!messageId || !UUID_RE.test(messageId)) return;
  const orphan = await tx.execute({
    sql: `SELECT 1 FROM messages m
          WHERE m.id = ?
            AND COALESCE(m.is_preset, 0) = 0
            AND NOT EXISTS (SELECT 1 FROM alarms a WHERE a.message_id = m.id)
            -- 보관함이 가리키면 지우지 않는다 (Codex #703 P1). message_library.message_id
            -- 는 messages.id 를 참조하는 FK 이고, 생성 TTS 로 만든 가족 알람은
            -- POST /tts/generate 가 발신자 보관함 행을 함께 만든다. 그걸 무시하고 지우면
            -- FK 강제 시 이 트랜잭션이 통째로 롤백돼 **전달이 서버에 남아 계속 다시 내려가고**,
            -- 강제가 없으면 dangling 행이 남는 데다 **발신자가 저장해 둔 문구가 사라진다.**
            -- 보관함 행은 발신자의 것이라 여기서 지울 대상이 아니다 — 참조가 있으면 남긴다.
            AND NOT EXISTS (SELECT 1 FROM message_library ml WHERE ml.message_id = m.id)
          LIMIT 1`,
    args: [messageId],
  });
  if (orphan.rows.length === 0) return;
  // ⚠ **R2 객체는 자산 행을 통해서만 발견된다**(Codex #703 P2). 보관 스윕이 그 행의
  // `audio_object_key` 로 객체를 찾으므로, 행만 지우면 오디오가 **영영 도달 불가**가 되어
  // 수거되지 않는다. 지우기 전에 삭제 큐에 넘긴다.
  const assets = await tx.execute({
    sql: 'SELECT audio_object_key FROM generated_audio_assets WHERE message_id = ?',
    args: [messageId],
  });
  await enqueueExternalDeletionsBatch(
    tx,
    'r2_object',
    assets.rows.map((row) => row.audio_object_key as string | null),
  );
  await tx.execute({
    sql: 'DELETE FROM generated_audio_assets WHERE message_id = ?',
    args: [messageId],
  });
  await tx.execute({ sql: 'DELETE FROM messages WHERE id = ?', args: [messageId] });
}

alarmMutation.post('/:id/received', async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  if (
    body === null ||
    typeof body !== 'object' ||
    !Object.prototype.hasOwnProperty.call(body, 'delivery_version')
  ) {
    return c.json(
      { error: 'delivery_version is required', error_code: 'DELIVERY_VERSION_REQUIRED' },
      400,
    );
  }
  const deliveryVersion = (body as { delivery_version?: unknown }).delivery_version;
  if (
    typeof deliveryVersion !== 'string' ||
    (!UUID_RE.test(deliveryVersion) && !/^[0-9a-f]{32}$/i.test(deliveryVersion))
  ) {
    return c.json(
      { error: 'Invalid delivery_version format', error_code: 'INVALID_DELIVERY_VERSION' },
      400,
    );
  }
  const resolved = await resolveDeclineTarget(c);
  if ('error' in resolved) return resolved.error;
  const db = getDB(c.env);
  const deleted = await withWriteTransaction(db, async (tx) => {
    const senderRes = await tx.execute({
      sql: 'SELECT user_id, message_id FROM alarms WHERE id = ? AND delivery_version = ? LIMIT 1',
      args: [resolved.id, deliveryVersion],
    });
    // 이미 지워졌거나 같은 id의 새 전달 세대로 교체됐으면 멱등 성공. 구버전 ACK가
    // 새 알람을 지우면 수신자는 그 내용을 영영 못 받는다.
    if (senderRes.rows.length === 0) return false;
    const senderRow = typedRow<{ user_id: string; message_id: string }>(senderRes.rows[0]!);
    const senderUserId = String(senderRow.user_id);
    const deliveredMessageId = String(senderRow.message_id);
    const source = await resolveAlarmVoiceRevocationSource(tx, resolved.id, deliveryVersion);
    if (!source) return false;

    // 출처 조회·tombstone·삭제는 한 쓰기 트랜잭션이다. 재전송이 중간에 끼어 옛 출처를
    // 같은 id의 새 전달에 남기지 못하게 한다.
    // **먼저 적고, 실패하면 지우지 않는다.** 철회가 먼저 revoked=1을 세웠다면 출처를
    // 되살리지 않는다. 반대 순서는 revokeDeletedVoices가 이 tombstone을 찾아 철회한다.
    await tx.execute({
      sql: `INSERT INTO alarm_recipient_state
              (alarm_id, recipient_user_id, declined, revoked, sender_user_id, voice_profile_id,
               sender_voice_upload, custom_voice, created_at, updated_at)
            VALUES (?, ?, 0, 0, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(alarm_id, recipient_user_id)
            DO UPDATE SET sender_user_id = excluded.sender_user_id,
                          voice_profile_id = CASE WHEN alarm_recipient_state.revoked = 1
                            THEN NULL ELSE excluded.voice_profile_id END,
                          sender_voice_upload = CASE WHEN alarm_recipient_state.revoked = 1
                            THEN 0 ELSE excluded.sender_voice_upload END,
                          custom_voice = CASE WHEN alarm_recipient_state.revoked = 1
                            THEN 0 ELSE excluded.custom_voice END,
                          updated_at = datetime('now')`,
      args: [
        resolved.id,
        resolved.target,
        senderUserId,
        source.voiceProfileId,
        source.senderVoiceUpload ? 1 : 0,
        source.customVoice ? 1 : 0,
      ],
    });
    const result = await tx.execute({
      sql: `DELETE FROM alarms
            WHERE id = ? AND target_user_id IS NOT NULL AND delivery_version = ?`,
      args: [resolved.id, deliveryVersion],
    });
    const removed = (result.rowsAffected ?? 0) > 0;
    if (removed) await deleteOrphanedDeliveryMessage(tx, deliveredMessageId);
    return removed;
  });
  return c.json({ success: true, deleted });
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

  // **남에게 보낸 알람이면 지우기 전에 보낸이를 적어 둔다.**
  //
  // 수신자 기기는 이 알람을 지우지 않는다 — 받은 뒤부터는 받는 사람 것이라, 기대고 자던
  // 알람이 남의 조작으로 사라지면 그날 못 일어난다(#675). 그래서 그 기기에는 내 복제
  // 목소리가 그대로 남는다. 나중에 내가 **탈퇴**하면 그걸 걷어내야 하는데, 그때는 훑을
  // 알람 행이 이미 없다 — 표식이 유일한 근거다(Codex #676 P1).
  //
  // **순서와 fail-closed 가 둘 다 중요하다.** 지운 뒤에 적으면서 실패를 삼키면, 알람도
  // 표식도 없는 상태가 남아 걷어낼 근거가 영영 사라진다 — 이 변경이 막으려던 바로 그
  // 구멍이 되돌아온다(Codex #678 P1). 배포 직후 마이그레이션 93 이 아직 안 돌았을 때가
  // 실제로 그 창이다. 그래서 **먼저 적고, 실패하면 지우지 않는다** — 사용자는 재시도하면
  // 되고 잃는 것이 없다(CLAUDE.md 「배포가 마이그레이션보다 먼저 돈다」 규약).
  //
  // `declined=0, revoked=0` 이라 지금은 아무 효력이 없다(GET /alarm/declined 는 둘 중
  // 하나가 1 인 행만 내보낸다). 나중에 **그 목소리가 사라지면** `revokeDeletedVoices` 가
  // 이 행을 찾아 revoked=1 로 바꾼다 — 그래서 `voice_profile_id` 도 함께 적어 둔다.
  // 조회→출처 기록→삭제를 한 쓰기 트랜잭션으로 직렬화한다. 같은 계정의 다른 기기가
  // 같은 슬롯을 재전송해 id를 재사용하더라도, 삭제가 옛 세대 전체보다 먼저 또는 새 세대
  // 전체보다 뒤에만 놓이므로 옛 출처를 남기고 새 세대를 지우는 중간 상태가 없다.
  let deletedAlarm: { messageId: string | null } | null;
  try {
    deletedAlarm = await withWriteTransaction(db, async (tx) => {
      const targetRes = await tx.execute({
        sql: `SELECT message_id, target_user_id FROM alarms
              WHERE id = ? AND user_id IN (${inPlaceholders(ownerIds)}) LIMIT 1`,
        args: [id, ...ownerIds],
      });
      if (targetRes.rows.length === 0) return null;
      const targetAlarm = typedRow<{
        message_id: string | null;
        target_user_id: string | null;
      }>(targetRes.rows[0]!);
      const recipientUserId = targetAlarm.target_user_id;

      if (recipientUserId) {
        const source = await resolveAlarmVoiceRevocationSource(tx, id);
        if (!source) throw new Error(`Alarm disappeared before voice source was recorded: ${id}`);
        await tx.execute({
          sql: `INSERT INTO alarm_recipient_state
                (alarm_id, recipient_user_id, declined, revoked, sender_user_id, voice_profile_id,
                 sender_voice_upload, custom_voice, created_at, updated_at)
              VALUES (?, ?, 0, 0, ?, ?, ?, ?, datetime('now'), datetime('now'))
              ON CONFLICT(alarm_id, recipient_user_id)
              DO UPDATE SET sender_user_id = excluded.sender_user_id,
                            voice_profile_id = CASE WHEN alarm_recipient_state.revoked = 1
                              THEN NULL ELSE excluded.voice_profile_id END,
                            sender_voice_upload = CASE WHEN alarm_recipient_state.revoked = 1
                              THEN 0 ELSE excluded.sender_voice_upload END,
                            custom_voice = CASE WHEN alarm_recipient_state.revoked = 1
                              THEN 0 ELSE excluded.custom_voice END,
                            updated_at = datetime('now')`,
          args: [
            id,
            recipientUserId,
            c.get('userIdPK') ?? ownerIds[0]!,
            source.voiceProfileId,
            source.senderVoiceUpload ? 1 : 0,
            source.customVoice ? 1 : 0,
          ],
        });
      }

      const result = await tx.execute({
        sql: `DELETE FROM alarms WHERE id = ? AND user_id IN (${inPlaceholders(ownerIds)})`,
        args: [id, ...ownerIds],
      });
      if ((result.rowsAffected ?? 0) === 0) {
        throw new Error(`Alarm disappeared during delete transaction: ${id}`);
      }
      return { messageId: targetAlarm.message_id };
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to delete alarm', error_code: 'ALARM_DELETE_FAILED' }, 500);
  }

  if (!deletedAlarm) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }
  const messageId = deletedAlarm.messageId;

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
      // ⚠ **그 오브젝트를 가리키던 포인터도 끊는다.** R2 오브젝트와 에셋 행만 지우고
      // `messages.audio_url` 을 그대로 두면 `r2://...` 가 **영구히 죽은 포인터**로
      // 남는다. 그 메시지를 다시 쓰는 경로가 있으면 없는 오브젝트를 받으러 가고,
      // TTL 스윕은 그 행 때문에 '아직 참조 중' 으로 오판해 청소를 건너뛴다.
      // 삭제와 **같은 소유권 스코프**를 건다(cross-tenant 파괴 방지, 위와 같은 이유).
      await db.execute({
        sql: 'UPDATE messages SET audio_url = NULL WHERE id = ? AND user_id IN (?, ?)',
        args: [messageId, ...ownerIds],
      });
    }
  }

  return c.json({ success: true });
});

export default alarmMutation;
