import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Client } from '@libsql/client/web';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { resolveUserPk, assertSameGroup } from '../lib/family-helpers';
import {
  familyAlarmSettingsFromRow,
  isBlockedByFamilyAlarmQuietTime,
} from '../lib/family-alarm-settings';
import { prepareAlarmTextWithVertex } from '../lib/vertex-translate';
import { inferSynthesisLanguage } from '../lib/voice-provider';
import { sendFamilyAlarmPush } from '../lib/fcm';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { enqueueExternalDeletion } from '../lib/audio-retention';
import {
  resolveEffectiveTimezone,
  computeNextAlarmFire,
  claimTargetedAlarmSlot,
  FAMILY_ALARM_MIN_LEAD_MINUTES,
} from './alarm-helpers';

const familyAlarm = new Hono<AppEnv>();

const WAKE_AT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MESSAGE_TEXT_MAX = 500;

function normalizeRepeatDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const filtered = raw
    .filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= 6)
    .sort((a, b) => a - b);
  return Array.from(new Set(filtered));
}

/**
 * 멱등 재전송으로 슬롯이 재사용될 때, 교체되어 더 이상 알람이 참조하지 않게 된 이전
 * 가족 message 행을 같은 트랜잭션에서 정리한다 — 같은 (발신자,수신자,time) 재전송마다
 * 미사용 메시지 행이 누적되는 것을 막는다. TTS·voice 두 경로 공용.
 *
 * 안전 가드:
 *  - 다른 알람이 아직 참조 중이면 보존.
 *  - 이 경로가 만든 메시지(수신자 소유 + family/family-voice 카테고리)만 삭제한다.
 *    DELETE 가드가 0행이면 연결 에셋도 건드리지 않는다.
 *  - 연결 generated_audio_assets 의 R2 오브젝트는 트랜잭션 안에서 직접 지울 수 없으므로
 *    삭제 큐(pending_external_deletions)에 적재만 한다(cron 이 실제 삭제).
 *    messages.audio_url(발신자 voice_uploads 원본 키)은 업로드 TTL 수명주기가 관리하므로
 *    여기서 건드리지 않는다.
 */
async function cleanupReplacedFamilyMessage(
  tx: DbExecutor,
  previousMessageId: string | null,
  newMessageId: string,
  recipientPk: string,
): Promise<void> {
  if (!previousMessageId || previousMessageId === newMessageId) return;
  const refs = await tx.execute({
    sql: `SELECT (SELECT COUNT(*) FROM alarms WHERE message_id = ?) AS alarm_refs`,
    args: [previousMessageId],
  });
  const refRow = refs.rows[0];
  if (!refRow || Number(refRow.alarm_refs ?? 0) > 0) return;
  const deleted = await tx.execute({
    sql: `DELETE FROM messages
          WHERE id = ? AND user_id = ? AND category IN ('family', 'family-voice')`,
    args: [previousMessageId, recipientPk],
  });
  if ((deleted.rowsAffected ?? 0) === 0) return;
  const assets = await tx.execute({
    sql: `SELECT audio_object_key FROM generated_audio_assets
          WHERE message_id = ? AND audio_object_key IS NOT NULL`,
    args: [previousMessageId],
  });
  for (const asset of assets.rows) {
    await enqueueExternalDeletion(tx, 'r2_object', asset.audio_object_key as string | null);
  }
  await tx.execute({
    sql: `DELETE FROM generated_audio_assets WHERE message_id = ?`,
    args: [previousMessageId],
  });
}

