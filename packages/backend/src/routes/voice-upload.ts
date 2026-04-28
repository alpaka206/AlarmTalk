import { Hono } from 'hono';
import type { AppEnv } from '../types';
import type { VoiceStorage } from '@voice-alarm/voice';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { getSharedInMemoryVoiceStorage, MockVoiceProvider } from '@voice-alarm/voice';
import { R2VoiceStorage } from '../lib/r2-storage';
import { UUID_RE } from '../lib/validate';

function getStorage(env?: { VOICE_BUCKET?: R2Bucket }): VoiceStorage {
  if (env?.VOICE_BUCKET) return new R2VoiceStorage(env.VOICE_BUCKET);
  return getSharedInMemoryVoiceStorage();
}

const voiceUpload = new Hono<AppEnv>();
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB
const MAX_SPEAKERS = 3;

voiceUpload.post('/upload', async (c) => {
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

voiceUpload.post('/uploads/:uploadId/separate', async (c) => {
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
  const upload = typedRow<{ id: string; user_id: string; object_key: string }>(uploadRes.rows[0]!);
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

voiceUpload.get('/uploads/:uploadId/speakers', async (c) => {
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
  if (typedRow<{ user_id: string }>(uploadRes.rows[0]!).user_id !== userId) {
    return c.json({ error: 'Forbidden', error_code: 'FORBIDDEN' }, 403);
  }

  const speakersRes = await db.execute({
    sql: `SELECT id, upload_id, label, start_ms, end_ms, confidence, created_at
          FROM voice_speakers WHERE upload_id = ? ORDER BY start_ms ASC`,
    args: [uploadId],
  });

  return c.json({ speakers: speakersRes.rows });
});

voiceUpload.patch('/uploads/:uploadId/speakers/:speakerId', async (c) => {
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
  if (typedRow<{ user_id: string }>(uploadRes.rows[0]!).user_id !== userId) {
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

voiceUpload.post('/diarize', async (c) => {
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

export default voiceUpload;
