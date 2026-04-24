import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { resolveUserPk, assertSameGroup } from '../lib/family-helpers';

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

familyAlarm.post('/alarms', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  type AlarmBody = {
    recipient_user_id?: unknown;
    wake_at?: unknown;
    message_text?: unknown;
    repeat_days?: unknown;
    voice_profile_id?: unknown;
  };
  const body: AlarmBody = await c.req.json<AlarmBody>().catch(() => ({}) as AlarmBody);

  const recipientPk =
    typeof body.recipient_user_id === 'string' ? body.recipient_user_id.trim() : '';
  const wakeAt = typeof body.wake_at === 'string' ? body.wake_at.trim() : '';
  const messageText =
    typeof body.message_text === 'string' ? body.message_text.trim() : '';

  if (!recipientPk) {
    return c.json({ error: 'recipient_user_id 가 필요합니다', error_code: 'RECIPIENT_REQUIRED' }, 400);
  }
  if (!WAKE_AT_RE.test(wakeAt)) {
    return c.json({ error: 'wake_at 는 HH:mm 형식이어야 합니다', error_code: 'INVALID_WAKE_AT' }, 400);
  }
  if (messageText.length === 0) {
    return c.json({ error: 'message_text 가 비어있습니다', error_code: 'MESSAGE_TEXT_REQUIRED' }, 400);
  }
  if (messageText.length > MESSAGE_TEXT_MAX) {
    return c.json({ error: `message_text 는 ${MESSAGE_TEXT_MAX}자 이하여야 합니다`, error_code: 'MESSAGE_TEXT_TOO_LONG' }, 400);
  }

  const senderPk = await resolveUserPk(db, userId);
  if (!senderPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  if (senderPk === recipientPk) {
    return c.json({ error: '자기 자신에게는 가족 알람을 보낼 수 없습니다', error_code: 'SELF_ALARM' }, 400);
  }

  const inSameGroup = await assertSameGroup(db, senderPk, recipientPk);
  if (!inSameGroup) {
    return c.json({ error: '같은 가족 그룹의 멤버가 아닙니다', error_code: 'NOT_SAME_GROUP' }, 403);
  }

  const recipientRes = await db.execute({
    sql: `SELECT id, google_id, allow_family_alarms FROM users WHERE id = ?`,
    args: [recipientPk],
  });
  if (recipientRes.rows.length === 0) {
    return c.json({ error: '수신자를 찾을 수 없습니다', error_code: 'RECIPIENT_NOT_FOUND' }, 404);
  }
  const recipient = recipientRes.rows[0]!;
  if (Number(recipient.allow_family_alarms ?? 0) !== 1) {
    return c.json({ error: '수신자가 가족 알람을 허용하지 않았습니다', error_code: 'FAMILY_ALARM_DISABLED' }, 403);
  }

  let voiceProfileId =
    typeof body.voice_profile_id === 'string' ? body.voice_profile_id.trim() : '';
  if (voiceProfileId) {
    const owned = await db.execute({
      sql: `SELECT id FROM voice_profiles WHERE id = ? AND user_id = ?`,
      args: [voiceProfileId, recipientPk],
    });
    if (owned.rows.length === 0) {
      return c.json({ error: '지정한 voice_profile 이 수신자 소유가 아닙니다', error_code: 'VOICE_NOT_OWNED' }, 400);
    }
  } else {
    const latest = await db.execute({
      sql: `SELECT id FROM voice_profiles WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [recipientPk],
    });
    if (latest.rows.length === 0) {
      return c.json({ error: '수신자의 음성 프로필이 없습니다', error_code: 'NO_VOICE_PROFILE' }, 400);
    }
    voiceProfileId = String(latest.rows[0]!.id);
  }

  const repeatDays = normalizeRepeatDays(body.repeat_days);
  const messageId = crypto.randomUUID();
  const alarmId = crypto.randomUUID();

  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
          VALUES (?, ?, ?, ?, NULL, 'family')`,
    args: [messageId, recipientPk, voiceProfileId, messageText],
  });

  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, repeat_days, mode)
          VALUES (?, ?, ?, ?, ?, ?, 'tts')`,
    args: [
      alarmId,
      userId,
      String(recipient.google_id),
      messageId,
      wakeAt,
      JSON.stringify(repeatDays),
    ],
  });

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
      message: { id: messageId, text: messageText, category: 'family' },
    },
    201,
  );
});

const DUB_LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
type DubLanguage = (typeof DUB_LANGUAGES)[number];
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
    dub_target_language?: unknown;
    repeat_days?: unknown;
  };
  const body: VoiceBody = await c.req.json<VoiceBody>().catch(() => ({}) as VoiceBody);

  const recipientPk =
    typeof body.recipient_user_id === 'string' ? body.recipient_user_id.trim() : '';
  const wakeAt = typeof body.wake_at === 'string' ? body.wake_at.trim() : '';
  const voiceUploadId =
    typeof body.voice_upload_id === 'string' ? body.voice_upload_id.trim() : '';

  if (!recipientPk) {
    return c.json({ error: 'recipient_user_id 가 필요합니다', error_code: 'RECIPIENT_REQUIRED' }, 400);
  }
  if (!WAKE_AT_RE.test(wakeAt)) {
    return c.json({ error: 'wake_at 는 HH:mm 형식이어야 합니다', error_code: 'INVALID_WAKE_AT' }, 400);
  }
  if (!voiceUploadId) {
    return c.json({ error: 'voice_upload_id 가 필요합니다', error_code: 'VOICE_UPLOAD_REQUIRED' }, 400);
  }

  const rawLabel = typeof body.label === 'string' ? body.label.trim() : '';
  if (rawLabel.length > LABEL_MAX) {
    return c.json({ error: `label 은 ${LABEL_MAX}자 이하여야 합니다`, error_code: 'LABEL_TOO_LONG' }, 400);
  }
  const label = rawLabel.length > 0 ? rawLabel : DEFAULT_VOICE_LABEL;

  let dubTarget: DubLanguage | null = null;
  if (body.dub_target_language !== undefined && body.dub_target_language !== null) {
    const raw = typeof body.dub_target_language === 'string' ? body.dub_target_language : '';
    if (!DUB_LANGUAGES.includes(raw as DubLanguage)) {
      return c.json(
        { error: `dub_target_language 는 ${DUB_LANGUAGES.join('|')} 중 하나여야 합니다`, error_code: 'INVALID_DUB_LANGUAGE' },
        400,
      );
    }
    dubTarget = raw as DubLanguage;
  }

  const senderPk = await resolveUserPk(db, userId);
  if (!senderPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  if (senderPk === recipientPk) {
    return c.json({ error: '자기 자신에게는 가족 알람을 보낼 수 없습니다', error_code: 'SELF_ALARM' }, 400);
  }

  const inSameGroup = await assertSameGroup(db, senderPk, recipientPk);
  if (!inSameGroup) {
    return c.json({ error: '같은 가족 그룹의 멤버가 아닙니다', error_code: 'NOT_SAME_GROUP' }, 403);
  }

  const recipientRes = await db.execute({
    sql: `SELECT id, google_id, allow_family_alarms FROM users WHERE id = ?`,
    args: [recipientPk],
  });
  if (recipientRes.rows.length === 0) {
    return c.json({ error: '수신자를 찾을 수 없습니다', error_code: 'RECIPIENT_NOT_FOUND' }, 404);
  }
  const recipient = recipientRes.rows[0]!;
  if (Number(recipient.allow_family_alarms ?? 0) !== 1) {
    return c.json({ error: '수신자가 가족 알람을 허용하지 않았습니다', error_code: 'FAMILY_ALARM_DISABLED' }, 403);
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
    sql: `SELECT id FROM voice_profiles WHERE user_id = ?
          ORDER BY created_at DESC LIMIT 1`,
    args: [recipientPk],
  });
  if (latestVp.rows.length === 0) {
    return c.json({ error: '수신자의 음성 프로필이 없습니다', error_code: 'NO_VOICE_PROFILE' }, 400);
  }
  const voiceProfileId = String(latestVp.rows[0]!.id);

  const repeatDays = normalizeRepeatDays(body.repeat_days);
  const messageId = crypto.randomUUID();
  const alarmId = crypto.randomUUID();
  const audioUrl = dubTarget ? null : objectKey;

  await db.execute({
    sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
          VALUES (?, ?, ?, ?, ?, 'family-voice')`,
    args: [messageId, recipientPk, voiceProfileId, label, audioUrl],
  });

  await db.execute({
    sql: `INSERT INTO alarms (id, user_id, target_user_id, message_id, time, repeat_days, mode)
          VALUES (?, ?, ?, ?, ?, ?, 'sound-only')`,
    args: [
      alarmId,
      userId,
      String(recipient.google_id),
      messageId,
      wakeAt,
      JSON.stringify(repeatDays),
    ],
  });

  let dubJob: { id: string; target_language: DubLanguage; status: 'processing' } | null = null;
  if (dubTarget) {
    const dubJobId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO dub_jobs (id, user_id, source_language, target_language, status, result_message_id)
            VALUES (?, ?, ?, ?, 'processing', ?)`,
      args: [dubJobId, userId, 'auto', dubTarget, messageId],
    });
    dubJob = { id: dubJobId, target_language: dubTarget, status: 'processing' };
  }

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
      dub_job: dubJob,
    },
    201,
  );
});

export default familyAlarm;
