import { Hono } from 'hono';
import type { AppEnv } from '../types';
import type { VoiceStorage } from '@voice-alarm/voice';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { getSharedInMemoryVoiceStorage, MockVoiceProvider } from '@voice-alarm/voice';
import { R2VoiceStorage } from '../lib/r2-storage';

import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';

function getStorage(env?: { VOICE_BUCKET?: R2Bucket }): VoiceStorage {
  if (env?.VOICE_BUCKET) return new R2VoiceStorage(env.VOICE_BUCKET);
  return getSharedInMemoryVoiceStorage();
}

const voice = new Hono<AppEnv>();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
const MAX_SPEAKERS = 3;
const MAX_VOICE_PROFILES = 2;

/** 원본 오디오 업로드 — 화자 분리/클론 전 단계 저장소. R2 가용 시 R2, 미가용 시 in-memory 폴백. */
voice.post('/upload', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'multipart/form-data body required', error_code: 'MULTIPART_BODY_REQUIRED' }, 400);
  }

  const audioFile = getFormFile(formData, 'audio');
  if (!audioFile || typeof audioFile === 'string') {
    return c.json({ error: 'audio file is required', error_code: 'AUDIO_FILE_REQUIRED' }, 400);
  }

  const mimeType = audioFile.type || 'application/octet-stream';
  if (!mimeType.startsWith('audio/')) {
    return c.json({ error: 'audio/* MIME type required', error_code: 'INVALID_AUDIO_MIME_TYPE' }, 415);
  }

  const buffer = await audioFile.arrayBuffer();
  if (buffer.byteLength === 0) {
    return c.json({ error: 'audio file is empty', error_code: 'AUDIO_FILE_EMPTY' }, 400);
  }
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    return c.json(
      { error: `audio file exceeds ${MAX_UPLOAD_BYTES} bytes (got ${buffer.byteLength})`, error_code: 'AUDIO_FILE_TOO_LARGE' },
      413,
    );
  }

  const durationRaw = formData.get('durationMs');
  let durationMs: number | undefined;
  if (typeof durationRaw === 'string' && durationRaw.length > 0) {
    const n = Number.parseInt(durationRaw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return c.json({ error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' }, 400);
    }
    durationMs = n;
  }

  const originalNameRaw = formData.get('originalName');
  const originalName =
    typeof originalNameRaw === 'string' && originalNameRaw.length > 0
      ? originalNameRaw.slice(0, 200)
      : audioFile.name || undefined;

  const storage = getStorage(c.env);
  const meta = await storage.store({
    userId,
    bytes: new Uint8Array(buffer),
    mimeType,
    durationMs,
    originalName,
  });

  const uploadId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO voice_uploads
          (id, user_id, object_key, mime_type, size_bytes, duration_ms, original_name)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      uploadId,
      userId,
      meta.objectKey,
      meta.mimeType,
      meta.sizeBytes,
      meta.durationMs ?? null,
      meta.originalName ?? null,
    ],
  });

  return c.json(
    {
      upload: {
        id: uploadId,
        objectKey: meta.objectKey,
        mimeType: meta.mimeType,
        sizeBytes: meta.sizeBytes,
        durationMs: meta.durationMs ?? null,
        originalName: meta.originalName ?? null,
        createdAt: meta.createdAt,
      },
    },
    201,
  );
});

/**
 * 업로드된 오디오의 화자 분리 (mock).
 * NEEDS_VERIFICATION: real diarization algorithm — 실제 알고리즘은 perso.ai/ElevenLabs 영역.
 */
