import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { R2VoiceStorage } from './r2-storage';
import { computeTtsCacheKey, generatedTtsObjectKey } from './audio-cache';
import { createSynthesisAttempts, normalizeSynthesisLanguage } from './voice-provider';
import { prepareAlarmTextWithVertex } from './vertex-translate';

/** 시스템 스톡 보이스의 소유자(로그인 불가, 발급 전용). migrations.ts #43 과 동일. */
export const SYSTEM_VOICE_LIBRARY_USER_ID = '70000000-0000-4000-9000-000000000001';

/** 스톡 클립을 만들 수 있는 언어. 한국어 베이스 → 영어/일본어는 Vertex 로 번역. */
export const STOCK_CLIP_LANGUAGES = ['ko', 'en', 'ja'] as const;

/** 목소리 미리듣기(샘플 인사말) 카테고리 — 알람 클립과 구분해 앱에서 따로 쓴다. */
export const STOCK_GREETING_CATEGORY = 'greeting';

/**
 * 스톡 클립 프리셋. baseText 는 태그 없는 한국어 한 줄이며, 합성 직전에
 * Vertex 로 (번역 +) ElevenLabs v3 딜리버리 태그 1개를 자동 부여한다.
 * languages 로 프리셋별 생성 언어를 지정한다 (greeting 은 샘플이라 한국어만).
 *
 * 카테고리를 늘리려면 여기에 추가하면 findMissingStockTargets 가 자동으로
 * (보이스 × 언어) 매트릭스를 채운다.
 */
export const STOCK_CLIP_PRESETS = [
  // 무료 플랜 알람 "버킷". 카테고리당 여러 variants(문구)를 시스템 보이스마다 한국어·
  // 영어·일본어로 미리 합성해 둔다(en/ja 는 Vertex 번역). 앱은 한 버킷의 변형들을 전부
  // 로컬 캐시한 뒤, 알람이 울릴 때마다 순차로 돌려가며 재생한다(완전 오프라인).
  //  - 무료 버킷 = 기상(morning) 8문구 + 약(medication) 2문구. (보이스당 (8+2)×3언어 = 30클립)
  //  - greeting 은 알람이 아니라 목소리 미리듣기용 1문구(한국어).
  //  - 버킷을 늘리려면 카테고리를 추가하고 재시드하면 된다(FREE_BUCKET_CATEGORIES 가 자동 반영).
  {
    category: 'morning',
    languages: ['ko', 'en', 'ja'],
    variants: [
      '좋은 아침이에요. 잘 잤어요? 천천히 기지개 켜고 오늘 하루도 산뜻하게 시작해 봐요.',
      '아침이 밝았어요. 이불 속에서 조금만 더 있고 싶겠지만, 지금 살짝 일어나 볼까요?',
      '일어날 시간이에요. 무겁게 생각하지 말고 발끝부터 꼼지락 움직이면서 깨워 봐요.',
      '굿모닝! 오늘은 어떤 하루가 기다리고 있을까요. 가볍게 웃으면서 시작해요.',
      '창밖이 벌써 환해졌어요. 물 한 잔 마시고 정신을 깨우면 하루가 한결 수월해질 거예요.',
      '자, 이제 진짜 일어날 시간이에요. 딱 한 번 크게 기지개 켜고 몸을 일으켜 봐요.',
      '오늘도 당신을 위한 아침이 왔어요. 서두르지 말고 천천히 하루를 열어 봐요.',
      '알람이 울렸어요. 눈 한번 깜빡이고, 심호흡 한 번 하고, 가볍게 일어나 봐요.',
    ],
  },
  {
    category: 'medication',
    languages: ['ko', 'en', 'ja'],
    variants: [
      '약 먹을 시간이에요. 물 한 잔과 함께 잊지 말고 꼭 챙겨 드세요.',
      '약 챙길 시간이에요. 잠깐이면 되니까 지금 바로 드시고 가요.',
    ],
  },
  {
    category: STOCK_GREETING_CATEGORY,
    // 목소리 창에서 "이 목소리는 이런 느낌" 을 들려주는 짧은 인사 샘플(미리듣기, 한국어).
    languages: ['ko'],
    variants: ['안녕하세요? 만나서 반가워요. 앞으로 기분 좋은 아침을 함께할게요.'],
  },
] as const;

/**
 * 무료 플랜이 알람 버킷으로 고를 수 있는 카테고리(greeting 제외). 스톡 프리셋이 단일
 * 출처이므로, STOCK_CLIP_PRESETS 에 카테고리를 추가하면 자동으로 버킷 후보가 된다.
 */
export const FREE_BUCKET_CATEGORIES: readonly string[] = STOCK_CLIP_PRESETS
  .map((preset) => preset.category)
  .filter((category) => category !== STOCK_GREETING_CATEGORY);

/**
 * 보이스별 인사말(greeting 카테고리) 문구. 키는 elevenlabs_voice_id.
 * 없는 보이스는 STOCK_CLIP_PRESETS 의 기본 greeting 문구를 쓴다.
 * 미리듣기에서 각 목소리의 개성이 드러나도록 톤을 음성별로 맞췄다.
 */
