import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';

const tts = new Hono<AppEnv>();

/** TTS 생성 - 텍스트를 클론된 음성으로 변환 */
tts.post('/generate', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req.json<{
    voice_profile_id: string;
    text: string;
    category?: string;
  }>();

  if (!body.voice_profile_id || !body.text) {
    return c.json({ error: 'voice_profile_id and text are required', error_code: 'VOICE_AND_TEXT_REQUIRED' }, 400);
  }

  if (!UUID_RE.test(body.voice_profile_id)) {
    return c.json({ error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  if (body.text.length > 200) {
    return c.json({ error: 'Text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' }, 400);
  }

  const validCategories = [
    'morning',
    'lunch',
    'afternoon',
    'evening',
    'night',
    'cheer',
    'love',
    'health',
    'custom',
  ];
  if (body.category && !validCategories.includes(body.category)) {
    return c.json(
      { error: `Invalid category. Must be one of: ${validCategories.join(', ')}`, error_code: 'INVALID_CATEGORY' },
      400,
    );
  }

  // 사용량 체크
  const user = await db.execute({
    sql: 'SELECT * FROM users WHERE google_id = ?',
    args: [userId],
  });

  if (user.rows.length > 0) {
    const u = user.rows[0];
    const plan = u.plan as string;
    const today = new Date().toISOString().split('T')[0];

    // 일일 리셋
    if (u.daily_tts_reset_at !== today) {
      await db.execute({
        sql: `UPDATE users SET daily_tts_count = 0, daily_tts_reset_at = ? WHERE google_id = ?`,
        args: [today, userId],
      });
    } else {
      const count = Number(u.daily_tts_count);
      const limits: Record<string, number> = { free: 3, plus: 9999, family: 9999 };
      if (count >= (limits[plan] ?? 3)) {
        return c.json(
          {
            error: '오늘의 TTS 생성 횟수를 초과했습니다. 업그레이드하면 무제한으로 사용 가능해요!',
            error_code: 'DAILY_TTS_LIMIT_EXCEEDED',
          },
          429,
        );
      }
    }
  }

  // 음성 프로필 조회
  const profile = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [body.voice_profile_id, userId],
  });

  if (profile.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const vp = profile.rows[0];
  if (vp.status !== 'ready') {
    return c.json({ error: 'Voice profile is not ready yet', error_code: 'VOICE_PROFILE_NOT_READY' }, 400);
  }

  try {
    if (!vp.elevenlabs_voice_id) {
      return c.json({ error: 'No voice ID available for this profile', error_code: 'NO_VOICE_ID' }, 400);
    }

    const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
    const audioBuffer = await client.textToSpeech(vp.elevenlabs_voice_id as string, body.text);

    // 메시지 DB 저장
    const messageId = crypto.randomUUID();
    await db.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category)
            VALUES (?, ?, ?, ?, ?)`,
      args: [messageId, userId, body.voice_profile_id, body.text, body.category ?? 'custom'],
    });

    // 사용량 증가
    await db.execute({
      sql: `UPDATE users SET daily_tts_count = daily_tts_count + 1 WHERE google_id = ?`,
      args: [userId],
    });

    // 라이브러리에도 추가
    await db.execute({
      sql: `INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)`,
      args: [crypto.randomUUID(), userId, messageId],
    });

    // 오디오 데이터를 base64로 반환 (클라이언트에서 로컬 저장)
    const bytes = new Uint8Array(audioBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Audio = btoa(binary);

    return c.json(
      {
        message_id: messageId,
        audio_base64: base64Audio,
        audio_format: 'mp3',
        text: body.text,
        voice_profile_id: body.voice_profile_id,
      },
      201,
    );
  } catch (err) {
    return c.json(
      {
        error: 'TTS generation failed',
        error_code: 'TTS_GENERATION_FAILED',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

/** 메시지 목록 조회 */
tts.get('/messages', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const category = c.req.query('category');
  const voiceProfileId = c.req.query('voice_profile_id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  let whereClause = 'WHERE m.user_id = ?';
  const filterArgs: (string | number)[] = [userId];

  if (category) {
    whereClause += ' AND m.category = ?';
    filterArgs.push(category);
  }

  if (voiceProfileId) {
    if (!UUID_RE.test(voiceProfileId)) {
      return c.json({ error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
    }
    whereClause += ' AND m.voice_profile_id = ?';
    filterArgs.push(voiceProfileId);
  }

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM messages m ${whereClause}`,
      args: filterArgs,
    }),
    db.execute({
      sql: `SELECT m.*, vp.name as voice_name
            FROM messages m
            JOIN voice_profiles vp ON m.voice_profile_id = vp.id
            ${whereClause}
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?`,
      args: [...filterArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0].total);
  return c.json({ messages: result.rows, total, limit, offset });
});

/** 메시지 삭제 */
tts.delete('/messages/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid message ID format', error_code: 'INVALID_MESSAGE_ID' }, 400);
  }

  const alarmCheck = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM alarms WHERE message_id = ?',
    args: [id],
  });
  const alarmCount = Number(typedRow<{ cnt: number }>(alarmCheck.rows[0]).cnt ?? 0);

  if (alarmCount > 0 && c.req.query('force') !== 'true') {
    return c.json({
      warning: true,
      error_code: 'MESSAGE_IN_USE',
      alarm_count: alarmCount,
      message: `This message is used by ${alarmCount} alarm(s). Add ?force=true to delete anyway.`,
    }, 409);
  }

  await db.execute({
    sql: 'DELETE FROM message_library WHERE message_id = ? AND user_id = ?',
    args: [id, userId],
  });

  const result = await db.execute({
    sql: 'DELETE FROM messages WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rowsAffected === 0) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  return c.json({ ok: true, alarms_affected: alarmCount });
});

/** 프리셋 메시지 목록 */
tts.get('/presets', async (c) => {
  const { PRESETS } = await import('../data/presets');
  return c.json({ presets: PRESETS });
});

export default tts;
