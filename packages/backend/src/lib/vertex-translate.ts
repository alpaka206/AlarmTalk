import type { Env } from '../types';

type VertexServiceAccount = {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  token_uri?: string;
};

type VertexTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type VertexGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export type AlarmTextPreparation = {
  text: string;
  translated: boolean;
  tags: string[];
  provider: 'vertex' | 'local';
};

export type DynamicAlarmTextMode =
  | 'wake_weather'
  | 'wake_fortune'
  | 'meal'
  | 'sleep'
  | 'exercise'
  | 'love';

// 구조화 날씨 시그널(설계 #7). 한국어 문자열 대신 언어무관 토큰으로 전달해, 동적 프롬프트가
// 타깃 언어로 네이티브 재표현하고 폴백도 언어별 표면을 만든다(한국어 누출 0).
export type WeatherConditionKind = 'rain' | 'snow' | 'dust' | 'cold' | 'heat' | 'nice';
export type WeatherAction = 'umbrella' | 'mask' | 'coat' | 'water' | 'walk';
export type WeatherCondition = { kind: WeatherConditionKind; action: WeatherAction };
export type WeatherSignal = { conditions: WeatherCondition[] };

export type DynamicAlarmTextContext = {
  mode: DynamicAlarmTextMode;
  category: string;
  targetLanguage: string;
  dateLabel: string;
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  weatherSignal?: WeatherSignal | null;
  fortuneProfile?: string | null;
  mealLabel?: string | null;
  alarmTimeLabel?: string | null;
};

export class AlarmTextTranslationUnavailableError extends Error {
  constructor() {
    super('Alarm text translation is not configured.');
    this.name = 'AlarmTextTranslationUnavailableError';
  }
}

export class AlarmTextPreparationInvalidError extends Error {
  constructor() {
    super('Alarm text preparation returned invalid content.');
    this.name = 'AlarmTextPreparationInvalidError';
  }
}

export class DynamicAlarmTextGenerationInvalidError extends Error {
  constructor() {
    super('Dynamic alarm text generation returned invalid content.');
    this.name = 'DynamicAlarmTextGenerationInvalidError';
  }
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_VERTEX_MODEL = 'gemini-2.5-flash';
const TAG_RE = /\[[a-z][a-z -]{1,32}\]/i;
// ElevenLabs v3 태그는 고정 enum이 아니라 대괄호 안 자연어 지시이며, 실제 효과는 보이스·문맥·
// stability에 따라 달라진다(2026-06-28 사용자/공식문서 검증). 아래는 우리가 예측가능성·
// 알람적합성·태그 낭독 방지를 위해 쓰는 큐레이트 세트(공식 문서/예시 실증분). 저각성 태그는
// 기상 목표와 충돌하므로 sleep 전용으로 가드한다.
const APPROVED_TAGS = [
  'happy',
  'cheerfully',
  'excited',
  'playfully',
  'curious',
  'lighthearted',
  'calm',
  'tired',
  'whispers',
  'quietly',
];
// Bruck/McFarlane: 저각성 신호는 기상을 방해 → sleep 모드에서만 허용.
const LOW_AROUSAL_TAGS = ['calm', 'tired', 'whispers', 'quietly'];

// 정규화 후 큐레이트 세트에 있으면 그대로, 아니면 무태그(''). 출시 전 단계라 옛 태그
// back-compat 매핑은 두지 않는다 — 세트 밖 태그는 SOFT로 무태그 강등.
function normalizeApprovedTag(tag: string): string {
  const normalized = normalizeTag(tag);
  return normalized && APPROVED_TAGS.includes(normalized) ? normalized : '';
}

// 모드별 기본 delivery 태그(§4.4). 폴백/가이드에 쓰인다.
function modeDefaultTag(mode: DynamicAlarmTextMode): string {
  switch (mode) {
    case 'wake_weather':
      return 'cheerfully';
    case 'wake_fortune':
      return 'playfully';
    case 'meal':
      return 'cheerfully';
    case 'sleep':
      return 'calm';
    case 'exercise':
      return 'cheerfully';
    case 'love':
      return 'happy';
    default:
      return 'cheerfully';
  }
}

// 동적 생성의 tag 필드를 정제한다: 큐레이트 세트 검증 → 저각성 sleep 전용 가드.
// 부적합하면 빈 문자열(무태그)로 강등(reject 아님 = SOFT).
function sanitizeDeliveryTag(tag: string, mode: DynamicAlarmTextMode): string {
  const approved = normalizeApprovedTag(tag);
  if (!approved) return '';
  if (LOW_AROUSAL_TAGS.includes(approved) && mode !== 'sleep') return '';
  return approved;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
};

export async function prepareAlarmTextWithVertex(
  env: Env,
  text: string,
  options: {
    targetLanguage: string;
    sourceLanguage?: string;
    translate?: boolean;
    autoTag?: boolean;
  },
): Promise<AlarmTextPreparation> {
  const trimmed = text.trim();
  const sourceLanguage = options.sourceLanguage ?? 'ko';
  const targetLanguage = options.targetLanguage || sourceLanguage;
  const shouldTranslate = options.translate === true && targetLanguage !== sourceLanguage;
  const shouldTag = options.autoTag !== false && !TAG_RE.test(trimmed);

  if (!trimmed) {
    return { text: trimmed, translated: false, tags: [], provider: 'local' };
  }

  if (!shouldTranslate && !shouldTag) {
    return {
      text: trimmed,
      translated: false,
      tags: extractTags(trimmed),
      provider: 'local',
    };
  }

  if (!hasGeminiConfiguration(env)) {
    if (shouldTranslate) {
      throw new AlarmTextTranslationUnavailableError();
    }
    const fallbackText = shouldTag ? tagAlarmTextLocally(trimmed) : trimmed;
    return {
      text: fallbackText,
      translated: false,
      tags: extractTags(fallbackText),
      provider: 'local',
    };
  }

  const prompt = alarmTextPrompt({
    text: trimmed,
    sourceLanguage,
    targetLanguage,
    shouldTranslate,
    shouldTag,
  });
  const provider = 'vertex';
  let raw: string;
  try {
    raw = await generateContentText(env, prompt, {
      temperature: 0.15,
      maxOutputTokens: 256,
    });
  } catch {
    if (shouldTranslate) {
      throw new AlarmTextPreparationInvalidError();
    }
    const fallbackText = shouldTag ? tagAlarmTextLocally(trimmed) : trimmed;
    return {
      text: fallbackText,
      translated: false,
      tags: extractTags(fallbackText),
      provider: 'local',
    };
  }
  const parsed = parseAlarmTextPreparation(raw);
  const fallbackText = shouldTag ? tagAlarmTextLocally(trimmed) : trimmed;
  let preparedText = parsed.text;

  if (
    !preparedText ||
    isMetaJsonResponse(preparedText) ||
    (!parsed.parsedJson && isMetaJsonResponse(raw))
  ) {
    if (shouldTranslate) {
      throw new AlarmTextPreparationInvalidError();
    }
    preparedText = fallbackText;
  }

  if (shouldTag && !shouldTranslate) {
    preparedText =
      normalizeSameLanguageTaggedText(preparedText, trimmed, parsed.tags) ?? fallbackText;
  }

  const tags = extractTags(preparedText);

  return {
    text: preparedText,
    translated: shouldTranslate,
    tags,
    provider,
  };
}

export async function generateDynamicAlarmTextWithVertex(
  env: Env,
  context: DynamicAlarmTextContext,
): Promise<AlarmTextPreparation> {
  const fallback = dynamicAlarmTextPreparationFallback(context);

  if (!isDynamicVertexTextEnabled(env) || !hasGeminiConfiguration(env)) {
    return fallback;
  }

  const prompt = dynamicAlarmTextPrompt(context);

  // 2단 검증(§4.7): HARD 차단 시 1회만 재롤하고, 그래도 막히면 회전식 폴백.
  // SOFT 이슈(조사/어체 슬립 등)는 polishDynamicAlarmText로 국소 수리만 하고 수용한다.
  // temperature 0.85→0.75로 낮춰 churn을 줄인다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await generateContentText(env, prompt, {
        temperature: 0.75,
        maxOutputTokens: 256,
        systemInstruction: DYNAMIC_SYSTEM_INSTRUCTION,
        responseSchema: DYNAMIC_RESPONSE_SCHEMA,
      });
    } catch {
      // 네트워크/인증 실패는 재롤로 풀리지 않으므로 즉시 폴백.
      return fallback;
    }

    const parsed = parseDynamicAlarmTextResult(raw);
    // SOFT 자동수리: 조사/띄어쓰기·손주 존대·형제 취침 어체 슬립을 reject가 아니라 수리한다.
    const text = polishDynamicAlarmText(parsed.text.trim(), context);

    if (dynamicTextHardFailure(text, context)) {
      continue; // HARD → 1회 재롤
    }

    const tag = sanitizeDeliveryTag(parsed.tag, context.mode);
    return {
      text,
      translated: false,
      tags: tag ? [tag] : [],
      provider: 'vertex',
    };
  }

  return fallback;
}

