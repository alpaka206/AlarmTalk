import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { R2VoiceStorage } from '../lib/r2-storage';
import { computeTtsCacheKey, generatedTtsObjectKey } from '../lib/audio-cache';
import { loadAudioBytes, uint8ToBase64 } from '../lib/audio-loader';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import {
  createSynthesisAttempts,
  inferSynthesisLanguage,
  noVoiceProviderError,
  normalizeSynthesisLanguage,
  UnsupportedVoiceProviderError,
} from '../lib/voice-provider';
import {
  AlarmTextTranslationUnavailableError,
  prepareAlarmTextWithVertex,
} from '../lib/vertex-translate';
import { loadTtsPresets, type TtsPreset } from '../lib/tts-presets';
import { isPaidVoicePlan } from './billing-helpers';

const tts = new Hono<AppEnv>();
const TTS_CATEGORIES = [
  'morning',
  'lunch',
  'evening',
  'night',
  'health',
  'study',
  'cheer',
  'love',
  'custom',
] as const;

const LEGACY_TTS_CATEGORY_ALIASES: Record<string, (typeof TTS_CATEGORIES)[number]> = {
  afternoon: 'cheer',
  sleep: 'night',
  medicine: 'health',
};

function normalizeTtsCategory(category: string): (typeof TTS_CATEGORIES)[number] | null {
  const raw = category.trim();
  if ((TTS_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as (typeof TTS_CATEGORIES)[number];
  }
  return LEGACY_TTS_CATEGORY_ALIASES[raw] ?? null;
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]! % length;
}

async function pickRandomPresetText(
  env: AppEnv['Bindings'],
  category: string,
): Promise<string | null> {
  const presets: TtsPreset[] = await loadTtsPresets(env);
  const preset = presets.find((item) => item.category === category);
  const messages = preset?.messages.map((message) => message.trim()).filter(Boolean) ?? [];
  if (messages.length === 0) return null;
  return messages[randomIndex(messages.length)]!;
}

async function findUsableVoiceProfile(
  db: ReturnType<typeof getDB>,
  userId: string,
  userPk: string,
  voiceProfileId: string,
): Promise<Record<string, unknown> | null> {
  const owned = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL',
    args: [voiceProfileId, userPk, userId],
  });
  if (owned.rows.length > 0) return owned.rows[0] as Record<string, unknown>;

  const shared = await db.execute({
    sql: `SELECT vp.*, u.id AS owner_pk
          FROM voice_profiles vp
          LEFT JOIN users u ON u.google_id = vp.user_id OR u.id = vp.user_id
          WHERE vp.id = ? AND COALESCE(vp.is_shared, 0) = 1
            AND vp.deleted_at IS NULL
          LIMIT 1`,
    args: [voiceProfileId],
  });
  if (shared.rows.length === 0) return null;

  const row = shared.rows[0] as Record<string, unknown>;
  const viewerPk = userPk || (await resolveUserPk(db, userId));
  const ownerPk = typeof row.owner_pk === 'string' ? row.owner_pk : null;
  if (!viewerPk || !ownerPk || viewerPk === ownerPk) return null;

  const inSameGroup = await assertSameGroup(db, viewerPk, ownerPk);
  return inSameGroup ? row : null;
}

