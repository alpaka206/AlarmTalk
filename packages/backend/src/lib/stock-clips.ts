import type { Client } from '@libsql/client/web';
import type { Env } from '../types';
import { R2VoiceStorage } from './r2-storage';
import { computeTtsCacheKey, generatedTtsObjectKey } from './audio-cache';
import { createSynthesisAttempts, normalizeSynthesisLanguage } from './voice-provider';
import { applyDeliveryTagPerSentence, prepareAlarmTextWithVertex, generatePrerenderClipText } from './vertex-translate';
import { withWriteTransaction, type DbExecutor } from './transactions';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from './consent';
import { enqueueExternalDeletion } from './audio-retention';

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
export const FREE_BUCKET_CATEGORIES: readonly string[] = STOCK_CLIP_PRESETS.map(
  (preset) => preset.category,
).filter((category) => category !== STOCK_GREETING_CATEGORY);

/**
 * 유료 클론 목소리에 사전렌더할 알람 버킷 카테고리(greeting 미리듣기는 별도로 항상 포함).
 * 날씨/운세는 '조건·테마'를 variant 인덱스로 담는다(category 는 하나, variant 순서가 조건/테마).
 * 재생 시 클라가 (날씨=지역 신호 / 운세=사주+날짜)로 로컬에서 조건·테마 인덱스를 골라 매칭한다.
 */
export const PAID_BUCKET_CATEGORIES: readonly string[] = [
  'weather',
  'fortune',
  'love',
  'medication',
];

/** 유료 클론이 사전렌더 대상으로 삼는 카테고리(알람 버킷 + greeting 미리듣기 겸 기상 인사). */
export const CLONE_PRERENDER_CATEGORIES: readonly string[] = [
  ...PAID_BUCKET_CATEGORIES,
  STOCK_GREETING_CATEGORY,
];

/**
 * 날씨 variant 인덱스 ↔ 조건. 클라가 라이브 날씨 신호를 이 순서의 인덱스로 매핑해 해당 클립을
 * 고른다. 순서를 바꾸면 기존 사전렌더 인덱스와 어긋나므로 append-only 로 관리한다.
 */
export const CLONE_WEATHER_CONDITIONS = [
  'nice',
  'rain',
  'snow',
  'dust',
  'cloud',
  'fog',
  'heat',
  'cold',
] as const;

/** 운세 variant 인덱스 ↔ 테마(오락용, 개인정보 미포함). 클라가 사주+날짜로 인덱스를 고른다. */
export const CLONE_FORTUNE_THEMES = [
  'luck',
  'caution',
  'wealth',
  'health',
  'relationship',
] as const;

/**
 * 유료 클론 사전렌더의 '의미 seed'. 각 문자열은 최종 문구가 아니라 생성 지시(outcome)이며,
 * generatePrerenderClipText 가 그 목소리의 관계/호칭/말투에 맞춰 실제 문구로 만든다. 소량 유지.
 * greeting=기상 인사(미리듣기 겸용). weather=CLONE_WEATHER_CONDITIONS 순서(0..7) + 미해결 안내 1(마지막),
 * fortune=CLONE_FORTUNE_THEMES 순서(기기 결정적이라 미해결 없음).
 */
