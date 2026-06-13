import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { R2VoiceStorage } from './r2-storage';
import { computeTtsCacheKey, generatedTtsObjectKey } from './audio-cache';
import { createSynthesisAttempts, normalizeSynthesisLanguage } from './voice-provider';
import { prepareAlarmTextWithVertex } from './vertex-translate';

/** 시스템 스톡 보이스의 소유자(로그인 불가, 발급 전용). migrations.ts #43 과 동일. */
export const SYSTEM_VOICE_LIBRARY_USER_ID = '70000000-0000-4000-9000-000000000001';

/** 스톡 클립을 만들 언어. 한국어 베이스 → 영어/일본어는 Vertex 로 번역. */
export const STOCK_CLIP_LANGUAGES = ['ko', 'en', 'ja'] as const;

/**
 * 스톡 클립 프리셋. baseText 는 태그 없는 한국어 한 줄이며, 합성 직전에
 * Vertex 로 (번역 +) ElevenLabs v3 딜리버리 태그 1개를 자동 부여한다.
 *
 * 지금은 "기상" 1종만 테스트로 둔다. 카테고리를 늘리려면 여기에 추가하면
 * findMissingStockTargets 가 자동으로 (보이스 × 언어) 매트릭스를 채운다.
 */
export const STOCK_CLIP_PRESETS = [
  {
    category: 'morning',
    // 안내방송처럼 딱딱하지 않게, 옆에서 다정하게 깨워주는 자연스러운 한 마디.
    baseText: '좋은 아침이에요. 잘 잤어요? 천천히 기지개 켜고 오늘 하루도 산뜻하게 시작해 봐요.',
  },
] as const;

export interface SystemVoiceRow {
  id: string;
  name: string;
  elevenlabsVoiceId: string;
}

export interface StockClipTarget {
  voiceProfileId: string;
  voiceName: string;
  elevenlabsVoiceId: string;
  category: string;
  baseText: string;
  language: string;
}

export interface GeneratedStockClip {
  message_id: string;
  voice_profile_id: string;
  voice_name: string;
  category: string;
  language: string;
  text: string;
}

/** 합성 준비된(ready) 시스템 보이스 목록. */
export async function listSystemVoices(db: Client): Promise<SystemVoiceRow[]> {
  const res = await db.execute({
    sql: `SELECT id, name, elevenlabs_voice_id
          FROM voice_profiles
          WHERE COALESCE(is_system, 0) = 1
            AND deleted_at IS NULL
            AND status = 'ready'
            AND elevenlabs_voice_id IS NOT NULL
          ORDER BY id ASC`,
    args: [],
  });
  return res.rows
    .map((row) => ({
      id: String(row.id),
      name: String(row.name),
      elevenlabsVoiceId: String(row.elevenlabs_voice_id ?? ''),
    }))
    .filter((row) => row.elevenlabsVoiceId.length > 0);
}

/** 아직 생성되지 않은 (보이스 × 카테고리 × 언어) 조합. */
export async function findMissingStockTargets(db: Client): Promise<StockClipTarget[]> {
  const voices = await listSystemVoices(db);

  const existing = await db.execute({
    sql: `SELECT voice_profile_id, category, language
          FROM messages
          WHERE COALESCE(is_preset, 0) = 1 AND audio_url IS NOT NULL`,
    args: [],
  });
  const seen = new Set(
    existing.rows.map(
      (row) => `${row.voice_profile_id}|${row.category}|${row.language}`,
    ),
  );

  const targets: StockClipTarget[] = [];
  for (const voice of voices) {
    for (const preset of STOCK_CLIP_PRESETS) {
      for (const language of STOCK_CLIP_LANGUAGES) {
        const lang = normalizeSynthesisLanguage(language);
        if (seen.has(`${voice.id}|${preset.category}|${lang}`)) continue;
        targets.push({
          voiceProfileId: voice.id,
          voiceName: voice.name,
          elevenlabsVoiceId: voice.elevenlabsVoiceId,
          category: preset.category,
          baseText: preset.baseText,
          language: lang,
        });
      }
    }
  }
  return targets;
}

/**
 * 기존 스톡 클립 전체 삭제 (문구를 바꿔 재생성할 때 사용). messages·
 * generated_audio_assets·message_library 행과 R2 오브젝트를 정리하고,
 * 혹시 이 클립을 참조하던 알람은 sound-only 로 떼어낸다. dev 반복용.
 */
