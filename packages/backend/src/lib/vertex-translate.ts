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
  /** **표시용** 문구 — 딜리버리 태그가 없는 순수 낭독 텍스트. 화면·저장은 이걸 쓴다. */
  text: string;
  translated: boolean;
  tags: string[];
  /**
   * **합성용** 문구 — 모델이 배치한 인라인 태그가 그대로 박힌 텍스트. 없으면 호출부가
   * `text` 에 태그를 다시 입힌다(`applyDeliveryTagPerSentence`).
   *
   * ⚠ `text` 와 나뉘어 있는 이유: 예전에는 하나였는데, 모델이 인라인 태그를 내기
   * 시작하자 **그 대괄호가 화면 문구로 그대로 샜다**(Codex #701 P2).
   */
  synthesisText?: string;
  provider: 'vertex' | 'local';
};

// 편집기가 고를 수 있는 동적 생성 모드.
// ⚠ `cheer` 의 옛 이름은 `love` 다(2026-09-02 개념 변경 — 연애가 아니라 응원).
// 들어오는 값은 `normalizeRandomContext` 가 이미 접어서 준다.
export type DynamicAlarmTextMode = 'wake_weather' | 'wake_fortune' | 'cheer';

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

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const DEFAULT_VERTEX_LOCATION = 'global';
const DEFAULT_VERTEX_MODEL = 'gemini-2.5-flash';
/// 대괄호 태그의 **모양**. 이 한 벌이 유일 출처다 — 예전에는 같은 문자셋이 네 군데에
/// 리터럴로 박혀 있어, 하나만 넓히면 "태그로 인식은 되는데 화면에서 안 벗겨지는" 상태가 됐다.
///
/// ⚠ **쉼표를 빼지 말 것.** ElevenLabs v3 태그는 고정 enum 이 아니라 자연어 지시라
/// `[low, controlled]`·`[measured, deliberate]` 같은 두 마디 지시가 흔하다. 쉼표가 빠져
/// 있던 동안 그 형태는 **태그로 인식조차 되지 않아** 그냥 글자로 낭독되거나 뒤 검사에서
/// 통째로 폐기됐다(2026-08-13 실측).
export const TAG_BODY_PATTERN = '[a-z][a-z ,-]{1,48}';
const TAG_RE = new RegExp(`\\[${TAG_BODY_PATTERN}\\]`, 'i');
const TAG_RE_GLOBAL = new RegExp(`\\[${TAG_BODY_PATTERN}\\]`, 'gi');
// ElevenLabs v3 태그는 고정 enum이 아니라 대괄호 안 자연어 지시이며, 실제 효과는 보이스·문맥·
// stability에 따라 달라진다(2026-06-28 사용자/공식문서 검증).
//
// ⚠ **닫힌 허용 목록으로 되돌리지 말 것**(2026-08-13 확정).
// 예전에는 감정 형용사 10개짜리 allowlist 였고, 그 밖의 태그는 조용히 무태그로 강등됐다.
// 그래서 [laughs]·[through gritted teeth]·[defiant] 같은 **비언어 소리·발성 방식·태도**
// 지시를 아예 쓸 수 없었다 — 목록을 넓혀도 새 어휘가 나올 때마다 또 막힌다.
// 이제 판정은 **모양(TAG_RE) + 아래 저각성 금지**뿐이다.
//
// 프롬프트에 예시로 보여줄 어휘. 목록에 없다고 막지는 않는다 — 모델에게 방향만 준다.
const TAG_EXAMPLES = [
  // 감정·태도
  'happy', 'cheerfully', 'excited', 'playfully', 'curious', 'lighthearted',
  'proud', 'defiant', 'flustered', 'fierce', 'embarrassed',
  // 비언어 소리
  'laughs', 'giggles', 'sighs', 'laughs nervously', 'giggling',
  // 발성 방식
  'shouting', 'low, controlled', 'through gritted teeth', 'measured, deliberate',
];
// Bruck/McFarlane: 저각성 신호는 기상을 방해한다. 깨우는 경로(동적 생성·사전렌더)는 서버가
// 이 뜻을 가진 태그를 무조건 드롭한다.
//
// ⚠ **"천천히" 와 "졸리게" 를 섞지 말 것**(2026-08-13 확정 — C안).
// 말 속도를 늦추는 지시(measured·deliberate·slow)는 **허용**한다. 사용자가 "말이 너무
// 빠르다" 고 했고, 천천히 말하는 것은 각성을 낮추지 않는다. 막는 것은 **졸리고 작게**
// 말하라는 쪽이다.
const LOW_AROUSAL_WORDS = [
  'tired', 'sleepy', 'drowsy', 'yawn',
  'whisper', 'whispers', 'whispering',
  'quiet', 'quietly', 'soft', 'softly', 'hushed',
  'calm', 'calmly', 'soothing', 'gentle', 'gently',
  'mumbl', 'murmur',
];

/**
 * 프롬프트에 그대로 실을 금지 태그 문구. `LOW_AROUSAL_WORDS` 에서 **파생**시킨다.
 *
 * ⚠ 손으로 적어 두면 가드와 어긋난다(실측 2026-08-21): 목록에 `[gently]` 만 있고
 * `[gentle]` 이 없어서, 모델이 형용사형 `[gentle]` 을 붙였다가 가드에 걸려 일본어 운세
 * '건강' 시드가 3회 전부 실패했다. 무엇이 막히는지 모델에게 정확히 알려 준다.
 */
const LOW_AROUSAL_TAG_EXAMPLES = LOW_AROUSAL_WORDS.filter(
  (word) => !word.endsWith('l') && word !== 'mumbl',
)
  .map((word) => `[${word}]`)
  .join(', ');

/// 이 태그가 저각성(기상 방해) 뜻을 갖는가. 여러 마디 태그도 낱말 단위로 본다.
function isLowArousalTag(tag: string): boolean {
  const normalized = normalizeTag(tag);
  if (!normalized) return false;
  return LOW_AROUSAL_WORDS.some((word) => normalized.includes(word));
}

/// 태그로 받아들일 수 있는가 — **모양만** 본다(닫힌 목록 없음).
///
/// ⚠ 예전에는 여기서 큐레이트 세트 멤버십을 봤고, 밖의 태그는 조용히 무태그가 됐다.
/// 그래서 프롬프트만 넓히면 **모델은 태그를 내는데 결과는 무태그**라 원인을 못 찾았다.
function normalizeApprovedTag(tag: string): string {
  const normalized = normalizeTag(tag);
  if (!normalized) return '';
  return TAG_RE.test(`[${normalized}]`) ? normalized : '';
}

// 모드별 기본 delivery 태그(§4.4). 폴백/가이드에 쓰인다.
function modeDefaultTag(mode: DynamicAlarmTextMode): string {
  switch (mode) {
    case 'wake_weather':
      return 'cheerfully';
    case 'wake_fortune':
      return 'playfully';
    case 'cheer':
      return 'happy';
  }
}

// 동적 생성의 tag 필드를 정제한다: 큐레이트 세트 검증 → 저각성 태그 차단(남은 모드는 전부
// '깨우는' 알람이다). 부적합하면 빈 문자열(무태그)로 강등(reject 아님 = SOFT).
/// 깨우는 경로용 — 모양이 맞고 **저각성이 아니면** 통과.
function sanitizeDeliveryTag(tag: string): string {
  const approved = normalizeApprovedTag(tag);
  if (!approved) return '';
  if (isLowArousalTag(approved)) return '';
  return approved;
}