export const CLONE_CLIP_SEEDS: {
  category: string;
  defaultTag: string;
  seeds: readonly string[];
}[] = [
  {
    category: STOCK_GREETING_CATEGORY,
    defaultTag: 'cheerfully',
    seeds: [
      '다정하게 아침 인사를 하며 잘 잤는지 안부를 묻고, 오늘 하루도 기분 좋게 시작하자고 따뜻하게 깨워 준다.',
    ],
  },
  {
    category: 'weather',
    defaultTag: 'cheerfully',
    // seeds[0..7] = CLONE_WEATHER_CONDITIONS 순서(nice/rain/snow/dust/cloud/fog/heat/cold).
    // seeds[8] = '날씨 미해결' 안내(반드시 마지막). 준비창에서 인터넷이 안 돼 날씨를 못 받아온 경우,
    // 클라가 무음/오재생(맑음) 대신 이 클립으로 폴백해 정직하게 안내한다(클라 bucketVariantIndex 의
    // size-1 규약 = 마지막 클립). resolvePrerenderWeatherIndex 는 0..7 만 반환하므로 8 은 오직 폴백용.
    seeds: [
      '오늘 날씨가 맑고 좋다고 알리며, 잠깐 바깥바람을 쐬거나 산책하기에도 좋겠다고 가볍게 권한다.',
      '오늘 비가 온다고 알리고, 나갈 때 우산을 꼭 챙기고 길이 미끄러우니 조심하라고 다정하게 당부한다.',
      '오늘 눈이 온다고 알리고, 미끄러우니 따뜻하게 입고 발밑을 조심하라고 챙긴다.',
      '오늘 미세먼지가 심하다고 알리고, 외출할 때 마스크를 꼭 챙기라고 다정하게 당부한다.',
      '오늘 하늘이 흐리다고 알리며, 그래도 기분까지 흐려지지 않게 오늘 하루도 힘내라고 따뜻하게 챙긴다.',
      '오늘 안개가 짙다고 알리고, 길을 나설 때 시야가 안 좋으니 천천히 조심해서 다니라고 챙긴다.',
      '오늘 날이 많이 덥다고 알리고, 물을 자주 마시고 더위 먹지 않게 조심하라고 다정하게 챙긴다.',
      '오늘 날이 많이 춥다고 알리고, 따뜻하게 든든히 입고 감기 걸리지 않게 조심하라고 다정하게 챙긴다.',
      '인터넷이 연결되지 않아 오늘 날씨를 미리 확인하지 못했다고 미안한 듯 알리고, 그래도 오늘 하루 좋은 일만 가득하길 바란다고 다정하게 응원한다.',
    ],
  },
  {
    category: 'fortune',
    defaultTag: 'playfully',
    seeds: [
      '오늘은 전반적으로 운이 좋은 날이라고 가볍고 재미로 전하며, 좋은 일이 있을 것 같으니 기대해도 좋겠다고 한다.',
      '오늘은 작은 실수나 서두름만 조심하면 괜찮은 날이라고 가볍게, 천천히 하면 다 잘될 거라고 다독인다.',
      '오늘은 재물운이 살짝 따르는 날이라고 재미로 전하며, 뜻밖의 좋은 소식이 있을지도 모른다고 가볍게 한다.',
      '오늘은 컨디션을 잘 챙기면 좋은 날이라고, 무리하지 말고 몸을 아끼라고 다정하게 당부한다.',
      '오늘은 사람들과의 사이에서 기분 좋은 일이 있을 수 있다고 가볍게, 주변에 다정하게 대하면 좋겠다고 한다.',
    ],
  },
  {
    category: 'love',
    defaultTag: 'happy',
    seeds: [
      '사랑하는 마음을 담아, 오늘도 곁에서 응원하고 있다고 다정하게 힘을 준다.',
      '보고 싶었다는 마음과 함께, 오늘 하루도 잘 보내고 밥 잘 챙겨 먹으라고 따뜻하게 챙긴다.',
      '힘든 일이 있으면 언제든 기대도 된다고, 늘 네 편이라고 다정하게 응원한다.',
    ],
  },
  {
    category: 'medication',
    defaultTag: 'cheerfully',
    seeds: [
      '약 먹을 시간이라고 알리고, 까먹지 말고 물이랑 꼭 챙겨 드시고 건강 잘 챙기시라고 다정하게 당부한다.',
      '약 챙길 시간이라고 부드럽게 알리고, 잊지 말고 지금 바로 드시라고 챙긴다.',
      '약 드실 시간이라고 알리며, 오늘 하루도 건강하게 잘 보내시라고 따뜻하게 응원한다.',
    ],
  },
];

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
  /**
   * 이 클립을 소유할 유저. 시스템 보이스는 SYSTEM_VOICE_LIBRARY_USER_ID, 유료 클론은
   * 실소유자 PK. messages/generated_audio_assets.user_id 와 R2 object key owner 로 쓰인다.
   */
  ownerUserId: string;
  category: string;
  baseText: string;
  language: string;
  /** 같은 (보이스·카테고리·언어) 안에서 문구를 구분/정렬하는 0-based 인덱스. */
  variantIndex: number;
  /**
   * true 면 baseText 를 '의미 seed' 로 보고 그 목소리의 관계/호칭/말투에 맞춰 문구를 생성한다
   * (유료 클론). false(시스템)면 baseText 를 리터럴로 번역+태깅만 한다.
   */
  toneAdapt: boolean;
  /** 톤 적응 생성용 관계/호칭(클론만). generatePrerenderClipText 로 전달된다. */
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  /** 톤 적응 생성 시 카테고리 기본 delivery 태그. */
  defaultTag?: string;
  /** 등록 미리듣기에서 확정된 preview_text(클론만) — 톤/어투 스타일 레퍼런스. */
  styleReference?: string | null;
  claimToken?: string;
}