// HARD 차단(§4.7): 차단 시 재롤→폴백. allowlist/단일태그/저각성 가드는 별도(태그 정제는 SOFT).
function dynamicTextHardFailure(text: string, context: DynamicAlarmTextContext): boolean {
  if (!text) return true;
  // 파싱불가/메타 JSON('here is the json' 등)은 형식 위반.
  if (isMetaJsonResponse(text)) return true;
  if (text.length > 200) return true;
  if (hasLanguageMismatch(text, context.targetLanguage)) return true;
  if (hasUnsupportedListenerAddress(text, context.listenerTitle)) return true;
  if (hasRelationshipLabelLeak(text, context.relationshipLabel, context.listenerTitle)) return true;
  // text 안의 브래킷/지문은 HARD. 태그는 별도 필드라 정상 출력은 여기서 안 걸린다.
  if (hasDeliveryTagOrStageDirection(text)) return true;
  if (hasAlarmTimeEcho(text, context.alarmTimeLabel)) return true;
  if (hasDateLabelEcho(text, context.dateLabel)) return true;
  // 연인/배우자 톤: '새 인연/연애운/질투' 어휘만 HARD. 정중 어미 슬립은 SOFT로 강등.
  if (hasRomanticForbiddenContent(text, context)) return true;
  if (context.mode === 'wake_fortune' && hasFortuneProfileEcho(text, context.fortuneProfile)) {
    return true;
  }
  return false;
}

export async function translateTextWithVertex(
  env: Env,
  text: string,
  targetLanguage: string,
  sourceLanguage = 'ko',
): Promise<string> {
  const prepared = await prepareAlarmTextWithVertex(env, text, {
    targetLanguage,
    sourceLanguage,
    translate: true,
    autoTag: false,
  });
  return prepared.text;
}

function readVertexCredentials(env: Env): Required<
  Pick<VertexServiceAccount, 'client_email' | 'private_key' | 'project_id'>
> & {
  token_uri: string;
} {
  if (!env.GOOGLE_VERTEX_CREDENTIALS_JSON) {
    throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON is not configured.');
  }
  let parsed: VertexServiceAccount;
  try {
    parsed = JSON.parse(env.GOOGLE_VERTEX_CREDENTIALS_JSON) as VertexServiceAccount;
  } catch {
    throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON must be valid service account JSON.');
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON is missing required service account fields.');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    project_id: parsed.project_id,
    token_uri: parsed.token_uri || DEFAULT_TOKEN_URI,
  };
}

async function createAccessToken(
  credentials: ReturnType<typeof readVertexCredentials>,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    {
      alg: 'RS256',
      typ: 'JWT',
    },
    {
      iss: credentials.client_email,
      scope: CLOUD_PLATFORM_SCOPE,
      aud: credentials.token_uri,
      iat: now,
      exp: now + 3600,
    },
    credentials.private_key,
  );

  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    // 상류(Google OAuth) 지연이 사용자 대면 요청(알람 생성/TTS)을 워커 상한까지 볼모로
    // 잡지 않도록 타임아웃을 건다. abort 시 fetch reject → 기존 catch 폴백으로 흐른다.
    signal: AbortSignal.timeout(8000),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const json: VertexTokenResponse = await response.json<VertexTokenResponse>().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || `Vertex auth failed (${response.status})`,
    );
  }
  return json.access_token;
}

export async function generateTranslation(args: {
  env: Env;
  credentials: ReturnType<typeof readVertexCredentials>;
  accessToken: string;
  text: string;
  targetLanguage: string;
  sourceLanguage: string;
}): Promise<string> {
  const location = args.env.GOOGLE_VERTEX_LOCATION || DEFAULT_VERTEX_LOCATION;
  const model = args.env.GOOGLE_VERTEX_MODEL || DEFAULT_VERTEX_MODEL;
  const endpoint =
    `https://aiplatform.googleapis.com/v1/projects/${args.credentials.project_id}` +
    `/locations/${location}/publishers/google/models/${model}:generateContent`;
  const targetName = LANGUAGE_NAMES[args.targetLanguage] || args.targetLanguage;
  const sourceName = LANGUAGE_NAMES[args.sourceLanguage] || args.sourceLanguage;

  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Translate the following alarm message from ${sourceName} to ${targetName}. ` +
                'Return only the translated sentence, with no explanation, no markdown, and no quotes.\n\n' +
                args.text,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 256,
      },
    }),
  });
  const json: VertexGenerateContentResponse & { error?: { message?: string } } = await response
    .json<VertexGenerateContentResponse & { error?: { message?: string } }>()
    .catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message || `Vertex translation failed (${response.status})`);
  }
  return (json.candidates?.[0]?.content?.parts?.[0]?.text || '')
    .trim()
    .replace(/^["“”]+|["“”]+$/g, '');
}

type GenerateContentConfig = {
  temperature: number;
  maxOutputTokens: number;
  systemInstruction?: string;
  responseSchema?: unknown;
};

async function generateContentText(
  env: Env,
  prompt: string,
  config: GenerateContentConfig,
): Promise<string> {
  const credentials = readVertexCredentials(env);
  const accessToken = await createAccessToken(credentials);
  const location = env.GOOGLE_VERTEX_LOCATION || DEFAULT_VERTEX_LOCATION;
  const model = env.GOOGLE_VERTEX_MODEL || DEFAULT_VERTEX_MODEL;
  const endpoint =
    `https://aiplatform.googleapis.com/v1/projects/${credentials.project_id}` +
    `/locations/${location}/publishers/google/models/${model}:generateContent`;
  return generateContentAtEndpoint(endpoint, prompt, config, {
    authorization: `Bearer ${accessToken}`,
  });
}

async function generateContentAtEndpoint(
  endpoint: string,
  prompt: string,
  config: GenerateContentConfig,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      ...extraHeaders,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      ...(config.systemInstruction
        ? { systemInstruction: { parts: [{ text: config.systemInstruction }] } }
        : {}),
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0,
        },
        ...(config.responseSchema ? { responseSchema: config.responseSchema } : {}),
      },
    }),
  });
  const json: VertexGenerateContentResponse & { error?: { message?: string } } = await response
    .json<VertexGenerateContentResponse & { error?: { message?: string } }>()
    .catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message || `Gemini text preparation failed (${response.status})`);
  }
  return json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

function alarmTextPrompt(args: {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  shouldTranslate: boolean;
  shouldTag: boolean;
}): string {
  const sourceName = LANGUAGE_NAMES[args.sourceLanguage] || args.sourceLanguage;
  const targetName = LANGUAGE_NAMES[args.targetLanguage] || args.targetLanguage;
  const action = args.shouldTranslate
    ? `Translate the user's alarm message from ${sourceName} to ${targetName}.`
    : `Keep the user's alarm message in ${sourceName}.`;
  const tagInstruction = args.shouldTag
    ? `Add exactly one ElevenLabs v3 delivery tag from this allowlist: ${APPROVED_TAGS.map((tag) => `[${tag}]`).join(', ')}. Put the single tag at the very beginning of the text. Pick the tag that best matches the meaning and intended mood of the user text — use [cheerfully]/[happy] for warm or upbeat lines, [calm] for quiet, soothing, or night/wind-down lines, [excited]/[playfully]/[curious] for lively or light-hearted lines. Do not rewrite, add, remove, or reorder any words unless translation is requested.`
    : 'Do not add or remove delivery tags.';

  return [
    'You prepare short voice-alarm text for text-to-speech.',
    action,
    tagInstruction,
    'Do not add explanations, markdown, quotes, emojis, or extra fields.',
    'Keep the final text natural, spoken, and 200 characters or fewer.',
    'Return strict JSON: {"text":"final text","tags":["tag names without brackets"]}.',
    '',
    args.text,
  ].join('\n');
}

// 한국어일 때 관계 라벨에 맞는 어체(반말/해요체/합니다체) 가이드를 추가한다.
// 알람 청자는 보통 부모/조부모 (어른) 이라는 가정을 기본으로 깔고, speaker(말하는 사람)
// 가 어떤 관계냐에 따라 자연스러운 한국어 화법을 매핑한다.
const YOUNGER_TO_ELDER_RELATIONSHIPS = ['손녀', '손자', '손주', '딸', '아들', '자식', '며느리', '사위', '조카'];
const ELDER_TO_YOUNGER_RELATIONSHIPS = ['할머니', '할아버지', '엄마', '어머니', '아빠', '아버지', '부모', '이모', '고모', '삼촌', '외할머니', '외할아버지'];
const GRANDCHILD_RELATIONSHIPS = ['손녀', '손자', '손주'];
const SIBLING_RELATIONSHIPS = ['형제', '자매', '남매', '동생', '누나', '언니', '오빠', '형'];