export const VOICE_GREETING_OVERRIDES: Record<string, string> = {
  // 아담(Adam) — 릴스/숏폼에서 유행한 들뜬 자기소개 톤. [excited] 태그로 딜리버리 고정
  // (Vertex autoTag 에 맡기지 않고 직접 박음. stripDeliveryTags 가 표시용에선 태그 제거).
  pNInz6obpgDQGcFmaJgB: '[excited] 여러분! 저 됐어요! 알람톡 음성 됐어요! 반가워요!',
  // 미나·하준·소은 — 목소리 특징이나 알람 기능을 드러내지 않는 담백한 첫인사.
  aiUUgjHa4mpHf6UenZuf: '안녕하세요! 만나서 정말 반가워요. 앞으로 자주 봐요.',
  LKOcTG4J4tYTPR9DnLeM: '안녕하세요. 반가워요. 우리 앞으로 잘 지내봐요.',
  cgSgspJ2msm6clMCkdW9: '안녕하세요. 앞으로 저와 함께해요. 잘 부탁해요.',
};

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
  /** 같은 (보이스·카테고리·언어) 안에서 문구를 구분/정렬하는 0-based 인덱스. */
  variantIndex: number;
}

export interface GeneratedStockClip {
  message_id: string;
  voice_profile_id: string;
  voice_name: string;
  category: string;
  language: string;
  variant: number;
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
    sql: `SELECT voice_profile_id, category, language, variant
          FROM messages
          WHERE COALESCE(is_preset, 0) = 1 AND audio_url IS NOT NULL`,
    args: [],
  });
  const seen = new Set(
    existing.rows.map(
      (row) =>
        `${row.voice_profile_id}|${row.category}|${row.language}|${Number(row.variant ?? 0)}`,
    ),
  );

  const targets: StockClipTarget[] = [];
  for (const voice of voices) {
    for (const preset of STOCK_CLIP_PRESETS) {
      preset.variants.forEach((variantText, variantIndex) => {
        for (const language of preset.languages) {
          const lang = normalizeSynthesisLanguage(language);
          if (seen.has(`${voice.id}|${preset.category}|${lang}|${variantIndex}`)) continue;
          // greeting 은 보이스별 개성 멘트가 있으면 그것을, 없으면 기본 문구를 쓴다.
          const baseText =
            preset.category === STOCK_GREETING_CATEGORY
              ? (VOICE_GREETING_OVERRIDES[voice.elevenlabsVoiceId] ?? variantText)
              : variantText;
          targets.push({
            voiceProfileId: voice.id,
            voiceName: voice.name,
            elevenlabsVoiceId: voice.elevenlabsVoiceId,
            category: preset.category,
            baseText,
            language: lang,
            variantIndex,
          });
        }
      });
    }
  }
  return targets;
}

/** 스톡 클립 삭제 필터. 비우면 전체(reset), 채우면 특정 보이스(+카테고리)만. */
export interface DeleteStockClipsFilter {
  /** elevenlabs_voice_id 로 특정 시스템 보이스만 한정. */
  elevenlabsVoiceId?: string;
  /** category 로 한정 (예: 'greeting'). elevenlabsVoiceId 와 함께 쓰면 보이스의 해당 클립만. */
  category?: string;
}

/**
 * 스톡 클립 삭제 (문구를 바꿔 재생성할 때 사용). 필터가 없으면 전체(reset),
 * 있으면 특정 보이스(+카테고리)만 지운다. messages·generated_audio_assets·
 * message_library 행과 R2 오브젝트를 정리하고, 혹시 이 클립을 참조하던 알람은
 * sound-only 로 떼어낸다. dev 반복용.
 */
export async function deleteStockClips(
  db: Client,
  env: Env,
  filter: DeleteStockClipsFilter = {},
): Promise<number> {
  const conditions = [
    'COALESCE(m.is_preset, 0) = 1',
    `m.voice_profile_id IN (
       SELECT id FROM voice_profiles
       WHERE COALESCE(is_system, 0) = 1
       ${filter.elevenlabsVoiceId ? 'AND elevenlabs_voice_id = ?' : ''}
     )`,
  ];
  const selectArgs: string[] = [];
  if (filter.elevenlabsVoiceId) selectArgs.push(filter.elevenlabsVoiceId);
  if (filter.category) {
    conditions.push('m.category = ?');
    selectArgs.push(filter.category);
  }

  const rows = await db.execute({
    sql: `SELECT m.id AS message_id, ga.audio_object_key AS audio_object_key
          FROM messages m
          LEFT JOIN generated_audio_assets ga ON ga.message_id = m.id
          WHERE ${conditions.join(' AND ')}`,
    args: selectArgs,
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

/** 전체 스톡 클립 삭제 (reset). deleteStockClips 의 무필터 호출. */
export async function deleteAllStockClips(db: Client, env: Env): Promise<number> {
  return deleteStockClips(db, env);
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
           category, language, variant, is_preset, audio_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    args: [
      messageId,
      SYSTEM_VOICE_LIBRARY_USER_ID,
      target.voiceProfileId,
      displayText,
      synthesisText,
      deliveryTagsJson,
      target.category,
      language,
      target.variantIndex,
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
    variant: target.variantIndex,
    text: displayText,
  };
}