voice.post('/uploads/:uploadId/separate', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const uploadId = c.req.param('uploadId');

  if (!UUID_RE.test(uploadId)) {
    return c.json({ error: 'Invalid upload ID format', error_code: 'INVALID_UPLOAD_ID' }, 400);
  }

  const uploadRes = await db.execute({
    sql: 'SELECT id, user_id, object_key FROM voice_uploads WHERE id = ?',
    args: [uploadId],
  });
  if (uploadRes.rows.length === 0) {
    return c.json({ error: 'Voice upload not found', error_code: 'VOICE_UPLOAD_NOT_FOUND' }, 404);
  }
  const upload = typedRow<{ id: string; user_id: string; object_key: string }>(uploadRes.rows[0]);
  if (upload.user_id !== userId) {
    return c.json({ error: 'Forbidden', error_code: 'FORBIDDEN' }, 403);
  }

  const provider = new MockVoiceProvider();
  const result = await provider.separate({
    audioUri: upload.object_key,
    maxSpeakers: MAX_SPEAKERS,
  });

  await db.execute({
    sql: 'DELETE FROM voice_speakers WHERE upload_id = ?',
    args: [uploadId],
  });

  const speakers = result.speakers.map((s, idx) => ({
    id: crypto.randomUUID(),
    uploadId,
    label: `화자 ${idx + 1}`,
    startMs: s.startMs,
    endMs: s.endMs,
    confidence: s.confidence,
  }));

  for (const sp of speakers) {
    await db.execute({
      sql: `INSERT INTO voice_speakers (id, upload_id, label, start_ms, end_ms, confidence)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [sp.id, sp.uploadId, sp.label, sp.startMs, sp.endMs, sp.confidence],
    });
  }

  return c.json({ speakers, provider: result.provider }, 201);
});

/** 업로드된 오디오의 분리된 화자 목록 조회 */
voice.get('/uploads/:uploadId/speakers', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const uploadId = c.req.param('uploadId');

  if (!UUID_RE.test(uploadId)) {
    return c.json({ error: 'Invalid upload ID format', error_code: 'INVALID_UPLOAD_ID' }, 400);
  }

  const uploadRes = await db.execute({
    sql: 'SELECT id, user_id FROM voice_uploads WHERE id = ?',
    args: [uploadId],
  });
  if (uploadRes.rows.length === 0) {
    return c.json({ error: 'Voice upload not found', error_code: 'VOICE_UPLOAD_NOT_FOUND' }, 404);
  }
  if (typedRow<{ user_id: string }>(uploadRes.rows[0]).user_id !== userId) {
    return c.json({ error: 'Forbidden', error_code: 'FORBIDDEN' }, 403);
  }

  const speakersRes = await db.execute({
    sql: `SELECT id, upload_id, label, start_ms, end_ms, confidence, created_at
          FROM voice_speakers WHERE upload_id = ? ORDER BY start_ms ASC`,
    args: [uploadId],
  });

  return c.json({ speakers: speakersRes.rows });
});

/** 분리된 화자 라벨 수정 */
voice.patch('/uploads/:uploadId/speakers/:speakerId', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const uploadId = c.req.param('uploadId');
  const speakerId = c.req.param('speakerId');

  if (!UUID_RE.test(uploadId) || !UUID_RE.test(speakerId)) {
    return c.json({ error: 'Invalid ID format', error_code: 'INVALID_ID_FORMAT' }, 400);
  }

  let body: { label?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (label.length === 0 || label.length > 50) {
    return c.json({ error: 'label must be 1-50 characters', error_code: 'INVALID_LABEL_LENGTH' }, 400);
  }

  const uploadRes = await db.execute({
    sql: 'SELECT id, user_id FROM voice_uploads WHERE id = ?',
    args: [uploadId],
  });
  if (uploadRes.rows.length === 0) {
    return c.json({ error: 'Voice upload not found', error_code: 'VOICE_UPLOAD_NOT_FOUND' }, 404);
  }
  if (typedRow<{ user_id: string }>(uploadRes.rows[0]).user_id !== userId) {
    return c.json({ error: 'Forbidden', error_code: 'FORBIDDEN' }, 403);
  }

  const speakerRes = await db.execute({
    sql: 'SELECT id FROM voice_speakers WHERE id = ? AND upload_id = ?',
    args: [speakerId, uploadId],
  });
  if (speakerRes.rows.length === 0) {
    return c.json({ error: 'Speaker not found', error_code: 'SPEAKER_NOT_FOUND' }, 404);
  }

  await db.execute({
    sql: 'UPDATE voice_speakers SET label = ? WHERE id = ?',
    args: [label, speakerId],
  });

  return c.json({ speaker: { id: speakerId, uploadId, label } });
});

/** 음성 프로필 목록 조회 */
voice.get('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const status = c.req.query('status');

  const validStatuses = ['ready', 'processing', 'failed'];
  let statusClause = '';
  const baseArgs: (string | number)[] = [userId];
  if (status && validStatuses.includes(status)) {
    statusClause = ' AND status = ?';
    baseArgs.push(status);
  }

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM voice_profiles WHERE user_id = ?${statusClause}`,
      args: baseArgs,
    }),
    db.execute({
      sql: `SELECT * FROM voice_profiles WHERE user_id = ?${statusClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [...baseArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0].total);
  return c.json({ profiles: result.rows, total, limit, offset });
});

/** 가족/커플 멤버의 음성 프로필 조회 (읽기 전용) */
voice.get('/family', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const memberRes = await db.execute({
    sql: `SELECT fm2.user_id
          FROM family_members fm1
          JOIN family_members fm2 ON fm1.group_id = fm2.group_id
          WHERE fm1.user_id = ? AND fm2.user_id != ?`,
    args: [userId, userId],
  });

  if (memberRes.rows.length === 0) {
    return c.json({ profiles: [] });
  }

  const memberIds = memberRes.rows.map((r) => typedRow<{ user_id: string }>(r).user_id);
  const placeholders = memberIds.map(() => '?').join(',');
  const voicesRes = await db.execute({
    sql: `SELECT vp.id, vp.name, vp.status, vp.created_at, vp.user_id, u.name as owner_name
          FROM voice_profiles vp
          LEFT JOIN users u ON vp.user_id = u.google_id
          WHERE vp.user_id IN (${placeholders}) AND vp.status = 'ready'
          ORDER BY vp.created_at DESC`,
    args: memberIds,
  });

  return c.json({ profiles: voicesRes.rows });
});

/** 음성 프로필 상세 조회 */
voice.get('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const result = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({ profile: result.rows[0] });
});

/** 음성 프로필 이름 변경 */
voice.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  let body: { name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length === 0 || name.length > 50) {
    return c.json({ error: 'name must be 1-50 characters', error_code: 'INVALID_NAME_LENGTH' }, 400);
  }

  const existing = await db.execute({
    sql: 'SELECT id FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  await db.execute({
    sql: "UPDATE voice_profiles SET name = ?, updated_at = datetime('now') WHERE id = ?",
    args: [name, id],
  });

  return c.json({ profile: { id, name } });
});

/** 음성 클론 생성 (오디오 업로드) */
voice.post('/clone', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const profileCount = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM voice_profiles WHERE user_id = ?',
      args: [userId],
    });
    const count = Number(profileCount.rows[0].count);
    if (count >= MAX_VOICE_PROFILES) {
      return c.json(
        {
          error: 'VOICE_LIMIT_REACHED',
          error_code: 'VOICE_LIMIT_REACHED',
          message: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
        },
        403,
      );
    }

    const formData = await c.req.formData();
    const audioFile = getFormFile(formData, 'audio');
    const name = formData.get('name') as string | null;
    if (!audioFile || !name) {
      return c.json({ error: 'audio file and name are required', error_code: 'AUDIO_AND_NAME_REQUIRED' }, 400);
    }

    if (name.length > 50) {
      return c.json({ error: 'Name must be 50 characters or less', error_code: 'NAME_TOO_LONG' }, 400);
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const profileId = crypto.randomUUID();

    await db.execute({
      sql: `INSERT INTO voice_profiles (id, user_id, name, status)
            VALUES (?, ?, ?, 'processing')`,
      args: [profileId, userId, name],
    });

    const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
    const result = await client.createInstantClone(audioBuffer, name);
    const voiceId = result.voice_id;

    await db.execute({
      sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ?, status = 'ready', updated_at = datetime('now')
            WHERE id = ?`,
      args: [voiceId, profileId],
    });

    return c.json(
      {
        profile: {
          id: profileId,
          name,
          voice_id: voiceId,
          status: 'ready',
        },
      },
      201,
    );
  } catch (err) {
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : 'Unknown error';

    return c.json(
      {
        error: 'Voice cloning failed',
        error_code: 'VOICE_CLONING_FAILED',
        detail,
      },
      500,
    );
  }
});