function koreanRegisterGuidance(relationshipLabel: string | null | undefined): string {
  if (!relationshipLabel) return '';
  const label = relationshipLabel.trim();
  if (!label) return '';
  const peerOrIntimate = ['친구', ...SIBLING_RELATIONSHIPS];

  if (isGrandchildRelationship(label)) {
    return ' Speaker is a grandchild speaking to a grandparent: write in warm, familiar 해요체 with respectful verb forms. Prefer "할머니, 일어나실 시간이에요" or "할아버지, 좋은 아침이에요"; never write casual elder-address phrases like "할머니, 일어날 시간이에요". It should sound like an actual grandchild speaking beside the listener, not a scripted announcement. Use small caring phrases when natural, such as "조심히 다녀오세요" or "감기 조심하세요". Do NOT use stiff 합니다체 like "~합니다", "~하십시오".';
  }
  if (isYoungerToElderRelationship(label)) {
    return ' Speaker is younger than the listener: write in warm, familiar 해요체 that still shows respect (e.g. "할아버지, 일어나실 시간이에요", "나가실 때 우산 꼭 챙기세요"). It should sound like an actual granddaughter/grandson or child speaking beside the listener, not a scripted announcement. Use small caring phrases when natural, such as "조심히 다녀오세요" or "감기 조심하세요". Do NOT use stiff 합니다체 like "~합니다", "~하십시오".';
  }
  if (ELDER_TO_YOUNGER_RELATIONSHIPS.some((k) => label.includes(k))) {
    return ' Speaker is older than the listener: write in caring 반말 or 해요체 mixed style (e.g. "우리 딸, 잘 잤어?", "오늘도 화이팅이야"). Avoid 합니다체.';
  }
  if (isRomanticRelationship(label)) {
    return ' Speaker is a romantic partner or spouse: write in intimate 반말 that feels warm and a little heart-fluttering when heard from a boyfriend, girlfriend, wife, or husband. Use soft caring phrases like "자기야", "내 생각도 조금 해", "감기 걸리면 안 돼", or "오늘도 네 편이야" only when they fit. Avoid stiff 해요체/합니다체, childish baby talk, melodrama, or generic slogans as the main emotion.';
  }
  if (peerOrIntimate.some((k) => label.includes(k))) {
    return ' Speaker and listener are peers/intimate: write in natural 반말 (e.g. "일어났어?", "오늘 뭐 입을까?"). For sibling labels such as 형제·자매, 누나, 언니, 오빠, 형, or 동생, avoid 존댓말/해요체 and sound like a real sibling; for bedtime, prefer a line like "누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자." Never use 합니다체.';
  }
  return ' Use a warm conversational tone — prefer 해요체 over 합니다체. Sound like a real person, not an announcement.';
}

function isRomanticRelationship(relationshipLabel: string | null | undefined): boolean {
  const label = relationshipLabel?.trim();
  if (!label) return false;
  return ['연인', '여자친구', '남자친구', '애인', '여보', '자기', '아내', '남편', '배우자', '와이프', '신랑', '신부'].some((keyword) =>
    label.includes(keyword),
  );
}

function isYoungerToElderRelationship(relationshipLabel: string | null | undefined): boolean {
  const label = relationshipLabel?.trim();
  if (!label) return false;
  return YOUNGER_TO_ELDER_RELATIONSHIPS.some((keyword) => label.includes(keyword));
}

function isGrandchildRelationship(relationshipLabel: string | null | undefined): boolean {
  const label = relationshipLabel?.trim();
  if (!label) return false;
  return GRANDCHILD_RELATIONSHIPS.some((keyword) => label.includes(keyword));
}

function isSiblingRelationship(relationshipLabel: string | null | undefined): boolean {
  const label = relationshipLabel?.trim();
  if (!label) return false;
  return SIBLING_RELATIONSHIPS.some((keyword) => label.includes(keyword));
}

// 고정 철학·출력계약·태그규칙·NEVER 목록(§4.2 전문). 프롬프트 캐시 친화를 위해
// 가변 데이터(user prompt)와 분리해 systemInstruction으로 전달한다.
const DYNAMIC_SYSTEM_INSTRUCTION = `You are the voice of a personal voice-alarm app. You write ONE short spoken line — usually one
sentence, sometimes two very short ones — that one real, familiar person says out loud to gently
wake or remind someone they care about. An expressive TTS voice reads it aloud, so it must sound
like natural speech the way a native speaker actually talks, never like a notification, news
anchor, weather report, or a translated/written sentence.

PHILOSOPHY
- Native-first. Write the way a native speaker SAYS it in the target language: natural
  contractions, particles, sentence-final particles, dropped subjects/pronouns, colloquial
  rhythm. Idiomatic naturalness outranks literal fidelity.
- A specific human beside the listener, not a script. Warm but restrained — caring, never
  saccharine, theatrical, poetic, or dramatic.
- Soft-start. Open gently (the listener's title or a soft greeting), then ease into the point;
  acknowledge the wake/sleep transition when natural. Never jarring, never alarming, never
  fear/urgency.
- Meaning over novelty. The value is a context-appropriate, kind line. Never announce whose voice
  this is or the listener's identity.
- Fresh every day. Vary the opener, wording, rhythm, and the small caring detail so it never
  feels prerecorded. Do not reuse the same opener/closer each time. Never trade naturalness or any
  constraint for novelty.
- Brevity is correct. The listener just woke up — keep it simple, concrete, fast to absorb. One
  short line or two short sentences. Hard cap 200 characters.

REGISTER (one consistent register per line, matched to the relationship)
- You are given a relationship (how the speaker relates to the listener) and an optional listener
  title. Use them ONLY to choose register, warmth, vocabulary, and first-person reference — never
  speak them. Hold ONE politeness level for the whole line; never switch mid-sentence.
- Follow the LANGUAGE RULES block in the user message exactly for the target language. Korean and
  Japanese use DIFFERENT logic for the same relationship — do not copy one language's politeness
  into the other.
- Address the listener by the provided listener title EXACTLY (never translate it, never swap it
  for a guessed family title like grandmother/mom/son). If no title is given, use a natural
  title-free greeting.

DELIVERY TAG (ElevenLabs v3)
- You MAY prepend AT MOST ONE delivery tag, chosen ONLY from the allowlist in the user message,
  matching the mode/relationship mood. Return it in the separate "tag" field WITHOUT brackets;
  the backend prepends it as [tag]. Do NOT put any bracket/[tag]/stage direction inside "text".
- One tag, or none. Never combine tags, never invent tags, never use a tag mid-line.
- For pauses/pacing use punctuation and ellipses (…), NOT tags — the engine has no SSML breaks
  and a soft '…' or comma after the greeting is the soft-start.
- If the line is very short (under ~20 characters) or no tag clearly fits, leave "tag" empty —
  punctuation alone is fine, and an under-realized tag can be read aloud.
- Tag effects are SUBTLE in Japanese and Korean — carry the emotion in word/particle/ending
  choice; treat the tag as a light touch only.

NEVER
- Never recite raw values the user did not write: temperatures, percentages, weather codes, exact
  clock time, dates, weekdays, birth date/time, zodiac specifics, or city/district/country/
  location labels.
- Never state whose voice this is or name the relationship.
- Never use a stiff/formal/business register (Korean 합니다체; Japanese ビジネス敬語/文語;
  English "Please be advised") for family, friends, or partners.
- No markdown, emojis, quotes, explanations, or extra fields.

OUTPUT
- Return STRICT JSON only, matching the schema: {"text": string, "tag": string}. "text" = the
  final spoken line in the target language (no brackets). "tag" = exactly one allowlisted tag
  name, lowercase, no brackets, or "" for none.`;

// 구조화 출력(§4.7). responseMimeType/json·thinkingBudget:0 과 함께 1차 파서로 쓰고,
// 간헐 빈응답 대비 brace-slice 파서를 최후 폴백으로 유지한다.
const DYNAMIC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    tag: { type: 'string' },
  },
  required: ['text'],
} as const;

// 언어별 네이티브 규칙(§4.3 전문). 활성 언어 블록만 user prompt에 주입한다.
const KOREAN_NATIVE_RULES = `KOREAN — native, spoken, never an announcement. Pick the register from the speaker→listener
relationship and hold it the whole line. NEVER 합니다체(~합니다/~하십시오) for family/friends/partners.
- Grandchild→grandparent (손녀/손자/손주) and child→elder (딸/아들/자식/며느리/사위/조카): warm
  familiar 해요체 WITH honorific verb stems(존대 동사). '할머니, 일어나실 시간이에요.' '나가실 때
  우산 꼭 챙기세요.' Never clipped lower-sounding forms to an elder ('일어날 시간이에요').
- Elder→younger (부모→자식 등): caring 반말 or 반말/해요체 mix. '우리 딸, 잘 잤어?' '오늘도 화이팅이야.'
- Sibling/friend (형제/자매/누나/언니/오빠/형/동생/친구): natural 반말. '일어났어?' Bedtime: '누나,
  잘 시간이야. 휴대폰 내려놓고 얼른 자.' Never 존댓말/해요체.
- Romantic/spouse (연인/자기/여보/아내/남편): intimate 반말, warm and lightly heart-fluttering;
  never 해요체/합니다체 even for 아내/남편. '자기야, 비 온대. 나가기 전에 우산 챙겨, 감기 걸리면 안 돼.'
  No baby talk, no melodrama, no possessiveness; never new-romance/dating-luck/jealousy.
- Neutral/unknown: warm 해요체.
PARTICLES & SPACING (a writing rule, not a post-fix): keep subject/object particles alive —
'비가 올 수 있대요'(O) not '비 올 수 있대요'(X); '오늘은 비가 와요' reads warmer than '오늘 비 와요'.
Drop redundant 나/너/내가 when obvious.
REPORTED/SOFT endings for relayed weather/fortune: 해요체 '~대요/~래요/~다네요/~면 좋겠어요';
반말 '~대/~래/~다네/~면 좋겠다'. Sounds like relaying, not asserting.
NUMBERS: never read raw numbers/units aloud — no 강수확률·기온·시각·날짜 ('강수확률 70%'(X), '최저 10도'(X),
'7시 30분'(X)). Re-express softly instead ('비가 올 수 있대요'(O), '오늘은 좀 쌀쌀하대요'(O)).
AVOID: exaggerated interjections(세상에/맙소사/오 마이 갓), news-anchor openers('예보에 따르면'),
comma-spam (use connective endings). Use 할머니/할아버지 as address ONLY if it matches the listener title.`;

