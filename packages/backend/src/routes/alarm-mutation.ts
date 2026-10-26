import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { planWithGrantSql } from '../lib/plan-grant-sql';
import { typedRow } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError, logStructured } from '../lib/logger';
import { R2VoiceStorage } from '../lib/r2-storage';
import {
  validateAlarmFields,
  normalizeAlarmRow,
  normalizeTimezone,
  cheerFieldsOf,
  type AlarmRow,
  type AlarmMode,
  type VibrationPattern,
  type WakeMode,
} from './alarm-helpers';
import { hasPersonalVoiceAccess } from './billing-helpers';
import { resolvePersonalPromo } from '../lib/personal-promo';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { callerOwnerIds, inPlaceholders } from '../lib/caller-ids';
import { normalizeStockCategory, requestCloneContentSupplement, STOCK_GREETING_CATEGORY } from '../lib/stock-clips';
import { ownAlarmIdentity } from '../lib/alarm-identity';

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
 * message_id 가 호출자(ownerIds) 가 쓸 수 있는 메시지인지 확인한다. 허용 갈래는 둘:
 * **내 문구**(그 목소리가 내 목소리이거나 시스템 목소리) / **시스템 스톡 프리셋**.
 * 초안(is_draft) 보이스의 메시지는 어느 갈래로도 못 지난다.
 *
 * GET /tts/messages/:id/audio 와 **같은 규칙이어야 한다.** 어긋나면 두 방향 모두 사고가 난다:
 * 여기가 좁으면 '들리는데 저장이 안 되고'(2026-08-05), 여기가 넓으면 '저장은 되는데 받을 수
 * 없는' 알람이 생긴다(Codex #685). 규칙을 고칠 땐 두 곳을 같이 고칠 것. 목소리 쪽 짝은
 * [voiceProfileBelongsToCaller] 다.
 *
 * 내 문구라도 목소리가 남의 것이면 받지 않는다 — 목소리 공유가 있던 시절에 만들어진 행이 남아
 * 있을 수 있는데, 오디오 라우트가 그 음원을 주지 않는다.
 *
 * 부르는 자리: POST 는 언제나, PATCH 는 `message_id` 가 **저장된 값에서 바뀔 때만**(스펙 D8·D13 —
 * [voiceProfileBelongsToCaller] 도 같은 조건으로 부른다). 그대로 보낸 값은 새 참조가 아니다. 허용 갈래
 * 자체는 이 조건과 무관하게 오디오 라우트와 같다.
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
              (
                user_id IN (?, ?)
                AND EXISTS (
                  SELECT 1 FROM voice_profiles own_vp
                  WHERE own_vp.id = messages.voice_profile_id
                    AND (own_vp.user_id IN (?, ?) OR COALESCE(own_vp.is_system, 0) = 1)
                )
              )
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
    args: [messageId, ...ownerIds, ...ownerIds],
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
  const owned = await db.execute({
    sql: `SELECT 1 FROM voice_profiles
          WHERE id = ?
            AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 0
            AND (user_id IN (?, ?) OR COALESCE(is_system, 0) = 1)
          LIMIT 1`,
    args: [voiceProfileId, ...ownerIds],
  });
  return owned.rows.length > 0;
}

/**
 * greeting 버킷 정책: 알람이 쓰는 보이스가 non-system 클론인지 판정한다.
 * greeting 문구는 목소리 미리듣기 전용이지만, '유료 클론의 기본(기상 인사) 알람 버킷'
 * 으로만 예외 허용한다(validateAlarmFields 의 greeting 허용 주석 참고). 시스템 스톡
 * 보이스 + greeting 조합은 미리듣기 클립을 무료 알람으로 돌려 쓰는 우회라 차단한다.
 * 접근 가능 여부(소유/프리셋)는 voiceProfileBelongsToCaller /
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

/**
 * **클론으로 응원 알람을 저장했으면 보충을 요청한다**(스펙 voice-and-message §5-4 「클론은 고른 것만 보충한다」).
 *
 * 저장이 끝난 **뒤**에 부르고, 실패해도 저장은 성공으로 둔다 — 잃는 것은 보충이 한 번 늦는 것뿐이고(다음 응원 저장이 다시
 * 요청한다), 알람을 500 으로 돌려 보내면 사용자는 저장된 알람을 다시 저장한다. 기본 목소리·무료·공개 전이면 아무 일도
 * 하지 않는다. 클론 소유는 큐의 `owner_user_id` 가 확인한다(큐 행은 그 사람의 클론에만 있다).
 */
