import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getFormFile } from '../lib/db-types';
import { getDB } from '../lib/db';

/**
 * Upload a short raw audio clip (≤30s) to be played directly when an alarm
 * fires. Stores the clip in R2 under `raw-alarms/{userId}/{uuid}` and returns
 * the public/signed URL caller should attach to the alarm payload.
 *
 * Body: multipart/form-data
 *   - audio: File (audio/* or video/* — caller should crop video → audio first
 *            for now; auto-crop is a follow-up step)
 *   - durationMs: integer, must be ≤ MAX_DURATION_MS
 */
const alarmSource = new Hono<AppEnv>();

const MAX_DURATION_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB cap for a 30s clip

alarmSource.post('/source', async (c) => {
  const userId = c.get('userId');
  const bucket = c.env.VOICE_BUCKET;
  if (!bucket) {
    return c.json(
      { error: 'voice storage not configured', error_code: 'STORAGE_UNAVAILABLE' },
      503,
    );
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { error: 'multipart/form-data body required', error_code: 'MULTIPART_BODY_REQUIRED' },
      400,
    );
  }

  const audioFile = getFormFile(formData, 'audio');
  if (!audioFile || typeof audioFile === 'string') {
    return c.json({ error: 'audio file is required', error_code: 'AUDIO_FILE_REQUIRED' }, 400);
  }

  const mimeType = audioFile.type || 'application/octet-stream';
  if (!mimeType.startsWith('audio/') && !mimeType.startsWith('video/')) {
    return c.json(
      { error: 'audio/* or video/* MIME type required', error_code: 'INVALID_MIME_TYPE' },
      415,
    );
  }

  const durationRaw = formData.get('durationMs');
  const durationMs =
    typeof durationRaw === 'string' ? Number.parseInt(durationRaw, 10) : NaN;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return c.json(
      { error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' },
      400,
    );
  }
  if (durationMs > MAX_DURATION_MS) {
    return c.json(
      {
        error: `clip exceeds ${MAX_DURATION_MS / 1000}s (got ${Math.round(durationMs / 1000)}s)`,
        error_code: 'CLIP_TOO_LONG',
      },
      400,
    );
  }

  const buffer = await audioFile.arrayBuffer();
  if (buffer.byteLength === 0) {
    return c.json({ error: 'audio file is empty', error_code: 'AUDIO_FILE_EMPTY' }, 400);
  }
  if (buffer.byteLength > MAX_BYTES) {
    return c.json(
      {
        error: `clip exceeds ${MAX_BYTES} bytes (got ${buffer.byteLength})`,
        error_code: 'CLIP_TOO_LARGE',
      },
      413,
    );
  }

  const id = crypto.randomUUID();
  const objectKey = `raw-alarms/${userId}/${id}`;
  await bucket.put(objectKey, buffer, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      userId,
      durationMs: String(durationMs),
      originalName: audioFile.name?.slice(0, 200) ?? '',
    },
  });

  // 업로드를 추적 테이블에 기록한다. 이후 어떤 알람에도 연결되지 않은 채 TTL 이
  // 지나면 retention 크론이 R2 삭제 큐에 적재해 고아 누수를 막는다(VF2).
  try {
    await getDB(c.env).execute({
      sql: `INSERT OR IGNORE INTO raw_alarm_uploads (id, user_id, object_key)
            VALUES (?, ?, ?)`,
      args: [id, userId, objectKey],
    });
  } catch {
    // 추적 행 기록 실패가 업로드 자체를 막진 않는다(클립은 이미 R2 에 저장됨).
    // 최악의 경우 해당 클립이 추적되지 않을 뿐, 알람에 연결되면 정상 동작한다.
  }

  // Return a relative URL the alarm-fire client can resolve against the
  // public bucket / signed-URL endpoint. Storing the bare object key keeps
  // the DB row stable across bucket renames.
  return c.json(
    {
      object_key: objectKey,
      raw_audio_url: `r2://${objectKey}`,
      duration_ms: durationMs,
      mime_type: mimeType,
    },
    201,
  );
});

export default alarmSource;