const JAPANESE_NATIVE_RULES = `JAPANESE — write like a native speaker. Do NOT translate Korean/English structure into Japanese.
REGISTER — CRITICAL: Japanese family & intimate speech is CASUAL(タメ口), NOT honorific. Do NOT copy
Korean's polite 해요체 into Japanese.
- Grandchild→grandparent, child→parent, parent→child, sibling, friend, romantic partner: CASUAL
  (だ/〜だよ/〜て/〜よっか/〜ね). e.g. 'おばあちゃん、おはよう。今日は雨が降るみたい、傘忘れないでね。'
  NOT 'おばあちゃん、起きる時間です。' Address おばあちゃん/おじいちゃん (familiar), never おばあさま,
  and only if it matches the listener title.
- です・ます polite ONLY for distant/unknown/teacher/workplace or when no relationship is given:
  'おはようございます。今日は冷えるみたいなので、一枚羽織ってくださいね。' Avoid over-honorific/business
  文語 (no お目覚めください, no 〜となっております).
- Never mix politeness levels within one line.
終助詞 (the core of natural warmth; choose to match intonation, don't stack): ね = empathy/shared
feeling (soft); よ = telling/gently urging; な/なあ = soft self-musing; よね/の = soft confirmation.
Vary them; don't end every sentence with よ.
GENDER: stay GENDER-NEUTRAL ね/よ. Prefer pro-drop over any first-person pronoun; if one is truly
needed, neutral 私 (or omit it). Do NOT use 役割語/manga-style gendered finals (わ/かしら/ぞ/だぜ) —
modern speakers rarely say them and they sound unnatural.
PRO-DROP (strong): omit 私/僕/俺/あなた/君 when context is clear; keep first-person consistent if used.
LOANWORDS/NAMES: natural katakana (コーヒー, マスク, ストレッチ); never literal English calques
('良い一日を過ごしてください'→'いってらっしゃい、今日もいい一日にね'). ORTHOGRAPHY: 。、！？ only, NO
spaces between words; let mora rhythm breathe; use … for a soft pause. WEATHER: soft 伝聞, never
numbers — '雨が降るみたい' / '寒くなりそうだから上着があると安心だよ'.`;

const ENGLISH_NATIVE_RULES = `ENGLISH — natural, warm, spoken (American-neutral), not formal writing. Contractions always
(you're, it's, let's, don't). English has little grammatical register, so RELATIONSHIP changes
warmth/intimacy, not grammar.
- Most relationships: friendly, like a close person nudging you awake. 'Hey, morning… time to get
  up. Looks like rain later, grab your umbrella, okay?'
- Elder/respectful or teacher: warm but a touch more composed — still contractions, no stiffness.
- Romantic: tender, low-key intimate, never cheesy. 'Morning, you. Up you get… I've got you today.'
Drop the subject when natural. One light opener/filler max (Hey/Alright/Okay). Address by the given
title if provided, else a soft 'hey'/'morning'; never a guessed family title. Weather/fortune stays
casual and number-free. AVOID: weather-report numbers, exclamation spam, 'Please be advised',
'rise and shine' clichés, over-sweet lines.`;

// 활성 언어 블록 선택(§4.3). ja는 신규, en은 경량 추가, ko는 네이티브 규칙 + 관계별 가이드.
function koreanNativeGuidance(): string {
  return KOREAN_NATIVE_RULES;
}

function japaneseRegisterGuidance(): string {
  return JAPANESE_NATIVE_RULES;
}

function englishRegisterGuidance(): string {
  return ENGLISH_NATIVE_RULES;
}

function activeLanguageBlock(targetLanguage: string): string {
  if (targetLanguage === 'ja') return japaneseRegisterGuidance();
  if (targetLanguage === 'en') return englishRegisterGuidance();
  if (targetLanguage === 'ko') return koreanNativeGuidance();
  return '';
}

// few-shot(§4.9). 출력계약이 {text, tag}이므로 표의 [tag] 접두는 tag 필드로 분리해 주입한다.
const DYNAMIC_FEW_SHOT: Record<string, Array<{ context: string; text: string; tag: string }>> = {
  ko: [
    { context: 'wake_weather, 손녀→할아버지, rain', text: '할아버지, 좋은 아침이에요. 오늘은 비가 올 수 있대요. 나가실 때 우산 꼭 챙기세요.', tag: 'cheerfully' },
    { context: 'wake_weather, 연인, dust', text: '자기야, 일어나자. 오늘 미세먼지 많대. 나갈 때 마스크 꼭 챙겨, 알았지?', tag: 'cheerfully' },
    { context: 'sleep, 형제(누나)', text: '누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자.', tag: 'calm' },
    { context: 'wake_fortune, 중립', text: '좋은 아침이에요. 오늘은 작은 선택에 좋은 기운이 따른대요. 가벼운 마음으로 시작해요.', tag: 'playfully' },
    { context: 'meal(점심), 부모→자식', text: '우리 딸, 점심 챙겼어? 바빠도 따뜻한 국밥 한 그릇은 먹자.', tag: 'cheerfully' },
  ],
  ja: [
    { context: 'wake_weather, 孫→祖母(タメ口), rain', text: 'おばあちゃん、おはよう。今日は雨が降るみたい、出かけるとき傘忘れないでね。', tag: 'cheerfully' },
    { context: 'wake_weather, 距離/불명(です・ます), cold', text: 'おはようございます。今日は冷えるみたいなので、一枚羽織ってくださいね。', tag: 'cheerfully' },
    { context: 'sleep, 恋人(タメ口)', text: 'そろそろ寝よっか。スマホは置いて、ゆっくり休んでね。', tag: 'calm' },
    { context: 'exercise, 友達(タメ口), nice', text: 'そろそろ体動かそっか。今日は天気もいいし、軽く外を歩いてこよ。', tag: 'cheerfully' },
    { context: 'wake_fortune, 중립/casual', text: 'おはよう。今日はちょっといいことがありそうだよ。気楽にいこうね。', tag: 'playfully' },
  ],
  en: [
    { context: 'wake_weather, neutral, rain', text: 'Morning… time to get up. Looks like rain later, grab your umbrella before you head out.', tag: 'cheerfully' },
    { context: 'love, romantic, babe', text: "Morning, babe. Take your time getting up — I've got you today, okay?", tag: 'happy' },
    { context: 'sleep, friend', text: "Hey, it's getting late. Put the phone down and let's get some rest.", tag: 'calm' },
  ],
};

function fewShotBlock(targetLanguage: string): string {
  const examples = DYNAMIC_FEW_SHOT[targetLanguage];
  if (!examples || examples.length === 0) return '';
  const lines = examples.map(
    (ex) => `- (${ex.context}) -> {"text":"${ex.text}","tag":"${ex.tag}"}`,
  );
  return ['Few-shot examples (target language, follow the {text, tag} contract):', ...lines].join('\n');
}

