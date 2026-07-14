import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';
import { R2VoiceStorage } from '../lib/r2-storage';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import {
  familyAlarmSettingsFromRow,
  isBlockedByFamilyAlarmQuietTime,
} from '../lib/family-alarm-settings';
import {
  validateAlarmFields,
  normalizeAlarmRow,
  type AlarmRow,
  type AlarmMode,
  type VibrationPattern,
  type WakeMode,
} from './alarm-helpers';
import { isPaidVoicePlan } from './billing-helpers';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';

const alarmMutation = new Hono<AppEnv>();

/**
 * 클라이언트가 보낸 IANA timezone 을 정규화한다. 푸시 스케줄러가 알람 HH:mm 을
 * 이 시간대로 판정한다. 형식이 어긋나면 null (스케줄러가 Asia/Seoul 폴백).
 */
function normalizeTimezone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(trimmed)) return null;
  return trimmed;
}

function alarmUsesPaidVoice(body: {
  mode?: string | null;
  wake_mode?: string | null;
  message_id?: string | null;
  voice_profile_id?: string | null;
  speaker_id?: string | null;
  raw_audio_url?: string | null;
}): boolean {
  return (
    body.mode === 'tts' ||
    body.wake_mode === 'voice_only' ||
    !!body.message_id ||
    !!body.voice_profile_id ||
    !!body.speaker_id ||
    !!body.raw_audio_url
  );
}

/**
 * 무료 플랜도 시스템 스톡 보이스 기반 TTS 알람은 허용한다.
 * 녹음/파일(raw_audio_url, speaker_id) 알람은 여전히 유료 전용.
 */