/** 화자 분리 (Speaker Diarization) */
voice.post('/diarize', async (c) => {
  const formData = await c.req.formData();
  const audioFile = getFormFile(formData, 'audio');

  if (!audioFile) {
    return c.json({ error: 'audio file is required', error_code: 'AUDIO_FILE_REQUIRED' }, 400);
  }

  const audioBuffer = await audioFile.arrayBuffer();

  try {
    const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
    const result = await client.diarize(audioBuffer);

    return c.json({
      speakers: result.speakers.map((s, i) => ({
        speaker_id: s.speaker_id,
        label: `Speaker ${i + 1}`,
        segments: s.segments,
        total_duration: s.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0),
      })),
    });
  } catch (err) {
    return c.json(
      {
        error: 'Speaker diarization failed',
        error_code: 'DIARIZATION_FAILED',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

/** 음성 프로필 통계 */
voice.get('/:id/stats', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const [profileRes, msgRes, alarmRes] = await Promise.all([
    db.execute({
      sql: 'SELECT id, name FROM voice_profiles WHERE id = ? AND user_id = ?',
      args: [id, userId],
    }),
    db.execute({
      sql: 'SELECT COUNT(*) as count FROM messages WHERE voice_profile_id = ? AND user_id = ?',
      args: [id, userId],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM alarms a
            JOIN messages m ON a.message_id = m.id
            WHERE m.voice_profile_id = ? AND (a.user_id = ? OR a.target_user_id = ?)`,
      args: [id, userId, userId],
    }),
  ]);

  if (profileRes.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({
    voice_profile_id: id,
    messages: Number(typedRow<{ count: number }>(msgRes.rows[0]).count ?? 0),
    alarms: Number(typedRow<{ count: number }>(alarmRes.rows[0]).count ?? 0),
  });
});

/** 음성 프로필 삭제 */
voice.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' }, 400);
  }

  const result = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const profile = result.rows[0];

  const msgCheck = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM messages WHERE voice_profile_id = ?',
    args: [id],
  });
  const msgCount = Number(typedRow<{ cnt: number }>(msgCheck.rows[0]).cnt ?? 0);

  if (msgCount > 0 && c.req.query('force') !== 'true') {
    return c.json(
      {
        warning: true,
        error_code: 'VOICE_PROFILE_IN_USE',
        message_count: msgCount,
        message: `This voice profile has ${msgCount} message(s). Add ?force=true to delete anyway.`,
      },
      409,
    );
  }

  // ElevenLabs에서도 삭제
  try {
    if (profile.elevenlabs_voice_id) {
      const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
      await client.deleteVoice(profile.elevenlabs_voice_id as string);
    }
  } catch {
    // 외부 API 삭제 실패해도 로컬은 삭제 진행
  }

  if (msgCount > 0) {
    await db.execute({
      sql: 'DELETE FROM alarms WHERE message_id IN (SELECT id FROM messages WHERE voice_profile_id = ?)',
      args: [id],
    });
    await db.execute({
      sql: 'DELETE FROM message_library WHERE message_id IN (SELECT id FROM messages WHERE voice_profile_id = ?)',
      args: [id],
    });
    await db.execute({
      sql: 'DELETE FROM messages WHERE voice_profile_id = ?',
      args: [id],
    });
  }

  await db.execute({
    sql: 'DELETE FROM voice_profiles WHERE id = ?',
    args: [id],
  });

  return c.json({ success: true, messages_deleted: msgCount });
});

export default voice;