/// 텍스트 안의 태그들을 깨우는 경로 기준으로 거른다.
/// 저각성 태그만 지우고 나머지는 **위치까지 그대로** 남긴다 — 여러 개·중간 태그가 요점이다.
export function dropLowArousalTags(text: string): string {
  return text
    .replace(TAG_RE_GLOBAL, (match) => {
      const body = match.slice(1, -1);
      return isLowArousalTag(body) ? '' : match;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
    const raw2 = parsed.text.trim();
    // ⚠ **검증·수리·표시는 태그를 뺀 본문으로 한다**(Codex #701 P2).
    // 모델이 인라인 태그를 내기 시작하면서 `[warmly]` 같은 영어 대괄호가 본문에 섞이는데,
    // 그대로 재면 (1) 200자 상한에 장식이 얹히고 (2) `hasLanguageMismatch` 가 한국어
    // 문구를 영어 섞임으로 오판하며 (3) 무엇보다 그 대괄호가 **화면 문구로 샌다.**
    // ⚠ **수리(polish)는 합성 문구에도 반영돼야 한다**(Codex #701 P2).
    // 예전에는 태그를 벗긴 본문만 수리하고 합성에는 원문을 넘겨, 조사·띄어쓰기 수리가
    // 화면에만 반영되고 **실제로 들리는 소리는 안 고쳐진** 상태가 됐다.
    // 태그가 붙은 원문을 그대로 수리하되, 수리가 태그를 건드렸으면(개수·내용이 달라지면)
    // 그 결과는 믿지 않고 태그 없는 쪽만 쓴다.
    const polishedTagged = polishDynamicAlarmText(raw2, context);
    const tagsSurvivedPolish =
      JSON.stringify(extractTags(polishedTagged)) === JSON.stringify(extractTags(raw2));
    const taggedSource = tagsSurvivedPolish ? polishedTagged : raw2;
    const spoken = tagsSurvivedPolish
      ? normalizeAlarmTextWithoutTags(polishedTagged)
      : polishDynamicAlarmText(normalizeAlarmTextWithoutTags(raw2), context);

    // 태그 검사만 **원문**으로 한다 — 저각성 태그(`[quietly]`)는 벗긴 뒤엔 보이지 않아
    // 그대로 통과해 버린다. 나머지(길이·언어·호칭·유출)는 태그를 뺀 본문 기준이다.
    if (dynamicTextHardFailure(spoken, context, taggedSource)) {
      continue; // HARD → 1회 재롤
    }

    // 저각성 태그는 기상을 방해하므로 여기서 떨군다(`sanitizeDeliveryTag` 와 같은 규칙).
    const inlineTags = extractTags(taggedSource)
      .map((tag) => sanitizeDeliveryTag(tag))
      .filter(Boolean);
    const legacyTag = sanitizeDeliveryTag(parsed.tag);
    const tags = inlineTags.length > 0 ? inlineTags : legacyTag ? [legacyTag] : [];
    // 모델이 배치한 자리를 살린다. 다만 저각성 태그를 떨궜다면 원문을 그대로 쓸 수 없으므로
    // (떨군 태그가 남는다) 그때는 호출부가 `text` 에 다시 입히게 넘기지 않는다.
    const keptAllInlineTags =
      inlineTags.length > 0 && inlineTags.length === extractTags(taggedSource).length;
    return {
      text: spoken,
      translated: false,
      tags,
      ...(keptAllInlineTags ? { synthesisText: taggedSource } : {}),
      provider: 'vertex',
    };
  }

  return fallback;
}

// HARD 차단(§4.7): 차단 시 재롤→폴백. allowlist/단일태그/저각성 가드는 별도(태그 정제는 SOFT).
function dynamicTextHardFailure(
  text: string,
  context: DynamicAlarmTextContext,
  /** 태그가 붙어 있는 원문. 태그 관련 검사만 이걸 본다(없으면 `text`). */
  taggedText?: string,
): boolean {
  if (!text) return true;
  // 파싱불가/메타 JSON('here is the json' 등)은 형식 위반.
  if (isMetaJsonResponse(text)) return true;
  if (text.length > 200) return true;
  if (hasLanguageMismatch(text, context.targetLanguage)) return true;
  if (hasUnsupportedListenerAddress(text, context.listenerTitle)) return true;
  if (
    hasRelationshipLabelLeak(
      text,
      context.relationshipLabel,
      context.listenerTitle,
      context.targetLanguage,
    )
  ) {
    return true;
  }
  // 소괄호 지문과 **저각성 대괄호 태그**는 HARD. 태그를 벗긴 본문으로 재면 저각성 태그가
  // 보이지 않아 그대로 통과하므로 반드시 원문으로 본다.
  if (hasDeliveryTagOrStageDirection(taggedText ?? text)) return true;
  if (hasAlarmTimeEcho(text, context.alarmTimeLabel)) return true;
  if (hasDateLabelEcho(text, context.dateLabel)) return true;
  // 연인/배우자 톤: '새 인연/연애운/질투' 어휘만 HARD. 정중 어미 슬립은 SOFT로 강등.
  if (hasRomanticForbiddenContent(text, context)) return true;
  if (context.mode === 'wake_fortune' && hasFortuneProfileEcho(text, context.fortuneProfile)) {
    return true;
  }
  return false;
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
    ? `Add ElevenLabs v3 delivery tags in square brackets so the line is performed, not just read. Use as many as the line needs — typically 1 to 3 — and put them where the delivery changes, including mid-sentence. Tags are free-form natural-language directions, not a fixed list; these are only examples: ${TAG_EXAMPLES.map((tag) => `[${tag}]`).join(', ')}. Mix kinds when it helps: feeling ([proud], [flustered]), non-verbal sounds ([laughs], [sighs]), voice quality ([low, controlled], [through gritted teeth]), and pacing ([measured, deliberate]). Prefer an unhurried pace — a rushed alarm is hard to follow. Do not rewrite, add, remove, or reorder any words unless translation is requested; tags are the only thing you may insert.`
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
    return ' Speaker and listener are peers/intimate: write in natural 반말 (e.g. "일어났어?", "오늘 뭐 입을까?"). For sibling labels such as 형제·자매, 누나, 언니, 오빠, 형, or 동생, avoid 존댓말/해요체 and sound like a real sibling. Never use 합니다체.';
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
- Write delivery tags INLINE inside "text", in square brackets, at each point where the delivery
  changes — including mid-line. Use as many as the line needs (typically 1 to 3).
- Leave the separate "tag" field as "" — it is a legacy field the backend no longer reads.
- For pauses/pacing use punctuation and ellipses (…) as well — the engine has no SSML breaks
  and a soft '…' or comma after the greeting is the soft-start.
- If a line is very short (under ~20 characters), one tag is plenty; never stack tags on a
  single short clause, and never invent a tag that the delivery does not actually change.
- Tag effects are SUBTLE in Japanese and Korean — carry the emotion in word/particle/ending
  choice too; treat tags as a light touch, not a replacement for good wording.

NEVER
- Never recite raw values the user did not write: temperatures, percentages, weather codes, exact
  clock time, dates, weekdays, birth date/time, zodiac specifics, or city/district/country/
  location labels.
- Never describe the voice from outside ("your mom's voice", "speaking as your mom") or speak as
  if you were someone else standing in for that person ("엄마처럼", "엄마 대신"). Referring to
  yourself in the third person the way that person naturally would ("엄마는 늘 네 편이야") is fine.
- Never speak as a MESSENGER for that person — you are that person, not someone carrying their
  words or running their errand: no "엄마가 깨우래", "엄마가 깨워 달래", "엄마한테 부탁받아서
  왔어", "엄마가 시켜서", "엄마 심부름으로".
- Never use a stiff/formal/business register (Korean 합니다체; Japanese ビジネス敬語/文語;
  English "Please be advised") for family, friends, or partners.
- No markdown, emojis, quotes, explanations, or extra fields.

OUTPUT
- Return STRICT JSON only, matching the schema: {"text": string, "tag": string}. "text" = the
  final spoken line in the target language, WITH delivery tags written inline in square
  brackets where the delivery changes. "tag" = "" (legacy field, no longer used).`;

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
- Sibling/friend (형제/자매/누나/언니/오빠/형/동생/친구): natural 반말. '일어났어?' Never 존댓말/해요체.
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

// few-shot(§4.9).
//
// ⚠ **예시가 곧 계약이다**(2026-08-20). 프롬프트에는 "태그를 문장 안 전달이 바뀌는 자리마다
// 인라인으로 쓰라" 고 적어 두고, 정작 예시는 `text` 에 태그가 없고 `tag` 한 개만 채운
// 형태였다. 모델은 지시문이 아니라 **예시와 반환 형식을 따랐다** — dev 실측에서 받은 응답이
// 전부 무태그 `text` + `tag:"cheerfully"` 였다. 지시만 고치고 예시를 두면 또 무효가 된다.
const DYNAMIC_FEW_SHOT: Record<string, Array<{ context: string; text: string }>> = {
  ko: [
    { context: 'wake_weather, 손녀→할아버지, rain', text: '[warmly] 할아버지, 좋은 아침이에요. [brightly] 오늘은 비가 올 수 있대요, 나가실 때 우산 꼭 챙기세요.' },
    { context: 'wake_weather, 연인, dust', text: '[playfully] 자기야, 일어나자. [lightly] 오늘 미세먼지 많대 — 마스크 꼭 챙겨, 알았지?' },
    { context: 'wake_fortune, 중립', text: '[cheerfully] 좋은 아침이에요. [curious] 오늘은 작은 선택에 좋은 기운이 따른대요… [lighthearted] 가벼운 마음으로 시작해요.' },
  ],
  ja: [
    { context: 'wake_weather, 孫→祖母(タメ口), rain', text: '[warmly] おばあちゃん、おはよう。[brightly] 今日は雨が降るみたい、出かけるとき傘忘れないでね。' },
    { context: 'wake_weather, 距離/불명(です・ます), cold', text: '[cheerfully] おはようございます。[warmly] 今日は冷えるみたいなので、一枚羽織ってくださいね。' },
    { context: 'wake_fortune, 중립/casual', text: '[playfully] おはよう。[curious] 今日はちょっといいことがありそうだよ… [lighthearted] 気楽にいこうね。' },
  ],
  en: [
    { context: 'wake_weather, neutral, rain', text: '[warmly] Morning… time to get up. [brightly] Looks like rain later, grab your umbrella before you head out.' },
    { context: 'love, romantic, babe', text: "[playfully] Morning, babe. [warmly] Take your time getting up — I've got you today, okay?" },
  ],
};

function fewShotBlock(targetLanguage: string): string {
  const examples = DYNAMIC_FEW_SHOT[targetLanguage];
  if (!examples || examples.length === 0) return '';
  const lines = examples.map((ex) => `- (${ex.context}) -> {"text":"${ex.text}","tag":""}`);
  return [
    'Few-shot examples — note the tags live INSIDE "text" and the "tag" field stays empty:',
    ...lines,
  ].join('\n');
}

function dynamicAlarmTextPrompt(context: DynamicAlarmTextContext): string {
  const targetName = LANGUAGE_NAMES[context.targetLanguage] || context.targetLanguage;
  const listenerTitle = context.listenerTitle?.trim();
  // ⚠ **지시와 가드를 같이 움직인다**(Codex #701 P2). 호칭이 비었을 때 가드는 관계에서
  // 유도한 상대 호칭(아들/딸 → 엄마·아빠)을 허용하는데, 지시가 "가족 호칭을 쓰지 말라" 로
  // 남아 있으면 모델은 안 쓰고 어색한 무호칭 문장을 낸다. 아이 목소리가 부모를 못 부르는
  // 것도 그 탓이었다.
  const listenerInstruction = listenerTitle
    ? `When addressing the listener, call them "${listenerTitle}" exactly (use this label naturally, do not translate it, and never replace it with grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter).`
    : neutralAddressGuidance();
  // 어체는 관계 기반(auto)으로만 결정한다.
  const koreanRegisterInstruction =
    context.targetLanguage === 'ko'
      ? koreanRegisterGuidance(context.relationshipLabel?.trim())
      : '';
  const relationship = context.relationshipLabel?.trim()
    ? `The selected voice IS the user's "${context.relationshipLabel}" — speak as that person, in the first person. Referring to yourself in the third person the way that person naturally would ("엄마는 늘 네 편이야") is fine and often the most natural wording. What you must never do is break the illusion by describing the voice from outside: no "${context.relationshipLabel} voice", "in your ${context.relationshipLabel}'s voice", "speaking as your ${context.relationshipLabel}", and never speak as if that person were someone else ("${context.relationshipLabel}처럼", "${context.relationshipLabel} 대신"). You are also NOT a messenger carrying that person's words or running their errand — never "${context.relationshipLabel}가 깨우래", "${context.relationshipLabel}한테 부탁받아서", "${context.relationshipLabel}가 시켜서". ${listenerInstruction} Do not invent names or private facts.${koreanRegisterInstruction}`
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
    return isRomanticRelationship(context.relationshipLabel)
      ? 'Create a romantic partner wake-up line that feels private, affectionate, and gently exciting to hear, while still short enough for a practical alarm. Avoid generic "좋은 하루 보내" unless paired with a more personal caring phrase.'
      : 'Create a warm love/relationship message that feels personal, caring, and suitable for a voice alarm without being overly dramatic.';
  })();

  const languageBlock = activeLanguageBlock(context.targetLanguage);
  // ⚠ **태그를 "tag" 필드 하나로 받지 말 것**(2026-08-13 — C안).
  // 예전에는 별도 필드에 한 개만 받아서, 여러 개도 중간 배치도 **구조적으로 불가능**했다.
  // 이제 텍스트 안에 직접 쓰게 한다. `tag` 필드는 옛 클라이언트 호환으로만 남는다.
  //
  // ⚠ **저각성 금지를 여기에 명시해야 한다.** 예전에는 허용 목록에서 빼는 것으로만
  // 막았는데, 자유형으로 바뀌면 그 장치가 사라진다 — 말로 적어 둔다.
  const tagAllowlistInstruction = `DELIVERY TAGS: write them inline in "text", in square brackets, where the delivery changes — including mid-sentence. Use as many as the line needs (typically 1 to 3). Tags are free-form natural-language directions; these are only examples: ${TAG_EXAMPLES.filter(
    (tag) => !isLowArousalTag(tag),
  )
    .map((tag) => `[${tag}]`)
    .join(' ')}. Mix kinds when it helps: feeling, non-verbal sounds ([laughs], [sighs]), voice quality ([low, controlled]), and pacing ([measured, deliberate]).
PACING: prefer an unhurried delivery — a rushed alarm is hard to follow right after waking.
Use an ellipsis ("...") where the speaker would naturally pause or trail off before turning to the point ("그래도 이제... 슬슬 일어나 볼까?"). One or two per line at most — it is a breath, not a mannerism.
SHAPE: acknowledge how the listener feels first, then turn to waking them. A line that only reports facts does not wake anyone; a line that only nags is unpleasant to hear every morning. Lead with the empathy, land on the nudge.
⚠ PRIORITY: the relationship and this speaker's own way of talking come FIRST. Everything above is shape, not a script — if a pause, a tag, or the empathy-then-nudge order would make this person sound like someone else, drop it and sound like them.
NEVER use sleepy or hushed directions — every one of these is rejected: ${LOW_AROUSAL_TAG_EXAMPLES}. This line has to wake someone up, and a low-arousal delivery works against that.
Leave the separate "tag" field as "" — it is legacy.`;

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
    'Return STRICT JSON only: {"text":"final spoken line in the target language, with delivery tags inline in square brackets","tag":""}. The "tag" field is legacy — leave it empty.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── 사전렌더(유료 클론) 톤 적응 생성 ─────────────────────────────────────────────