// 가족 알람 생성 시 수신자에게 즉시 data-only push — 앱이 백그라운드여도 onMessageReceived 가 바로
// pull 해 로컬 스케줄+알림(notifyReceivedAlarm)을 그린다. 논블로킹(waitUntil), 실패해도 15분 주기 pull
// 폴백. recipient.id=users.id(PK) 로 타깃(push_tokens.user_id FK 정합). executionCtx 가 없는
// 컨텍스트(테스트 등)에선 c.executionCtx 접근이 던지므로 try 로 감싸 push 를 생략한다(그 경우
// sendFamilyAlarmPush 자체가 호출되지 않아 mock DB FIFO 순서도 밀리지 않는다).
function notifyRecipientOfFamilyAlarm(
  c: Context<AppEnv>,
  db: Client,
  recipient: Record<string, unknown>,
  alarmId: string,
): void {
  try {
    c.executionCtx.waitUntil(
      sendFamilyAlarmPush(db, c.env, String(recipient.id), alarmId).catch(() => {}),
    );
  } catch {
    // executionCtx 없음(비-fetch/테스트) → push 생략, 15분 주기 pull 폴백.
  }
}

familyAlarm.post('/alarms', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  type AlarmBody = {
    recipient_user_id?: unknown;
    wake_at?: unknown;
    message_text?: unknown;
    repeat_days?: unknown;
    voice_profile_id?: unknown;
    /** 발신 클라가 보내는 값이지만 서버는 검증·저장 어디에도 쓰지 않는다(무시) —
     *  발신자 기기 값이라 신뢰 불가. 효과 시간대는 수신자 최근 알람 tz → Asia/Seoul. */
    timezone?: unknown;
  };
  const body: AlarmBody = await c.req.json<AlarmBody>().catch(() => ({}) as AlarmBody);

  const recipientPk =
    typeof body.recipient_user_id === 'string' ? body.recipient_user_id.trim() : '';
  const wakeAt = typeof body.wake_at === 'string' ? body.wake_at.trim() : '';
  const messageText = typeof body.message_text === 'string' ? body.message_text.trim() : '';

  if (!recipientPk) {
    return c.json(
      { error: 'recipient_user_id 가 필요합니다', error_code: 'RECIPIENT_REQUIRED' },
      400,
    );
  }
  if (!WAKE_AT_RE.test(wakeAt)) {
    return c.json(
      { error: 'wake_at 는 HH:mm 형식이어야 합니다', error_code: 'INVALID_WAKE_AT' },
      400,
    );
  }
  if (messageText.length === 0) {
    return c.json(
      { error: 'message_text 가 비어있습니다', error_code: 'MESSAGE_TEXT_REQUIRED' },
      400,
    );
  }
  if (messageText.length > MESSAGE_TEXT_MAX) {
    return c.json(
      {
        error: `message_text 는 ${MESSAGE_TEXT_MAX}자 이하여야 합니다`,
        error_code: 'MESSAGE_TEXT_TOO_LONG',
      },
      400,
    );
  }

  const senderPk = await resolveUserPk(db, userId);
  if (!senderPk)
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  if (senderPk === recipientPk) {
    return c.json(
      { error: '자기 자신에게는 가족 알람을 보낼 수 없습니다', error_code: 'SELF_ALARM' },
      400,
    );
  }

  const inSameGroup = await assertSameGroup(db, senderPk, recipientPk);
  if (!inSameGroup) {
    return c.json({ error: '같은 가족 그룹의 멤버가 아닙니다', error_code: 'NOT_SAME_GROUP' }, 403);
  }

  const recipientRes = await db.execute({
    sql: `SELECT id, google_id, allow_family_alarms,
                 family_alarm_quiet_windows
          FROM users WHERE id = ?`,
    args: [recipientPk],
  });
  if (recipientRes.rows.length === 0) {
    return c.json({ error: '수신자를 찾을 수 없습니다', error_code: 'RECIPIENT_NOT_FOUND' }, 404);
  }
  const recipient = recipientRes.rows[0]!;
  const recipientSettings = familyAlarmSettingsFromRow(recipient as Record<string, unknown>);
  if (!recipientSettings.allowFamilyAlarms) {
    return c.json(
      { error: '수신자가 가족 알람을 허용하지 않았습니다', error_code: 'FAMILY_ALARM_DISABLED' },
      403,
    );
  }
  // 읽기(기존 행 매칭)용 보조 식별자. 저장은 항상 users.id(recipientPk) 로 한다 —
  // JWT sub 이 users.id 로 통일돼, google_id 로 저장하면 수신자가 자기 알람을 못 본다.
  const recipientLegacyId = (recipient.google_id as string | null) ?? String(recipient.id);
  const repeatDays = normalizeRepeatDays(body.repeat_days);
  // 수신자 시간대 기준 서버 검증: 효과 시간대(수신자 최근 알람 tz → Asia/Seoul)로 다음
  // 발사 시각을 구해 30분 리드타임과 quiet 요일을 판정한다. 발신자 body.timezone 은
  // 판정·저장 어디에도 쓰지 않는다(우회 차단 — resolveEffectiveTimezone 주석 참고).
  const effectiveTimezone = await resolveEffectiveTimezone(db, [recipientPk, recipientLegacyId]);
  const nextFire = computeNextAlarmFire(wakeAt, repeatDays, effectiveTimezone);
  if (
    nextFire &&
    nextFire.fireAt.getTime() - Date.now() < FAMILY_ALARM_MIN_LEAD_MINUTES * 60_000
  ) {
    return c.json(
      {
        error: `알람은 최소 ${FAMILY_ALARM_MIN_LEAD_MINUTES}분 이후 시각으로만 보낼 수 있습니다`,
        error_code: 'FAMILY_ALARM_LEAD_TIME',
      },
      400,
    );
  }
  if (
    isBlockedByFamilyAlarmQuietTime(
      wakeAt,
      repeatDays,
      recipientSettings,
      nextFire?.fireDayOfWeek ?? new Date().getDay(),
    )
  ) {
    return c.json(
      {
        error: '수신자가 설정한 불가 시간에는 알람을 만들 수 없습니다',
        error_code: 'FAMILY_ALARM_QUIET_TIME',
      },
      403,
    );
  }

  let voiceProfileId =
    typeof body.voice_profile_id === 'string' ? body.voice_profile_id.trim() : '';
  if (voiceProfileId) {
    const owned = await db.execute({
      sql: `SELECT id FROM voice_profiles
            WHERE id = ? AND user_id = ? AND deleted_at IS NULL
              AND status = 'ready' AND COALESCE(is_draft, 0) = 0`,
      args: [voiceProfileId, recipientPk],
    });
    if (owned.rows.length === 0) {
      return c.json(
        { error: '지정한 voice_profile 이 수신자 소유가 아닙니다', error_code: 'VOICE_NOT_OWNED' },
        400,
      );
    }
  } else {
    const latest = await db.execute({
      sql: `SELECT id FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL
              AND status = 'ready' AND COALESCE(is_draft, 0) = 0
            ORDER BY created_at DESC LIMIT 1`,
      args: [recipientPk],
    });
    if (latest.rows.length === 0) {
      return c.json(
        { error: '수신자의 음성 프로필이 없습니다', error_code: 'NO_VOICE_PROFILE' },
        400,
      );
    }
    voiceProfileId = String(latest.rows[0]!.id);
  }

  const messageId = crypto.randomUUID();
  const newAlarmId = crypto.randomUUID();
  const messageLanguage = inferSynthesisLanguage(messageText, 'ko');
  const preparedMessage = await prepareAlarmTextWithVertex(c.env, messageText, {
    targetLanguage: messageLanguage,
    sourceLanguage: messageLanguage,
    translate: false,
    autoTag: true,
  });

  // 메시지 insert + (수신자, time) 슬롯 점유를 한 트랜잭션으로: 같은 발신자의 재전송은
  // 기존 알람 행을 새 메시지로 UPDATE(멱등, id 유지)하고 교체된 이전 message 행을 정리,
  // 다른 발신자의 같은 시각 발신 알람은 비활성화(최신 우선). 수신자 본인 알람(target 없음)은
  // 서버가 건드리지 않는다 — 클라 로컬 교체 확인창 담당(claimTargetedAlarmSlot 주석 참고).
  // timezone 은 검증에 쓴 효과 시간대를 그대로 저장한다 — cron 스케줄러가 검증과 같은
  // 시간대로 알람 HH:mm 을 해석한다.
  const alarmId = await withWriteTransaction(db, async (tx) => {
    await tx.execute({
      sql: `INSERT INTO messages
            (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json, audio_url, category)
            VALUES (?, ?, ?, ?, ?, ?, NULL, 'family')`,
      args: [
        messageId,
        recipientPk,
        voiceProfileId,
        messageText,
        preparedMessage.text,
        JSON.stringify(preparedMessage.tags),
      ],
    });
    const claimed = await claimTargetedAlarmSlot(
      tx,
      userId,
      [recipientPk, recipientLegacyId],
      wakeAt,
      newAlarmId,
    );
    if (claimed.reused) {
      await tx.execute({
        sql: `UPDATE alarms SET message_id = ?, repeat_days = ?, mode = 'tts', timezone = ?,
                is_active = 1, updated_at = datetime('now')
              WHERE id = ?`,
        args: [messageId, JSON.stringify(repeatDays), effectiveTimezone, claimed.alarmId],
      });
      // 재전송으로 교체돼 고아가 된 이전 message 행을 같은 트랜잭션에서 정리(누적 방지).
      await cleanupReplacedFamilyMessage(tx, claimed.previousMessageId, messageId, recipientPk);
    } else {
      await tx.execute({
        sql: `INSERT INTO alarms
              (id, user_id, target_user_id, message_id, time, repeat_days, mode, timezone)
              VALUES (?, ?, ?, ?, ?, ?, 'tts', ?)`,
        args: [
          claimed.alarmId,
          userId,
          recipientPk,
          messageId,
          wakeAt,
          JSON.stringify(repeatDays),
          effectiveTimezone,
        ],
      });
    }
    return claimed.alarmId;
  });

  notifyRecipientOfFamilyAlarm(c, db, recipient, alarmId);

  return c.json(
    {
      alarm: {
        id: alarmId,
        sender_user_id: senderPk,
        recipient_user_id: recipientPk,
        wake_at: wakeAt,
        repeat_days: repeatDays,
        mode: 'tts',
        voice_profile_id: voiceProfileId,
      },
      message: {
        id: messageId,
        text: messageText,
        synthesis_text: preparedMessage.text,
        tags: preparedMessage.tags,
        category: 'family',
      },
    },
    201,
  );
});