export async function deleteAllStockClips(db: Client, env: Env): Promise<number> {
  const rows = await db.execute({
    sql: `SELECT m.id AS message_id, ga.audio_object_key AS audio_object_key
          FROM messages m
          LEFT JOIN generated_audio_assets ga ON ga.message_id = m.id
          WHERE COALESCE(m.is_preset, 0) = 1
            AND m.voice_profile_id IN (
              SELECT id FROM voice_profiles WHERE COALESCE(is_system, 0) = 1
            )`,
    args: [],
  });
  const ids = Array.from(new Set(rows.rows.map((r) => String(r.message_id))));
  if (ids.length === 0) return 0;

  if (env.VOICE_BUCKET) {
    const storage = new R2VoiceStorage(env.VOICE_BUCKET);
    for (const r of rows.rows) {
      const key = r.audio_object_key;
      if (typeof key === 'string' && key) {
        try {
          await storage.delete(key);
        } catch {
          // R2 삭제 실패해도 DB 정리는 계속
        }
      }
    }
  }

  const ph = ids.map(() => '?').join(',');
  // 이 클립을 쓰던 알람은 음성 떼고 sound-only 로 (FK·런타임 안전).
  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only', wake_mode = 'sound_then_voice',
              message_id = NULL, voice_profile_id = NULL, speaker_id = NULL,
              raw_audio_url = NULL, raw_audio_duration_ms = NULL
          WHERE message_id IN (${ph})`,
    args: ids,
  });
  await db.execute({ sql: `DELETE FROM message_library WHERE message_id IN (${ph})`, args: ids });
  await db.execute({
    sql: `DELETE FROM generated_audio_assets WHERE message_id IN (${ph})`,
    args: ids,
  });
  await db.execute({ sql: `DELETE FROM messages WHERE id IN (${ph})`, args: ids });
  return ids.length;
}

/** 표시용 텍스트에서 [tag] 마커 제거 (앱에는 태그 없이 보여준다). */
function stripDeliveryTags(text: string): string {
  return text
    .replace(/\[[a-z][a-z -]{1,32}\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 스톡 클립 1개 생성: Vertex 로 문구/번역/태그 → ElevenLabs 합성 → R2 저장 →
 * messages(is_preset=1) + generated_audio_assets insert. 멱등 보장은 호출자
 * (findMissingStockTargets) 가 담당한다.
 */
export async function generateStockClip(
  db: Client,
  env: Env,
  target: StockClipTarget,
): Promise<GeneratedStockClip> {
  const language = normalizeSynthesisLanguage(target.language);

  const prepared = await prepareAlarmTextWithVertex(env, target.baseText, {
    targetLanguage: language,
    sourceLanguage: 'ko',
    translate: language !== 'ko',
    autoTag: true,
  });
  const synthesisText = prepared.text;
  const displayText = stripDeliveryTags(synthesisText) || stripDeliveryTags(target.baseText);
  const deliveryTagsJson = JSON.stringify(prepared.tags);

  const attempts = createSynthesisAttempts({
    env,
    profile: { elevenlabs_voice_id: target.elevenlabsVoiceId },
    text: synthesisText,
    language,
    category: target.category,
  });
  if (attempts.length === 0) {
    throw new Error('No synthesis provider available (ELEVENLABS_API_KEY missing?)');
  }
  const attempt = attempts[0]!;

  const cacheKey = await computeTtsCacheKey({
    provider: attempt.provider,
    providerVoiceId: attempt.providerVoiceId,
    voiceProfileId: target.voiceProfileId,
    modelId: attempt.modelId,
    language,
    languageCode: language,
    text: synthesisText,
    outputFormat: attempt.outputFormat,
    voiceSettings: attempt.voiceSettings,
  });

  const generated = await attempt.synthesize();
  const bytes = generated.bytes;

  if (!env.VOICE_BUCKET) {
    throw new Error('VOICE_BUCKET (R2) is not configured.');
  }
  const storage = new R2VoiceStorage(env.VOICE_BUCKET);
  const audioObjectKey = generatedTtsObjectKey(
    SYSTEM_VOICE_LIBRARY_USER_ID,
    cacheKey,
    generated.outputFormat,
  );
  await storage.storeAtKey(audioObjectKey, {
    bytes,
    userId: SYSTEM_VOICE_LIBRARY_USER_ID,
    mimeType: generated.mimeType,
    originalName: `stock_${cacheKey}.${generated.outputFormat}`,
  });
  const audioUrl = `r2://${audioObjectKey}`;

  const messageId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO messages
          (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
           category, language, is_preset, audio_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    args: [
      messageId,
      SYSTEM_VOICE_LIBRARY_USER_ID,
      target.voiceProfileId,
      displayText,
      synthesisText,
      deliveryTagsJson,
      target.category,
      language,
      audioUrl,
    ],
  });

  await db.execute({
    sql: `INSERT OR IGNORE INTO generated_audio_assets
          (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
           model_id, language, request_hash, text, original_text, delivery_tags_json,
           category, audio_url, audio_object_key, audio_format, mime_type, size_bytes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      crypto.randomUUID(),
      SYSTEM_VOICE_LIBRARY_USER_ID,
      target.voiceProfileId,
      messageId,
      generated.provider,
      generated.providerVoiceId,
      generated.modelId,
      language,
      cacheKey,
      synthesisText,
      displayText,
      deliveryTagsJson,
      target.category,
      audioUrl,
      audioObjectKey,
      generated.outputFormat,
      generated.mimeType,
      bytes.byteLength,
    ],
  });

  return {
    message_id: messageId,
    voice_profile_id: target.voiceProfileId,
    voice_name: target.voiceName,
    category: target.category,
    language,
    text: displayText,
  };
}