/** 사전렌더 대상 보이스(시스템 or 유료 클론). ownerUserId·categories 로 소유자/버킷을 구분. */
export interface PrerenderVoice {
  id: string;
  name: string;
  elevenlabsVoiceId: string;
  ownerUserId: string;
  /** 이 보이스에 렌더할 카테고리 집합. 시스템=전체, 클론=CLONE_PRERENDER_CATEGORIES. */
  categories: readonly string[];
  /**
   * 지정 시 이 보이스의 모든 카테고리를 이 언어 1개로만 렌더(클론=확정 시점 앱 언어).
   * 미지정 시 각 preset 의 languages 를 그대로 쓴다(시스템=ko/en/ja).
   */
  languageOverride?: string;
  /** true 면 CLONE_CLIP_SEEDS(톤 적응)로, 아니면 STOCK_CLIP_PRESETS(리터럴)로 대상 계산. */
  isClone?: boolean;
  /** 클론 톤 적응 생성용 관계/호칭. */
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  /** 등록 미리듣기에서 확정된 preview_text(클론만) — 톤/어투 스타일 레퍼런스. */
  styleReference?: string | null;
  claimToken?: string;
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

/** 시스템 보이스를 사전렌더 대상(전 카테고리·preset 언어 그대로)으로 변환. */
export function systemPrerenderVoices(voices: SystemVoiceRow[]): PrerenderVoice[] {
  const allCategories = STOCK_CLIP_PRESETS.map((preset) => preset.category);
  return voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    elevenlabsVoiceId: voice.elevenlabsVoiceId,
    ownerUserId: SYSTEM_VOICE_LIBRARY_USER_ID,
    categories: allCategories,
  }));
}

/**
 * 큐가 지목한 id 들 중 사전렌더 준비된(ready) 유료 클론 목소리 목록. 실소유자(user_id)를
 * ownerUserId 로 싣고 CLONE_PRERENDER_CATEGORIES(+앱 언어 1개)로 스코프한다. voiceIds 가
 * 비면 빈 배열(전유저 스캔 방지).
 */
export async function listReadyCloneVoices(
  db: Client,
  requests: readonly {
    voiceProfileId: string;
    ownerUserId: string;
    language: string;
    claimToken: string;
  }[],
): Promise<PrerenderVoice[]> {
  if (requests.length === 0) return [];
  const byId = new Map(requests.map((r) => [r.voiceProfileId, r]));
  const ids = [...byId.keys()];
  const ph = ids.map(() => '?').join(',');
  const res = await db.execute({
    sql: `SELECT id, name, elevenlabs_voice_id, relationship_label, listener_title, preview_text
          FROM voice_profiles
          WHERE COALESCE(is_system, 0) = 0
            AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 0
            AND status = 'ready'
            AND elevenlabs_voice_id IS NOT NULL
            AND id IN (${ph})`,
    args: ids,
  });
  const out: PrerenderVoice[] = [];
  for (const row of res.rows) {
    const id = String(row.id);
    const req = byId.get(id);
    const elevenlabsVoiceId = String(row.elevenlabs_voice_id ?? '');
    if (!req || elevenlabsVoiceId.length === 0) continue;
    const relationshipLabel = ((row.relationship_label as string | null) ?? '').trim() || null;
    const listenerTitle = ((row.listener_title as string | null) ?? '').trim() || null;
    const styleReference = ((row.preview_text as string | null) ?? '').trim() || null;
    out.push({
      id,
      name: String(row.name),
      elevenlabsVoiceId,
      ownerUserId: req.ownerUserId,
      categories: CLONE_PRERENDER_CATEGORIES,
      languageOverride: normalizeSynthesisLanguage(req.language),
      isClone: true,
      relationshipLabel,
      listenerTitle,
      styleReference,
      claimToken: req.claimToken,
    });
  }
  return out;
}

/**
 * 아직 생성되지 않은 (보이스 × 카테고리 × 언어) 조합. voices 를 주면 그 목록으로,
 * 안 주면 시스템 보이스 전체로 계산한다. 대상 보이스 id 로 기존 클립 조회를 스코프해
 * 전유저 is_preset 스캔(CPU/메모리 폭증)을 피한다.
 */