async function usesOnlySystemStockVoice(
  db: ReturnType<typeof getDB>,
  body: {
    message_id?: string | null;
    voice_profile_id?: string | null;
    speaker_id?: string | null;
    raw_audio_url?: string | null;
  },
): Promise<boolean> {
  if (body.raw_audio_url || body.speaker_id) return false;
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
  db: ReturnType<typeof getDB>,
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

alarmMutation.post('/', async (c) => {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userId;
  const ownerIds = [userPk, userId] as [string, string];
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
    speaker_id?: string;
    raw_audio_url?: string;
    raw_audio_duration_ms?: number;
    timezone?: string;
    // 무료 버킷 회전 알람이 가리키는 버킷(예: 'morning'·'medication'). message_id 는
    // 대표(변형0) 스톡 클립을 그대로 유지하므로 회전 미지원 경로에선 폴백 단일 재생.
    bucket_id?: string | null;
  }>();

  if (!body.time) {
    return c.json({ error: 'time is required', error_code: 'REQUIRED_FIELDS_MISSING' }, 400);
  }
  const timezone = normalizeTimezone(body.timezone);
  // Three valid sources for what the alarm plays:
  //   1. message_id          → TTS / saved voice clip
  //   2. raw_audio_url       → user-recorded raw audio
  //   3. neither             → "alarm-only" mode: device default alarm sound
  // No further check needed; the alarm row stores message_id NULL for case 3.

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  let targetUserIdForAlarm: string | null = null;
  if (body.target_user_id) {
    const rawTargetUserId = body.target_user_id.trim();
    if (!rawTargetUserId) {
      return c.json({ error: 'Invalid target_user_id', error_code: 'INVALID_TARGET_USER' }, 400);
    }
    if (rawTargetUserId !== userId) {
      const targetRes = await db.execute({
        sql: `SELECT id, google_id, allow_family_alarms,
                     family_alarm_quiet_days, family_alarm_quiet_start, family_alarm_quiet_end,
                     family_alarm_quiet_windows
              FROM users
              WHERE google_id = ? OR id = ?
              LIMIT 1`,
        args: [rawTargetUserId, rawTargetUserId],
      });
      if (targetRes.rows.length === 0) {
        return c.json(
          {
            error: '친구 관계인 사용자에게만 알람을 설정할 수 있습니다.',
            error_code: 'NOT_FRIENDS',
          },
          403,
        );
      }

      const target = targetRes.rows[0]!;
      const targetPk = String(target.id);
      const targetLoginId = (target.google_id as string | null) ?? targetPk;
      const targetSettings = familyAlarmSettingsFromRow(target as Record<string, unknown>);
      if (!targetSettings.allowFamilyAlarms) {
        return c.json(
          {
            error: '상대방이 알람 설정을 허용하지 않았습니다.',
            error_code: 'FAMILY_ALARM_DISABLED',
          },
          403,
        );
      }
      if (isBlockedByFamilyAlarmQuietTime(body.time, body.repeat_days ?? [], targetSettings)) {
        return c.json(
          {
            error: '상대방이 설정한 불가 시간에는 알람을 만들 수 없습니다.',
            error_code: 'FAMILY_ALARM_QUIET_TIME',
          },
          403,
        );
      }

      const friendship = await db.execute({
        sql: `SELECT id FROM friendships
              WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
                AND status = 'accepted'`,
        args: [userId, targetLoginId, targetLoginId, userId],
      });

      if (friendship.rows.length > 0) {
        targetUserIdForAlarm = targetLoginId;
      } else {
        const senderPk = await resolveUserPk(db, userId);
        const allowed =
          targetLoginId !== userId && !!senderPk && (await assertSameGroup(db, senderPk, targetPk));

        if (!allowed) {
          return c.json(
            {
              error: '친구 또는 같은 커플/가족 그룹 멤버에게만 알람을 설정할 수 있습니다.',
              error_code: 'NOT_CONNECTED',
            },
            403,
          );
        }
        targetUserIdForAlarm = targetLoginId;
      }
    }
  }

  const alarmOwner = targetUserIdForAlarm || userId;

  const user = await db.execute({
    sql: 'SELECT plan FROM users WHERE google_id = ?',
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

  // Raw-audio alarms have no real TTS message but the schema still requires
  // message_id (NOT NULL). Insert a "raw" placeholder message that points at
  // the same audio URL so the alarm row is satisfied. We attach it to the
  // user's first voice profile because messages.voice_profile_id is NOT NULL.
  let resolvedMessageId: string | null = body.message_id ?? null;
  if (
    body.voice_profile_id &&
    !(await voiceProfileBelongsToCaller(db, body.voice_profile_id, ownerIds))
  ) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  if (!resolvedMessageId && body.raw_audio_url) {
    const firstVoice = await db.execute({
      sql: `SELECT id FROM voice_profiles
            WHERE user_id IN (?, ?) AND deleted_at IS NULL
              AND COALESCE(is_draft, 0) = 0
            LIMIT 1`,
      args: ownerIds,
    });
    if (firstVoice.rows.length === 0) {
      return c.json(
        {
          error: 'A voice profile is required to create a raw-audio alarm.',
          error_code: 'VOICE_PROFILE_REQUIRED',
        },
        400,
      );
    }
    const placeholderMsgId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
            VALUES (?, ?, ?, '', ?, 'raw')`,
      args: [placeholderMsgId, userPk, firstVoice.rows[0]!.id as string, body.raw_audio_url],
    });
    resolvedMessageId = placeholderMsgId;
  } else if (resolvedMessageId) {
    // 본인 소유 메시지뿐 아니라 시스템 스톡 클립(is_preset=1 + 시스템 보이스)도
    // 허용한다. 무료 플랜은 스톡 클립으로 알람을 만들 수 있어야 하는데, 기존
    // 검증은 user_id 만 봐서 스톡 클립 알람을 404 로 막고 있었다
    // (GET /tts/messages/:id/audio 의 허용 규칙과 일치시킨다).
    if (!(await messageBelongsToCaller(db, resolvedMessageId, ownerIds))) {
      return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
    }
  }

  const alarmId = crypto.randomUUID();
  const mode: AlarmMode =
    (body.mode as AlarmMode | undefined) ?? (creatorHasPaidVoice ? 'tts' : 'sound-only');
  const vibPattern: VibrationPattern =
    (body.vibration_pattern as VibrationPattern | undefined) ?? 'default';
  const wakeMode: WakeMode = (body.wake_mode as WakeMode | undefined) ?? 'sound_then_voice';
  const insertAlarm = (executor: DbExecutor) =>
    executor.execute({
      sql: `INSERT INTO alarms
            (id, user_id, target_user_id, message_id, time, repeat_days, snooze_minutes,
             mode, vibration_pattern, wake_mode, voice_profile_id, speaker_id,
             raw_audio_url, raw_audio_duration_ms, timezone, bucket_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        body.speaker_id ?? null,
        body.raw_audio_url ?? null,
        body.raw_audio_duration_ms ?? null,
        timezone,
        body.bucket_id ?? null,
      ],
    });
  const inserted = body.voice_profile_id
    ? await withWriteTransaction(db, async (tx) => {
        if (!(await voiceProfileBelongsToCaller(tx, body.voice_profile_id!, ownerIds))) return null;
        return insertAlarm(tx);
      })
    : await insertAlarm(db);
  if (!inserted) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
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
        speaker_id: body.speaker_id ?? null,
      },
    },
    201,
  );
});

