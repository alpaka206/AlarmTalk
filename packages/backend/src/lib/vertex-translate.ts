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
    hasUnsupportedListenerAddress(text)
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
    ? `Add one or two ElevenLabs v3 delivery tags from this allowlist: ${APPROVED_TAGS.map((tag) => `[${tag}]`).join(', ')}. Put tags inline before the phrase they affect.`
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

function dynamicAlarmTextPrompt(context: DynamicAlarmTextContext): string {
  const targetName = LANGUAGE_NAMES[context.targetLanguage] || context.targetLanguage;
  const listenerTitle = context.listenerTitle?.trim();
  const listenerInstruction = listenerTitle
    ? `When addressing the listener, call them "${listenerTitle}" exactly (use this label naturally, do not translate it, and never replace it with grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter).`
    : 'Do not address the listener by guessed family titles such as grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter. Use a neutral greeting instead.';
  const relationship = context.relationshipLabel?.trim()
    ? `The selected voice belongs to the user's "${context.relationshipLabel}" relationship. This label describes the speaker's relationship to the user, not the listener's title. Use it only to shape warmth and tone. ${listenerInstruction} Do not invent names or private facts.`
    : `No relationship label is available, so keep the line generally warm. ${listenerInstruction}`;
  const modeInstruction = (() => {
    if (context.mode === 'wake_weather') {
      return `Use this weather context if available: ${context.weatherSummary || 'weather information is unavailable'}. Give one practical morning tip when it fits.`;
    }
    if (context.mode === 'wake_fortune') {
      return `Create a wake-up message with a light, entertainment-only daily fortune. If fortune input is available, infer a gentle saju-style daily tone from gender, birth date, and birth time, but do not repeat the raw birth data. Fortune input: ${context.fortuneProfile || 'fortune profile is unavailable'}. Do not sound like a real prediction or guarantee.`;
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
    `Date context: ${context.dateLabel}.`,
    context.alarmTimeLabel ? `Alarm time context: ${context.alarmTimeLabel}.` : '',
    `Alarm category: ${context.category}.`,
    relationship,
    modeInstruction,
    listenerTitle
      ? `Address the listener as "${listenerTitle}" rather than guessing a family title.`
      : 'For example, if the relationship label is "손녀", do not write "할머니" or "할아버지"; use a neutral greeting instead.',
    'Make it feel meaningfully different from a prerecorded fixed alarm.',
    'No markdown, no emojis, no quotes, no explanations, no extra fields.',
    'Keep the final text spoken, kind, and 200 characters or fewer.',
    'Return strict JSON: {"text":"final alarm line"}.',
  ].join('\n');
}

function dynamicAlarmTextReadableFallback(context: DynamicAlarmTextContext): string {
  const relationship = context.relationshipLabel?.trim();
  const listener = context.listenerTitle?.trim();
  const opener = (() => {
    if (listener && relationship) return `${listener}, ${relationship} 목소리로 전해요.`;
    if (listener) return `${listener}, 좋은 아침이에요.`;
    if (relationship) return `${relationship} 목소리로 전해요.`;
    return '좋은 아침이에요.';
  })();
  if (context.mode === 'wake_weather' && context.weatherSummary) {
    return `${opener} ${context.dateLabel}, ${context.weatherSummary} 오늘 필요한 것만 챙기고 가볍게 시작해요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'wake_fortune') {
    const profileText = context.fortuneProfile ? ' 입력한 생년월일과 태어난 시간 기준으로' : '';
    return `${opener} ${context.dateLabel}${profileText} 오늘은 작은 선택에 좋은 기운이 따르는 날이에요. 차근차근 시작해 봐요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'meal') {
    const weatherTip = context.weatherSummary ? ` ${context.weatherSummary}` : '';
    return `${opener} ${context.mealLabel || '식사'} 챙길 시간이에요.${weatherTip} 오늘은 부담 없는 따뜻한 메뉴로 에너지를 채워 봐요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'sleep') {
    return `${opener} 이제 쉬어갈 시간이에요. 화면은 잠시 내려놓고, 편안한 숨으로 하루를 마무리해요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'exercise') {
    return `${opener} 운동 갈 시간이에요. 오늘도 무리하지 말고 한 세트씩, 몸이 깨어나는 느낌으로 시작해 봐요.`
      .slice(0, 200)
      .trim();
  }
  if (context.mode === 'love') {
    return `${opener} 잠깐이라도 네 생각이 났어. 오늘도 마음은 네 편이니까 천천히 다녀와.`
      .slice(0, 200)
      .trim();
  }
  return `${opener} ${context.dateLabel} 오늘은 새로운 하루가 시작됐어요. 천천히 일어나서 좋은 리듬을 만들어 봐요.`
    .slice(0, 200)
    .trim();
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