export async function findMissingStockTargets(
  db: Client,
  voices?: PrerenderVoice[],
): Promise<StockClipTarget[]> {
  const prerenderVoices = voices ?? systemPrerenderVoices(await listSystemVoices(db));
  if (prerenderVoices.length === 0) return [];

  const voiceIds = prerenderVoices.map((voice) => voice.id);
  const ph = voiceIds.map(() => '?').join(',');
  const existing = await db.execute({
    sql: `SELECT voice_profile_id, category, language, variant
          FROM messages
          WHERE COALESCE(is_preset, 0) = 1 AND audio_url IS NOT NULL
            AND voice_profile_id IN (${ph})`,
    args: voiceIds,
  });
  const seen = new Set(
    existing.rows.map(
      (row) =>
        `${row.voice_profile_id}|${row.category}|${row.language}|${Number(row.variant ?? 0)}`,
    ),
  );

  const targets: StockClipTarget[] = [];
  for (const voice of prerenderVoices) {
    // 클론=CLONE_CLIP_SEEDS(관계/호칭 톤 적응), 시스템=STOCK_CLIP_PRESETS(리터럴 번역+태깅).
    const sources = voice.isClone
      ? CLONE_CLIP_SEEDS.map((s) => ({
          category: s.category,
          defaultTag: s.defaultTag,
          languages: undefined as readonly string[] | undefined,
          entries: s.seeds,
        }))
      : STOCK_CLIP_PRESETS.map((p) => ({
          category: p.category,
          defaultTag: undefined as string | undefined,
          languages: p.languages as readonly string[],
          entries: p.variants as readonly string[],
        }));
    for (const source of sources) {
      if (!voice.categories.includes(source.category)) continue;
      const languages = voice.languageOverride
        ? [voice.languageOverride]
        : (source.languages ?? ['ko']);
      source.entries.forEach((entry, variantIndex) => {
        for (const language of languages) {
          const lang = normalizeSynthesisLanguage(language);
          if (seen.has(`${voice.id}|${source.category}|${lang}|${variantIndex}`)) continue;
          // 시스템 greeting 은 보이스별 개성 멘트가 있으면 그것을 리터럴로 쓴다.
          const baseText =
            !voice.isClone && source.category === STOCK_GREETING_CATEGORY
              ? (VOICE_GREETING_OVERRIDES[voice.elevenlabsVoiceId] ?? entry)
              : entry;
          targets.push({
            voiceProfileId: voice.id,
            voiceName: voice.name,
            elevenlabsVoiceId: voice.elevenlabsVoiceId,
            ownerUserId: voice.ownerUserId,
            category: source.category,
            baseText,
            language: lang,
            variantIndex,
            toneAdapt: Boolean(voice.isClone),
            relationshipLabel: voice.relationshipLabel ?? null,
            listenerTitle: voice.listenerTitle ?? null,
            defaultTag: source.defaultTag,
            styleReference: voice.styleReference ?? null,
            claimToken: voice.claimToken,
          });
        }
      });
    }
  }
  return targets;
}

/**
 * 사전렌더 큐에 유료 클론 목소리를 적재. voice_profile_id PK 라 이미 있으면 무시(멱등) —
 * 재확정/훅 중복 트리거가 있어도 큐가 1행으로 유지되고, 이미 done 인 목소리를 다시 pending
 * 으로 되돌려 재합성 낭비를 만들지 않는다(문구변경 재렌더는 follow-up).
 */
export async function enqueuePrerender(
  db: DbExecutor,
  voiceProfileId: string,
  ownerUserId: string,
  language: string,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language)
          VALUES (?, ?, ?)
          ON CONFLICT(voice_profile_id) DO NOTHING`,
    args: [voiceProfileId, ownerUserId, normalizeSynthesisLanguage(language)],
  });
}

/** cron 이 드레인할 pending 큐 항목을 15분 임대로 원자적 claim. limit 은 1..50 로 클램프. */
export async function claimPendingPrerenderVoices(
  db: Client,
  limit: number,
): Promise<PrerenderClaim[]> {
  const claimToken = crypto.randomUUID();
  const res = await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET claimed_at = datetime('now'), claim_token = ?, updated_at = datetime('now')
          WHERE voice_profile_id IN (
            SELECT voice_profile_id
            FROM voice_prerender_queue
            WHERE status = 'pending'
              AND (claimed_at IS NULL OR claimed_at <= datetime('now', '-15 minutes'))
            ORDER BY requested_at ASC
            LIMIT ?
          )
            AND status = 'pending'
            AND (claimed_at IS NULL OR claimed_at <= datetime('now', '-15 minutes'))
          RETURNING voice_profile_id, owner_user_id, language, claim_token`,
    args: [claimToken, Math.max(1, Math.min(Math.trunc(limit), 50))],
  });
  return res.rows.map((row) => ({
    voiceProfileId: String(row.voice_profile_id),
    ownerUserId: String(row.owner_user_id),
    language: String(row.language),
    claimToken: String(row.claim_token),
  }));
}