async function requestCheerSupplementAfterSave(
  db: ReturnType<typeof getDB>,
  params: { ownerUserId: string; bucketId: string | null; voiceProfileId: string | null; hasPersonalVoice: boolean },
): Promise<void> {
  if (normalizeStockCategory(params.bucketId ?? '') !== 'cheer') return;
  if (!params.voiceProfileId || !params.hasPersonalVoice) return;
  try {
    const result = await requestCloneContentSupplement(db, {
      voiceProfileId: params.voiceProfileId,
      ownerUserId: params.ownerUserId,
      theme: 'cheer',
    });
    if (result === 'queued' || result === 'requested') {
      logStructured('info', { at: 'voice.prerender.supplement_requested', voice_profile_id: params.voiceProfileId, result });
    }
  } catch (error) {
    logStructured('warn', {
      at: 'voice.prerender.supplement_request_failed',
      voice_profile_id: params.voiceProfileId,
      error: String(error).slice(0, 200),
    });
  }
}

alarmMutation.post('/', async (c) => {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userId;
  // [users.id, 토큰 로그인 식별자] — 통일 이전에 만들어진 행까지 매칭한다.
  const ownerIds = callerOwnerIds(c) as [string, string];
  const db = getDB(c.env);

  const body = await c.req.json<{
    client_alarm_id?: string;
    message_id?: string;
    time: string;
    is_active?: boolean;
    repeat_days?: number[];
    snooze_minutes?: number;
    /** 옛 앱의 가족 알람 보내기가 싣던 값 — 아래 가드만 본다. */
    target_user_id?: unknown;
    mode?: string;
    vibration_pattern?: string;
    wake_mode?: string;
    voice_profile_id?: string;
    timezone?: string;
    // 무료 버킷 회전 알람이 가리키는 버킷(예: 'weather'·'medication'). message_id 는
    // 대표(변형0) 스톡 클립을 그대로 유지하므로 회전 미지원 경로에선 폴백 단일 재생.
    bucket_id?: string | null;
    // 응원 테마의 '다양하게 / 이 문구로 고정'(스펙 voice-and-message §5-4). 응원이 아니면 앱이 보내지 않는다.
    cheer_mode?: string | null;
    cheer_pinned_content_id?: string | null;
  }>();

  if (!body.time) {
    return c.json({ error: 'time is required', error_code: 'REQUIRED_FIELDS_MISSING' }, 400);
  }
  if (body.client_alarm_id != null && (typeof body.client_alarm_id !== 'string' || !UUID_RE.test(body.client_alarm_id))) {
    return c.json({ error: 'Invalid client alarm ID', error_code: 'INVALID_ALARM_ID' }, 400);
  }
  const timezone = normalizeTimezone(body.timezone);
  // Two valid sources for what the alarm plays:
  //   1. message_id → TTS / 저장된 음성 클립
  //   2. neither    → "alarm-only" 모드: 기기 기본 알람음
  // 내 알람용 로컬 녹음/파일은 폰에만 두고 서버로 올리지 않는다.

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  // 남에게 보내는 알람은 없다(가족 알람은 2026-10-20 커플·가족 이용권과 함께 지웠다). 다른 계정을
  // 가리키는 `target_user_id` 는 그룹 밖 발신자가 받던 답(403 `NOT_CONNECTED`)으로 끊는다 — 조용히
  // 내 알람으로 저장하지 않는다. 비었거나 나를 가리키거나 문자열이 아니면 무시한다
  // (`docs/spec/alarm-lifecycle.md`).
  const requestedTargetUserId =
    typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
  if (requestedTargetUserId && !ownerIds.includes(requestedTargetUserId)) {
    return c.json(
      { error: 'Alarms can only be set for your own account.', error_code: 'NOT_CONNECTED' },
      403,
    );
  }

  const user = await db.execute({
    sql: `SELECT ${planWithGrantSql('users')} AS plan FROM users WHERE id = ?`,
    args: [userId],
  });
  const creatorPlanValue = user.rows.length > 0 ? user.rows[0]!.plan : undefined;
  // 내 알람은 **계산값**(기간 한정 개인 플랜 반영)으로 본다.
  const creatorHasPaidVoice =
    !resolvedUserPk ||
    creatorPlanValue === undefined ||
    hasPersonalVoiceAccess(creatorPlanValue, resolvePersonalPromo(c.env));
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

  const clientAlarmId = body.client_alarm_id;
  const alarmId = clientAlarmId ? await ownAlarmIdentity(userPk, clientAlarmId) : crypto.randomUUID();
  let creationReplayed = false;
  const mode: AlarmMode =
    (body.mode as AlarmMode | undefined) ?? (creatorHasPaidVoice ? 'tts' : 'sound-only');
  const vibPattern: VibrationPattern =
    (body.vibration_pattern as VibrationPattern | undefined) ?? 'default';
  const wakeMode: WakeMode = (body.wake_mode as WakeMode | undefined) ?? 'sound_then_voice';
  const isActive = body.is_active ?? true;
  // ⚠ 응원 칼럼(#143)은 **값이 왔을 때만** 쓴다. 왔는데 칼럼이 없으면(배포 창) INSERT 가 통째로 실패한다 — fail-closed.
  //   값이 없는 요청은 지금과 같은 행을 남기므로 칼럼을 건드리지 않는다(창에서도 그대로 저장된다).
  const cheerFields = cheerFieldsOf(body);
  const insertAlarm = (executor: DbExecutor) =>
    executor.execute({
      sql: `INSERT INTO alarms
            (id, user_id, message_id, time, repeat_days, snooze_minutes,
             mode, vibration_pattern, wake_mode, voice_profile_id,
             timezone, bucket_id, is_active${cheerFields.map((f) => `, ${f.column}`).join('')})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${cheerFields.map(() => ', ?').join('')})`,
      args: [
        alarmId,
        userId,
        resolvedMessageId,
        body.time,
        JSON.stringify(body.repeat_days ?? []),
        body.snooze_minutes ?? 5,
        mode,
        vibPattern,
        wakeMode,
        body.voice_profile_id ?? null,
        timezone,
        body.bucket_id ?? null,
        isActive ? 1 : 0,
        ...cheerFields.map((f) => f.value),
      ],
    });
  const inserted =
    body.voice_profile_id || resolvedMessageId || clientAlarmId
      ? await withWriteTransaction(db, async (tx) => {
          if (clientAlarmId) {
            const existing = await tx.execute({
              sql: 'SELECT id FROM alarms WHERE id = ? AND user_id IN (?, ?)',
              args: [alarmId, ...ownerIds],
            });
            if (existing.rows.length) {
              creationReplayed = true;
              return { status: 'ok' as const, result: null };
            }
          }
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
          return { status: 'ok' as const, result: await insertAlarm(tx) };
        })
      : { status: 'ok' as const, result: await insertAlarm(db) };
  if (inserted.status === 'voice_not_found') {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }
  if (inserted.status === 'message_not_found') {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }
  await requestCheerSupplementAfterSave(db, {
    ownerUserId: userPk,
    bucketId: body.bucket_id ?? null,
    voiceProfileId: body.voice_profile_id ?? null,
    hasPersonalVoice: creatorHasPaidVoice && !!resolvedUserPk,
  });

  // 받은 본문을 되돌려 주되 `target_user_id` 는 싣지 않는다(위 가드 — 저장하지 않은 값이다).
  const { target_user_id: _ignoredTargetUserId, ...echoedBody } = body;
  return c.json(
    {
      alarm: {
        ...echoedBody,
        id: alarmId,
        is_active: isActive,
        ...(clientAlarmId ? { creation_replayed: creationReplayed } : {}),
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
    cheer_mode?: string | null;
    cheer_pinned_content_id?: string | null;
  }>();

  const fieldError = validateAlarmFields(body);
  if (fieldError) return c.json(fieldError, 400);

  // 소유권 게이트는 두 식별자를 모두 본다 — 통일 이전에 만들어진 알람은 user_id 에
  // 로그인 식별자가 들어 있어, users.id 하나로만 걸면 자기 알람을 수정할 수 없다.
  const patchOwnerIds = callerOwnerIds(c);
  const existing = await db.execute({
    sql: `SELECT a.id, a.time, a.repeat_days, a.is_active,
                 a.message_id, a.mode, a.wake_mode, a.voice_profile_id,
                 a.bucket_id, ${planWithGrantSql('u')} AS user_plan
          FROM alarms a
          LEFT JOIN users u ON u.google_id = a.user_id OR u.id = a.user_id
          WHERE a.id = ? AND a.user_id IN (${inPlaceholders(patchOwnerIds)})`,
    args: [id, ...patchOwnerIds],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Alarm not found', error_code: 'ALARM_NOT_FOUND' }, 404);
  }

  const current = typedRow<{
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
  // 언제나 **내 알람**이라 계산값(기간 한정 개인 플랜 반영)으로 본다.
  const creatorHasPaidVoice =
    !resolvedUserPk ||
    current.user_plan === undefined ||
    hasPersonalVoiceAccess(current.user_plan, resolvePersonalPromo(c.env));
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
  // ⚠ **목소리·문구는 저장된 값에서 바뀔 때만 다시 본다**(스펙 D8·D13 —
  // `docs/spec/billing-lifecycle.md` 「기간 한정 개인 플랜」). 안드로이드 동기화
  // (`RemoteAlarmMapper.toWriteRequest`)는 켜기·끄기·시각만 고쳐도 `voice_profile_id` 와
  // `message_id` 를 **매번 그대로** 보낸다. 저장한 뒤 판정이 바뀐 값(허용 갈래를 좁혔을 때 등 —
  // 2026-10-20 에 남의 목소리 갈래를 지웠다)을 든 알람은, 그대로 보낸 값까지 보면 토글마다 404 →
  // 생성 폴백도 404 → 알람이 동기화 실패로 남는다. 바뀌지 않은 값은 새 참조를 만들지 않는다
  // — 이미 이 알람에 있던 값이고, 알람 소유는 위 조회가 확인했다. 새 값으로 **바꾸는** PATCH 와
  // POST 는 언제나 본다.
  // ⚠ 이건 `messageBelongsToCaller` ↔ 오디오 라우트 **쌍 규칙을 넓히지 않는다** — 허용 갈래는 그대로이고,
  //   막힌 클립의 재생은 `GET /tts/messages/:id/audio` 가 여전히 막는다. 살리는 것은 이미 있던 알람의
  //   동기화뿐이다.
  const changedVoiceProfileId =
    body.voice_profile_id !== undefined &&
    body.voice_profile_id !== null &&
    body.voice_profile_id !== current.voice_profile_id
      ? body.voice_profile_id
      : null;
  const changedMessageId =
    body.message_id !== undefined &&
    body.message_id !== null &&
    body.message_id !== current.message_id
      ? body.message_id
      : null;
  if (
    changedMessageId !== null &&
    !(await messageBelongsToCaller(db, changedMessageId, ownerIds))
  ) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }
  if (
    changedVoiceProfileId !== null &&
    !(await voiceProfileBelongsToCaller(db, changedVoiceProfileId, ownerIds))
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
  // 응원 저장값(#143) — 온 것만 쓴다(POST 와 같은 이유, fail-closed). 화이트리스트 칼럼 조각이다.
  for (const field of cheerFieldsOf(body)) {
    updates.push(`${field.column} = ?`);
    args.push(field.value);
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
  // 트랜잭션 안의 재확인(TOCTOU)도 바깥 게이트와 같은 조건이다 — 바뀌는 값만 본다(D8·D13).
  const updateResult =
    changedVoiceProfileId !== null || changedMessageId !== null
      ? await withWriteTransaction(db, async (tx) => {
          if (
            changedVoiceProfileId !== null &&
            !(await voiceProfileBelongsToCaller(tx, changedVoiceProfileId, ownerIds))
          ) {
            return { status: 'voice_not_found' as const, result: null };
          }
          if (
            changedMessageId !== null &&
            !(await messageBelongsToCaller(tx, changedMessageId, ownerIds))
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
    // 응원 칼럼은 **이 요청이 그 값을 썼을 때만** 되읽는다 — 그때는 위 UPDATE 가 칼럼이 있음을 이미 보였다. 안 썼으면
    // 응답에 싣지 않는다(배포 창에 칼럼 없음으로 응답만 500 이 되는 일을 막는다. 앱은 응원 알람이면 언제나 보낸다).
    sql: `SELECT id, user_id, message_id, time, repeat_days,
                 is_active, snooze_minutes, mode, vibration_pattern, wake_mode,
                 voice_profile_id, bucket_id, created_at, updated_at
                 ${cheerFieldsOf(body).length > 0 ? ', cheer_mode, cheer_pinned_content_id' : ''}
          FROM alarms WHERE id = ?`,
    args: [id],
  });
  await requestCheerSupplementAfterSave(db, {
    ownerUserId: (c.get('userIdPK') as string | undefined) || (c.get('userId') as string),
    bucketId: effectiveBucketId,
    voiceProfileId: effectiveVoiceFields.voice_profile_id,
    hasPersonalVoice: creatorHasPaidVoice && !!resolvedUserPk,
  });

  return c.json({
    success: true,
    alarm: normalizeAlarmRow(updated.rows[0] as AlarmRow),
  });
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

  // 조회와 삭제를 한 쓰기 트랜잭션으로 묶는다 — 지운 행이 가리키던 message_id 를 정확히 알아야
  // 아래에서 그 문구의 음원을 정리할 수 있다.
  let deletedAlarm: { messageId: string | null } | null;
  try {
    deletedAlarm = await withWriteTransaction(db, async (tx) => {
      const targetRes = await tx.execute({
        sql: `SELECT message_id FROM alarms
              WHERE id = ? AND user_id IN (${inPlaceholders(ownerIds)}) LIMIT 1`,
        args: [id, ...ownerIds],
      });
      if (targetRes.rows.length === 0) return null;
      const targetAlarm = typedRow<{ message_id: string | null }>(targetRes.rows[0]!);

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
