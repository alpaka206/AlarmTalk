import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { PersoClient } from '../lib/perso';
import { getDB } from '../lib/db';
import { getFormFile } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';

const dub = new Hono<AppEnv>();

async function getSpaceSeq(perso: PersoClient): Promise<number> {
  const { result } = await perso.listSpaces();
  if (!result.length) throw new Error('No Perso spaces available');
  return result[0]!.spaceSeq;
}

dub.get('/languages', async (c) => {
  const perso = new PersoClient(c.env.PERSO_API_KEY);
  const { result } = await perso.listLanguages();
  return c.json({ languages: result.languages });
});

dub.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const perso = new PersoClient(c.env.PERSO_API_KEY);

  const formData = await c.req.formData();
  const audioFile = getFormFile(formData, 'audio');
  const sourceLanguage = formData.get('source_language') as string | null;
  const targetLanguage = formData.get('target_language') as string | null;
  const sourceMessageId = formData.get('source_message_id') as string | null;

  if (!audioFile || !sourceLanguage || !targetLanguage) {
    return c.json({ error: 'audio, source_language, target_language are required', error_code: 'MISSING_REQUIRED_FIELDS' }, 400);
  }

  if (sourceLanguage === targetLanguage) {
    return c.json({ error: 'Source and target languages must be different', error_code: 'SAME_LANGUAGE' }, 400);
  }

  if (sourceMessageId && !UUID_RE.test(sourceMessageId)) {
    return c.json({ error: 'Invalid source_message_id format', error_code: 'INVALID_SOURCE_MESSAGE_ID' }, 400);
  }

  const jobId = crypto.randomUUID();

  try {
    const spaceSeq = await getSpaceSeq(perso);

    await db.execute({
      sql: `INSERT INTO dub_jobs (id, user_id, source_message_id, source_language, target_language, status, perso_space_seq)
            VALUES (?, ?, ?, ?, ?, 'uploading', ?)`,
      args: [jobId, userId, sourceMessageId, sourceLanguage, targetLanguage, spaceSeq],
    });

    const audioBuffer = await audioFile.arrayBuffer();
    const fileName = audioFile.name || 'audio.wav';

    const { blobSasUrl } = await perso.getSasToken(fileName);
    await perso.uploadToBlob(blobSasUrl, audioBuffer);

    const blobUrl = blobSasUrl.split('?')[0]!;
    const registered = await perso.registerAudio(spaceSeq, blobUrl, fileName);

    const { result } = await perso.requestTranslation(spaceSeq, {
      mediaSeq: registered.seq,
      isVideoProject: false,
      sourceLanguageCode: sourceLanguage,
      targetLanguageCodes: [targetLanguage],
      numberOfSpeakers: 1,
    });

    const projectSeq = result.startGenerateProjectIdList[0]!;

    await db.execute({
      sql: `UPDATE dub_jobs SET status = 'processing', perso_project_seq = ?, perso_media_seq = ? WHERE id = ?`,
      args: [projectSeq, registered.seq, jobId],
    });

    return c.json({ dub_id: jobId, status: 'processing' }, 201);
  } catch (err) {
    await db.execute({
      sql: `UPDATE dub_jobs SET status = 'failed', error_message = ? WHERE id = ?`,
      args: [err instanceof Error ? err.message : 'Unknown error', jobId],
    });
    return c.json(
      { error: 'Failed to start dubbing', error_code: 'DUB_START_FAILED', detail: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
});

dub.get('/jobs', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const result = await db.execute({
    sql: `SELECT id, source_message_id, source_language, target_language, status, progress, result_message_id, error_message, created_at
          FROM dub_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
    args: [userId],
  });

  return c.json({ jobs: result.rows });
});

dub.get('/:id', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid dub job ID format', error_code: 'INVALID_DUB_JOB_ID' }, 400);
  }

  const jobRes = await db.execute({
    sql: 'SELECT * FROM dub_jobs WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });

  if (jobRes.rows.length === 0) {
    return c.json({ error: 'Dub job not found', error_code: 'DUB_JOB_NOT_FOUND' }, 404);
  }

  const job = jobRes.rows[0]!;

  if (job.status === 'ready' || job.status === 'failed') {
    return c.json({
      dub_id: job.id,
      status: job.status,
      progress: Number(job.progress),
      result_message_id: job.result_message_id,
      error_message: job.error_message,
    });
  }

  if (job.status === 'uploading') {
    return c.json({ dub_id: job.id, status: 'uploading', progress: 0 });
  }

  const perso = new PersoClient(c.env.PERSO_API_KEY);
  const projectSeq = Number(job.perso_project_seq);
  const spaceSeq = Number(job.perso_space_seq);

  try {
    const { result } = await perso.getProgress(projectSeq, spaceSeq);

    if (result.hasFailed) {
      await db.execute({
        sql: `UPDATE dub_jobs SET status = 'failed', error_message = ? WHERE id = ?`,
        args: [result.progressReason || 'Dubbing failed', id],
      });
      return c.json({
        dub_id: id,
        status: 'failed',
        progress: result.progress,
        error_message: result.progressReason,
      });
    }

    if (result.progress < 100) {
      await db.execute({
        sql: `UPDATE dub_jobs SET progress = ? WHERE id = ?`,
        args: [result.progress, id],
      });
      return c.json({
        dub_id: id,
        status: 'processing',
        progress: result.progress,
        expected_remaining_minutes: result.expectedRemainingTimeMinutes,
      });
    }

    const downloadInfo = await perso.getDownloadInfo(projectSeq, spaceSeq);
    if (!downloadInfo.hasTranslatedVoice) {
      await db.execute({
        sql: `UPDATE dub_jobs SET status = 'failed', error_message = ? WHERE id = ?`,
        args: ['No translated audio available', id],
      });
      return c.json({ dub_id: id, status: 'failed', error_message: 'No translated audio available' });
    }

    const downloadRes = await perso.download(projectSeq, spaceSeq, 'translatedVoice');
    const audioLink = downloadRes.result.audioFile?.voiceAudioDownloadLink;

    if (!audioLink) {
      await db.execute({
        sql: `UPDATE dub_jobs SET status = 'failed', error_message = ? WHERE id = ?`,
        args: ['Download link unavailable', id],
      });
      return c.json({ dub_id: id, status: 'failed', error_message: 'Download link unavailable' });
    }

    const audioUrl = PersoClient.toFileUrl(audioLink);
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Audio download failed: ${audioRes.status}`);

    const audioBuffer = await audioRes.arrayBuffer();
    const bytes = new Uint8Array(audioBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const audioBase64 = btoa(binary);

    let resultMessageId: string | null = null;
    const sourceMessageId = job.source_message_id as string | null;

    if (sourceMessageId) {
      const srcMsg = await db.execute({
        sql: 'SELECT * FROM messages WHERE id = ? AND user_id = ?',
        args: [sourceMessageId, userId],
      });

      if (srcMsg.rows.length > 0) {
        const src = srcMsg.rows[0]!;
        resultMessageId = crypto.randomUUID();

        await db.execute({
          sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            resultMessageId,
            userId,
            src.voice_profile_id!,
            `[${job.target_language}] ${src.text}`,
            audioUrl,
            src.category!,
          ],
        });

        await db.execute({
          sql: `INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)`,
          args: [crypto.randomUUID(), userId, resultMessageId],
        });
      }
    }

    await db.execute({
      sql: `UPDATE dub_jobs SET status = 'ready', progress = 100, result_message_id = ? WHERE id = ?`,
      args: [resultMessageId, id],
    });

    return c.json({
      dub_id: id,
      status: 'ready',
      progress: 100,
      result_message_id: resultMessageId,
      audio_base64: audioBase64,
      audio_format: 'mp3',
    });
  } catch (err) {
    return c.json(
      { error: 'Failed to check dubbing progress', error_code: 'DUB_PROGRESS_CHECK_FAILED', detail: err instanceof Error ? err.message : 'Unknown error' },
      500,
    );
  }
});

export default dub;