alarmMutation.patch('/:id', async (c) => {
  const userId = c.get('userId');
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
    speaker_id?: string | null;
    raw_audio_url?: string | null;
    raw_audio_duration_ms?: number | null;
    timezone?: string | null;
    bucket_id?: string | null;
  }>();

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  const existing = await db.execute({
    sql: `SELECT a.id, a.message_id, a.mode, a.wake_mode, a.voice_profile_id,
                 a.speaker_id, a.raw_audio_url, u.plan AS user_plan
          FROM alarms a
          LEFT JOIN users u ON u.google_id = a.user_id OR u.id = a.user_id
          WHERE a.id = ? AND a.user_id = ?`,
    args: [id, userId],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  const current = typedRow<{
    message_id: string | null;
    mode: string | null;
    wake_mode: string | null;
    voice_profile_id: string | null;
    speaker_id: string | null;
    raw_audio_url: string | null;
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
    speaker_id: body.speaker_id !== undefined ? body.speaker_id : current.speaker_id,
    raw_audio_url: body.raw_audio_url !== undefined ? body.raw_audio_url : current.raw_audio_url,
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
  const ownerIds = [resolvedUserPk || userId, userId] as [string, string];
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
  if (body.speaker_id !== undefined) {
    updates.push('speaker_id = ?');
    args.push(body.speaker_id);
  }
  if (body.raw_audio_url !== undefined) {
    updates.push('raw_audio_url = ?');
    args.push(body.raw_audio_url);
  }
  if (body.raw_audio_duration_ms !== undefined) {
    updates.push('raw_audio_duration_ms = ?');
    args.push(body.raw_audio_duration_ms);
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
    body.voice_profile_id !== undefined && body.voice_profile_id !== null
      ? await withWriteTransaction(db, async (tx) => {
          if (!(await voiceProfileBelongsToCaller(tx, body.voice_profile_id!, ownerIds)))
            return null;
          return updateAlarm(tx);
        })
      : await updateAlarm(db);
  if (!updateResult) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  // raw_audio_url 을 새 값으로 교체하면 이전 R2 녹음이 어떤 알람에서도 참조되지
  // 않을 수 있다. DELETE 핸들러와 동일하게, 더 이상 쓰이지 않는 이전 오브젝트를
  // 삭제 큐에 적재해 영구 고아를 막는다(교체 경로에는 기존에 이 정리가 없었다).
  if (body.raw_audio_url !== undefined) {
    const previousRawUrl = current.raw_audio_url;
    if (previousRawUrl?.startsWith('r2://') && previousRawUrl !== body.raw_audio_url) {
      const stillReferenced = await db.execute({
        sql: 'SELECT COUNT(*) AS cnt FROM alarms WHERE raw_audio_url = ?',
        args: [previousRawUrl],
      });
      if (Number(typedRow<{ cnt: number }>(stillReferenced.rows[0]!).cnt ?? 0) === 0) {
        const { enqueueExternalDeletion } = await import('../lib/audio-retention');
        await enqueueExternalDeletion(db, 'r2_object', previousRawUrl.replace(/^r2:\/\//, ''));
      }
    }
  }

  const updated = await db.execute({
    sql: `SELECT id, user_id, target_user_id, message_id, time, repeat_days,
                 is_active, snooze_minutes, mode, vibration_pattern, wake_mode,
                 voice_profile_id, speaker_id, bucket_id, created_at, updated_at
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
  const viewer = Array.from(new Set([userPk, userId]));
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

alarmMutation.delete('/:id/decline', async (c) => {
  const resolved = await resolveDeclineTarget(c);
  if ('error' in resolved) return resolved.error;
  const db = getDB(c.env);
  await db.execute({
    sql: 'DELETE FROM alarm_recipient_state WHERE alarm_id = ? AND recipient_user_id = ?',
    args: [resolved.id, resolved.target],
  });
  return c.json({ success: true, declined: false });
});

alarmMutation.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid alarm ID format', error_code: 'INVALID_ALARM_ID' }, 400);
  }

  const targetRes = await db.execute({
    sql: 'SELECT message_id, raw_audio_url FROM alarms WHERE id = ? AND user_id = ? LIMIT 1',
    args: [id, userId],
  });
  const targetAlarm =
    targetRes.rows.length > 0
      ? typedRow<{ message_id: string | null; raw_audio_url: string | null }>(targetRes.rows[0]!)
      : null;
  const messageId = targetAlarm?.message_id ?? null;
  const rawAudioUrl = targetAlarm?.raw_audio_url ?? null;

  const result = await db.execute({
    sql: 'DELETE FROM alarms WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rowsAffected === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  // 사용자 녹음 원본(r2://)이 더 이상 어떤 알람에도 쓰이지 않으면 R2 삭제 큐에 적재.
  if (rawAudioUrl?.startsWith('r2://')) {
    const rawRefRes = await db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM alarms WHERE raw_audio_url = ?',
      args: [rawAudioUrl],
    });
    if (Number(typedRow<{ cnt: number }>(rawRefRes.rows[0]!).cnt ?? 0) === 0) {
      const { enqueueExternalDeletion } = await import('../lib/audio-retention');
      await enqueueExternalDeletion(db, 'r2_object', rawAudioUrl.replace(/^r2:\/\//, ''));
    }
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
