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
  provider: 'vertex' | 'gemini-api-key' | 'local';
};

export type DynamicAlarmTextMode =
  | 'wake_weather'
  | 'wake_fortune'
  | 'meal'
  | 'sleep'
  | 'exercise'
  | 'love';

export type DynamicAlarmTextContext = {
  mode: DynamicAlarmTextMode;
  category: string;
  targetLanguage: string;
  dateLabel: string;
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  weatherSummary?: string | null;
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
const APPROVED_TAGS = [
  'warmly',
  'encouraging',
  'gentle',
  'softly',
  'calmly',
  'happily',
  'proudly',
  'brightly',
  'sleepily',
  'comforting',
];

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
  const provider = readGeminiApiKey(env) ? 'gemini-api-key' : 'vertex';
  const raw = await generateContentText(env, prompt, {
    temperature: 0.15,
    maxOutputTokens: 256,
  });
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

  if (!hasGeminiConfiguration(env)) {
    return fallback;
  }

  const prompt = dynamicAlarmTextPrompt(context);
  const provider = readGeminiApiKey(env) ? 'gemini-api-key' : 'vertex';
  let raw: string;
  try {
    raw = await generateContentText(env, prompt, {
      temperature: 0.85,
      maxOutputTokens: 256,
    });
  } catch {
    return fallback;
  }
  const parsed = parseAlarmTextPreparation(raw);
  const text = parsed.text.trim();

  if (
    !text ||
    isMetaJsonResponse(text) ||
    text.length > 200 ||
    hasUnsupportedListenerAddress(text) ||
    (context.mode === 'wake_fortune' && hasFortuneProfileEcho(text, context.fortuneProfile))
  ) {
    return fallback;
  }

  return {
    text,
    translated: false,
    tags: extractTags(text),
    provider,
  };
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

async function generateContentText(
  env: Env,
  prompt: string,
  config: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  const apiKey = readGeminiApiKey(env);
  if (apiKey) {
    return generateContentWithApiKey(env, apiKey, prompt, config);
  }

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

async function generateContentWithApiKey(
  env: Env,
  apiKey: string,
  prompt: string,
  config: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  const rawModel = env.GOOGLE_VERTEX_MODEL || DEFAULT_VERTEX_MODEL;
  const model = rawModel.startsWith('models/') ? rawModel : `models/${rawModel}`;
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  return generateContentAtEndpoint(endpoint, prompt, config);
}

async function generateContentAtEndpoint(
  endpoint: string,
  prompt: string,
  config: { temperature: number; maxOutputTokens: number },
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
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
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0,
        },
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
    ? `Add exactly one ElevenLabs v3 delivery tag from this allowlist: ${APPROVED_TAGS.map((tag) => `[${tag}]`).join(', ')}. Put the single tag at the very beginning of the text. Pick the tag that best matches the meaning and intended mood of the user text — use [warmly]/[encouraging]/[gentle]/[comforting] for affectionate or soft lines, [calmly]/[softly]/[sleepily] for night or quiet lines, [happily]/[brightly]/[proudly] for cheerful or celebratory lines. Do not rewrite, add, remove, or reorder any words unless translation is requested.`
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
function koreanRegisterGuidance(relationshipLabel: string | null | undefined): string {
  if (!relationshipLabel) return '';
  const label = relationshipLabel.trim();
  if (!label) return '';
  const youngerToElder = ['손녀', '손자', '손주', '딸', '아들', '자식', '며느리', '사위', '조카'];
  const elderToYounger = ['할머니', '할아버지', '엄마', '어머니', '아빠', '아버지', '부모', '이모', '고모', '삼촌', '외할머니', '외할아버지'];
  const peerOrIntimate = ['친구', '연인', '여자친구', '남자친구', '애인', '여보', '자기', '동생'];

  if (youngerToElder.some((k) => label.includes(k))) {
    return ' Speaker is younger than the listener: write in warm 해요체 (e.g. "할머니, 일어나셨어요?", "오늘은 ~해요"). Do NOT use stiff 합니다체 like "~합니다", "~하십시오". Sound like family talking, not a TV news anchor.';
  }
  if (elderToYounger.some((k) => label.includes(k))) {
    return ' Speaker is older than the listener: write in caring 반말 or 해요체 mixed style (e.g. "우리 딸, 잘 잤어?", "오늘도 화이팅이야"). Avoid 합니다체.';
  }
  if (peerOrIntimate.some((k) => label.includes(k))) {
    return ' Speaker and listener are peers/intimate: write in 반말 (e.g. "일어났어?", "오늘 뭐 입을까?"). Never use 합니다체.';
  }
  return ' Use a warm conversational tone — prefer 해요체 over 합니다체. Sound like a real person, not an announcement.';
}

function dynamicAlarmTextPrompt(context: DynamicAlarmTextContext): string {
  const targetName = LANGUAGE_NAMES[context.targetLanguage] || context.targetLanguage;
  const listenerTitle = context.listenerTitle?.trim();
  const listenerInstruction = listenerTitle
    ? `When addressing the listener, call them "${listenerTitle}" exactly (use this label naturally, do not translate it, and never replace it with grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter).`
    : 'Do not address the listener by guessed family titles such as grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter. Use a neutral greeting instead.';
  const koreanRegisterInstruction = context.targetLanguage === 'ko'
    ? koreanRegisterGuidance(context.relationshipLabel?.trim())
    : '';
  const relationship = context.relationshipLabel?.trim()
    ? `The selected voice belongs to the user's "${context.relationshipLabel}" relationship. Use this only to choose a natural speech register and warmth. Never mention the relationship label in the text, and never write phrases like "${context.relationshipLabel} voice", "in your ${context.relationshipLabel}'s voice", or "speaking as your ${context.relationshipLabel}". ${listenerInstruction} Do not invent names or private facts.${koreanRegisterInstruction}`
    : `No relationship label is available, so keep the line generally warm. ${listenerInstruction}`;
  const modeInstruction = (() => {
    if (context.mode === 'wake_weather') {
      return `Create a wake-up message. Start naturally like "일어나실 시간이에요" or "좋은 아침이에요" rather than describing whose voice it is. The weather context already comes as one or two short actionable suggestions, e.g. "비가 올 수 있어요. 우산 챙기세요", "미세먼지가 많아요. 외출할 땐 마스크 챙기세요", "날씨가 좋아요. 잠깐 산책 가기에도 딱이에요". Weave at most two of these suggestions into the line naturally. DO NOT recite raw numbers, temperatures, percentages, weather codes, or labels like "강수 확률 70%" or "최저 12도 최고 19도". DO NOT just describe the weather ("비가 와요" alone is not enough) — always pair it with a short action the listener can take (e.g. 우산 챙기기, 마스크 챙기기, 따뜻하게 입기, 산책 추천). Do not mention location names, city/country names, the exact date, or weekday. Ending is optional; if you add one, keep it short like "오늘도 화이팅!". Weather context: ${context.weatherSummary || 'weather information is unavailable'}.`;
    }
    if (context.mode === 'wake_fortune') {
      return `Create a wake-up message with a light, entertainment-only daily fortune. If fortune input is available, infer only a gentle mood from gender, birth date, and birth time. Fortune input is internal only: ${context.fortuneProfile || 'fortune profile is unavailable'}. Never mention the listener's birth date, birthday, birth time, zodiac details, "born on", "birth date", "생년월일", "태어난 시간", "몇 월 며칠생", or any specific month/day/year/time from the input. Do not sound like a real prediction or guarantee.`;
    }
    if (context.mode === 'meal') {
      return `Create a ${context.mealLabel || 'meal'} reminder. Ask naturally whether they have eaten and recommend one menu idea. Consider this weather if available: ${context.weatherSummary || 'weather information is unavailable'}.`;
    }
    if (context.mode === 'sleep') {
      return 'Create a bedtime message that helps the listener wind down, put the phone away, and rest without sounding like a generic notification.';
    }
    if (context.mode === 'exercise') {
      return `Create an exercise reminder. Make it energetic but not childish. If the weather suggests it, choose indoor strength training or outdoor cardio naturally. Weather context: ${context.weatherSummary || 'weather information is unavailable'}.`;
    }
    return 'Create a warm love/relationship message that feels personal, caring, and suitable for a voice alarm without being overly dramatic.';
  })();

  return [
    'You write one short, natural voice-alarm sentence for text-to-speech.',
    `Write in ${targetName}.`,
    `Internal date context for freshness only, do not mention it in the final text: ${context.dateLabel}.`,
    context.alarmTimeLabel ? `Alarm time context: ${context.alarmTimeLabel}.` : '',
    `Alarm category: ${context.category}.`,
    relationship,
    modeInstruction,
    listenerTitle
      ? `Address the listener as "${listenerTitle}" rather than guessing a family title.`
      : 'For example, if the relationship label is "손녀", do not write "할머니" or "할아버지"; use a neutral greeting instead.',
    'Do not announce the relationship or source of the voice. Avoid phrases like "손녀 목소리로 전해요"; the alarm should sound like a natural alarm line.',
    'Do not mention the exact date, weekday, country, city, district, or saved location label unless the user explicitly wrote it as part of the alarm text.',
    context.targetLanguage === 'ko'
      ? '한국어 어체 규칙: 가족·친구·연인 관계에서는 절대 "~합니다", "~하십시오" 같은 합니다체를 쓰지 말 것. 손녀→조부모, 자식→부모 등 손아랫사람이 손윗사람에게 말할 때는 친근한 해요체 ("~해요", "~예요"). 부모→자식, 형/누나→동생 등은 다정한 반말 또는 해요체 혼용. 친구·연인 사이는 반말. 뉴스 앵커처럼 들리지 않게 진짜 가족이 옆에서 말하는 톤으로.'
      : '',
    context.targetLanguage === 'ko'
      ? '문장 구조 예시 (wake_weather): "일어나실 시간이에요. 비가 올 수 있대요. 우산 꼭 챙기세요. 오늘도 화이팅!" / "좋은 아침이에요. 날씨가 좋대요. 잠깐 산책 가기에도 딱이에요." / "일어나실 시간이에요. 미세먼지가 많대요. 마스크 챙겨 나가세요." — 위치/날짜/관계/숫자 없이 시작해서, 날씨 상태와 그에 맞는 행동 권유를 한두 마디로 자연스럽게 묶고 짧게 마무리. 강수확률·기온 숫자를 그대로 읽는 패턴은 금지.'
      : '',
    'Make it feel meaningfully different from a prerecorded fixed alarm.',
    'Do not include any brackets, delivery tags, [tag] markers, or stage directions in your output. A single delivery tag will be added in a later step.',
    'No markdown, no emojis, no quotes, no explanations, no extra fields.',
    'Keep the final text spoken, kind, and 200 characters or fewer.',
    'Return strict JSON: {"text":"final alarm line"}.',
  ].join('\n');
}

function dynamicAlarmTextReadableFallback(context: DynamicAlarmTextContext): string {
  const listener = context.listenerTitle?.trim();
  const address = listener ? `${listener}, ` : '';
  const wakeOpener = `${address}일어나실 시간이에요.`;
  const opener = listener ? `${listener}, ` : '';
  if (context.mode === 'wake_weather' && context.weatherSummary) {
    return `${wakeOpener} ${stripTrailingPunctuation(context.weatherSummary)}. 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'wake_fortune') {
    return `${wakeOpener} 오늘은 작은 선택에 좋은 기운이 따르는 날이에요. 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'meal') {
    const weatherTip = context.weatherSummary ? ` ${context.weatherSummary}` : '';
    return `${opener}${context.mealLabel || '식사'} 챙길 시간이에요.${weatherTip} 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'sleep') {
    return `${opener}이제 쉬어갈 시간이에요. 화면은 잠시 내려놓고 편하게 쉬어요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'exercise') {
    return `${opener}운동할 시간이에요. 무리하지 말고 가볍게 시작해요. 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'love') {
    return `${opener}좋은 아침이에요. 오늘도 옆에서 응원하고 있어요.`
      .slice(0, 200)
      .trim();
  }
  return `${address}일어나실 시간이에요. 오늘도 화이팅!`
    .slice(0, 200)
    .trim();
}

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?。]+$/g, '');
}

function dynamicAlarmTextPreparationFallback(
  context: DynamicAlarmTextContext,
): AlarmTextPreparation {
  const text = dynamicAlarmTextReadableFallback(context);
  return {
    text,
    translated: false,
    tags: extractTags(text),
    provider: 'local',
  };
}

function hasUnsupportedListenerAddress(text: string): boolean {
  return /(^|[\s"'“”‘’(（])(?:할머니|할머님|할아버지|할아버님|엄마|어머니|어머님|아빠|아버지|아버님|부모님|할미|할배|손녀|손자|딸|아들)(?:님)?(?=[\s,，.!！?？~]|$)/.test(
    text,
  );
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

function hasGeminiConfiguration(env: Env): boolean {
  return Boolean(readGeminiApiKey(env) || env.GOOGLE_VERTEX_CREDENTIALS_JSON);
}

function readGeminiApiKey(env: Env): string | undefined {
  return env.GOOGLE_VERTEX_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
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

function normalizeAlarmTextWithoutTags(text: string): string {
  return text
    .replace(/\s*\[[a-z][a-z -]{1,32}\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickApprovedTag(tags: string[]): string | null {
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (APPROVED_TAGS.includes(normalized)) return normalized;
  }
  return null;
}

function tagAlarmTextLocally(text: string): string {
  if (TAG_RE.test(text)) return text;
  const lower = text.toLowerCase();
  const tag =
    lower.includes('잘 자') || lower.includes('night') || lower.includes('sleep')
      ? '[softly]'
      : lower.includes('사랑') || lower.includes('love')
        ? '[warmly]'
        : lower.includes('고생') || lower.includes('퇴근') || lower.includes('수고')
          ? '[gentle]'
          : lower.includes('공부') || lower.includes('study') || lower.includes('힘')
            ? '[encouraging]'
            : lower.includes('건강') || lower.includes('약') || lower.includes('물')
              ? '[calmly]'
              : '[warmly]';
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