// 라이브 동적 경로(generateDynamicAlarmTextWithVertex)와 분리된, seed 기반 1회 생성기.
// 카테고리 outcome 을 자연어 seed 로 받아 그 목소리의 관계/호칭/말투에 맞춘 알람 문구를 만든다.
// 동적 경로의 품질 규칙(관계 어체·호칭 호출·자연스러움·태그 allowlist·few-shot)을 그대로 재사용해
// "할아버지, 약 먹을 시간이에요. 까먹지 말고 꼭 드시고 건강하셔야 해요!" 수준을 보장한다.
function prerenderClipPrompt(params: {
  seed: string;
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  targetLanguage: string;
  defaultTag?: string;
  /** 사용자가 등록 미리듣기에서 확정(직접 수정 포함)한 문구 — 톤/어투 기준. 내용 복제 금지. */
  styleReference?: string | null;
  /** 등록 녹음 전사에서 분석한 화자 말투(사투리·존댓말·특징 어미). styleReference 가 우선. */
  speechStyle?: SpeechStyle | null;
}): string {
  const targetName = LANGUAGE_NAMES[params.targetLanguage] || params.targetLanguage;
  const listenerTitle = params.listenerTitle?.trim();
  const listenerInstruction = listenerTitle
    ? `When addressing the listener, call them "${listenerTitle}" exactly (use it naturally, do not translate it, and never replace it with guessed family titles such as grandmother, grandfather, mom, dad, son, daughter, grandson, or granddaughter).`
    : neutralAddressGuidance();
  const koreanRegisterInstruction =
    params.targetLanguage === 'ko' ? koreanRegisterGuidance(params.relationshipLabel?.trim()) : '';
  const relationship = params.relationshipLabel?.trim()
    ? `The selected voice IS the user's "${params.relationshipLabel}" — speak as that person, in the first person. Referring to yourself in the third person the way that person naturally would ("엄마는 늘 네 편이야") is fine and often the most natural wording. Never break the illusion by describing the voice from outside ("${params.relationshipLabel} 목소리", "speaking as your ${params.relationshipLabel}") or by speaking as if that person were someone else ("${params.relationshipLabel}처럼", "${params.relationshipLabel} 대신"). You are also NOT a messenger carrying that person's words or running their errand — never "${params.relationshipLabel}가 깨우래", "${params.relationshipLabel}한테 부탁받아서", "${params.relationshipLabel}가 시켜서". ${listenerInstruction} Do not invent names or private facts.${koreanRegisterInstruction}`
    : `No relationship label is available, so keep the line generally warm. ${listenerInstruction}`;
  const romanticToneInstruction =
    params.targetLanguage === 'ko' && isRomanticRelationship(params.relationshipLabel)
      ? '연인/배우자 톤: 실제 남자친구·여자친구·아내·남편이 사적으로 건네는 말투로. 친밀한 반말을 쓰고 해요체/합니다체를 쓰지 말 것(아내·남편도). 따뜻하고 살짝 설레게, 하지만 짧게. 새 인연·연애운·질투·다른 사람에게 끌림 언급 금지.'
      : '';
  // 사전렌더도 동적 경로와 **같은 규칙**이다(위 `tagAllowlistInstruction` 주석 참조).
  const tagAllowlistInstruction = `DELIVERY TAGS: write them inline in "text", in square brackets, where the delivery changes — including mid-sentence. Use as many as the line needs (typically 1 to 3). Tags are free-form natural-language directions; these are only examples: ${TAG_EXAMPLES.filter(
    (tag) => !isLowArousalTag(tag),
  )
    .map((tag) => `[${tag}]`)
    .join(' ')}. Mix kinds when it helps: feeling, non-verbal sounds ([laughs], [sighs]), voice quality ([low, controlled]), and pacing ([measured, deliberate]).
PACING: prefer an unhurried delivery — a rushed alarm is hard to follow right after waking.
NEVER use sleepy or hushed directions — every one of these is rejected: ${LOW_AROUSAL_TAG_EXAMPLES}. This line has to wake someone up.
Leave the separate "tag" field as "" — it is legacy.`;
  const styleReference = params.styleReference?.trim();
  const styleReferenceInstruction = styleReference
    ? `STYLE REFERENCE (tone only): the user approved this exact line for this same voice: "${styleReference}". Match its register, warmth, sentence length and overall speaking style — but write NEW content for the current intent; never copy or lightly rephrase the reference line itself.`
    : '';
  const speechStyle = params.speechStyle;
  const speechStyleInstruction =
    speechStyle && (speechStyle.dialect || speechStyle.markers.length > 0 || speechStyle.persona)
      ? `SPEAKER DIALECT/STYLE (analyzed from this speaker's own recording): dialect="${
          speechStyle.dialect || 'standard'
        }"${speechStyle.strength ? ` (strength: ${speechStyle.strength})` : ''}${
          speechStyle.register ? `, register: ${speechStyle.register}` : ''
        }${
          speechStyle.persona ? `, verbal identity: "${speechStyle.persona}"` : ''
        }${
          speechStyle.markers.length > 0
            ? `, typical endings/expressions: ${speechStyle.markers.map((m) => `"${m}"`).join(', ')}`
            : ''
        }. Write the line the way THIS speaker actually talks — keep their first-person pronoun, signature sentence endings (語尾癖) and energy, using the dialect's natural endings and vocabulary instead of standard textbook language. Do not exaggerate or stack markers; if strength is low, keep it to a light touch on sentence endings only. If a STYLE REFERENCE line is present above, it wins over this analysis.`
      : '';
  // 아이 목소리로 **판정된 경우에만** 켠다(SpeechStyle.childlike). 어른 목소리가 이렇게
  // 말하면 이상하므로 분석 쪽에서 보수적으로 판단하고, 여기서는 그 결과를 그대로 따른다.
  // 알람이라 알아들을 수 있어야 하므로 '늘어진 발음' 은 한두 낱말까지만 허용한다.
  const childlikeInstruction = params.speechStyle?.childlike
    ? [
        'CHILD SPEAKER: this voice is a young child talking to a grown-up they love. Write it as that child, not as an adult imitating one.',
        'Sound like a child: very short sentences, small everyday words, a bit of repetition, and eager affection. No polished adult phrasing, no advice-giving, no long clauses.',
        'REQUIRED — spell one or two words the way a small child actually says them, instead of textbook-correct spelling: stretch an ending ("주라아", "가자아"), soften a consonant ("힘드러어", "이러나아"), or repeat a word ("빨리빨리"). Exactly one or two such words per line — the rest stays normally spelled so the message is still clear enough to wake someone.',
        'Never write the whole line in broken spelling, and never break the word that carries the actual point (medicine, umbrella, waking up).',
      ].join(' ')
    : '';
  return [
    `LANGUAGE: write the spoken line in ${targetName}.`,
    activeLanguageBlock(params.targetLanguage),
    `Alarm intent (semantic seed): ${params.seed}`,
    relationship,
    romanticToneInstruction,
    speechStyleInstruction,
    childlikeInstruction,
    styleReferenceInstruction,
    'Write it like ONE real person speaking warmly and naturally to the listener — call them by their title when provided, hold the relationship register, and make it caring and specific. Do NOT just state a bare fact ("비가 와요" alone is not enough); pair it with a short, natural caring action or wish that fits the intent (weather → suggest umbrella/mask/warm clothes/careful steps; medication → remind kindly and wish good health; fortune → a light playful mood, entertainment only). Keep it to one or two short sentences, usable as an alarm.',
    'Do not announce the relationship or source of the voice. Do not mention the exact date, weekday, alarm time, numbers/percentages/temperatures, or location/city/country names.',
    params.targetLanguage === 'ko'
      ? '뉴스 앵커처럼 들리지 않게 진짜 옆에서 말하는 톤. 손녀·손자·손주→조부모, 자식→부모는 존대 해요체("일어나실 시간이에요", "챙기세요")로, 형제·자매·친구는 반말, 연인·배우자는 사적인 반말로. 조사와 띄어쓰기를 살려 다정하게.'
      : '',
    'Make it feel warm and human, not a robotic prerecorded template.',
    tagAllowlistInstruction,
    fewShotBlock(params.targetLanguage),
    'Return STRICT JSON only: {"text":"final spoken line in the target language, with delivery tags inline in square brackets","tag":""}. The "tag" field is legacy — leave it empty.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 사전렌더 클립 1개의 톤 적응 문구를 생성한다(유료 클론 전용). 실패(Vertex 미설정/네트워크/
 * 검증 위반)하면 throw 하여 호출자(cron)가 재시도하도록 한다 — 나쁜 폴백 문구를 저장하지 않는다.
 */
export async function generatePrerenderClipText(
  env: Env,
  params: {
    seed: string;
    relationshipLabel?: string | null;
    listenerTitle?: string | null;
    targetLanguage: string;
    defaultTag?: string;
    /** 등록 미리듣기에서 확정된 preview_text — 있으면 톤/어투 스타일 레퍼런스로 쓴다. */
    styleReference?: string | null;
    /** 등록 녹음 전사에서 분석한 화자 말투(사투리 등) — 문구를 그 말투로 작성. */
    speechStyle?: SpeechStyle | null;
  },
): Promise<{ text: string; tag: string }> {
  const targetLanguage = params.targetLanguage || 'ko';
  if (!hasGeminiConfiguration(env)) {
    throw new AlarmTextPreparationInvalidError();
  }
  // 사전렌더 클립은 전부 기상/알림용이다. 저각성 태그(calm/tired/whispers/quietly)는 기상을
  // 방해하므로 동적 경로 sanitizeDeliveryTag 와 동일하게 여기서도 드롭한다. 안 그러면 모델이
  // medication/love 등에 calm 을 붙였을 때 안 깨우는 알람 클립이 영구 저장된다.
  const sanitizePrerenderTag = (raw: string): string => {
    const approved = normalizeApprovedTag(raw);
    return approved && !isLowArousalTag(approved) ? approved : '';
  };

  // ⚠ **한 번 던지고 끝내지 말 것**(2026-08-20). 예전에는 1회 호출 뒤 검증에 걸리면 곧바로
  // throw 했고, cron 은 그걸 5번 반복한 뒤 큐를 `failed` 로 내렸다. 그런데 거절 사유가
  // **결정적**이면(같은 시드+관계에서 모델이 매번 같은 문장을 낸다) 재시도는 전부 같은
  // 결과라, 21개 중 1개가 영구히 안 만들어지고 '다시 시도' 버튼도 무력했다 —
  // 실제로 사랑 3번 시드 × 관계 '엄마' 에서 그렇게 막혔다.
  // 그래서 **회차마다 제약을 더해** 다시 묻는다. 마지막 회차는 관계 낱말 자체를 금지한다.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const label = params.relationshipLabel?.trim();
    // ⚠ 재시도 힌트에 **태그 제약을 다시 말한다.** 실측(2026-08-21): 영어 안개 시드 ×
    // 관계 '엄마' 가 3회 전부 `[softly]` 를 붙여 나와 저각성 가드에 걸려 **영구 실패**했다.
    // '다르게 써 봐' 만으로는 모델이 문장만 바꾸고 태그는 그대로 둔다.
    const retryTagHint =
      ` The rejection may have been the delivery tags: never use sleepy or hushed ones` +
      ` (${LOW_AROUSAL_TAG_EXAMPLES}) — this line must wake someone up.`;
    const retryHint =
      attempt === 1
        ? ''
        : attempt === 2
          ? `RETRY: the previous attempt was rejected. Keep the same intent but rephrase it differently — vary the sentence shape and wording.${retryTagHint}`
          : label
            ? `RETRY (final): earlier attempts were rejected. Write the line WITHOUT using the word "${label}" anywhere — speak purely in the first person ("나는"/"내가") and keep it short.${retryTagHint}`
            : `RETRY (final): earlier attempts were rejected. Write a shorter, plainer line in the first person.${retryTagHint}`;
    const prompt = [prerenderClipPrompt({ ...params, targetLanguage }), retryHint]
      .filter(Boolean)
      .join('\n');
    let raw: string;
    try {
      raw = await generateContentText(env, prompt, {
        // 회차마다 온도를 올려 같은 문장이 되풀이되는 것을 피한다.
        temperature: attempt === 1 ? 0.6 : 0.9,
        maxOutputTokens: 256,
        systemInstruction: DYNAMIC_SYSTEM_INSTRUCTION,
        responseSchema: DYNAMIC_RESPONSE_SCHEMA,
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    const parsed = parseDynamicAlarmTextResult(raw);
    const text = parsed.text.trim();
    // ⚠ 길이는 **태그를 뺀 본문**으로 잰다. 태그가 인라인으로 들어오면서 `[warmly] ` 같은
    // 장식이 글자 수에 얹히는데, 그걸 그대로 세면 멀쩡한 한 문장이 상한에 걸려 떨어진다.
    const spoken = normalizeAlarmTextWithoutTags(text);
    if (
      // ⚠ `!text` 가 아니라 `!spoken` 이다(Codex #701 P2) — `{"text":"[happy] [excited]"}`
      // 처럼 **태그만** 온 응답은 text 가 비지 않아 통과하고, 낭독할 말이 하나도 없는
      // 클립이 영구 저장된다.
      !spoken ||
      isMetaJsonResponse(text) ||
      spoken.length > 200 ||
      hasLanguageMismatch(spoken, targetLanguage, params.listenerTitle) ||
      hasDeliveryTagOrStageDirection(text) ||
      hasUnsupportedListenerAddress(spoken, params.listenerTitle) ||
      hasRelationshipLabelLeak(spoken, params.relationshipLabel, params.listenerTitle, targetLanguage)
    ) {
      lastError = new AlarmTextPreparationInvalidError();
      continue;
    }
    // 모델이 태그를 스스로 배치했으면 그대로 둔다. 아예 없거나 선두 하나뿐이면 문장마다
    // 다시 앞세운다 — v3 태그는 뒤로 갈수록 풀려 끝 문장이 빨라진다
    // (`normalizeSameLanguageTaggedText` 와 같은 규칙, 한 곳에서 두 번 정하지 않는다).
    const inlineTags = extractTags(text);
    const onlyLeadingTag =
      inlineTags.length === 1 && text.trimStart().startsWith(`[${inlineTags[0]!}]`);
    const primaryTag =
      sanitizePrerenderTag(inlineTags[0] ?? '') ||
      sanitizePrerenderTag(parsed.tag) ||
      sanitizePrerenderTag(params.defaultTag ?? '');
    if (inlineTags.length === 0 || onlyLeadingTag) {
      return {
        text: primaryTag ? applyDeliveryTagPerSentence(primaryTag, spoken) : spoken,
        tag: primaryTag,
      };
    }
    return { text, tag: primaryTag };
  }
  throw lastError instanceof AlarmTextPreparationInvalidError
    ? lastError
    : new AlarmTextPreparationInvalidError();
}

/**
 * 등록 녹음 전사에서 분석한 화자 말투. voice_profiles.speech_style 에 JSON 으로 영속되고,
 * 미리듣기·사전렌더 문구 생성 프롬프트에 주입돼 "그 사람이 실제로 말하는 방식"으로 문구가
 * 나오게 한다(사투리는 텍스트+클론 억양의 조합으로 구현되므로 텍스트 쪽 절반을 담당).
 */
export interface SpeechStyle {
  /** 사투리/방언 지역(표준어면 ''). 예: '경상', '전라', '関西', '博多'. */
  dialect: string;
  /** 사투리 강도. 표준어면 ''. */
  strength: '' | 'low' | 'medium' | 'high';
  /** 말단 격식. 예: 'banmal'(반말), 'jondaemal'(존댓말), 'casual', 'polite'. */
  register: string;
  /** 화자가 실제로 쓴 특징 어미/말버릇/캐치프레이즈(최대 5개, 원문 그대로). */
  markers: string[];
  /**
   * 화자(사람 또는 캐릭터)의 말투 특징 한 줄 요약 — 같은 성우가 연기한 다른 캐릭터도
   * 어미 습관(語尾癖)·1인칭·에너지로 구분되도록 한다. 예: "장난기 많은 소년투, 1인칭 オレ,
   * 어미를 늘이며 반말". 특징이 없으면 ''.
   */
  persona: string;
  /**
   * 화자가 **어린아이**로 판단되는가. true 일 때만 문구 생성이 아이 말투(늘어진 발음·
   * 반복·짧은 문장)를 쓴다.
   *
   * ⚠ **판단 근거는 오디오가 아니라 전사 텍스트뿐이다** — 목소리 높이를 듣는 게 아니라
   * 낱말·문장 구조를 본다. 어른이 아이처럼 말하면 이상하므로(사용자 지시) 모델에게
   * **확신할 때만** true 를 내라고 하고, 기본은 false 다. 옛 행에는 이 필드가 없으므로
   * `parseSpeechStyle` 이 false 로 채운다.
   *
   * ⚠ **알려진 한계 — 아이가 '예시 대본' 을 그대로 읽으면 켜지지 않는다**(Codex #701).
   * 등록 화면이 권하는 대본(`onb`/`voices` 예시 문구)은 어른 말투로 다듬어진 글이라,
   * 누가 읽든 전사가 똑같이 나온다. 그래서 정상 등록 경로의 아이는 false 로 판정된다.
   * **의도한 실패 방향이다.** 반대로 틀리면(어른을 아이로) 부모·배우자 목소리가 유아어로
   * 알람을 읽는다 — 그쪽이 훨씬 나쁘다. 자유롭게 말한 녹음·업로드 음원에서는 켜진다.
   * 이걸 제대로 고치려면 전사가 아니라 **음향 특징**을 봐야 하는데, 지금 파이프라인은
   * ElevenLabs STT 로 텍스트만 얻으므로 그 신호가 존재하지 않는다.
   */
  childlike: boolean;
}

const SPEECH_STYLE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dialect: { type: 'STRING' },
    strength: { type: 'STRING', enum: ['', 'low', 'medium', 'high'] },
    register: { type: 'STRING' },
    markers: { type: 'ARRAY', items: { type: 'STRING' } },
    persona: { type: 'STRING' },
    childlike: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
  },
  required: ['dialect', 'strength', 'register', 'markers', 'persona', 'childlike', 'confidence'],
} as const;

function speechStylePrompt(transcript: string, language: string): string {
  const dialectGuide =
    language === 'ja'
      ? 'Japanese dialects to consider: 関西 (Kansai — e.g. 〜やねん/〜へん/ほんま), 東北 (Tohoku), 博多/九州 (Hakata/Kyushu — e.g. 〜と?/〜ばい), 広島, 名古屋, 沖縄. Standard = 標準語. Japanese speakers/characters are ALSO identified by signature sentence-final quirks (語尾癖 such as 〜だってばよ／〜ですわ／〜のだ／〜にゃ), their first-person pronoun (俺/僕/私/わし/あたし…), and catchphrases — capture these even when the dialect is standard.'
      : language === 'en'
        ? 'For English, dialect detection is usually not reliable from a transcript — leave dialect "" unless wording is unmistakably regional; focus on register (casual/polite) and habitual expressions/catchphrases.'
        : 'Korean dialects to consider: 경상 (e.g. ~했나/~아이가/~카이/~심더), 전라 (e.g. ~잉/~부러/~것이), 충청 (e.g. ~여/~유), 강원, 제주 (e.g. ~수다/~마씸). Standard = 표준어. Also capture personal verbal habits (특유의 어미·감탄사·말버릇) even for standard speakers.';
  return [
    'You are analyzing how a speaker talks, from a transcript of their voice-clone enrollment recording. The speaker may be a real person reading a suggested script (they may sound more standard than usual — only report a dialect when clearly shown), or a fictional character with a distinctive verbal identity: the SAME voice actor can play different characters, so it is the verbal habits — signature sentence endings, first-person pronoun, catchphrases, energy — that tell characters apart. Capture whichever is present.',
    dialectGuide,
    'Also decide "childlike": is this speaker a young child (roughly preschool to early elementary)? Judge ONLY from how the transcript reads — very short simple sentences, a small everyday vocabulary, childish word choice or mispronunciations written out, talking about school/toys/parents from a child\'s position. A short or casual line from an adult is NOT enough. Default to false: only set true when the transcript would read as a child to any reader. Getting this wrong is worse than leaving it off, because it makes an adult voice speak like a toddler.',
    'Return STRICT JSON: {"dialect":"region name in its own language, or empty string for standard","strength":"low|medium|high or empty when standard","register":"banmal|jondaemal for Korean, casual|polite otherwise","markers":["up to 5 verbatim endings/expressions/catchphrases the speaker actually used"],"persona":"one short line describing the speaker\'s verbal identity (tone, first-person pronoun, ending habits), or empty string when unremarkable","childlike":true or false,"confidence":0.0-1.0}.',
    'Be conservative: when unsure, dialect="" and confidence low. markers must be copied from the transcript, not invented. persona describes only what the transcript shows — no guessed names or identities.',
    `TRANSCRIPT (${language}):`,
    transcript.slice(0, 2000),
  ].join('\n');
}

/**
 * 전사 텍스트에서 화자 말투(사투리·격식·특징 어미)를 분석한다. confidence 가 낮거나
 * 실패하면 null — 호출자는 저장을 건너뛴다(표준어로 동작, 사용자 미리듣기 수정으로 교정 가능).
 */
export async function analyzeSpeechStyleWithVertex(
  env: Env,
  transcript: string,
  language: string,
): Promise<SpeechStyle | null> {
  if (!hasGeminiConfiguration(env)) return null;
  const trimmed = transcript.trim();
  if (trimmed.length < 20) return null;
  let raw: string;
  try {
    raw = await generateContentText(env, speechStylePrompt(trimmed, language), {
      temperature: 0.1,
      maxOutputTokens: 256,
      responseSchema: SPEECH_STYLE_RESPONSE_SCHEMA,
    });
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      dialect?: unknown;
      strength?: unknown;
      register?: unknown;
      markers?: unknown;
      confidence?: unknown;
    };
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    if (confidence < 0.6) return null;
    const dialect = typeof parsed.dialect === 'string' ? parsed.dialect.trim().slice(0, 20) : '';
    const strengthRaw = typeof parsed.strength === 'string' ? parsed.strength.trim() : '';
    const strength = (['low', 'medium', 'high'].includes(strengthRaw) ? strengthRaw : '') as
      | ''
      | 'low'
      | 'medium'
      | 'high';
    const register = typeof parsed.register === 'string' ? parsed.register.trim().slice(0, 20) : '';
    const markers = Array.isArray(parsed.markers)
      ? parsed.markers
          .filter((m): m is string => typeof m === 'string')
          .map((m) => m.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const persona =
      typeof (parsed as { persona?: unknown }).persona === 'string'
        ? String((parsed as { persona?: unknown }).persona).trim().slice(0, 120)
        : '';
    const childlike = (parsed as { childlike?: unknown }).childlike === true;
    if (!dialect && !register && markers.length === 0 && !persona && !childlike) return null;
    // 표준어인데 사투리 강도만 있는 모순 정리.
    return { dialect, strength: dialect ? strength : '', register, markers, persona, childlike };
  } catch {
    return null;
  }
}

/** voice_profiles.speech_style JSON 컬럼 → SpeechStyle (없거나 깨졌으면 null). */
export function parseSpeechStyle(value: unknown): SpeechStyle | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SpeechStyle>;
    return {
      dialect: typeof parsed.dialect === 'string' ? parsed.dialect : '',
      strength: (['low', 'medium', 'high'].includes(String(parsed.strength))
        ? parsed.strength
        : '') as SpeechStyle['strength'],
      register: typeof parsed.register === 'string' ? parsed.register : '',
      markers: Array.isArray(parsed.markers)
        ? parsed.markers.filter((m): m is string => typeof m === 'string').slice(0, 5)
        : [],
      persona: typeof parsed.persona === 'string' ? parsed.persona.slice(0, 120) : '',
      // 옛 행에는 이 필드가 없다 — 없으면 false(아이 말투를 켜지 않는다)가 안전한 기본이다.
      childlike: parsed.childlike === true,
    };
  } catch {
    return null;
  }
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
// 모드 기본 태그는 dynamicAlarmTextPreparationFallback의 modeDefaultTag가 붙인다.
function nonKoreanReadableFallback(context: DynamicAlarmTextContext): string {
  const showWeather = context.mode === 'wake_weather' && weatherConditions(context.weatherSignal).length > 0;
  if (context.targetLanguage === 'ja') {
    const weather = showWeather ? ` ${jaWeatherSurface(context.weatherSignal)}。` : '';
    return `おはよう。今日も無理せずいこうね。${weather}`.slice(0, 200).trim();
  }
  // en 및 기타 비한국어(fr/it 등)는 한국어 누출을 피하기 위해 영어 제네릭으로 폴백한다.
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
  if (context.mode === 'cheer') {
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
  // 폴백은 일반적 문구이므로 모드 기본 태그를 붙인다(modeDefaultTag — 전부 고각성).
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

/**
 * 호칭(`listener_title`)이 비었을 때의 지시.
 *
 * ⚠ **관계 라벨로 상대 호칭을 추측하지 않는다**(Codex #701 P2). 2026-08-20 에 한 번
 * 열었다가 되돌렸다: 관계 '아들' 은 **화자가 아들**이라는 뜻일 뿐, 듣는 사람이 엄마인지
 * 아빠인지는 알려 주지 않는다. 둘 다 허용하고 모델에게 고르게 하면 **엄마를 "아빠" 라고
 * 부르는 클립이 영구 저장**될 수 있다(손녀/손자, 아들/딸도 같다).
 *
 * 대신 지시를 **분명하게** 준다. 앞선 실패(아이 목소리가 매번 거절됨)는 이 규칙 자체가
 * 아니라 지시가 흐릿한데 가드만 빡빡해서 났다 — 무엇을 쓰면 되는지 말해 주면 맞춘다.
 */
function neutralAddressGuidance(): string {
  return 'No listener title was provided, and the relationship label does NOT tell you who the listener is — never guess a family title (mom, dad, grandmother, grandfather, son, daughter, grandson, granddaughter). Open warmly without any title at all (e.g. "좋은 아침이에요", "잘 잤어?"), or use an affectionate title-free address. This is a hard requirement.';
}

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

/**
 * 절이 끝났다고 볼 문장부호. 전각(`，`)·말줄임(`…`)까지 넣는 이유는 모델이 실제로 섞어
 * 쓰기 때문이다(Codex #702 P2).
 */
const CLAUSE_END_PUNCTUATION = '[.!?~,、。，…！？]';

/**
 * `~래` 로 끝나지만 전언이 **아닌** 낱말. 적대적 검증(754문장, 2026-08-21)에서 나온 실측
 * 충돌들이다 — 명사(`노래`·`빨래`), 접속부사 어간(`그래`), ㅎ불규칙 형용사 활용(`파래`),
 * 부사(`오래`), 용언 활용(`바래`).
 *
 * ⚠ 이 목록은 **닫히지 않는다.** 한국어에 낱말 경계가 없어 `래` 한 글자로는 근본적으로
 * 가를 수 없다는 뜻이고, 그래서 이 가드는 **백스톱**이지 유일 방어선이 아니다(프롬프트가
 * 1차다). 목록을 늘리는 것보다 새 어미를 더 잡겠다고 넓히는 쪽이 훨씬 위험하다.
 */
const QUOTATIVE_LOOKALIKES = new Set([
  '노래',
  '빨래',
  '미래',
  '유래',
  '장래',
  '원래',
  '이래',
  '저래',
  '거래',
  '그래',
  '파래',
  '오래',
  '바래',
]);

/**
 * 화자가 **대신 하는 행동**. 대리 구문은 "라벨이 시켰다" 만으로는 성립하지 않는다 — 그
 * 결과로 **화자가** 무언가를 하고 있어야 심부름꾼이다.
 *
 * 이게 없으면 "엄마가 시켜서 억지로 하지는 마"(청자에게 주는 당부)나 "엄마가 시켜서 하는 게
 * 아니라 네가 하고 싶어서 하는 거야"(오히려 부정하는 말)까지 떨어진다 — 둘 다 실측 오탐이다.
 */
/**
 * 뒤에 이게 붙으면 그 낱말은 **청자에게 시키는 것**이라 화자의 대리 행동이 아니다
 * (Codex #702 P2). "엄마가 부탁해서 미안해, **전화해 줘**" 는 엄마 자신의 부탁이다 —
 * 대리 행동으로 읽으면 정상 문구가 떨어진다.
 * 화자가 하는 형태(`전화했어`, `말해 주는 거야`, `깨우러 왔어`)는 그대로 통과시킨다.
 */
const NOT_LISTENER_IMPERATIVE =
  '(?!\\s*(?:해\\s*)?(?:줘|줄래|주렴|주세요|보렴|봐|세요|렴|라|자)(?![가-힣]))';

const PROXY_ACTION =
  `(?:왔|오는\\s*길|들렀|깨우|깨워|전하|전해|알려|대신|전화|말해|말하|데리러)${NOT_LISTENER_IMPERATIVE}`;

/**
 * 전언 어미 `~라…` 앞에서 **전언이 아님을 드러내는 앞글자**. 두 종류를 함께 막는다:
 *  - 어간이 `라` 로 끝나는 용언: 바라다·자라다·놀라다("깜짝 놀라네").
 *  - 계사: `~이라`·`~ㄹ 거라`·`아니라`("늘 네 편이란다" 는 정반대 뜻이다).
 */
const QUOTATIVE_STEM_GUARD = '(?<![바자놀이거])(?<!아니)';

/**
 * 트리거 뒤에 **라벨이 아닌 다른 사람**이 행위자로 나오는가. 나오면 화자는 대리인이 아니다 —
 * "엄마를 대신해서 오늘은 **아빠가** 데리러 갈 거야" 는 엄마 본인이 하는 말이다(실측 오탐).
 */
const OTHER_ACTOR_RE =
  /(할머니|할아버지|엄마|어머니|아빠|아버지|언니|오빠|누나|형|이모|고모|삼촌|동생|선생님)\s*(?:가|이|는|은|께서|께|한테|에게)/g;

function hasOtherActor(segment: string, label: string): boolean {
  for (const m of segment.matchAll(OTHER_ACTOR_RE)) {
    // ⚠ **부분 일치를 라벨로 인정한다**(Codex #702 P2). 라벨은 자유 입력이라 "우리 엄마" 처럼
    // 가족 토큰을 품은 복합어일 수 있다. 잡힌 토큰(`엄마`)을 라벨 전체(`우리 엄마`)와 그대로
    // 비교하면 **자기 자신을 남으로 읽어** 대리 구문 탐지가 통째로 꺼진다.
    if (label.includes(m[1]!)) continue;
    return true;
  }
  return false;
}

/**
 * `pattern` 에 걸리되, **다른 행위자**가 끼어 있지 않은 자리가 하나라도 있는가.
 *
 * 매치 **구간 안**은 언제나 본다 — "엄마가 부탁해서 아빠가 깨우러" 는 대리 행동(`깨우`)까지가
 * 한 매치라, 뒤만 보면 `아빠가` 를 놓친다(실측 오탐).
 *
 * ⚠ **뒤를 훑을지는 패턴이 대리 행동을 이미 품었는지로 갈린다**(Codex #702 P2).
 *  - `requestFromLabel`·`orderedByLabel` 은 패턴 끝이 `PROXY_ACTION` 이라 **대리 행동까지가
 *    매치**다. 그 뒤는 딴 이야기이므로 훑으면 안 된다 — "엄마가 시켜서 깨우러 왔어,
 *    아빠한테도 전화해야 해" 의 `아빠한테` 를 보고 **진짜 유출을 통과시킨다.**
 *  - `thirdPartyReference`(`엄마 대신`)는 행동이 매치 **밖**에 있으므로 뒤를 봐야 한다 —
 *    "엄마를 대신해서 오늘은 아빠가 데리러 갈 거야" 의 `아빠가` 가 거기 있다.
 *
 * ⚠ 뒤를 훑을 때도 **같은 문장까지만**이다(Codex #702 P2). "엄마 대신 깨우러 왔어.
 * 아빠한테도 전화해야 해" 의 뒷문장을 보고 대리 판정을 끄면 진짜 유출이 통과한다.
 * 오탐을 막아 주는 `아빠가` 는 언제나 같은 문장 안에 있다.
 */
function matchesWithoutOtherActor(
  text: string,
  label: string,
  pattern: string,
  scanAfterMatch = false,
): boolean {
  for (const m of text.matchAll(new RegExp(pattern, 'gi'))) {
    const end = m.index + m[0].length;
    let suffix = '';
    if (scanAfterMatch) {
      suffix = text.slice(end, end + 40);
      const stop = suffix.search(/[.!?。！？…]/);
      if (stop !== -1) suffix = suffix.slice(0, stop);
    }
    // 매치 시작 부분의 라벨 자체는 `hasOtherActor` 가 라벨 비교로 걸러 준다.
    if (!hasOtherActor(m[0] + suffix, label)) return true;
  }
  return false;
}

/**
 * 라벨 뒤에 **현재형 전언 어미**(`~래`)가 붙었는가 — "엄마가 깨우래", "엄마가 깨우래서 왔어".
 *
 * ⚠ 정규식만으로는 가를 수 없어 코드로 거른다. 한국어에는 낱말 경계가 없어서 `래` 한 글자는
 * 세 가지와 겹친다:
 *  - **권유형 `~ㄹ래`**("입을래?", "갈래?", "들어줄래?") — 앞 글자 받침이 ㄹ 이다.
 *  - **명사·접속부사**("노래", "빨래", "그래서") — `QUOTATIVE_LOOKALIKES` 로 걸러낸다.
 *  - **전언형 `~래`**("깨우래", "일어나래") — 이것만 유출이다.
 * 그래서 ①라벨이 **주격**(가/이/께서)이고 ②`래` 뒤가 **절 끝**(`요?` + 문장부호/끝)이거나
 * **연결형 `서`** 이며 ③앞 글자가 ㄹ받침이 아니고 ④위 목록에 없을 때만 전언으로 본다.
 *
 * ⚠ 절 끝 조건에 **공백은 넣지 않는다.** `래` 는 용언 뒤에서는 전언이지만 체언 뒤에서는
 * 계사 전언("휴일이래", "30도래")이라 `~대`(비 온대)와 같은 **사실 전달**이다. 부호 없이
 * 이어지는 자리까지 열면 그 계사형이 통째로 걸려 멀쩡한 문구가 떨어진다.
 *
 * ⚠ `~대`(비 온대, 많대요)는 **넣지 않는다.** 날씨 전달의 표준 어미라 프롬프트 few-shot 이
 * 직접 쓰고 있다("비가 올 수 있대요") — 넣으면 멀쩡한 날씨 문구가 통째로 떨어진다.
 * 같은 이유로 `~ㄹ 거래`(= `~ㄹ 거라고 해`)도 뺀다: 실 Vertex 호출에서 "오늘은 흐릴 거래,
 * 따뜻하게 입고 나가요" 가 그대로 나왔다(2026-08-21 실측). "엄마가 데리러 올 거래" 같은
 * 전언도 같은 꼴이라 갈라낼 수 없는데, 실제로 나오는 쪽은 날씨다.
 */
function hasPresentReportedSpeech(text: string, escapedLabel: string): boolean {
  const re = new RegExp(
    `${escapedLabel}\\s*(?:가|이|는|은|도|께서)\\s*[^.!?]{0,20}?([가-힣])래(?=서|잖|요?\\s*(?:${CLAUSE_END_PUNCTUATION}|$))`,
    'gi',
  );
  for (const match of text.matchAll(re)) {
    const prev = match[1]!;
    if (QUOTATIVE_LOOKALIKES.has(`${prev}래`)) continue;
    // "깨워 달래(서)" 는 `달라고 해` 의 준말이라 앞 글자 받침이 ㄹ 이지만 전언이 맞다.
    // 어루만지는 `달래다`("엄마가 달래 줄게")는 뒤에 용언이 붙어 절 끝 조건에서 걸러진다.
    if (prev === '달') return true;
    const syllable = prev.charCodeAt(0) - 0xac00;
    // 받침 ㄹ(종성 인덱스 8) = 권유형 `~ㄹ래`.
    if (syllable >= 0 && syllable < 11172 && syllable % 28 === 8) continue;
    return true;
  }
  return false;
}

/**
 * 관계 라벨(한국어 정규값)이 en·ja 출력에서 어떤 낱말로 나오는가.
 *
 * ⚠ **라벨은 앱 언어와 무관하게 한국어로 저장된다**(안드로이드 `RelationshipPreset` 의
 * `label` 은 정규값이고 로케일 리소스는 표시용일 뿐이다). 그래서 en·ja 문구에는 `엄마` 라는
 * 글자가 아예 없고, 한국어 조사·어미만 보는 가드는 **그 두 언어에서 통째로 무력**했다
 * (Codex #702 P2). 프롬프트는 세 언어 모두에 걸려 있지만 백스톱이 비어 있었다.
 *
 * 자유 입력 라벨은 여기 없다 — 그건 한국어 갈래로만 걸러진다(알려진 한계).
 */
const RELATIONSHIP_LABEL_TRANSLATIONS: Record<string, { en: string[]; ja: string[] }> = {
  엄마: { en: ['mom', 'mum', 'mother', 'mommy'], ja: ['お母さん', 'ママ', '母'] },
  아빠: { en: ['dad', 'father', 'daddy'], ja: ['お父さん', 'パパ', '父'] },
  할머니: { en: ['grandma', 'grandmother', 'granny'], ja: ['おばあちゃん', '祖母'] },
  할아버지: { en: ['grandpa', 'grandfather'], ja: ['おじいちゃん', '祖父'] },
  아들: { en: ['son'], ja: ['息子'] },
  딸: { en: ['daughter'], ja: ['娘'] },
  손녀: { en: ['granddaughter'], ja: ['孫娘'] },
  손주: { en: ['grandson', 'grandchild'], ja: ['孫'] },
  '형제·자매': { en: ['brother', 'sister', 'sibling'], ja: ['兄弟', '姉妹'] },
  남자친구: { en: ['boyfriend'], ja: ['彼氏'] },
  여자친구: { en: ['girlfriend'], ja: ['彼女'] },
  남편: { en: ['husband'], ja: ['夫', '旦那'] },
  아내: { en: ['wife'], ja: ['妻', '奥さん'] },
  친구: { en: ['friend'], ja: ['友達'] },
  연예인: { en: ['celebrity'], ja: ['芸能人'] },
};

/**
 * 한국어가 아닌 출력에서 **화자가 전달자처럼 말하는가.**
 *
 * 한국어와 달리 en·ja 는 전달 구문이 **1인칭 대명사를 요구**해서("mom asked **me** to",
 * "**私**が頼まれて") 훨씬 덜 모호하다. 그래서 라벨 낱말 + 전달 틀이 붙은 형태만 좁게 본다.
 * 자기 3인칭 지칭("Mom is always on your side", "ママはいつも味方だよ")은 틀이 없으니 통과한다.
 */
function hasForeignLanguageProxy(
  text: string,
  label: string,
  targetLanguage: string,
): boolean {
  const language = targetLanguage === 'en' || targetLanguage === 'ja' ? targetLanguage : null;
  if (!language) return false;
  const words = RELATIONSHIP_LABEL_TRANSLATIONS[label.trim()]?.[language];
  if (!words?.length) return false;
  const alternation = words.map(escapeRegExp).join('|');

  if (language === 'en') {
    // "your mom's voice" — 목소리를 밖에서 묘사한다.
    if (new RegExp(`(?:${alternation})(?:'s|s')\\s+voice`, 'i').test(text)) return true;
    // "mom asked me to wake you" / "mom wants me to" / "mom sent me" / "on behalf of your mom"
    return (
      new RegExp(
        `(?:${alternation})\\b[^.!?]{0,20}?\\b(?:asked|told|wanted|wants|needs|sent|had)\\s+me\\b`,
        'i',
      ).test(text) ||
      new RegExp(`\\bon\\s+behalf\\s+of\\b[^.!?]{0,15}?(?:${alternation})\\b`, 'i').test(text) ||
      new RegExp(`\\b(?:instead\\s+of|in\\s+place\\s+of)\\s+(?:your\\s+)?(?:${alternation})\\b`, 'i').test(
        text,
      )
    );
  }

  // ja: 「お母さんに頼まれて」「ママの代わりに」「お母さんの声」「お母さんが起こしてって」
  return (
    new RegExp(`(?:${alternation})の声`).test(text) ||
    new RegExp(`(?:${alternation})(?:に|から)[^。！？]{0,10}?(?:頼まれ|言われ|頼まれて|命じられ)`).test(
      text,
    ) ||
    new RegExp(`(?:${alternation})の代わり`).test(text) ||
    new RegExp(`(?:${alternation})が[^。！？]{0,15}?(?:って言ってた|と言ってた|だって)`).test(text)
  );
}

/**
 * 문구가 **화자가 그 관계의 사람이 아닌 것처럼** 말하는가.
 *
 * ⚠ **이 가드는 백스톱이지 유일 방어선이 아니다.** 1차는 프롬프트다(3곳: 시스템 지시·동적·
 * 사전렌더 모두 "너는 그 사람이지 그 사람의 말을 전하는 사람이 아니다" 를 예시와 함께 준다).
 *
 * 근본 한계가 있다: 한국어는 **3인칭 자기 지칭이 표준**이라("엄마는 늘 네 편이야"),
 * 과거형 인용은 화자가 엄마든 심부름꾼이든 **글자가 같다**.
 * "엄마가 일어나라고 했잖아" 는 엄마가 자기 잔소리를 되짚는 말로도, 남이 엄마 말을 옮기는
 * 말로도 완벽히 읽힌다. 패턴으로는 가를 수 없다.
 *
 * 그래서 **현재형과 과거형을 다르게 다룬다** — 이게 이 함수의 설계 축이다:
 *  - 현재형 전언(`~래`·`~라네`·`~라잖아`·`~라셔`)은 지금 남의 말을 옮기는 형태라 넓게 잡는다.
 *  - 과거형(`했`·`그랬`·`랬`)은 자기 서술과 겹치므로 좁게 둔다.
 *  - 대리 구문은 지시 낱말만으로는 부족하고 **화자가 대신 하는 행동**까지 있어야 한다.
 *
 * **일부러 안 잡는 것**(적대적 검증 754문장 + 실 Vertex 168콜로 확인, 2026-08-21):
 *  - `~다더라`("엄마가 데리러 온다더라") — `~대`(비 온대)와 같은 사실 전달 어미라 날씨 문구가
 *    통째로 떨어진다. 실제 모델 출력이 이 형태를 쓴다.
 *  - `엄마가 시켰어`(대리 행동 없음) — "엄마가 시켰잖아"(내가 시켰잖아)와 구별되지 않는다.
 *  - `가재`·`됐냬` 같은 한 음절 인용 — 명사와 충돌이 너무 크다.
 * 이것들을 잡겠다고 넓히면 **과잉 거절**로 되돌아간다. 그게 이 파일에서 가장 비싼 실수다.
 */
function hasRelationshipLabelLeak(
  text: string,
  relationshipLabel: string | null | undefined,
  listenerTitle: string | null | undefined,
  targetLanguage: string,
): boolean {
  const label = relationshipLabel?.trim();
  if (!label) return false;

  if (hasForeignLanguageProxy(text, label, targetLanguage)) return true;

  const escapedLabel = escapeRegExp(label);
  const sourcePhrase = new RegExp(`${escapedLabel}\\s*(?:목소리|voice)`, 'i');
  if (sourcePhrase.test(text)) return true;

  // ⚠ **화자가 자기를 3인칭으로 부르는 것은 유출이 아니다**(2026-08-20).
  // 예전에는 `엄마` + 조사(가/는/도/의/에게/한테…)를 전부 거절했는데, "엄마는 늘 네 편이야"
  // 는 엄마가 자식에게 하는 **가장 자연스러운 한국어**다. 실제로 그 때문에 사랑 3번
  // 시드("늘 네 편이라고 응원한다")가 관계=엄마에서 **영구 실패**했다 — 모델이 매번
  // "엄마는 늘 네 편인 거 알지?" 를 내놓고 매번 거절돼 21개 중 20개에서 멈췄다
  // (dev 실측: cron 5틱 연속 AlarmTextPreparationInvalidError → 큐 failed).
  //
  // 남겨 두는 것은 **화자가 그 사람이 아님을 드러내는** 쓰임뿐이다:
  // `엄마처럼`(엄마가 아닌 사람의 비유) / `엄마 대신` / `엄마 입장에서`.
  // 목적격 조사를 허용하는 이유는 `엄마를 대신해서` 가 `엄마 대신` 과 같은 말이기 때문이다.
  //
  // ⚠ `대신할`·`대신하는`(관형형)은 뺀다 — "엄마를 대신할 알람은 없으니까" 처럼 대신하는
  // 주체가 화자가 아닌(사람도 아닌) 경우라, 화자를 사칭한다는 뜻이 되지 않는다.
  if (
    matchesWithoutOtherActor(
      text,
      label,
      `${escapedLabel}\\s*(?:을|를)?\\s*(?:처럼|입장에서|대신(?!할|하는|한\\s))`,
      true,
    )
  ) {
    return true;
  }

  // **전언(傳言) 구문도 화자가 그 사람이 아님을 드러낸다**(Codex #701 P2).
  // "엄마가 깨워 달라고 했어" 는 화자가 심부름꾼이라는 뜻이라, 자기 지칭("엄마는 늘 네
  // 편이야")과는 정반대다. 라벨 뒤 짧은 구간에 전언 어미가 오면 거절한다.
  //
  // ⚠ **한 음절 어미는 다른 낱말과 겹친다**(적대적 검증 실측):
  //  - `그랬` 앞글자 `그` 를 뺐다. "엄마가 걱정돼서 그랬어" / "엄마가 늘 그랬듯이" /
  //    "엄마가 그랬잖아" 는 전부 엄마 **자신의** 말이고, 3인칭 자기 지칭이 표준인 한국어에서
  //    `그랬` 은 전언과 자기 서술을 가르지 못한다.
  //  - `랬` 앞에 `바` 가 오면 `바라다/바래다`(바랬어, 바랬네)라 전언이 아니다.
  //  - `랬`·`댔` 앞에 공백이 오면 별개 낱말이다("손을 댔어" 의 `대다`).
  //  - `라고 했`·`라고 하셨` 도 뺐다. "엄마가 어릴 때부터 그러라고 했잖아?" 는 엄마가 **자기**
  //    잔소리를 되짚는 말이다. 남기는 것은 자기 말로 읽히지 않는 `말했`·`전했`·`하더` 뿐이다.
  const reportedSpeech = new RegExp(
    `${escapedLabel}\\s*(?:가|이|는|은|께서)?[^.!?]{0,20}?(?:달라고|라고\\s*(?:말했|전했|하더)|(?<![\\s바그])랬|(?<!\\s)댔)`,
    'i',
  );
  if (reportedSpeech.test(text)) return true;
  if (hasPresentReportedSpeech(text, escapedLabel)) return true;

  // **현재형 전언은 과거형과 달리 모호하지 않다.** 이게 이 가드의 핵심 구분선이다:
  //  - 과거형(`했`·`그랬`·`랬`)은 **엄마 자신이 지난 말을 되짚는 것**과 형태가 같다
  //    ("엄마가 일어나라고 했잖아" 는 엄마가 하는 말로 완벽히 자연스럽다). 그래서 좁게 둔다.
  //  - 현재형(`~래`·`~라네`·`~라잖아`·`~라셔`·`~라며`·`~라던데`)은 **지금 남의 말을 옮기는**
  //    형태라, 엄마가 자기 말에 쓰지 않는다. 그래서 넓게 잡아도 안전하다.
  // ⚠ **`라` 앞글자로 걸러야 하는 것이 두 종류 있다**(`QUOTATIVE_STEM_GUARD`):
  //   ① 어간이 `라` 로 끝나는 용언 — `바라다`("네 행복을 바라네"), `자라다`("키가 자라며"),
  //      `놀라다`("네 성장에 깜짝 놀라네"). 전언이 아니라 그냥 그 동사다.
  //   ② 계사 `~이라`/`~ㄹ 거라`/`아니라` — "할머니는 늘 네 편이란다" 는 **정반대 뜻**이고
  //      실 Vertex 출력이 실제로 이 형태를 낸다(2026-08-21 실측).
  //   `~다더라` 는 넣지 않는다: "비가 온다더라" 는 `~대` 와 같은 사실 전달이다.
  const presentQuotative = new RegExp(
    `${escapedLabel}\\s*(?:가|이|는|은|도|께서)?[^.!?]{0,20}?` +
      `(?:${QUOTATIVE_STEM_GUARD}라(?:네|셔|셨|잖아|며|던데|는데)|` +
      `라고\\s*(?:해|하네|하셔|하시|하더|한다|부탁)|달라(?:네|셔|잖아|는데)|` +
      `${QUOTATIVE_STEM_GUARD}라\\s*(?:해|하|했|시켜|시키)|` +
      `${QUOTATIVE_STEM_GUARD}(?:란다|랍니다))`,
    'i',
  );
  if (presentQuotative.test(text)) return true;

  // **대리(代理) 구문**(Codex #701 P2 후속). 어미가 아니라 **조사**로 화자를 심부름꾼으로
  // 만드는 형태라 위의 전언 정규식이 통째로 비켜 간다 — "엄마한테 부탁받아서 깨우러 왔어",
  // "엄마 부탁으로 알려 주는 거야", "엄마가 시켜서 왔어".
  //
  // 성립 조건이 **둘 다** 필요하다:
  //  1. 라벨이 부탁·지시의 **출처**여야 한다. `부탁` 만으로는 안 된다 — "엄마 부탁 하나만
  //     들어줄래?" 는 엄마 자신의 말이다. 조사가 뜻을 뒤집는 것도 여기다(Codex #702 P2):
  //     `엄마한테 부탁받아서`(엄마가 준 쪽) ≠ `엄마가 네 부탁받아서`(엄마가 받은 쪽).
  //     그래서 주격·주제 조사가 붙으면 이 갈래는 아예 보지 않는다.
  //     관형형 `부탁받은`(→ "엄마한테 부탁받은 우산 챙겨 가")도 뺀다 — 받은 쪽이 청자다.
  //  2. 그 결과로 **화자가 대신 하는 행동**(`PROXY_ACTION`)이 이어져야 한다. 없으면
  //     "엄마의 심부름 때문에 아침이 바쁘겠다" 같은 자기 서술까지 떨어진다.
  const requestFromLabel =
    `${escapedLabel}(?!\\s*(?:가|이|께서|는|은|도))\\s*(?:한테서?|에게서?|의|께)?\\s*` +
    `[^.!?]{0,6}?(?:부탁\\s*[^.!?]{0,6}?받(?:아|고)|부탁(?:으로|\\s*때문에)|` +
    `심부름(?:으로|\\s*때문에|을?\\s*하러)|말씀(?:을|를)?\\s*전하)` +
    `\\s*[^.!?]{0,10}?${PROXY_ACTION}`;
  if (matchesWithoutOtherActor(text, label, requestFromLabel)) return true;

  // `시키다`·`부탁하다` 는 반대로 라벨이 **주격**일 때가 유출이다 — "엄마가 시켜서 왔어".
  // 여기도 대리 행동이 있어야 한다: "엄마가 시켜서 억지로 하지는 마" 는 청자에게 주는
  // 당부이고, "엄마가 시켜서 하는 게 아니라" 는 오히려 그것을 부정하는 말이다(실측 오탐).
  //
  // ⚠ **맨 과거형(`시켰`·`시키셨`)은 넣지 않는다**(Codex #702 P2). "엄마가 시켰잖아,
  // 전화해 줘" 는 엄마가 **자기** 지시를 되짚는 말인데, `시켰` 이 `시켰잖아` 의 앞부분에
  // 걸리고 뒤의 `전화` 가 대리 행동 조건까지 채워 버린다. 위 「일부러 안 잡는 것」에
  // `엄마가 시켰어` 를 적어 둔 것과도 어긋났다 — 과거형은 좁게 둔다는 규칙 그대로다.
  const orderedByLabel =
    `${escapedLabel}\\s*(?:가|이|께서|한테서?|에게서?|의)?\\s*` +
    `[^.!?]{0,6}?(?:시켜서|시키셔서|시키신|시킨\\s*대로|시키는\\s*대로|보내서|보내셔서|` +
    `부탁(?:해|하셔|하시어)서|부탁하신\\s*대로|부탁한\\s*(?:대로|일))\\s*[^.!?]{0,8}?${PROXY_ACTION}`;
  if (matchesWithoutOtherActor(text, label, orderedByLabel)) return true;

  const allowedAddress =
    normalizeAddressLabel(label) !== null &&
    normalizeAddressLabel(label) === normalizeAddressLabel(listenerTitle);
  const directAddress = new RegExp(
    `(^|[\\s"'“”‘’(（])${escapedLabel}\\s*[,，!！?？~]`,
    'i',
  );
  return directAddress.test(text) && !allowedAddress;
}

/// 모델 출력에 **낭독되면 안 되는 지문**이 섞였는가.
///
/// ⚠ **대괄호 태그 자체는 이제 정상이다**(2026-08-13 — C안). 예전에는 대괄호가 하나라도
/// 있으면 HARD 실패로 보고 재롤/폴백했는데, 그러면 여러 개·중간 태그가 구조적으로 불가능했다.
/// 지금 막는 것은 둘뿐이다:
///  1. **전각/소괄호 지문** — `（다정하게）` `(웃으며)` 는 ElevenLabs 가 태그로 안 읽고
///     **글자 그대로 낭독**한다. 대괄호만 태그다.
///  2. **저각성 지시** — 대괄호든 아니든, 졸리게 말하라는 뜻이면 깨우는 알람에 맞지 않는다.
/**
 * 태그 문법에 **맞지 않는 대괄호**가 남아 있는가 — 예: `[다정하게]`, `[아침 인사]`.
 *
 * ⚠ `TAG_BODY_PATTERN` 은 ASCII 소문자만 받는다(`[a-z][a-z ,-]{1,48}`). 그래서 한글
 * 대괄호 지문은 **태그로 인식되지도, 벗겨지지도 않는다** — 그대로 두면 합성 문구에도
 * 표시 문구에도 남아 낭독되거나 화면에 뜬다(Codex #701 P2). 인라인 태그를 쓰라고
 * 지시하기 시작하면서 모델이 이 형태를 낼 여지가 커졌으므로 명시적으로 거절한다.
 */
function hasUnknownBracketedSegment(text: string): boolean {
  // 인식되는 태그를 먼저 걷어내고, **대괄호가 한 짝이라도 남으면** 거절한다.
  // ⚠ 닫히지 않은 지문(`[다정하게 좋은 아침이에요`)은 `[...]` 쌍 매칭으로는 잡히지 않는다 —
  // 남은 낱개 `[`·`]` 까지 봐야 합성·표시 문구에 새는 것을 막는다(Codex #701 P2).
  const withoutKnownTags = text.replace(TAG_RE_GLOBAL, '');
  return withoutKnownTags.includes('[') || withoutKnownTags.includes(']');
}

function hasDeliveryTagOrStageDirection(text: string): boolean {
  if (hasUnknownBracketedSegment(text)) return true;
  // 소괄호·전각괄호로 시작하면 지문이다(대괄호는 태그라 통과).
  if (/^\s*[（(]/.test(text)) return true;

  const parenthesized = text.match(/[（(][^）)]{1,50}[）)]/g) ?? [];
  if (
    parenthesized.some((part) =>
      /(softly|warmly|gently|cheerfully|brightly|calmly|whisper|속삭|다정하게|밝게|차분하게|부드럽게|따뜻하게|상냥하게)/i.test(
        part,
      ),
    )
  ) {
    return true;
  }

  // 대괄호 태그 중 저각성이 있으면 실패로 본다 — 깨우는 경로 전용 판정이다.
  const bracketed = text.match(TAG_RE_GLOBAL) ?? [];
  return bracketed.some((part) => isLowArousalTag(part.slice(1, -1)));
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
function hasLanguageMismatch(
  text: string,
  targetLanguage: string,
  allowedForeignText?: string | null,
): boolean {
  const allowed = allowedForeignText?.trim();
  const checkedText = allowed ? text.split(allowed).join('') : text;
  const hasHangul = /[가-힣]/.test(checkedText);
  const hasKana = /[぀-ヿㇰ-ㇿ]/.test(checkedText);
  const hasKanji = /[一-鿿]/.test(checkedText);
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
  // ⚠ 정규식을 여기 다시 쓰지 말 것 — `TAG_BODY_PATTERN` 한 곳에서 파생한다.
  const matches = text.match(TAG_RE_GLOBAL) ?? [];
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

/// 사용자가 친 문구에 모델이 태그만 얹었는지 확인하고, **얹은 그대로** 돌려준다.
///
/// ⚠ **태그를 하나로 접어 원문에 다시 붙이지 말 것**(2026-08-13 — C안).
/// 예전에는 `pickApprovedTag` 로 **첫 태그 하나만** 고른 뒤 `applyDeliveryTagPerSentence`
/// 로 원문을 재조립했다. 그래서 모델이 어디에 몇 개를 넣었든 **결과는 언제나 '원문 앞에
/// 태그 하나'** 였다 — 프롬프트를 아무리 고쳐도 이 경로에서는 변화가 관측되지 않았다.
///
/// 지금은 글자(태그를 뺀 본문)가 원문과 같은지만 확인하고 배치는 모델에 맡긴다.
function normalizeSameLanguageTaggedText(
  preparedText: string,
  originalText: string,
  candidateTags: string[],
): string | null {
  if (normalizeAlarmTextWithoutTags(preparedText) !== normalizeAlarmTextWithoutTags(originalText)) {
    return null;
  }
  const tagsInText = preparedText.match(TAG_RE_GLOBAL) ?? [];

  // ⚠ **선두 태그 하나뿐이면 문장마다 다시 앞세운다 — 이 장치를 없애지 말 것.**
  // v3 태그는 뒤로 갈수록 효력이 약해져, 여러 문장을 선두 태그 하나로 합성하면 **끝
  // 문장에서 톤이 풀리고 말이 빨라진다.** 사용자가 지적한 "말이 엄청 빠르다" 와 같은 축이다.
  // 모델이 스스로 여러 개·중간에 배치했다면 그건 의도이므로 건드리지 않는다.
  const onlyLeadingTag =
    tagsInText.length === 1 && preparedText.trimStart().startsWith(tagsInText[0]!);
  if (tagsInText.length === 0 || onlyLeadingTag) {
    const tag = pickApprovedTag([...extractTags(preparedText), ...candidateTags]);
    if (!tag) return null;
    return applyDeliveryTagPerSentence(tag, originalText, 200);
  }
  return preparedText.trim();
}

// ElevenLabs v3 delivery 태그는 뒤따르는 구간에서 갈수록 효력이 약해져, 여러 문장을
// 선두 태그 하나로 합성하면 끝 문장에서 톤이 풀리고 말이 빨라지는 드리프트가 생긴다.
// 문장 경계마다 같은 태그를 다시 앞세워 전달 톤을 끝까지 고정한다(태그는 발화되지 않음).
// 상한을 넘으면 선두 1회 태그로, 그것도 넘으면 원문 그대로 폴백한다.
/// 문구에 인라인으로 박힌 딜리버리 태그 목록(중복 제거·소문자). `messages.delivery_tags_json`
/// 처럼 "이 클립이 어떤 전달 톤으로 합성됐나" 를 남길 때 쓴다.
///
/// ⚠ 정규식을 호출부에 다시 쓰지 말 것 — `TAG_BODY_PATTERN` 한 곳에서 파생한다.
export function extractDeliveryTags(text: string): string[] {
  return extractTags(text);
}

export function applyDeliveryTagPerSentence(tag: string, text: string, maxLength = 300): string {
  const trimmed = text.trim();
  if (!tag) return trimmed;
  const sentences =
    trimmed
      .match(/[^.!?…]+[.!?…]*/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];
  const perSentence =
    sentences.length > 1
      ? sentences.map((sentence) => `[${tag}] ${sentence}`).join(' ')
      : `[${tag}] ${trimmed}`;
  if (perSentence.length <= maxLength) return perSentence;
  const single = `[${tag}] ${trimmed}`;
  return single.length <= maxLength ? single : trimmed;
}

export function normalizeAlarmTextWithoutTags(text: string): string {
  return text
    .replace(new RegExp(`\\s*\\[${TAG_BODY_PATTERN}\\]\\s*`, 'gi'), ' ')
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
