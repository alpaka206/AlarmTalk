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
  const text = polishDynamicAlarmText(parsed.text.trim(), context);

  if (
    !text ||
    isMetaJsonResponse(text) ||
    text.length > 200 ||
    hasUnsupportedListenerAddress(text, context.listenerTitle) ||
    hasRelationshipLabelLeak(text, context.relationshipLabel, context.listenerTitle) ||
    hasDeliveryTagOrStageDirection(text) ||
    hasAlarmTimeEcho(text, context.alarmTimeLabel) ||
    hasDateLabelEcho(text, context.dateLabel) ||
    hasRomanticToneIssue(text, context) ||
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
  const romanticToneInstruction =
    context.targetLanguage === 'ko' && isRomanticRelationship(context.relationshipLabel)
      ? 'Romantic partner/spouse tone: the line should sound like something an actual boyfriend, girlfriend, wife, or husband would say privately to the listener. Use intimate 반말, not 해요체 or 합니다체, even for spouse labels such as 아내 or 남편. Good examples: "여보, 날씨 좋대. 잠깐 산책 가도 좋겠다", "자기야, 오늘 작은 행운이 온대". Bad examples: "여보, 날씨가 좋대요", "자기야, 일어나세요". Make it tender, warm, and lightly heart-fluttering, but still short and usable as an alarm. Do not become cheesy, poetic, possessive, or overly dramatic. Never mention new romantic connections, romance luck, flirting with others, jealousy, or phrases like "나만 생각해".'
      : '';
  const modeInstruction = (() => {
    if (context.mode === 'wake_weather') {
      return `Create a wake-up message that sounds like one real person gently waking another person up. Start with the listener's title if one is provided, then a natural wake-up phrase like "일어나실 시간이에요" or "좋은 아침이에요"; do not describe whose voice it is. The weather context already comes as one or two short actionable suggestions, e.g. "비가 올 수 있어요. 우산 챙기세요", "미세먼지가 많아요. 외출할 땐 마스크 챙기세요", "날씨가 좋아요. 잠깐 산책 가기에도 딱이에요". Convert that context into conversational speech and weave at most two suggestions into the line naturally. DO NOT recite raw numbers, temperatures, percentages, weather codes, or labels like "강수 확률 70%" or "최저 12도 최고 19도". DO NOT just describe the weather ("비가 와요" alone is not enough) — always pair it with a short action the listener can take (e.g. 우산 챙기기, 마스크 챙기기, 따뜻하게 입기, 산책 추천). For Korean, prefer soft relayed phrasing such as "~대요", "~있대요", "~다네요", or "~면 좋겠어요" when natural. In respectful family speech, keep natural particles and spacing: prefer "비가 올 수 있대요" or "오늘은 비가 올 수 있대요"; avoid clipped wording like "비 올 수 있대요". Avoid robotic connector phrases like "예보 보니까" unless it truly sounds spoken. Do not mention location names, city/country names, the exact date, or weekday. End with a tiny human care phrase only when it fits the relationship. Weather context: ${context.weatherSummary || 'weather information is unavailable'}.`;
    }
    if (context.mode === 'wake_fortune') {
      return `Create a wake-up message with a light, entertainment-only daily fortune. If fortune input is available, infer only a gentle mood from gender, birth date, and birth time. Fortune input is internal only: ${context.fortuneProfile || 'fortune profile is unavailable'}. Never mention the listener's birth date, birthday, birth time, zodiac details, "born on", "birth date", "생년월일", "태어난 시간", "몇 월 며칠생", or any specific month/day/year/time from the input. Do not sound like a real prediction or guarantee. For Korean, make the fortune feel like a soft, playful reading rather than something the speaker personally knows for certain; endings like "~래", "~라네요", "~것 같아", or "~면 좋겠다" are good when they sound natural. If the speaker is a romantic partner or spouse, do not mention new relationships, romantic opportunities, attraction from others, flirting, jealousy, or dating luck; keep the fortune about mood, small luck, confidence, health, work, study, or daily energy.`;
    }
    if (context.mode === 'meal') {
      return `Create a ${context.mealLabel || 'meal'} reminder. Ask naturally whether they have eaten and recommend one menu idea. Consider this weather if available, using soft relayed weather phrasing in Korean when natural without forcing a source lead-in: ${context.weatherSummary || 'weather information is unavailable'}.`;
    }
    if (context.mode === 'sleep') {
      return isSiblingRelationship(context.relationshipLabel)
        ? 'Create a sibling-style bedtime message in natural 반말. Make it sound like a real brother or sister, not a polite notification. Good Korean example: "누나, 잘 시간이야. 휴대폰 내려놓고 얼른 자." Avoid 해요체 like "잘 시간이에요", "쉬어요", or "주무세요" for sibling cases.'
        : 'Create a bedtime message that helps the listener wind down, put the phone away, and rest without sounding like a generic notification.';
    }
    if (context.mode === 'exercise') {
      return `Create an exercise reminder. Make it energetic but not childish. If the weather suggests it, choose indoor strength training or outdoor cardio naturally. In Korean, weather can use soft reported phrasing when natural, but do not force an explicit source phrase. Weather context: ${context.weatherSummary || 'weather information is unavailable'}.`;
    }
    return isRomanticRelationship(context.relationshipLabel)
      ? 'Create a romantic partner wake-up line that feels private, affectionate, and gently exciting to hear, while still short enough for a practical alarm. Avoid generic "좋은 하루 보내" unless paired with a more personal caring phrase.'
      : 'Create a warm love/relationship message that feels personal, caring, and suitable for a voice alarm without being overly dramatic.';
  })();

  return [
    'You write one short, natural voice-alarm sentence for text-to-speech.',
    `Write in ${targetName}.`,
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
  const romantic = context.targetLanguage === 'ko' && isRomanticRelationship(context.relationshipLabel);
  const romanticOpener = listener ? `${listener}, ` : '좋은 아침이야. ';
  if (context.mode === 'wake_weather' && context.weatherSummary) {
    if (romantic) {
      return `${romanticOpener}${weatherSummaryForFallback(context.weatherSummary, true)}. 오늘도 네 편이야.`
        .slice(0, 200)
        .trim();
    }
    const weatherTip = weatherSummaryForFallback(context.weatherSummary, false);
    const careClosing = context.targetLanguage === 'ko' && isYoungerToElderRelationship(context.relationshipLabel)
      ? ' 조심히 다녀오세요.'
      : ' 오늘도 화이팅!';
    return `${wakeOpener} ${weatherTip}.${careClosing}`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'wake_fortune') {
    if (romantic) {
      return `${romanticOpener}오늘은 작은 행운이 따라온대. 천천히 일어나서 좋은 하루 같이 시작하자.`
        .slice(0, 200)
        .trim();
    }
    return `${wakeOpener} 오늘은 작은 선택에 좋은 기운이 따르는 날이에요. 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'meal') {
    if (romantic) {
      const weatherTip = context.weatherSummary
        ? ` ${weatherSummaryForFallback(context.weatherSummary, true)}.`
        : '';
      return `${romanticOpener}${context.mealLabel || '밥'} 먹었어? 바빠도 한 끼는 제대로 챙기자.${weatherTip}`
        .slice(0, 200)
        .trim();
    }
    const weatherTip = context.weatherSummary ? ` ${context.weatherSummary}` : '';
    return `${opener}${context.mealLabel || '식사'} 챙길 시간이에요.${weatherTip} 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'sleep') {
    if (romantic) {
      return `${romanticOpener}이제 쉬자. 오늘도 고생 많았어. 좋은 꿈 꿔.`
        .slice(0, 200)
        .trim();
    }
    return `${opener}이제 쉬어갈 시간이에요. 화면은 잠시 내려놓고 편하게 쉬어요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'exercise') {
    if (romantic) {
      return `${romanticOpener}운동할 시간이야. 무리하지 말고 딱 기분 좋아질 만큼만 하자.`
        .slice(0, 200)
        .trim();
    }
    return `${opener}운동할 시간이에요. 무리하지 말고 가볍게 시작해요. 오늘도 화이팅!`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'love') {
    if (romantic) {
      return `${romanticOpener}좋은 아침이야. 오늘도 네 편이니까 천천히 일어나자.`
        .slice(0, 200)
        .trim();
    }
    return `${opener}좋은 아침이에요. 오늘도 옆에서 응원하고 있어요.`
      .slice(0, 200)
      .trim();
  }
  return `${address}일어나실 시간이에요. 오늘도 화이팅!`
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

function stripTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?。]+$/g, '');
}

function weatherSummaryForFallback(summary: string, intimate: boolean): string {
  const naturalSummary = naturalizeRawWeatherSummary(summary, intimate);
  if (naturalSummary) return naturalSummary;

  const replacements: Array<[RegExp, string]> = intimate
    ? [
        [/비가 살짝 올 수 있어요/g, '비가 살짝 올 수 있대'],
        [/비가 올 수 있어요/g, '비 올 수 있대'],
        [/눈이 올 수 있어요/g, '눈 올 수 있대'],
        [/미세먼지가 많아요/g, '미세먼지 많대'],
        [/날씨가 좋아요/g, '날씨 좋대'],
        [/낮에 무더울 거예요/g, '낮에 많이 덥대'],
        [/낮엔 따뜻해요/g, '낮엔 따뜻하대'],
        [/많이 쌀쌀해요/g, '많이 쌀쌀하대'],
        [/쌀쌀해요/g, '쌀쌀하대'],
        [/우산 꼭 챙기세요/g, '우산 꼭 챙겨'],
        [/우산을 챙기면 안심돼요/g, '우산 챙기면 안심될 거야'],
        [/마스크 챙기세요/g, '마스크 챙겨'],
        [/겉옷 하나 챙기세요/g, '겉옷 하나 챙겨'],
        [/따뜻하게 입고 나가세요/g, '따뜻하게 입고 나가'],
        [/미끄럽지 않게 조심하세요/g, '미끄럽지 않게 조심해'],
        [/물도 자주 드세요/g, '물도 자주 마셔'],
        [/잠깐 산책 가기에도 딱이에요/g, '잠깐 산책 가기에도 딱이야'],
      ]
    : [
        [/비가 살짝 올 수 있어요/g, '비가 살짝 올 수 있대요'],
        [/비가 올 수 있어요/g, '비가 올 수 있대요'],
        [/눈이 올 수 있어요/g, '눈이 올 수 있대요'],
        [/미세먼지가 많아요/g, '미세먼지가 많대요'],
        [/날씨가 좋아요/g, '날씨가 좋대요'],
        [/낮엔 따뜻해요/g, '낮엔 따뜻하대요'],
        [/많이 쌀쌀해요/g, '많이 쌀쌀하대요'],
        [/쌀쌀해요/g, '쌀쌀하대요'],
        [/우산을 챙기면 (?:좋아요|안심돼요)/g, '우산 꼭 챙기세요'],
      ];
  return replacements.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    stripTrailingPunctuation(summary),
  );
}

function naturalizeRawWeatherSummary(summary: string, intimate: boolean): string | null {
  const text = stripTrailingPunctuation(summary);
  const hasRain = /(비|강수|우산|precipitation|rain)/i.test(text);
  const hasSnow = /(눈|미끄럽|snow)/i.test(text);
  const hasDust = /(미세먼지|초미세먼지|마스크|pm10|pm2\.?5)/i.test(text);
  const hasCold = /(쌀쌀|추|최저|영하|겉옷|따뜻하게)/i.test(text);
  const hasHeat = /(무더|더울|최고|물도|시원하게)/i.test(text);

  if (intimate) {
    if (hasSnow) return '눈 올 수 있대. 미끄럽지 않게 조심해';
    if (hasRain) return '비 올 수 있대. 나가기 전에 우산 꼭 챙겨';
    if (hasDust) return '미세먼지 많대. 나갈 땐 마스크 챙겨';
    if (hasCold) return '쌀쌀하대. 겉옷 하나 챙겨';
    if (hasHeat) return '낮에 많이 덥대. 물도 자주 마셔';
    return null;
  }

  if (hasSnow) return '눈이 올 수 있대요. 미끄럽지 않게 조심하세요';
  if (hasRain) return '비가 올 수 있대요. 나가실 때 우산 꼭 챙기세요';
  if (hasDust) return '미세먼지가 많대요. 외출하실 때 마스크 챙기세요';
  if (hasCold) return '쌀쌀하대요. 겉옷 하나 챙기세요';
  if (hasHeat) return '낮에 많이 덥대요. 물도 자주 드세요';
  return null;
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

const FAMILY_TITLE_RE =
  /(^|[\s"'“”‘’(（])(할머니|할머님|할아버지|할아버님|엄마|어머니|어머님|아빠|아버지|아버님|부모님|할미|할배|손녀|손자|딸|아들)(?:님)?(?:아|야)?(?=[\s,，.!！?？~]|$|[이가은는도의로으께])/g;

function hasUnsupportedListenerAddress(
  text: string,
  listenerTitle: string | null | undefined,
): boolean {
  const allowedTitle = normalizeAddressLabel(listenerTitle);
  for (const match of text.matchAll(FAMILY_TITLE_RE)) {
    const matchedTitle = normalizeAddressLabel(match[2]);
    if (!allowedTitle || matchedTitle !== allowedTitle) {
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

function hasRomanticToneIssue(text: string, context: DynamicAlarmTextContext): boolean {
  if (context.targetLanguage !== 'ko' || !isRomanticRelationship(context.relationshipLabel)) {
    return false;
  }

  if (
    /(새로운\s*인연|좋은\s*인연|연애운|소개팅|썸|플러팅|다른\s*사람|나만\s*(?:생각|바라)|내\s*생각만|질투)/i.test(
      text,
    )
  ) {
    return true;
  }

  return /(?:합니다|하십시오|해요|하세요|챙기세요|드세요|이에요|예요|거예요|좋대요|있대요|온대요|라네요|다네요)(?=[\s,，.!！?？~]|$)/.test(
    text,
  );
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
  return Boolean(readGeminiApiKey(env) || env?.GOOGLE_VERTEX_CREDENTIALS_JSON);
}

function readGeminiApiKey(env: Env | undefined): string | undefined {
  return env?.GOOGLE_VERTEX_API_KEY || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY;
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