const LABEL_MAX = 200;
const DEFAULT_VOICE_LABEL = '가족이 보낸 음성';

familyAlarm.post('/alarms/voice', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  type VoiceBody = {
    recipient_user_id?: unknown;
    wake_at?: unknown;
    voice_upload_id?: unknown;
    label?: unknown;
    repeat_days?: unknown;
    /** 발신 클라가 보내는 값이지만 서버는 검증·저장 어디에도 쓰지 않는다(무시) —
     *  발신자 기기 값이라 신뢰 불가. 효과 시간대는 수신자 최근 알람 tz → Asia/Seoul. */
    timezone?: unknown;
  };
  const body: VoiceBody = await c.req.json<VoiceBody>().catch(() => ({}) as VoiceBody);

  const recipientPk =
    typeof body.recipient_user_id === 'string' ? body.recipient_user_id.trim() : '';
  const wakeAt = typeof body.wake_at === 'string' ? body.wake_at.trim() : '';
  const voiceUploadId = typeof body.voice_upload_id === 'string' ? body.voice_upload_id.trim() : '';

  if (!recipientPk) {
    return c.json(
      { error: 'recipient_user_id 가 필요합니다', error_code: 'RECIPIENT_REQUIRED' },
      400,
    );
  }
  if (!WAKE_AT_RE.test(wakeAt)) {
    return c.json(
      { error: 'wake_at 는 HH:mm 형식이어야 합니다', error_code: 'INVALID_WAKE_AT' },
      400,
    );
  }
  if (!voiceUploadId) {
    return c.json(
      { error: 'voice_upload_id 가 필요합니다', error_code: 'VOICE_UPLOAD_REQUIRED' },
      400,
    );
  }

  const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
  if (rawLabel.length > LABEL_MAX) {
    return c.json(
      { error: `label 은 ${LABEL_MAX}자 이하여야 합니다`, error_code: 'LABEL_TOO_LONG' },
      400,
    );
  }
  const label = rawLabel.length > 0 ? rawLabel : DEFAULT_VOICE_LABEL;

  const senderPk = await resolveUserPk(db, userId);
  if (!senderPk)
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  if (senderPk === recipientPk) {
    return c.json(
      { error: '자기 자신에게는 가족 알람을 보낼 수 없습니다', error_code: 'SELF_ALARM' },
      400,
    );
  }

  const inSameGroup = await assertSameGroup(db, senderPk, recipientPk);
  if (!inSameGroup) {
    return c.json({ error: '같은 가족 그룹의 멤버가 아닙니다', error_code: 'NOT_SAME_GROUP' }, 403);
  }

  const recipientRes = await db.execute({
    sql: `SELECT id, google_id, allow_family_alarms,
                 family_alarm_quiet_windows
          FROM users WHERE id = ?`,
    args: [recipientPk],
  });
  if (recipientRes.rows.length === 0) {
    return c.json({ error: '수신자를 찾을 수 없습니다', error_code: 'RECIPIENT_NOT_FOUND' }, 404);
  }
  const recipient = recipientRes.rows[0]!;
  const recipientSettings = familyAlarmSettingsFromRow(recipient as Record<string, unknown>);
  if (!recipientSettings.allowFamilyAlarms) {
    return c.json(
      { error: '수신자가 가족 알람을 허용하지 않았습니다', error_code: 'FAMILY_ALARM_DISABLED' },
      403,
    );
  }
  // 읽기(기존 행 매칭)용 보조 식별자. 저장은 항상 users.id(recipientPk) 로 한다 —
  // JWT sub 이 users.id 로 통일돼, google_id 로 저장하면 수신자가 자기 알람을 못 본다.
  const recipientLegacyId = (recipient.google_id as string | null) ?? String(recipient.id);
  const repeatDays = normalizeRepeatDays(body.repeat_days);
  // 수신자 시간대 기준 서버 검증 — TTS 경로와 동일(30분 리드타임 + quiet 요일).
  // 발신자 body.timezone 은 판정·저장 어디에도 쓰지 않는다(우회 차단).
  const effectiveTimezone = await resolveEffectiveTimezone(db, [recipientPk, recipientLegacyId]);
  const nextFire = computeNextAlarmFire(wakeAt, repeatDays, effectiveTimezone);
  if (
    nextFire &&
    nextFire.fireAt.getTime() - Date.now() < FAMILY_ALARM_MIN_LEAD_MINUTES * 60_000
  ) {
    return c.json(
      {
        error: `알람은 최소 ${FAMILY_ALARM_MIN_LEAD_MINUTES}분 이후 시각으로만 보낼 수 있습니다`,
        error_code: 'FAMILY_ALARM_LEAD_TIME',
      },
      400,
    );
  }
  if (
    isBlockedByFamilyAlarmQuietTime(
      wakeAt,
      repeatDays,
      recipientSettings,
      nextFire?.fireDayOfWeek ?? new Date().getDay(),
    )
  ) {
    return c.json(
      {
        error: '수신자가 설정한 불가 시간에는 알람을 만들 수 없습니다',
        error_code: 'FAMILY_ALARM_QUIET_TIME',
      },
      403,
    );
  }

  const uploadRes = await db.execute({
    sql: `SELECT id, user_id, object_key FROM voice_uploads WHERE id = ?`,
    args: [voiceUploadId],
  });
  if (uploadRes.rows.length === 0) {
    return c.json({ error: '음성 업로드를 찾을 수 없습니다', error_code: 'UPLOAD_NOT_FOUND' }, 400);
  }
  if (String(uploadRes.rows[0]!.user_id) !== senderPk) {
    return c.json({ error: '업로드 소유자가 아닙니다', error_code: 'NOT_UPLOAD_OWNER' }, 400);
  }
  const objectKey = String(uploadRes.rows[0]!.object_key);

  const latestVp = await db.execute({
    sql: `SELECT id FROM voice_profiles WHERE user_id = ? AND deleted_at IS NULL
            AND status = 'ready' AND COALESCE(is_draft, 0) = 0
          ORDER BY created_at DESC LIMIT 1`,
    args: [recipientPk],
  });
  if (latestVp.rows.length === 0) {
    return c.json(
      { error: '수신자의 음성 프로필이 없습니다', error_code: 'NO_VOICE_PROFILE' },
      400,
    );
  }
  const voiceProfileId = String(latestVp.rows[0]!.id);

  const messageId = crypto.randomUUID();
  const newAlarmId = crypto.randomUUID();
  const audioUrl = objectKey;

  // TTS 경로와 동일한 원자 교체: 같은 발신자 재전송은 기존 행 UPDATE(멱등, id 유지) +
  // 교체된 이전 message 정리, 다른 발신자의 같은 시각 발신 알람은 비활성화. 수신자 본인
  // 알람은 건드리지 않는다. timezone 은 검증에 쓴 효과 시간대를 그대로 저장한다.
  const alarmId = await withWriteTransaction(db, async (tx) => {
    await tx.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
            VALUES (?, ?, ?, ?, ?, 'family-voice')`,
      args: [messageId, recipientPk, voiceProfileId, label, audioUrl],
    });
    const claimed = await claimTargetedAlarmSlot(
      tx,
      userId,
      [recipientPk, recipientLegacyId],
      wakeAt,
      newAlarmId,
    );
    if (claimed.reused) {
      await tx.execute({
        sql: `UPDATE alarms SET message_id = ?, repeat_days = ?, mode = 'sound-only', timezone = ?,
                is_active = 1, updated_at = datetime('now')
              WHERE id = ?`,
        args: [messageId, JSON.stringify(repeatDays), effectiveTimezone, claimed.alarmId],
      });
      // 재전송으로 교체돼 고아가 된 이전 message 행을 같은 트랜잭션에서 정리(누적 방지).
      await cleanupReplacedFamilyMessage(tx, claimed.previousMessageId, messageId, recipientPk);
    } else {
      await tx.execute({
        sql: `INSERT INTO alarms
              (id, user_id, target_user_id, message_id, time, repeat_days, mode, timezone)
              VALUES (?, ?, ?, ?, ?, ?, 'sound-only', ?)`,
        args: [
          claimed.alarmId,
          userId,
          recipientPk,
          messageId,
          wakeAt,
          JSON.stringify(repeatDays),
          effectiveTimezone,
        ],
      });
    }
    return claimed.alarmId;
  });

  // 수신자 push 는 반드시 커밋 후에 실행한다 — 롤백될 수 있는 알람을 미리 알리지 않는다.
  notifyRecipientOfFamilyAlarm(c, db, recipient, alarmId);

  return c.json(
    {
      alarm: {
        id: alarmId,
        sender_user_id: senderPk,
        recipient_user_id: recipientPk,
        wake_at: wakeAt,
        repeat_days: repeatDays,
        mode: 'sound-only',
        voice_upload_id: voiceUploadId,
      },
      message: {
        id: messageId,
        text: label,
        category: 'family-voice',
        audio_url: audioUrl,
      },
    },
    201,
  );
});

export default familyAlarm;