function dynamicAlarmTextPrompt(context: DynamicAlarmTextContext): string {
  const targetName = LANGUAGE_NAMES[context.targetLanguage] || context.targetLanguage;
  const listenerTitle = context.listenerTitle?.trim();
  const listenerInstruction = listenerTitle
    ? `When addressing the listener, call them "${listenerTitle}" exactly (use this label naturally, do not translate it, and never replace it with grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter).`
    : 'Do not address the listener by guessed family titles such as grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter. Use a neutral greeting instead.';
  // 어체는 관계 기반(auto)으로만 결정한다.
  const koreanRegisterInstruction =
    context.targetLanguage === 'ko'
      ? koreanRegisterGuidance(context.relationshipLabel?.trim())
      : '';
  const relationship = context.relationshipLabel?.trim()
    ? `The selected voice belongs to the user's "${context.relationshipLabel}" relationship. Use this only to choose a natural speech register and warmth. Never mention the relationship label in the text, and never write phrases like "${context.relationshipLabel} voice", "in your ${context.relationshipLabel}'s voice", or "speaking as your ${context.relationshipLabel}". ${listenerInstruction} Do not invent names or private facts.${koreanRegisterInstruction}`
    : `No relationship label is available, so keep the line generally warm. ${listenerInstruction}`;
  const romanticToneInstruction =
    context.targetLanguage === 'ko' && isRomanticRelationship(context.relationshipLabel)
      ? 'Romantic partner/spouse tone: the line should sound like something an actual boyfriend, girlfriend, wife, or husband would say privately to the listener. Use intimate 반말, not 해요체 or 합니다체, even for spouse labels such as 아내 or 남편. Good examples: "여보, 날씨 좋대. 잠깐 산책 가도 좋겠다", "자기야, 오늘 작은 행운이 온대". Bad examples: "여보, 날씨가 좋대요", "자기야, 일어나세요". Make it tender, warm, and lightly heart-fluttering, but still short and usable as an alarm. Do not become cheesy, poetic, possessive, or overly dramatic. Never mention new romantic connections, romance luck, flirting with others, jealousy, or phrases like "나만 생각해".'
      : '';
  const modeInstruction = (() => {
    if (context.mode === 'wake_weather') {
      return `Create a wake-up message that sounds like one real person gently waking another person up. Start with the listener's title if one is provided, then a natural wake-up phrase like "일어나실 시간이에요" or "좋은 아침이에요"; do not describe whose voice it is. The weather is given as language-neutral signals (condition → suggested action); re-express them naturally in ${targetName} as ordinary speech — never read the tokens literally and never use numbers. Weave at most two signals into the line. DO NOT recite raw numbers, temperatures, percentages, weather codes, or labels like "강수 확률 70%" or "최저 12도 최고 19도". DO NOT just describe the weather ("비가 와요" alone is not enough) — always pair it with a short action the listener can take. For Korean, prefer soft relayed phrasing such as "~대요", "~있대요", "~다네요", or "~면 좋겠어요" when natural. In respectful family speech, keep natural particles and spacing: prefer "비가 올 수 있대요" or "오늘은 비가 올 수 있대요"; avoid clipped wording like "비 올 수 있대요". Avoid robotic connector phrases like "예보 보니까" unless it truly sounds spoken. Do not mention location names, city/country names, the exact date, or weekday. End with a tiny human care phrase only when it fits the relationship. Weather signals: ${weatherSignalPromptHint(context.weatherSignal)}.`;
    }
    if (context.mode === 'wake_fortune') {
      return `Create a wake-up message with a light, entertainment-only daily fortune. If fortune input is available, infer only a gentle mood from gender, birth date, and birth time. Fortune input is internal only: ${context.fortuneProfile || 'fortune profile is unavailable'}. Never mention the listener's birth date, birthday, birth time, zodiac details, "born on", "birth date", "생년월일", "태어난 시간", "몇 월 며칠생", or any specific month/day/year/time from the input. Do not sound like a real prediction or guarantee. For Korean, make the fortune feel like a soft, playful reading rather than something the speaker personally knows for certain; endings like "~래", "~라네요", "~것 같아", or "~면 좋겠다" are good when they sound natural. If the speaker is a romantic partner or spouse, do not mention new relationships, romantic opportunities, attraction from others, flirting, jealousy, or dating luck; keep the fortune about mood, small luck, confidence, health, work, study, or daily energy.`;
    }
    if (context.mode === 'meal') {
      return `Create a ${context.mealLabel || 'meal'} reminder. Ask naturally whether they have eaten and recommend one menu idea. The weather is given as language-neutral signals; if helpful, re-express them naturally in ${targetName} (no numbers, no literal token reading) without forcing a source lead-in. Weather signals: ${weatherSignalPromptHint(context.weatherSignal)}.`;
    }
    if (context.mode === 'sleep') {
      return isSiblingRelationship(context.relationshipLabel)
        ? 'Create a sibling-style bedtime message in natural 반말. Make it sound like a real brother or sister, not a polite notification. Good Korean example: "누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자." Avoid 해요체 like "잘 시간이에요", "쉬어요", or "주무세요" for sibling cases.'
        : 'Create a bedtime message that helps the listener wind down, put the phone away, and rest without sounding like a generic notification.';
    }
    if (context.mode === 'exercise') {
      return `Create an exercise reminder. Make it energetic but not childish. The weather is given as language-neutral signals; if it suggests it, choose indoor strength training or outdoor cardio naturally, and re-express any weather in ${targetName} (no numbers, no literal token reading) without forcing a source phrase. Weather signals: ${weatherSignalPromptHint(context.weatherSignal)}.`;
    }
    return isRomanticRelationship(context.relationshipLabel)
      ? 'Create a romantic partner wake-up line that feels private, affectionate, and gently exciting to hear, while still short enough for a practical alarm. Avoid generic "좋은 하루 보내" unless paired with a more personal caring phrase.'
      : 'Create a warm love/relationship message that feels personal, caring, and suitable for a voice alarm without being overly dramatic.';
  })();

  const languageBlock = activeLanguageBlock(context.targetLanguage);
  const tagAllowlistInstruction = `DELIVERY TAG: you may prepend AT MOST ONE tag, chosen ONLY from this allowlist: ${APPROVED_TAGS.map(
    (tag) => `[${tag}]`,
  ).join(
    ' ',
  )}. Return it in the separate "tag" field WITHOUT brackets, or "" for none. A fitting default for this ${context.mode} mode is "${modeDefaultTag(
    context.mode,
  )}". The low-arousal tags ${LOW_AROUSAL_TAGS.map((tag) => `[${tag}]`).join(
    ' ',
  )} are for SLEEP mode only — never use them on wake/meal/exercise modes. One tag or none; never combine or invent tags; never put any bracket or [tag] inside "text".`;

  return [
    `LANGUAGE: write the spoken line in ${targetName}.`,
    languageBlock,
    `Internal date context for freshness only, do not mention it in the final text: ${context.dateLabel}.`,
    context.alarmTimeLabel ? `Alarm time context: ${context.alarmTimeLabel}.` : '',
    `Alarm category: ${context.category}.`,
    relationship,
    romanticToneInstruction,
    modeInstruction,
    listenerTitle
      ? `Address the listener as "${listenerTitle}" rather than guessing a family title.`
      : 'For example, if the relationship label is "손녀", do not write "할머니" or "할아버지"; use a neutral greeting instead.',
    'Do not announce the relationship or source of the voice. Avoid phrases like "손녀 목소리로 전해요"; the alarm should sound like a natural alarm line.',
    'Do not mention the exact date, weekday, alarm time, country, city, district, or saved location label unless the user explicitly wrote it as part of the alarm text.',
    context.targetLanguage === 'ko'
      ? '한국어 어체 규칙: 가족·친구·연인·배우자 관계에서는 절대 "~합니다", "~하십시오" 같은 합니다체를 쓰지 말 것. 손녀·손자·손주→조부모는 친근하지만 공손한 해요체와 존대 동사를 써서 "할머니, 일어나실 시간이에요"처럼 말하고, "할머니, 일어날 시간이에요"처럼 낮춰 들리는 표현은 피한다. 자식→부모는 친근한 해요체 ("~해요", "~예요"). 부모→자식은 다정한 반말 또는 해요체 혼용. 형제·자매·친구 사이는 반말. 연인·남자친구·여자친구·아내·남편·배우자는 사적인 반말과 따뜻하고 살짝 설레는 톤. 뉴스 앵커처럼 들리지 않게 진짜 사람이 옆에서 말하는 톤으로.'
      : '',
    context.targetLanguage === 'ko'
      ? '문장 구조 예시 (wake_weather): "할아버지, 일어나실 시간이에요. 오늘은 비가 올 수 있대요. 나가실 때 우산 꼭 챙기세요." / "할머니, 좋은 아침이에요. 미세먼지가 많대요. 외출하실 때 마스크 챙기세요." / "자기야, 일어나자. 비 온대. 나가기 전에 우산 챙겨, 감기 걸리면 안 돼." / "일어나실 시간이에요. 날씨가 좋대요. 잠깐 산책 가기에도 딱이에요." — 위치/날짜/관계/숫자 없이 시작해서, 날씨 상태와 그에 맞는 행동 권유를 한두 마디로 자연스럽게 묶고 짧게 마무리. "예보 보니까" 같은 출처 도입은 선택 사항이며, 강수확률·기온 숫자를 그대로 읽는 패턴은 금지. 손녀→할아버지처럼 손아랫사람이 손윗사람에게 말할 때는 "오늘은 비가 올 수 있대요", "나가실 때 우산 꼭 챙기세요"처럼 조사와 띄어쓰기가 살아 있는 다정한 말투를 우선한다.'
      : '',
    'Make it feel meaningfully different from a prerecorded fixed alarm.',
    tagAllowlistInstruction,
    fewShotBlock(context.targetLanguage),
    'Return STRICT JSON only: {"text":"final spoken line in the target language, no brackets","tag":"one allowlisted tag name without brackets, or empty string"}.',
  ]
    .filter(Boolean)
    .join('\n');
}