tts.post('/generate', async (c) => {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);

  const body = await c.req.json<{
    voice_profile_id: string;
    text?: string;
    category?: string;
    language?: string;
    translate?: boolean;
    random?: boolean;
  }>();

  if (!body.voice_profile_id) {
    return c.json(
      { error: 'voice_profile_id and text are required', error_code: 'VOICE_AND_TEXT_REQUIRED' },
      400,
    );
  }

  if (!UUID_RE.test(body.voice_profile_id)) {
    return c.json(
      { error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const category = normalizeTtsCategory(body.category ?? 'custom');
  if (!category) {
    return c.json(
      {
        error: `Invalid category. Must be one of: ${TTS_CATEGORIES.join(', ')}`,
        error_code: 'INVALID_CATEGORY',
      },
      400,
    );
  }
  const randomRequested = body.random === true;
  if (randomRequested && category === 'custom') {
    return c.json(
      {
        error: 'Random TTS requires a preset category.',
        error_code: 'RANDOM_CATEGORY_REQUIRED',
      },
      400,
    );
  }

  const requestText = randomRequested
    ? await pickRandomPresetText(c.env, category)
    : (body.text ?? '').trim();
  if (!requestText) {
    return c.json(
      { error: 'voice_profile_id and text are required', error_code: 'VOICE_AND_TEXT_REQUIRED' },
      400,
    );
  }

  if (requestText.length > 200) {
    return c.json(
      { error: 'Text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' },
      400,
    );
  }

  let dailyLimitExceeded = false;
  const user = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ? OR google_id = ? LIMIT 1',
    args: ownerIds,
  });

  if (user.rows.length > 0) {
    const u = user.rows[0]!;
    const plan = u.plan as string;
    const today = new Date().toISOString().split('T')[0]!;

    if (resolvedUserPk && !isPaidVoicePlan(plan)) {
      return c.json(
        {
          error: 'Voice features require a paid plan.',
          error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
        },
        403,
      );
    }

    if (u.daily_tts_reset_at !== today) {
      await db.execute({
        sql: `UPDATE users SET daily_tts_count = 0, daily_tts_reset_at = ? WHERE id = ? OR google_id = ?`,
        args: [today, ...ownerIds],
      });
    } else {
      const count = Number(u.daily_tts_count);
      const limits: Record<string, number> = { free: 3, plus: 9999, family: 9999 };
      if (count >= (limits[plan] ?? 3)) {
        dailyLimitExceeded = true;
      }
    }
  } else if (resolvedUserPk) {
    return c.json(
      {
        error: 'Voice features require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }

  const vp = await findUsableVoiceProfile(db, userId, userPk, body.voice_profile_id);
  if (!vp) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  if (vp.status !== 'ready') {
    return c.json(
      { error: 'Voice profile is not ready yet', error_code: 'VOICE_PROFILE_NOT_READY' },
      400,
    );
  }

  try {
    const requestedLanguage = normalizeSynthesisLanguage(body.language);
    const sourceLanguage = inferSynthesisLanguage(requestText, 'ko');
    const shouldTranslate =
      body.translate === true || (randomRequested && requestedLanguage !== sourceLanguage);
    const prepared = await prepareAlarmTextWithVertex(c.env, requestText, {
      targetLanguage: shouldTranslate ? requestedLanguage : sourceLanguage,
      sourceLanguage,
      translate: shouldTranslate,
      autoTag: randomRequested,
    });
    const synthesisText = prepared.text;
    const synthesisLanguage = prepared.translated
      ? requestedLanguage
      : inferSynthesisLanguage(synthesisText, sourceLanguage);

    if (synthesisText.length > 200) {
      return c.json(
        { error: 'Prepared text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' },
        400,
      );
    }

    const attempts = createSynthesisAttempts({
      env: c.env,
      profile: {
        perso_voice_id: vp.perso_voice_id as string | null | undefined,
        elevenlabs_voice_id: vp.elevenlabs_voice_id as string | null | undefined,
      },
      text: synthesisText,
      language: synthesisLanguage,
      category,
    });

    if (attempts.length === 0) {
      return c.json(
        { error: 'No voice ID available for this profile', error_code: 'NO_VOICE_ID' },
        400,
      );
    }

    const preparedAttempts = await Promise.all(
      attempts.map(async (attempt) => {
        const cacheKey = await computeTtsCacheKey({
          provider: attempt.provider,
          providerVoiceId: attempt.providerVoiceId,
          voiceProfileId: body.voice_profile_id,
          modelId: attempt.modelId,
          language: synthesisLanguage,
          languageCode: synthesisLanguage,
          text: synthesisText,
          outputFormat: attempt.outputFormat,
          voiceSettings: attempt.voiceSettings,
        });
        return { attempt, cacheKey };
      }),
    );

    for (const { cacheKey } of preparedAttempts) {
      const cached = await findCachedGeneratedAudio(c, ownerIds, cacheKey);
      if (cached) {
        return c.json(
          {
            message_id: cached.messageId,
            audio_base64: uint8ToBase64(cached.bytes),
            audio_format: cached.audioFormat,
            audio_url: cached.audioUrl,
            audio_object_key: cached.audioObjectKey,
            text: cached.text,
            original_text: requestText,
            translated: prepared.translated,
            tags: prepared.tags,
            voice_profile_id: body.voice_profile_id,
            language: synthesisLanguage,
            provider: cached.provider,
            cache_key: cacheKey,
            cache_hit: true,
          },
          200,
        );
      }
    }

    if (dailyLimitExceeded) {
      return c.json(
        {
          error: 'Daily TTS generation limit exceeded.',
          error_code: 'DAILY_TTS_LIMIT_EXCEEDED',
        },
        429,
      );
    }

    let lastError: unknown = noVoiceProviderError();
    for (const { attempt, cacheKey } of preparedAttempts) {
      try {
        const generated = await attempt.synthesize();
        const bytes = generated.bytes;

        let audioObjectKey: string | null = null;
        let audioUrl: string | null = null;
        if (c.env.VOICE_BUCKET) {
          const storage = new R2VoiceStorage(c.env.VOICE_BUCKET);
          audioObjectKey = generatedTtsObjectKey(userPk, cacheKey, generated.outputFormat);
          await storage.storeAtKey(audioObjectKey, {
            bytes,
            userId: userPk,
            mimeType: generated.mimeType,
            originalName: `tts_${cacheKey}.${generated.outputFormat}`,
          });
          audioUrl = `r2://${audioObjectKey}`;
        }

        const messageId = crypto.randomUUID();
        await db.execute({
          sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, audio_url)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            messageId,
            userPk,
            body.voice_profile_id,
            synthesisText,
            category,
            audioUrl,
          ],
        });

        if (audioUrl) {
          await db.execute({
            sql: `INSERT OR IGNORE INTO generated_audio_assets
                  (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                   model_id, language, request_hash, text, category, audio_url,
                   audio_object_key, audio_format, mime_type, size_bytes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              crypto.randomUUID(),
              userPk,
              body.voice_profile_id,
              messageId,
              generated.provider,
              generated.providerVoiceId,
              generated.modelId,
              synthesisLanguage,
              cacheKey,
              synthesisText,
              category,
              audioUrl,
              audioObjectKey,
              generated.outputFormat,
              generated.mimeType,
              bytes.byteLength,
            ],
          });
        }

        await db.execute({
          sql: `UPDATE users SET daily_tts_count = daily_tts_count + 1 WHERE id = ? OR google_id = ?`,
          args: ownerIds,
        });

        await db.execute({
          sql: `INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)`,
          args: [crypto.randomUUID(), userPk, messageId],
        });

        return c.json(
          {
            message_id: messageId,
            audio_base64: uint8ToBase64(bytes),
            audio_format: generated.outputFormat,
            audio_url: audioUrl,
            audio_object_key: audioObjectKey,
            text: synthesisText,
            original_text: requestText,
            translated: prepared.translated,
            tags: prepared.tags,
            voice_profile_id: body.voice_profile_id,
            language: synthesisLanguage,
            provider: generated.provider,
            cache_key: cacheKey,
            cache_hit: false,
          },
          201,
        );
      } catch (err) {
        lastError = err;
        if (err instanceof UnsupportedVoiceProviderError) continue;
        if (attempt !== attempts[attempts.length - 1]) continue;
      }
    }

    throw lastError;
  } catch (err) {
    if (err instanceof AlarmTextTranslationUnavailableError) {
      return c.json(
        {
          error: 'Alarm text translation is not configured.',
          error_code: 'TRANSLATION_NOT_CONFIGURED',
        },
        503,
      );
    }
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

tts.get('/messages', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const category = c.req.query('category');
  const voiceProfileId = c.req.query('voice_profile_id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  let whereClause = 'WHERE m.user_id IN (?, ?)';
  const filterArgs: (string | number)[] = [...ownerIds];

  if (category) {
    whereClause += ' AND m.category = ?';
    filterArgs.push(category);
  }

  if (voiceProfileId) {
    if (!UUID_RE.test(voiceProfileId)) {
      return c.json(
        { error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' },
        400,
      );
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

  const total = Number(countRes.rows[0]!.total);
  return c.json({ messages: result.rows, total, limit, offset });
});

tts.get('/messages/:id/audio', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid message ID format', error_code: 'INVALID_MESSAGE_ID' }, 400);
  }

  const result = await db.execute({
    sql: `SELECT id, user_id, voice_profile_id, text, audio_url, category
          FROM messages
          WHERE id = ?
            AND (
              user_id IN (?, ?)
              OR EXISTS (
                SELECT 1 FROM alarms a
                WHERE a.message_id = messages.id
                  AND a.target_user_id IN (?, ?)
              )
            )`,
    args: [id, ...ownerIds, ...ownerIds],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  const message = typedRow<{
    id: string;
    voice_profile_id: string;
    text: string | null;
    audio_url: string | null;
    category: string | null;
  }>(result.rows[0]!);
  const audioUrl = message.audio_url;
  if (!audioUrl) {
    return c.json(
      { error: 'Message has no stored audio', error_code: 'MESSAGE_AUDIO_MISSING' },
      404,
    );
  }

  const loaded = await loadAudioBytes(c, audioUrl);
  if (!loaded) {
    return c.json(
      { error: 'Stored audio object not found', error_code: 'MESSAGE_AUDIO_NOT_FOUND' },
      404,
    );
  }

  return c.json({
    message_id: message.id,
    audio_base64: uint8ToBase64(loaded.bytes),
    audio_format: loaded.format,
    audio_url: audioUrl,
    text: message.text ?? '',
    category: message.category ?? 'custom',
    voice_profile_id: message.voice_profile_id,
  });
});

tts.delete('/messages/:id', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid message ID format', error_code: 'INVALID_MESSAGE_ID' }, 400);
  }

  const alarmCheck = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM alarms WHERE message_id = ?',
    args: [id],
  });
  const alarmCount = Number(typedRow<{ cnt: number }>(alarmCheck.rows[0]!).cnt ?? 0);

  if (alarmCount > 0 && c.req.query('force') !== 'true') {
    return c.json(
      {
        warning: true,
        error_code: 'MESSAGE_IN_USE',
        alarm_count: alarmCount,
        message: `This message is used by ${alarmCount} alarm(s). Add ?force=true to delete anyway.`,
      },
      409,
    );
  }

  await db.execute({
    sql: 'DELETE FROM message_library WHERE message_id = ? AND user_id IN (?, ?)',
    args: [id, ...ownerIds],
  });

  await db.execute({
    sql: 'DELETE FROM generated_audio_assets WHERE message_id = ? AND user_id IN (?, ?)',
    args: [id, ...ownerIds],
  });

  const result = await db.execute({
    sql: 'DELETE FROM messages WHERE id = ? AND user_id IN (?, ?)',
    args: [id, ...ownerIds],
  });

  if (result.rowsAffected === 0) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  return c.json({ ok: true, alarms_affected: alarmCount });
});

tts.get('/presets', async (c) => {
  return c.json({ presets: await loadTtsPresets(c.env) });
});

async function findCachedGeneratedAudio(
  c: Context<AppEnv>,
  userIds: [string, string],
  cacheKey: string,
): Promise<{
  messageId: string;
  provider: string;
  text: string;
  audioUrl: string;
  audioObjectKey: string | null;
  audioFormat: string;
  bytes: Uint8Array;
} | null> {
  const db = getDB(c.env);
  const result = await db.execute({
    sql: `SELECT ga.message_id, ga.provider, ga.text, ga.audio_url, ga.audio_object_key,
                 ga.audio_format, ga.mime_type
          FROM generated_audio_assets ga
          JOIN messages m ON m.id = ga.message_id
          WHERE ga.user_id IN (?, ?) AND ga.request_hash = ?
          LIMIT 1`,
    args: [...userIds, cacheKey],
  });

  if (result.rows.length === 0) return null;
  const cached = typedRow<{
    message_id: string;
    provider: string;
    text: string;
    audio_url: string | null;
    audio_object_key: string | null;
    audio_format: string | null;
  }>(result.rows[0]!);

  if (!cached.audio_url) return null;
  const loaded = await loadAudioBytes(c, cached.audio_url);
  if (!loaded) return null;

  return {
    messageId: cached.message_id,
    provider: cached.provider,
    text: cached.text,
    audioUrl: cached.audio_url,
    audioObjectKey: cached.audio_object_key,
    audioFormat: cached.audio_format ?? loaded.format,
    bytes: loaded.bytes,
  };
}

export default tts;