export type PrerenderClaim = {
  readonly voiceProfileId: string;
  readonly ownerUserId: string;
  readonly language: string;
  readonly claimToken: string;
};

export async function releasePrerenderClaim(
  db: Client,
  voiceProfileId: string,
  claimToken: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET claimed_at = NULL, claim_token = NULL, updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending' AND claim_token = ?`,
    args: [voiceProfileId, claimToken],
  });
}

/** 해당 목소리의 사전렌더 완료 표시(missing 이 0이 됐을 때). */
export async function markPrerenderDone(
  db: Client,
  voiceProfileId: string,
  claimToken: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET status = 'done', claimed_at = NULL, claim_token = NULL, updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending' AND claim_token = ?`,
    args: [voiceProfileId, claimToken],
  });
}

/** 사전렌더 실패 1회 기록. attempts 상한(5) 초과 시 failed 로 내려 무한 재시도를 막는다. */
export async function markPrerenderFailed(
  db: Client,
  voiceProfileId: string,
  claimToken: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET attempts = attempts + 1,
              status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
              claimed_at = NULL,
              claim_token = NULL,
              updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending' AND claim_token = ?`,
    args: [voiceProfileId, claimToken],
  });
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
  if (!env.VOICE_BUCKET) {
    throw new Error('VOICE_BUCKET (R2) is not configured.');
  }
  const assertCloneAuthorization = async () => {
    if (!target.toneAdapt) return;
    if (!target.claimToken) throw new Error('Voice prerender claim token is missing.');
    const authorized = await db.execute({
      sql: `SELECT vp.id FROM voice_profiles vp
            JOIN voice_prerender_queue q ON q.voice_profile_id = vp.id
            WHERE vp.id = ? AND vp.deleted_at IS NULL AND vp.status = 'ready'
              AND COALESCE(vp.is_draft, 0) = 0 AND q.owner_user_id = ?
              AND q.status = 'pending' AND q.claim_token = ?`,
      args: [target.voiceProfileId, target.ownerUserId, target.claimToken],
    });
    if (authorized.rows.length === 0) throw new Error('Voice prerender authorization expired.');
    if (await missingConsentType(db, target.ownerUserId, SENSITIVE_REQUIRED_CONSENTS)) {
      throw new Error('Voice prerender consent was withdrawn.');
    }
  };
  await assertCloneAuthorization();
  const language = normalizeSynthesisLanguage(target.language);

  let synthesisText: string;
  let displayText: string;
  let deliveryTagsJson: string;
  if (target.toneAdapt) {
    // 유료 클론: baseText 를 '의미 seed' 로 보고 그 목소리의 관계/호칭/말투에 맞춰 문구 생성.
    // 실패 시 throw → 호출자(cron)가 재시도(나쁜 폴백 문구를 저장하지 않는다).
    const generated = await generatePrerenderClipText(env, {
      seed: target.baseText,
      relationshipLabel: target.relationshipLabel,
      listenerTitle: target.listenerTitle,
      targetLanguage: language,
      defaultTag: target.defaultTag,
      styleReference: target.styleReference,
    });
    displayText = generated.text;
    // 태그를 문장마다 다시 앞세워 클립 끝까지 전달 톤이 풀리지 않게 한다.
    synthesisText = generated.tag
      ? applyDeliveryTagPerSentence(generated.tag, generated.text)
      : generated.text;
    deliveryTagsJson = JSON.stringify(generated.tag ? [generated.tag] : []);
  } else {
    const prepared = await prepareAlarmTextWithVertex(env, target.baseText, {
      targetLanguage: language,
      sourceLanguage: 'ko',
      translate: language !== 'ko',
      autoTag: true,
    });
    synthesisText = prepared.text;
    displayText = stripDeliveryTags(synthesisText) || stripDeliveryTags(target.baseText);
    deliveryTagsJson = JSON.stringify(prepared.tags);
  }

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
  await assertCloneAuthorization();

  const storage = new R2VoiceStorage(env.VOICE_BUCKET);
  const audioObjectKey = generatedTtsObjectKey(
    target.ownerUserId,
    cacheKey,
    generated.outputFormat,
  );
  await storage.storeAtKey(audioObjectKey, {
    bytes,
    userId: target.ownerUserId,
    mimeType: generated.mimeType,
    originalName: `stock_${cacheKey}.${generated.outputFormat}`,
  });
  const audioUrl = `r2://${audioObjectKey}`;
  const discardStagedAudio = async () => {
    try {
      await storage.delete(audioObjectKey);
    } catch {
      await enqueueExternalDeletion(db, 'r2_object', audioObjectKey);
    }
  };

  const messageId = crypto.randomUUID();
  // 조건부 INSERT: 같은 (voice·category·language·variant) preset 이 이미 있으면 no-op. cron 이 겹쳐
  // 두 호출이 같은 target 을 동시에 렌더해도(findMissingStockTargets 는 순차 멱등만 보장) 중복 행이
  // 생기지 않는다. SQLite 단일 writer 라 INSERT…SELECT WHERE NOT EXISTS 가 원자적으로 직렬화된다.
  const publish = () =>
    withWriteTransaction(db, async (tx) => {
      if (
        target.toneAdapt &&
        (await missingConsentType(tx, target.ownerUserId, SENSITIVE_REQUIRED_CONSENTS))
      ) {
        throw new Error('Voice prerender consent was withdrawn.');
      }
    const insertedMessage = await tx.execute({
      sql: `INSERT INTO messages
          (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
           category, language, variant, is_preset, audio_url)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM messages
            WHERE voice_profile_id = ? AND category = ? AND language = ? AND variant = ?
              AND COALESCE(is_preset, 0) = 1
          )
            AND (? = 0 OR EXISTS (
              SELECT 1 FROM voice_profiles vp
              JOIN voice_prerender_queue q ON q.voice_profile_id = vp.id
              WHERE vp.id = ? AND vp.deleted_at IS NULL AND vp.status = 'ready'
                AND COALESCE(vp.is_draft, 0) = 0 AND q.owner_user_id = ?
                AND q.status = 'pending' AND q.claim_token = ?
            ))`,
      args: [
        messageId,
        target.ownerUserId,
        target.voiceProfileId,
        displayText,
        synthesisText,
        deliveryTagsJson,
        target.category,
        language,
        target.variantIndex,
        audioUrl,
        target.voiceProfileId,
        target.category,
        language,
        target.variantIndex,
        target.toneAdapt ? 1 : 0,
        target.voiceProfileId,
        target.ownerUserId,
        target.claimToken ?? '',
      ],
    });

    if ((insertedMessage.rowsAffected ?? 0) === 0) {
      const existing = await tx.execute({
        sql: `SELECT id, text, audio_url FROM messages
              WHERE voice_profile_id = ? AND category = ? AND language = ? AND variant = ?
                AND COALESCE(is_preset, 0) = 1
              LIMIT 1`,
        args: [target.voiceProfileId, target.category, language, target.variantIndex],
      });
      const row = existing.rows[0];
      return row
        ? {
            inserted: false as const,
            messageId: String(row.id),
            text: String(row.text ?? displayText),
            audioUrl: String(row.audio_url ?? ''),
          }
        : null;
    }

    await tx.execute({
      sql: `INSERT OR IGNORE INTO generated_audio_assets
            (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
             model_id, language, request_hash, text, original_text, delivery_tags_json,
             category, audio_url, audio_object_key, audio_format, mime_type, size_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        target.ownerUserId,
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
    return { inserted: true as const, messageId, text: displayText, audioUrl };
    });
  let publication: Awaited<ReturnType<typeof publish>>;
  try {
    publication = await publish();
  } catch (error) {
    await discardStagedAudio();
    throw error;
  }

  if (!publication) {
    await discardStagedAudio();
    throw new Error('Preset publication authorization expired.');
  }
  if (!publication.inserted && publication.audioUrl !== audioUrl) {
    await discardStagedAudio();
  }

  return {
    message_id: publication.messageId,
    voice_profile_id: target.voiceProfileId,
    voice_name: target.voiceName,
    category: target.category,
    language,
    variant: target.variantIndex,
    text: publication.text,
  };
}