// 폴백 회전(§4.7): 고정 단일 문구 대신 mode+dateLabel 해시로 몇 개 템플릿을 회전한다.
// 골격(오프너·날씨팁·핵심 안부)은 고정하고 닫는 케어 문구/도입만 변주해 자연스러움을 유지하면서
// 매일 같은 문구가 반복되지 않게 한다.
function fallbackRotationIndex(mode: string, dateLabel: string, count: number): number {
  if (count <= 1) return 0;
  let hash = 0;
  const seed = `${mode}|${dateLabel}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % count;
}

function pickFallbackRotation(
  options: string[],
  context: DynamicAlarmTextContext,
): string {
  return options[fallbackRotationIndex(context.mode, context.dateLabel, options.length)]!;
}

// 비한국어 타깃의 폴백. 한국어를 절대 쓰지 않고(누출 방지), 타깃 언어의 간단한 제네릭 네이티브
// 문구를 낸다(숫자/날짜 금지, ≤200자). 날씨는 구조화 시그널 → 타깃 언어 표면으로 붙인다.
// 저각성은 sleep에만. 모드 기본 태그는 dynamicAlarmTextPreparationFallback의 modeDefaultTag가 붙인다.
function nonKoreanReadableFallback(context: DynamicAlarmTextContext): string {
  const sleep = context.mode === 'sleep';
  const showWeather = context.mode === 'wake_weather' && weatherConditions(context.weatherSignal).length > 0;
  if (context.targetLanguage === 'ja') {
    if (sleep) return 'そろそろ休もっか。今日もおつかれさま、ゆっくりおやすみ。';
    const weather = showWeather ? ` ${jaWeatherSurface(context.weatherSignal)}。` : '';
    return `おはよう。今日も無理せずいこうね。${weather}`.slice(0, 200).trim();
  }
  // en 및 기타 비한국어(fr/it 등)는 한국어 누출을 피하기 위해 영어 제네릭으로 폴백한다.
  if (sleep) return 'Time to wind down. Put the phone down and get some rest, okay?';
  const weather = showWeather ? ` ${enWeatherSurface(context.weatherSignal)}.` : '';
  return `Morning. Take it easy and have a good one.${weather}`.slice(0, 200).trim();
}

function dynamicAlarmTextReadableFallback(context: DynamicAlarmTextContext): string {
  if (context.targetLanguage !== 'ko') {
    return nonKoreanReadableFallback(context);
  }
  const listener = context.listenerTitle?.trim();
  const address = listener ? `${listener}, ` : '';
  const wakeOpener = `${address}일어나실 시간이에요.`;
  const opener = listener ? `${listener}, ` : '';
  const romantic = context.targetLanguage === 'ko' && isRomanticRelationship(context.relationshipLabel);
  const romanticOpener = listener ? `${listener}, ` : '좋은 아침이야. ';
  if (context.mode === 'wake_weather' && weatherConditions(context.weatherSignal).length > 0) {
    if (romantic) {
      const lead = pickFallbackRotation(['', '좋은 아침이야. ', '천천히 일어나자. '], context);
      return `${romanticOpener}${lead}${koWeatherSurface(context.weatherSignal, true)}. 오늘도 네 편이야.`
        .slice(0, 200)
        .trim();
    }
    const weatherTip = koWeatherSurface(context.weatherSignal, false);
    const careClosing =
      context.targetLanguage === 'ko' && isYoungerToElderRelationship(context.relationshipLabel)
        ? pickFallbackRotation(
            [' 조심히 다녀오세요.', ' 오늘 하루도 잘 보내세요.', ' 다녀오시는 길 조심하세요.'],
            context,
          )
        : pickFallbackRotation(
            [' 오늘도 화이팅!', ' 오늘도 좋은 하루 보내요.', ' 오늘도 기분 좋게 시작해요.'],
            context,
          );
    return `${wakeOpener} ${weatherTip}.${careClosing}`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'wake_fortune') {
    if (romantic) {
      const body = pickFallbackRotation(
        [
          '오늘은 작은 행운이 따라온대. 천천히 일어나서 좋은 하루 같이 시작하자.',
          '오늘은 작은 행운이 함께한대. 천천히 눈 떠서 같이 하루 시작하자.',
          '오늘은 작은 행운이 깃든대. 서두르지 말고 같이 하루 열어보자.',
        ],
        context,
      );
      return `${romanticOpener}${body}`.slice(0, 200).trim();
    }
    const body = pickFallbackRotation(
      [
        '오늘은 작은 선택에 좋은 기운이 따르는 날이에요. 오늘도 화이팅!',
        '오늘은 마음 가는 대로 해도 좋은 흐름이래요. 가볍게 시작해요.',
        '오늘은 소소한 행운이 함께한대요. 기분 좋게 하루 열어봐요.',
      ],
      context,
    );
    return `${wakeOpener} ${body}`.slice(0, 200).trim();
  }
  if (context.mode === 'meal') {
    const hasWeather = weatherConditions(context.weatherSignal).length > 0;
    if (romantic) {
      const weatherTip = hasWeather ? ` ${koWeatherSurface(context.weatherSignal, true)}.` : '';
      const body = pickFallbackRotation(
        ['바빠도 한 끼는 제대로 챙기자.', '바쁘더라도 끼니는 거르지 말자.', '잠깐이라도 앉아서 챙겨 먹자.'],
        context,
      );
      return `${romanticOpener}${context.mealLabel || '밥'} 먹었어? ${body}${weatherTip}`
        .slice(0, 200)
        .trim();
    }
    const weatherTip = hasWeather ? ` ${koWeatherSurface(context.weatherSignal, false)}.` : '';
    const closing = pickFallbackRotation(
      [' 오늘도 화이팅!', ' 든든하게 챙겨요.', ' 거르지 말고 챙겨요.'],
      context,
    );
    return `${opener}${context.mealLabel || '식사'} 챙길 시간이에요.${weatherTip}${closing}`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'sleep') {
    if (romantic) {
      const body = pickFallbackRotation(
        ['이제 쉬자. 오늘도 고생 많았어. 좋은 꿈 꿔.', '이제 그만 쉬자. 오늘도 수고했어. 푹 자.'],
        context,
      );
      return `${romanticOpener}${body}`.slice(0, 200).trim();
    }
    const body = pickFallbackRotation(
      [
        '이제 쉬어갈 시간이에요. 화면은 잠시 내려놓고 편하게 쉬어요.',
        '이제 하루를 마무리할 시간이에요. 휴대폰은 내려놓고 편히 쉬어요.',
      ],
      context,
    );
    return `${opener}${body}`.slice(0, 200).trim();
  }
  if (context.mode === 'exercise') {
    if (romantic) {
      const body = pickFallbackRotation(
        ['운동할 시간이야. 무리하지 말고 딱 기분 좋아질 만큼만 하자.', '몸 좀 움직여볼까? 무리하지 말고 가볍게 같이 하자.'],
        context,
      );
      return `${romanticOpener}${body}`.slice(0, 200).trim();
    }
    const body = pickFallbackRotation(
      ['운동할 시간이에요. 무리하지 말고 가볍게 시작해요. 오늘도 화이팅!', '가볍게 몸 풀 시간이에요. 무리하지 말고 천천히 시작해요.'],
      context,
    );
    return `${opener}${body}`.slice(0, 200).trim();
  }
  if (context.mode === 'love') {
    if (romantic) {
      const body = pickFallbackRotation(
        ['좋은 아침이야. 오늘도 네 편이니까 천천히 일어나자.', '좋은 아침이야. 오늘도 내가 응원할게, 천천히 일어나자.'],
        context,
      );
      return `${romanticOpener}${body}`.slice(0, 200).trim();
    }
    const body = pickFallbackRotation(
      ['좋은 아침이에요. 오늘도 옆에서 응원하고 있어요.', '좋은 아침이에요. 오늘 하루도 마음 다해 응원해요.'],
      context,
    );
    return `${opener}${body}`.slice(0, 200).trim();
  }
  const closing = pickFallbackRotation([' 오늘도 화이팅!', ' 오늘도 좋은 하루 보내요.'], context);
  return `${address}일어나실 시간이에요.${closing}`
    .slice(0, 200)
    .trim();
}

function polishDynamicAlarmText(text: string, context: DynamicAlarmTextContext): string {
  if (context.targetLanguage !== 'ko') return text;
  let polished = text.trim();

  if (isGrandchildRelationship(context.relationshipLabel)) {
    const listener = context.listenerTitle?.trim();
    const titlePattern = listener
      ? escapeRegExp(listener)
      : '할머니|할머님|할아버지|할아버님';
    polished = polished.replace(
      new RegExp(`(${titlePattern}),\\s*일어날\\s+시간(?:이에요|예요)`, 'g'),
      '$1, 일어나실 시간이에요',
    );
  }

  if (context.mode === 'sleep' && isSiblingRelationship(context.relationshipLabel)) {
    const listener = context.listenerTitle?.trim();
    if (listener && /(잘\s+시간(?:이에요|예요)|쉬어요|주무세요)/.test(polished)) {
      return `${listener}, 잘 시간이야. 휴대폰 내려놓고 얼른 자.`;
    }
  }

  if (context.mode !== 'wake_weather') return polished;
  const respectful = !isRomanticRelationship(context.relationshipLabel);
  if (!respectful) return polished;

  return polished
    .replace(/오늘\s+비\s+올\s+수\s+있대요/g, '오늘은 비가 올 수 있대요')
    .replace(/오늘\s+비\s+올\s+수\s+있다네요/g, '오늘은 비가 올 수 있다네요')
    .replace(/오늘\s+비\s+온대요/g, '오늘은 비가 온대요')
    .replace(/비\s+올\s+수\s+있대요/g, '비가 올 수 있대요')
    .replace(/비\s+올\s+수\s+있다네요/g, '비가 올 수 있다네요')
    .replace(/비\s+온대요/g, '비가 온대요')
    .trim();
}

// 구조화 시그널 → 언어별 표면. 폴백(ko/ja/en)과 프롬프트(영어 메타)에서 공통으로 쓴다.
function weatherConditions(signal: WeatherSignal | null | undefined): WeatherCondition[] {
  return (signal?.conditions ?? []).slice(0, 2);
}

// 한국어 표면(존대/반말). 기존 자연어 문구를 시그널 kind로부터 그대로 재현한다.
function koWeatherConditionPhrase(kind: WeatherConditionKind, intimate: boolean): string {
  if (intimate) {
    switch (kind) {
      case 'snow':
        return '눈 올 수 있대. 미끄럽지 않게 조심해';
      case 'rain':
        return '비 올 수 있대. 나가기 전에 우산 꼭 챙겨';
      case 'dust':
        return '미세먼지 많대. 나갈 땐 마스크 챙겨';
      case 'cold':
        return '쌀쌀하대. 겉옷 하나 챙겨';
      case 'heat':
        return '낮에 많이 덥대. 물도 자주 마셔';
      case 'nice':
        return '날씨 좋대. 잠깐 산책 가기에도 딱이야';
    }
  }
  switch (kind) {
    case 'snow':
      return '눈이 올 수 있대요. 미끄럽지 않게 조심하세요';
    case 'rain':
      return '비가 올 수 있대요. 나가실 때 우산 꼭 챙기세요';
    case 'dust':
      return '미세먼지가 많대요. 외출하실 때 마스크 챙기세요';
    case 'cold':
      return '쌀쌀하대요. 겉옷 하나 챙기세요';
    case 'heat':
      return '낮에 많이 덥대요. 물도 자주 드세요';
    case 'nice':
      return '날씨가 좋대요. 잠깐 산책 가기에도 딱이에요';
  }
}

function koWeatherSurface(signal: WeatherSignal | null | undefined, intimate: boolean): string {
  return weatherConditions(signal)
    .map((c) => koWeatherConditionPhrase(c.kind, intimate))
    .join(' ')
    .trim();
}

function jaWeatherConditionPhrase(kind: WeatherConditionKind): string {
  switch (kind) {
    case 'snow':
      return '雪が降るかも、足元に気をつけてね';
    case 'rain':
      return '雨が降るみたい、傘を持っていってね';
    case 'dust':
      return '空気がよくないみたい、マスクがあると安心だよ';
    case 'cold':
      return '冷えるみたいだから、一枚羽織ってね';
    case 'heat':
      return '暑くなりそうだから、水分をしっかりとってね';
    case 'nice':
      return 'いい天気みたいだから、少し散歩してもいいかもね';
  }
}

function jaWeatherSurface(signal: WeatherSignal | null | undefined): string {
  return weatherConditions(signal)
    .map((c) => jaWeatherConditionPhrase(c.kind))
    .join(' ')
    .trim();
}

function enWeatherConditionPhrase(kind: WeatherConditionKind): string {
  switch (kind) {
    case 'snow':
      return 'might snow, so watch your step';
    case 'rain':
      return 'looks like rain, so grab an umbrella';
    case 'dust':
      return "the air's a bit rough, a mask helps";
    case 'cold':
      return "it's chilly, so layer up";
    case 'heat':
      return "it's gonna be hot, so keep some water handy";
    case 'nice':
      return "weather's nice, maybe a short walk";
  }
}

function enWeatherSurface(signal: WeatherSignal | null | undefined): string {
  return weatherConditions(signal)
    .map((c) => enWeatherConditionPhrase(c.kind))
    .join('. ')
    .trim();
}

// 프롬프트용 언어무관 영어 메타. 모델이 타깃 언어로 네이티브 재표현하도록 condition+action만 준다.
function weatherSignalPromptHint(signal: WeatherSignal | null | undefined): string {
  const conditions = weatherConditions(signal);
  if (conditions.length === 0) return 'no notable weather to mention';
  const map: Record<WeatherConditionKind, string> = {
    rain: 'rain likely → suggest taking an umbrella',
    snow: 'snow likely → suggest bundling up and watching for slippery ground',
    dust: 'poor air quality / fine dust → suggest wearing a mask',
    cold: 'cold → suggest dressing warmly with a layer',
    heat: 'hot → suggest staying hydrated, drinking water',
    nice: 'pleasant weather → a short walk is nice',
  };
  return conditions.map((c) => map[c.kind]).join('; ');
}

function dynamicAlarmTextPreparationFallback(
  context: DynamicAlarmTextContext,
): AlarmTextPreparation {
  const text = dynamicAlarmTextReadableFallback(context);
  // 폴백은 일반적 문구이므로 모드 기본 태그를 붙인다(sleep만 저각성 calm 허용).
  return {
    text,
    translated: false,
    tags: [modeDefaultTag(context.mode)],
    provider: 'local',
  };
}

// 호격(직접 호칭) 경계: 호격 조사(아/야)나 문장부호/공백/문장끝이 바로 뒤에 와야 매칭한다.
// 과거에는 일반 조사(이/가/은/는/도/의/로/으/께)까지 허용해 '딸이/아들이'(주어)처럼
// 호칭이 아닌 쓰임을 오매칭했다 → 호격 경계만 남겨 완화한다(§4.7).
const FAMILY_TITLE_RE =
  /(^|[\s"'“”‘’(（])(할머니|할머님|할아버지|할아버님|엄마|어머니|어머님|아빠|아버지|아버님|부모님|할미|할배|손녀|손자|딸|아들)(?:님)?(?:아|야)?(?=[\s,，.!！?？~]|$)/g;

function hasUnsupportedListenerAddress(
  text: string,
  listenerTitle: string | null | undefined,
): boolean {
  const allowedTitle = normalizeAddressLabel(listenerTitle);
  for (const match of text.matchAll(FAMILY_TITLE_RE)) {
    const matchedTitle = normalizeAddressLabel(match[2]);
    // 청자 호칭이 "우리 딸"/"사랑하는 아들"처럼 수식어+가족토큰(공백 구분)이면
    // FAMILY_TITLE_RE 는 bare 토큰("딸")만 뽑고 allowedTitle 은 공백제거형("우리딸")이라
    // strict 비교가 항상 어긋난다. matched 토큰이 allowedTitle 의 접미이면 지원 호칭으로 본다.
    const supported =
      allowedTitle != null &&
      matchedTitle != null &&
      (matchedTitle === allowedTitle || allowedTitle.endsWith(matchedTitle));
    if (!supported) {
      return true;
    }
  }
  return false;
}

function hasRelationshipLabelLeak(
  text: string,
  relationshipLabel: string | null | undefined,
  listenerTitle: string | null | undefined,
): boolean {
  const label = relationshipLabel?.trim();
  if (!label) return false;

  const escapedLabel = escapeRegExp(label);
  const sourcePhrase = new RegExp(`${escapedLabel}\\s*(?:목소리|voice)`, 'i');
  if (sourcePhrase.test(text)) return true;

  const koreanSelfReference = new RegExp(
    `${escapedLabel}\\s*(?:가|이|는|은|도|의|로|으로|에게|한테|처럼|입장에서|대신)`,
    'i',
  );
  if (koreanSelfReference.test(text)) return true;

  const allowedAddress =
    normalizeAddressLabel(label) !== null &&
    normalizeAddressLabel(label) === normalizeAddressLabel(listenerTitle);
  const directAddress = new RegExp(
    `(^|[\\s"'“”‘’(（])${escapedLabel}\\s*[,，!！?？~]`,
    'i',
  );
  return directAddress.test(text) && !allowedAddress;
}

function hasDeliveryTagOrStageDirection(text: string): boolean {
  if (TAG_RE.test(text)) return true;
  if (/^\s*[[（(]/.test(text)) return true;

  const bracketedParts = text.match(/[[（(][^\])）\]]{1,50}[\])）\]]/g) ?? [];
  return bracketedParts.some((part) =>
    /(softly|warmly|gently|cheerfully|brightly|calmly|whisper|속삭|다정하게|밝게|차분하게|부드럽게|따뜻하게|상냥하게)/i.test(
      part,
    ),
  );
}

