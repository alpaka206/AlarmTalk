import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import type { VoiceStorage } from '@alarmtalk/voice';
import { getDB } from '../lib/db';
import { getFormFile } from '../lib/db-types';
import { getSharedInMemoryVoiceStorage } from '@alarmtalk/voice';
import { R2VoiceStorage } from '../lib/r2-storage';
import { isPaidVoicePlan } from './billing-helpers';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from '../lib/consent';

function getStorage(env?: { VOICE_BUCKET?: R2Bucket }): VoiceStorage {
  if (env?.VOICE_BUCKET) return new R2VoiceStorage(env.VOICE_BUCKET);
  return getSharedInMemoryVoiceStorage();
}

const voiceUpload = new Hono<AppEnv>();
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MiB for up to 2 minutes of voice audio.
const MIN_UPLOAD_DURATION_MS = 60_000;
const MAX_UPLOAD_DURATION_MS = 120_000;
const UPLOAD_DURATION_TOLERANCE_MS = 5_000;

async function hasPaidVoiceAccess(c: Context<AppEnv>): Promise<boolean> {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  if (!resolvedUserPk) return true;
  const userPk = resolvedUserPk || userId;
  const db = getDB(c.env);
  const result = await db.execute({
    sql: 'SELECT plan FROM users WHERE id = ? OR google_id = ? LIMIT 1',
    args: [userPk, userId],
  });
  return result.rows.length > 0 && isPaidVoicePlan(result.rows[0]!.plan);
}

function paidVoiceRequired(c: Context<AppEnv>) {
  return c.json(
    {
      error: 'Voice features require a paid plan.',
      error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
    },
    403,
  );
}

function consentRequired(c: Context<AppEnv>, consent: string) {
  const error =
    consent === 'voice_biometric'
      ? 'Voice biometric consent is required for voice audio processing.'
      : 'Overseas transfer consent is required for ElevenLabs voice processing.';
  return c.json({ error, error_code: 'CONSENT_REQUIRED', consent }, 403);
}

async function requireSensitiveVoiceConsents(
  c: Context<AppEnv>,
  db: ReturnType<typeof getDB>,
  requiredTypes: readonly string[],
): Promise<Response | null> {
  const missingConsent = await missingConsentType(
    db,
    c.get('userIdPK') || c.get('userId'),
    requiredTypes,
  );
  return missingConsent ? consentRequired(c, missingConsent) : null;
}

voiceUpload.post('/upload', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

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
  if (!mimeType.startsWith('audio/')) {
    return c.json(
      { error: 'audio/* MIME type required', error_code: 'INVALID_AUDIO_MIME_TYPE' },
      415,
    );
  }

  if (audioFile.size === 0) {
    return c.json({ error: 'audio file is empty', error_code: 'AUDIO_FILE_EMPTY' }, 400);
  }
  if (audioFile.size > MAX_UPLOAD_BYTES) {
    return c.json(
      {
        error: `audio file exceeds ${MAX_UPLOAD_BYTES} bytes (got ${audioFile.size})`,
        error_code: 'AUDIO_FILE_TOO_LARGE',
      },
      413,
    );
  }

  const durationRaw = formData.get('durationMs');
  if (typeof durationRaw !== 'string' || durationRaw.length === 0) {
    return c.json(
      { error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' },
      400,
    );
  }
  const durationMs = Number.parseInt(durationRaw, 10);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return c.json(
      { error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' },
      400,
    );
  }
  if (durationMs < MIN_UPLOAD_DURATION_MS) {
    return c.json(
      {
        error: `audio file must be at least ${MIN_UPLOAD_DURATION_MS / 1000} seconds`,
        error_code: 'AUDIO_DURATION_TOO_SHORT',
      },
      400,
    );
  }
  if (durationMs > MAX_UPLOAD_DURATION_MS + UPLOAD_DURATION_TOLERANCE_MS) {
    return c.json(
      {
        error: `audio file exceeds ${MAX_UPLOAD_DURATION_MS / 1000} seconds`,
        error_code: 'AUDIO_DURATION_TOO_LONG',
      },
      400,
    );
  }

  if (!(await hasPaidVoiceAccess(c))) {
    return paidVoiceRequired(c);
  }

  const consentResponse = await requireSensitiveVoiceConsents(c, db, SENSITIVE_REQUIRED_CONSENTS);
  if (consentResponse) return consentResponse;

  const buffer = await audioFile.arrayBuffer();
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

export default voiceUpload;