function hasAlarmTimeEcho(text: string, alarmTimeLabel: string | null | undefined): boolean {
  const label = alarmTimeLabel?.trim();
  if (!label) return false;
  if (containsNormalized(text, label)) return true;

  const match = label.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const minuteText = String(minute).padStart(2, '0');
  const colonPattern = new RegExp(`(^|\\D)0?${hour}:${minuteText}(?=\\D|$)`);
  if (colonPattern.test(text)) return true;

  const koreanTimePattern =
    minute === 0
      ? new RegExp(`${hour}\\s*시\\s*(?:정각)?(?=[\\s,，.!！?？~]|$)`)
      : new RegExp(`${hour}\\s*시\\s*${minute}\\s*분`);
  if (koreanTimePattern.test(text)) return true;

  const period = hour < 12 ? '오전' : '오후';
  const twelveHour = hour % 12 || 12;
  const koreanTwelveHourPattern =
    minute === 0
      ? new RegExp(`${period}\\s*${twelveHour}\\s*시\\s*(?:정각)?(?=[\\s,，.!！?？~]|$)`)
      : new RegExp(`${period}\\s*${twelveHour}\\s*시\\s*${minute}\\s*분`);
  return koreanTwelveHourPattern.test(text);
}

function hasDateLabelEcho(text: string, dateLabel: string | null | undefined): boolean {
  const label = dateLabel?.trim();
  if (!label) return false;
  if (containsNormalized(text, label)) return true;

  const dateMatch = label.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (dateMatch) {
    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    if (new RegExp(`${month}\\s*월\\s*${day}\\s*일`).test(text)) return true;
  }

  const weekdayMatch = label.match(/[월화수목금토일]\s*요일/);
  if (weekdayMatch && containsNormalized(text, weekdayMatch[0])) return true;
  return false;
}

// 연인/배우자 톤의 HARD 하위규칙(§4.7): '새 인연/연애운/질투' 어휘만 차단한다.
// (과거의 '정중 어미 전량 reject'는 SOFT로 강등 → 더 이상 여기서 막지 않는다.)
function hasRomanticForbiddenContent(text: string, context: DynamicAlarmTextContext): boolean {
  if (context.targetLanguage !== 'ko' || !isRomanticRelationship(context.relationshipLabel)) {
    return false;
  }
  return /(새로운\s*인연|좋은\s*인연|연애운|소개팅|썸|플러팅|다른\s*사람|나만\s*(?:생각|바라)|내\s*생각만|질투)/i.test(
    text,
  );
}

// 타깃 언어 불일치(§4.7 HARD). 보수적으로만 판정한다: ko면 한글, ja면 가나/한자,
// en이면 한글·가나가 없어야 한다.
function hasLanguageMismatch(text: string, targetLanguage: string): boolean {
  const hasHangul = /[가-힣]/.test(text);
  const hasKana = /[぀-ヿㇰ-ㇿ]/.test(text);
  const hasKanji = /[一-鿿]/.test(text);
  if (targetLanguage === 'ko') return !hasHangul;
  if (targetLanguage === 'ja') return !hasKana && !hasKanji;
  if (targetLanguage === 'en') return hasHangul || hasKana;
  return false;
}

function normalizeAddressLabel(value: string | null | undefined): string | null {
  const compact = value?.trim().replace(/\s+/g, '').replace(/[,.!?~，！？。]+$/g, '');
  if (!compact) return null;
  return compact.replace(/님$/, '').replace(/[아야]$/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasFortuneProfileEcho(text: string, fortuneProfile: string | null | undefined): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/(생년월일|태어난\s*(?:시간|시각)|출생|몇\s*월\s*며칠\s*생|몇월\s*며칠\s*생|birth\s*date|born\s*on)/i.test(normalized)) {
    return true;
  }

  const birthDate = fortuneProfileValue(fortuneProfile, 'birth date');
  if (birthDate) {
    if (containsNormalized(normalized, birthDate)) return true;
    const match = birthDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const datePatterns = [
        new RegExp(`${year}\\s*년\\s*${month}\\s*월\\s*${day}\\s*일`),
        new RegExp(`${month}\\s*월\\s*${day}\\s*일\\s*(?:생|출생|태어)`, 'i'),
        new RegExp(`${month}\\s*월\\s*${day}\\s*일에\\s*(?:태어난|출생한)`, 'i'),
      ];
      if (datePatterns.some((pattern) => pattern.test(normalized))) return true;
    }
  }

  const birthTime = fortuneProfileValue(fortuneProfile, 'birth time');
  if (birthTime) {
    if (containsNormalized(normalized, birthTime)) return true;
    const match = birthTime.match(/^(\d{1,2}):(\d{2})$/);
    if (match) {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const timePattern = new RegExp(`${hour}\\s*시\\s*${minute}\\s*분`);
      if (timePattern.test(normalized)) return true;
    }
  }

  return false;
}

function fortuneProfileValue(profile: string | null | undefined, key: string): string | null {
  if (!profile) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = profile.match(new RegExp(`(?:^|,\\s*)${escapedKey}=([^,]+)`));
  return match?.[1]?.trim() || null;
}

function containsNormalized(text: string, needle: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  return normalize(text).includes(normalize(needle));
}

function parseAlarmTextPreparation(raw: string): {
  text: string;
  tags: string[];
  parsedJson: boolean;
} {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const parsed = JSON.parse(candidate) as { text?: unknown; tags?: unknown };
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === 'string').map(normalizeTag)
      : extractTags(text);
    return {
      text: stripWrappingQuotes(text),
      tags: tags.filter(Boolean),
      parsedJson: true,
    };
  } catch {
    return {
      text: stripWrappingQuotes(cleaned),
      tags: extractTags(cleaned),
      parsedJson: false,
    };
  }
}

// 동적 생성 응답 파서. responseSchema({text, tag})를 1차로 읽고, 간헐 빈응답/포맷이탈 대비
// brace-slice를 최후 폴백으로 둔다(§4.7: 레거시 파서 유지).
function parseDynamicAlarmTextResult(raw: string): {
  text: string;
  tag: string;
  parsedJson: boolean;
} {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    const parsed = JSON.parse(candidate) as { text?: unknown; tag?: unknown };
    const text = typeof parsed.text === 'string' ? stripWrappingQuotes(parsed.text.trim()) : '';
    const tag = typeof parsed.tag === 'string' ? normalizeTag(parsed.tag) : '';
    return { text, tag, parsedJson: true };
  } catch {
    return { text: stripWrappingQuotes(cleaned), tag: '', parsedJson: false };
  }
}

function isMetaJsonResponse(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return (
    normalized === 'here is the json' ||
    normalized === 'here is the json:' ||
    normalized === 'here is the json requested:' ||
    normalized === 'here is the json requested' ||
    normalized === 'here is the requested json:' ||
    normalized === 'here is the requested json' ||
    normalized.includes('here is the json') ||
    normalized.includes('json requested')
  );
}

function hasGeminiConfiguration(env: Env | undefined): boolean {
  return Boolean(env?.GOOGLE_VERTEX_CREDENTIALS_JSON);
}

function isDynamicVertexTextEnabled(env: Env | undefined): boolean {
  return env?.GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED === 'true';
}

function extractTags(text: string): string[] {
  const matches = text.match(/\[([a-z][a-z -]{1,32})\]/gi) ?? [];
  return Array.from(new Set(matches.map((tag) => normalizeTag(tag))));
}

function normalizeTag(tag: string): string {
  return tag.replace(/^\[/, '').replace(/\]$/, '').trim().toLowerCase();
}

function stripWrappingQuotes(text: string): string {
  return text
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

function normalizeSameLanguageTaggedText(
  preparedText: string,
  originalText: string,
  candidateTags: string[],
): string | null {
  if (normalizeAlarmTextWithoutTags(preparedText) !== normalizeAlarmTextWithoutTags(originalText)) {
    return null;
  }
  const tag = pickApprovedTag([...extractTags(preparedText), ...candidateTags]);
  if (!tag) return null;
  const tagged = `[${tag}] ${originalText}`;
  return tagged.length <= 200 ? tagged : originalText;
}

export function normalizeAlarmTextWithoutTags(text: string): string {
  return text
    .replace(/\s*\[[a-z][a-z -]{1,32}\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 표시/저장 문구(messageText)용: 우리가 자동으로 붙인 delivery 태그는 제거하되,
// 사용자가 직접 입력한 대괄호는 그대로 보존한다.
//
// 근거: 자동 태그는 prepareAlarmTextWithVertex 에서 '사용자가 대괄호를 하나도 안 쳤을 때만'
// (shouldTag = autoTag && !TAG_RE.test) 붙는다. 그러므로
// - originalText 에 대괄호가 있으면: 자동 태그가 아니므로 합성 텍스트를 그대로 쓴다(트림만).
//   '[after lunch]'·'오늘도 [happy]'·'[calm]'만 입력해도 문구가 안 지워진다.
// - 없으면: 합성 텍스트 안의 대괄호는 전부 자동/모델이 붙인 delivery 태그이므로 위치·개수와
//   무관하게 모두 제거하고 내부 공백을 한 칸으로 정리한다. 모델이 지시를 어기고 태그를 2개
//   붙이거나 문장 중간·이중 공백을 내도 화면에 새지 않는다(normalizeAlarmTextWithoutTags 재사용).
export function deriveAlarmDisplayText(synthesisText: string, originalText: string): string {
  if (TAG_RE.test(originalText.trim())) {
    return synthesisText.trim();
  }
  return normalizeAlarmTextWithoutTags(synthesisText);
}

function pickApprovedTag(tags: string[]): string | null {
  for (const tag of tags) {
    // 큐레이트 세트에 있으면 채택, 아니면 다음 후보로(세트 밖 옛 태그는 무시).
    const approved = normalizeApprovedTag(tag);
    if (approved) return approved;
  }
  return null;
}

function tagAlarmTextLocally(text: string): string {
  if (TAG_RE.test(text)) return text;
  const lower = text.toLowerCase();
  // 신 allowlist 기반 로컬 태깅(구 어휘 폐기). 모드 컨텍스트가 없는 preset/custom 경로라
  // 저각성 calm은 밤/마무리 뉘앙스에만 제한적으로 쓴다.
  const tag =
    lower.includes('잘 자') || lower.includes('night') || lower.includes('sleep')
      ? '[calm]'
      : lower.includes('사랑') || lower.includes('love')
        ? '[cheerfully]'
        : lower.includes('고생') || lower.includes('퇴근') || lower.includes('수고')
          ? '[calm]'
          : lower.includes('공부') || lower.includes('study') || lower.includes('힘')
            ? '[cheerfully]'
            : lower.includes('건강') || lower.includes('약') || lower.includes('물')
              ? '[calm]'
              : '[cheerfully]';
  const tagged = `${tag} ${text}`;
  return tagged.length <= 200 ? tagged : text;
}

async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function base64UrlJson(value: Record<string, unknown>): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
