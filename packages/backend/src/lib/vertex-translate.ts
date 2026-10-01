import type { Env } from '../types';
import { logStructured } from './logger';
import { LAUGH_TAG, typedLaughterToTags } from './typed-laughter';

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
    /** `STOP` 이 정상 종료다. 없으면 STOP 으로 본다(옛 응답·목). */
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
        /** 사고 요약 part. `includeThoughts` 를 안 보내면 오지 않지만, 오면 답이 아니다. */
        thought?: boolean;
        /** Gemini 3 부터 답 part 에 붙는다. 한 턴짜리 호출이라 돌려보낼 일이 없다. */
        thoughtSignature?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /** 사고에 쓴 토큰 — `maxOutputTokens` 안에서 센다. */
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
};

export type AlarmTextPreparation = {
  /**
   * 합성할 문구. **우리는 태그를 붙이지 않는다**(2026-09-30, eleven_v4_turbo) — 여기 대괄호가 있다면 사용자가
   * 직접 친 것이거나 사용자가 친 글자 웃음(ㅋㅋ)을 바꾼 `[laughs]` 뿐이다(스펙 §9).
   */
  text: string;
  translated: boolean;
  /** `text` 안의 대괄호 태그 목록(`messages.delivery_tags_json`). */
  tags: string[];
  provider: 'vertex' | 'local';
};

// 편집기가 고를 수 있는 동적 생성 모드.
// ⚠ `cheer` 의 옛 이름은 `love` 다(2026-09-02 개념 변경 — 연애가 아니라 응원).
// 들어오는 값은 `normalizeRandomContext` 가 이미 접어서 준다.
type DynamicAlarmTextMode = 'wake_weather' | 'wake_fortune' | 'cheer';

// 구조화 날씨 시그널(설계 #7). 한국어 문자열 대신 언어무관 토큰으로 전달해, 동적 프롬프트가
// 타깃 언어로 네이티브 재표현하고 폴백도 언어별 표면을 만든다(한국어 누출 0).
type WeatherConditionKind = 'rain' | 'snow' | 'dust' | 'cold' | 'heat' | 'nice';
type WeatherAction = 'umbrella' | 'mask' | 'coat' | 'water' | 'walk';
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

/**
 * 문구를 **왜** 거절했는가 — 사유 식별자. 구조화 로그·Sentry 태그로 그대로 나간다.
 *
 * ⚠ **낭독 문구 원문을 여기(또는 에러 메시지)에 담지 말 것.** 개인 목소리 콘텐츠라
 * 관측 파이프라인으로 흘려보낼 값이 아니다 — 무엇에 걸렸는지를 가리키는 이름만 싣는다.
 *
 * `upstream_unavailable` 만 성격이 다르다: 모델이 **낸 내용**이 아니라 **전송이 실패**한
 * 것이라 대응이 정반대다(프롬프트를 고칠 일이 아니라 상류·쿼터·자격증명을 본다).
 */
export type AlarmTextRejectionReason =
  | 'unspecified'
  /** Vertex 자격증명/설정이 없다 — 환경 문제. */
  | 'vertex_not_configured'
  /** 네트워크·인증·상류 5xx. 내용 위반이 아니다. */
  | 'upstream_unavailable'
  /** 태그를 벗기면 낭독할 말이 하나도 없다. */
  | 'empty_spoken'
  /** 'here is the json' 류의 메타 응답. */
  | 'meta_json'
  | 'too_long'
  | 'language_mismatch'
  /** 소괄호 지문 또는 태그 모양이 아닌 대괄호 — 낭독돼 버린다. */
  | 'stage_direction'
  /** 청자 호칭을 우리가 준 것과 다르게 불렀다. */
  | 'listener_address'
  /** 관계 라벨('엄마')이 문장에 그대로 샜다. */
  | 'relationship_leak'
  /** 한국어 한 줄 안에서 반말과 존댓말이 섞였다(시드의 '-요' 어미를 옮겨 쓸 때 난다). */
  | 'register_mixed'
  /** 인사가 아닌 알람에 아침 인사를 넣었다 — 사전렌더 클립은 몇 시에 울릴지 모른다. */
  | 'time_of_day'
  /** 영어가 축약 없이 글말로 나왔다('let us', 'do not') — 낭독하면 로봇처럼 들린다. */
  | 'uncontracted'
  /** 영어가 한국어 낱말을 그대로 옮겼다('money luck' — 재물운). 원어민은 그렇게 말하지 않는다. */
  | 'literal_translation'
  /** 한국어 낱말 짝이 어긋났다('운이 술술', '나중에 챙기려면 잊기 쉬우니까'). */
  | 'korean_collocation';

export class AlarmTextPreparationInvalidError extends Error {
  /**
   * 무엇에 걸렸는가. **원문은 담지 않는다** — 식별자만이라 그대로 로그·태그로 내보낼 수 있다.
   */
  readonly reason: AlarmTextRejectionReason;

  constructor(reason: AlarmTextRejectionReason = 'unspecified', options?: { cause?: unknown }) {
    super(`Alarm text preparation returned invalid content (${reason}).`, options);
    this.name = 'AlarmTextPreparationInvalidError';
    this.reason = reason;
  }
}

/**
 * 이 실패가 **내용 위반**이면 그 사유, 아니면 null(= 전송·인가 등 그 밖의 실패).
 *
 * 관측 쪽(cron 캡처)이 둘을 갈라 보기 위한 유일한 판정이다 — 문자열 매칭으로 흉내 내지 말 것.
 */
export function alarmTextRejectionReasonOf(error: unknown): AlarmTextRejectionReason | null {
  return error instanceof AlarmTextPreparationInvalidError ? error.reason : null;
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/**
 * 모든 Gemini 호출의 모델. **이 상수 하나가 정한다 — 워커 시크릿으로 바꾸는 길은 없다**(2026-09-30).
 *
 * ⚠ 예전에는 시크릿 `GOOGLE_VERTEX_MODEL` 이 이 값을 덮었다. 그 길을 남겨 두면 워커에 남은 옛 값
 *   (dev·prod 는 아직 `gemini-3.5-flash` 를 들고 있다)이 새 코드를 옛 모델로 계속 돌린다 — 모델마다
 *   사고 설정이 달라서(3.8 은 `MINIMAL` 을 400 으로 거절한다) 조용히 전부 실패할 수도 있다. 그래서
 *   모델과 그 모델의 요청 설정(`buildGenerationConfig`)을 **한 커밋에서 같이** 바꾸게 했다. 되돌릴 때도
 *   시크릿이 아니라 코드를 되돌린다.
 * - `gemini-3.8-flash`: GA(2026-09-02). 목록가가 3.5 Flash 보다 싸다(`us` 입력/출력 100만 토큰당
 *   $0.825/$4.125 — 2026-12-31 까지 도입가, 그 뒤 $1.65/$8.25. 3.5 Flash 는 $1.65/$9.90). 단 사고를
 *   `LOW` 밑으로 끌 수 없어 사고 토큰이 늘므로, 실제 단가는 로그의 `thought_tokens` 로 본다.
 * - ⚠ **Flash-Lite 로 내리지 말 것** — 2026-09-23 블라인드 판정에서 3.5 Flash-Lite 는 2.5 Flash 에
 *   69:108 로 졌다(한국어 36%). 가격만 보고 고르면 한국어 문구 품질이 눈에 띄게 떨어진다.
 * - 3.8 Flash 는 은퇴일이 정해지지 않은 '단기 제공' 모델이다(공지 뒤 최소 45일 안에 옮긴다).
 */
export const VERTEX_MODEL = 'gemini-3.8-flash';
// ⚠ **지역은 `us` 다.** 3.8 Flash 가 도는 곳은 `global` 과 멀티리전 `us`·`eu` 뿐이고(`us-central1` 같은
//   단일 리전 없음), 개인정보 처리방침은 Vertex 처리 국가를 '미국' 으로 적는다. `global` 엔드포인트는
//   처리 지역을 고를 수도 알 수도 없다고 문서가 말하므로 쓰지 않는다.
const DEFAULT_VERTEX_LOCATION = 'us';
/**
 * 사고 수준. **3.8 Flash 는 `LOW`·`MEDIUM`(기본)·`HIGH` 만 받는다** — 3.5 까지 쓰던 `MINIMAL` 을
 * 보내면 요청 검증 오류(400)다("Explicitly setting thinking_level to MINIMAL will return an API
 * validation error"). 호출부가 실패를 삼키고 폴백하므로 400 은 경보 없이 문구 품질만 떨어뜨린다.
 * 짧은 알람 문구 한 줄에 긴 사고는 필요 없어 가장 낮은 `LOW` 를 쓴다(지연·사고 토큰이 가장 적다).
 */
const VERTEX_THINKING_LEVEL = 'LOW';
/**
 * 출력 상한. **사고 토큰이 이 상한 안에서 함께 세어진다** — 사고에 다 쓰면 `finishReason: MAX_TOKENS`
 * 로 잘린 JSON 이 HTTP 200 으로 온다(2026-09-23 실측: 상한 16 에서 `{"text": "[cheerful] 엄마, 일`).
 * 답 자체는 문구 한 줄짜리 JSON 이라 수십~백여 토큰이다(2026-09-30 실호출 — 가장 긴 사전렌더 프롬프트
 * 3,635 토큰에 답 37 토큰, 사고 0, 2.4초). 그래도 `LOW` 는 사고 양을 모델이 정하는 동적 수준이고, 3.8 은
 * 3.7 보다 토큰을 더 쓴다고 문서가 말한다 — 사고가 길어지는 호출에서 잘리지 않도록 `MINIMAL` 시절의
 * 1024 에서 4096 으로 올렸다. 요금은 실제로 만든 토큰만 나가므로 상한을 올려도 비용은 그대로이고, 폭주하면
 * 이 상한보다 15초 타임아웃이 먼저 끊는다(둘 다 호출부의 폴백·재시도로 간다).
 */
const MAX_OUTPUT_TOKENS = 4096;
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
/// 태그 하나를 **양옆 공백까지** 잡는다 — 지운 자리를 메울 때 공백을 한 번에 본다(`tagGapFill`).
const TAG_WITH_GAP_RE_GLOBAL = new RegExp(`[ \\t]*\\[${TAG_BODY_PATTERN}\\][ \\t]*`, 'gi');
/// 문구 **첫머리의** 태그 묶음(`[warmly] [laughs] …` 의 앞부분).
const LEADING_TAGS_RE = new RegExp(`^(?:\\s*\\[${TAG_BODY_PATTERN}\\])*`, 'i');

/// 띄어 쓰는 글자인가 — 일본어·중국어는 띄어 쓰지 않으므로 빼고 본다.
function isSpacedWordChar(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch) && !/[぀-ヿ一-鿿]/.test(ch);
}

/**
 * 지운 태그 자리를 무엇으로 메울까 — `TAG_WITH_GAP_RE_GLOBAL` 로 잡은 조각(태그 + 양옆 공백)과 그 자리를 본다.
 *
 * - 문구 처음·끝, 또는 **문장부호 앞**이면 아무것도 남기지 않는다. 공백을 남기면 `Wake up [laughs].` 가
 *   `Wake up .`, `Hello [laughs], now` 가 `Hello , now` 가 된다(Codex #830).
 * - 공백이 있었으면 한 칸 — `일어나 [laughs] 자기야` → `일어나 자기야`.
 * - 붙어 있었으면 양옆이 낱말일 때만 한 칸이다. 빈 문자열로 지우면 `Good[softly]morning` 의 두 낱말이
 *   붙는다(Codex #801). 쉼표·마침표 **뒤**(`할머니,[softly]일어나세요`)도 뒤가 낱말이면 한 칸이다.
 *   일본어·중국어는 띄어 쓰지 않으므로 붙인다.
 */
function tagGapFill(piece: string, offset: number, whole: string): string {
  const before = whole[offset - 1] ?? '';
  const after = whole[offset + piece.length] ?? '';
  if (!before || !after || /[,.!?…;:~〜、。，．！？；：)）」』]/u.test(after)) return '';
  if (/^[ \t]|[ \t]$/.test(piece)) return ' ';
  return isSpacedWordChar(after) && (isSpacedWordChar(before) || /[,.!?…;:]/u.test(before)) ? ' ' : '';
}
// ── 태그 ────────────────────────────────────────────────────────────────────────
// ⚠ **우리는 딜리버리 태그를 붙이지 않는다**(2026-09-30, eleven_v4_turbo 전환). 예전에는 Gemini 가 직접 입력·
//   사전렌더·동적 생성에 `[cheerfully]` 같은 태그를 달았다(eleven_v3 는 태그가 있어야 연기했다). v4 Turbo 는 문장의
//   뜻과 문장부호로 스스로 결을 잡고, 같은 방향 태그는 차이가 ±2반음·1dB 안쪽이며 누르는 태그는 거의 안 먹고
//   올리는 태그만 크게 먹었다(129→205Hz) — 태그가 '차분을 망치는' 쪽으로만 효과가 있었다(스펙 §10). 그래서
//   태그 지시와 그 후처리(졸린·공포·차분 금지 태그, 문장마다 다시 앞세우기, 기본 태그)를 통째로 뺐다.
//
// 남은 대괄호는 둘뿐이다:
//  1. **사용자가 직접 친 것** — 사용자의 글이라 건드리지 않는다.
//  2. **사용자가 친 글자 웃음(ㅋㅋ·haha·www)을 바꾼 `[laughs]`** — v4 도 'ㅋㅋㅋ' 를 '크크크' 로 읽는다(스펙 §9).
// 모델이 쓴 글(사전렌더·동적 생성)의 대괄호는 전부 벗긴다(`stripAllTags`). 번역은 원문에 없던 톤 태그만 벗긴다.

/**
 * 웃음 태그인가(`[laughs]`·`[giggles]`·`[chuckles]`·`[laughs nervously]` …).
 *
 * 웃음은 **한 번 나는 소리**라 개수로 다룬다 — 번역이 사용자의 웃음을 빠뜨리거나 더하지 않게 세고
 * (`canonicalizeLaughterTags`·`withLeadingLaugh`), 화면 문구에서는 서버가 넣은 웃음만 벗긴다(`withoutServerLaughter`).
 *
 * 글자 웃음을 대괄호에 넣은 것(`[haha]`·`[lol]`·`[www]`)도, 거기에 꾸밈말을 붙인 것(`[haha loudly]`·`[lol nervously]`)도
 * 웃음이다(Codex #830) — `[laughs nervously]` 를 웃음으로 보는 것과 같다.
 */
export function isLaughterTag(tag: string): boolean {
  const normalized = normalizeTag(tag);
  if (!normalized) return false;
  if (['laugh', 'giggl', 'chuckl'].some((word) => normalized.includes(word))) return true;
  return normalized.split(/[\s,]+/).some((word) => {
    const spoken = typedLaughterToTags(word);
    return spoken !== word && !hasSpokenWords(spoken);
  });
}

/// 태그를 벗기고도 낭독할 말(글자·숫자)이 남는가. 문장부호만 남으면 말이 없는 것이다.
function hasSpokenWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(normalizeAlarmTextWithoutTags(text));
}

function countLaughterTags(text: string): number {
  return (text.match(TAG_RE_GLOBAL) ?? []).filter(isLaughterTag).length;
}

/// 글에 든 웃음 태그를 이름별로 센다(`[chuckles]` 두 번 → `chuckles: 2`).
function laughterTagCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of (text.match(TAG_RE_GLOBAL) ?? []).filter(isLaughterTag)) {
    const name = normalizeTag(tag);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/**
 * 번역문의 웃음 수를 원문에 맞춘다 — **모델이 낸** 웃음 태그는 `[laughs]` 로 맞추고(`[chuckles]`·`[giggles]` →
 * `[laughs]`), `maxLaughs` 번을 넘는 웃음은 지운다(앞에서부터 남긴다). 붙어 있는 웃음(`[chuckles] [giggles]`)은 한
 * 번으로 본다. 지운 자리는 `tagGapFill` 로 메운다 — 문장부호 앞에 공백을 남기지 않는다.
 *
 * `[chuckles]` 는 v3 남자 목소리에서 다른 언어로 합성된 적이 있어 모델 웃음은 한 이름으로 모은다(스펙 §9).
 *
 * ⚠ **사용자가 친 태그는 친 수만큼만 사용자 것이다**(`userTags`, Codex #830). 이름으로 통째로 빼 주면
 *   번역 모델이 사용자의 `[chuckles]` 를 지키면서 `[chuckles]` 를 하나 더 써도 그것까지 빠져 두 번 웃는다.
 *   앞에서부터 친 수만큼은 철자 그대로 두고 `maxLaughs` 에서 먼저 떼며, 나머지는 모델 웃음으로 맞추고 센다.
 */
function canonicalizeLaughterTags(
  text: string,
  /** 남길 웃음 수 — 사용자 것까지 합친 수다. */
  maxLaughs: number,
  /** 사용자가 대괄호로 직접 친 웃음 태그(정규화한 이름 → 친 수, `laughterTagCounts`). */
  userTags: ReadonlyMap<string, number> = new Map(),
): string {
  const userLeft = new Map(userTags);
  const userOwned = (text.match(TAG_RE_GLOBAL) ?? []).filter(isLaughterTag).map((tag) => {
    const left = userLeft.get(normalizeTag(tag)) ?? 0;
    if (left > 0) userLeft.set(normalizeTag(tag), left - 1);
    return left > 0;
  });
  const modelBudget = Math.max(0, maxLaughs - userOwned.filter(Boolean).length);
  // 사용자가 친 웃음 태그를 모델이 다른 철자로 바꿨으면(`[chuckles]` → `[laughs]`) 남는 모델 웃음을 **그 철자로**
  // 되돌린다 — 수만 맞추면 사용자가 친 태그가 조용히 바뀐다(Codex #830).
  const unmatchedUserTags = [...userLeft].flatMap(([name, left]) => Array<string>(left).fill(`[${name}]`));
  let index = 0;
  let modelLaughs = 0;
  let lastLaughEnd = -1;
  const limited = text.replace(TAG_WITH_GAP_RE_GLOBAL, (piece: string, offset: number, whole: string) => {
    if (!isLaughterTag(piece.trim())) return piece;
    const owned = userOwned[index++];
    const adjacent = offset === lastLaughEnd;
    lastLaughEnd = offset + piece.length;
    if (owned) return piece;
    if (!adjacent && ++modelLaughs <= modelBudget) {
      return piece.replace(TAG_RE, unmatchedUserTags.shift() ?? LAUGH_TAG);
    }
    return tagGapFill(piece, offset, whole);
  });
  return limited === text ? text : limited.replace(/[ \t]{2,}/g, ' ').trim();
}

/// 번역문에 사용자의 웃음이 하나도 안 남았을 때 — 선두 태그(사용자가 친 것) 뒤에 한 번 넣는다(`prepareAlarmTextWithVertex`).
/// `laugh` 는 되살릴 웃음 — 사용자가 대괄호로 친 웃음 태그면 **그 철자**다(`[chuckles]` 를 `[laughs]` 로 바꿔
/// 되살리지 않는다, Codex #830).
function withLeadingLaugh(text: string, laugh: string = LAUGH_TAG): string {
  const leading = text.match(LEADING_TAGS_RE)?.[0] ?? '';
  return `${leading.trim()} ${laugh} ${text.slice(leading.length).trim()}`.trim();
}

/**
 * 직접 입력의 글자 웃음(ㅋㅋ·haha·www·(笑))을 합성용 `[laughs]` 로 바꾼다(`lib/typed-laughter.ts`).
 *
 * ⚠ **웃음만 있는 문구('ㅋㅋㅋ')는 그대로 둔다.** 바꾸면 합성 글자가 태그뿐이라 낭독할 말이 없다 —
 *   번역 경로는 그걸 `empty_spoken` 으로 거절하고, 태그뿐인 요청을 제공자가 어떻게 합성하는지는 확인하지
 *   않았다. 예전과 같은 글자로 보내는 쪽이 안전하다.
 */
export function speakTypedLaughter(text: string): string {
  const converted = typedLaughterToTags(text);
  // 문장부호만 남아도('ㅋㅋㅋ!'·'haha…') 낭독할 말이 없는 것이다 — 글자·숫자가 남아야 한다(Codex #830).
  return converted !== text && hasSpokenWords(converted) ? converted : text;
}

/**
 * 대괄호 태그를 **전부** 벗긴다 — 모델이 쓴 글(사전렌더·등록 미리듣기·동적 생성)에 쓴다. 우리는 태그를 붙이지
 * 않으므로 모델이 스스로 낸 태그도 합성하지 않는다(위 머리말).
 *
 * `normalizeAlarmTextWithoutTags` 와 달리 지운 자리를 `tagGapFill` 로 메운다 — 공백으로 바꾸면 '좋아 [laughs].' 가
 * '좋아 .' 로 합성·저장된다(Codex #830 과 같은 모양).
 */
export function stripAllTags(text: string): string {
  return stripTagsWhere(text, () => true);
}

/// `drop` 이 참인 태그만 벗긴다(정규화한 이름을 받는다). 지운 자리는 `tagGapFill` 로 메운다.
function stripTagsWhere(text: string, drop: (normalizedTag: string) => boolean): string {
  const stripped = text.replace(TAG_WITH_GAP_RE_GLOBAL, (piece: string, offset: number, whole: string) =>
    drop(normalizeTag(piece.trim())) ? tagGapFill(piece, offset, whole) : piece,
  );
  return stripped === text ? text : stripped.replace(/[ \t]{2,}/g, ' ').trim();
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
};

/**
 * 직접 입력·스톡 문구를 합성할 글자로 만든다. **Gemini 는 번역할 때만 부른다**(2026-09-30).
 *
 * 같은 언어 문구는 태그를 붙이지 않으므로(위 「태그」 머리말) 사용자가 친 글 그대로다 — 글자 웃음만 `[laughs]` 로
 * 바꾼다(`speakTypedLaughter`). 예전에는 같은 언어 직접 입력마다 태그를 달려고 Gemini 를 불렀다. 이제 호출도
 * 지연도 없고, 사용자의 글이 국외(Google)로 가지도 않는다.
 */
export async function prepareAlarmTextWithVertex(
  env: Env,
  text: string,
  options: {
    targetLanguage: string;
    sourceLanguage?: string;
    translate?: boolean;
    /**
     * 사용자가 친 글자 웃음(ㅋㅋ·haha·www·(笑))을 `[laughs]` 로 바꿔 합성한다 — **직접 입력만** 켠다.
     * 스톡 문구는 우리가 확정한 대사라 켜지 않는다(합성 글자가 바뀌면 게시된 클립의 캐시 키가 갈라진다).
     */
    speakTypedLaughter?: boolean;
  },
): Promise<AlarmTextPreparation> {
  const trimmed = text.trim();
  const sourceLanguage = options.sourceLanguage ?? 'ko';
  const targetLanguage = options.targetLanguage || sourceLanguage;
  const shouldTranslate = options.translate === true && targetLanguage !== sourceLanguage;
  const speak = (value: string) => (options.speakTypedLaughter ? speakTypedLaughter(value) : value);
  /** 합성할 원문 — 글자 웃음만 `[laughs]` 로 바꿨다. 번역 모델도 이걸 받는다(ㅋㅋ 를 읽거나 지우지 않게). */
  const source = speak(trimmed);

  // ⚠ 사용자가 **직접 쓴** 대괄호는 거르지 않는다. 알람 문구는 사용자가 쓴 글이고, '[panicked] 지각이다!!' 같은
  //   장난 알람도 그 사람의 의도다 — 조용히 바꾸면 쓴 글과 다른 소리가 난다.
  if (!trimmed || !shouldTranslate) {
    return { text: source, translated: false, tags: extractTags(source), provider: 'local' };
  }
  if (!hasGeminiConfiguration(env)) {
    throw new AlarmTextTranslationUnavailableError();
  }

  let raw: string;
  try {
    raw = await generateContentText(env, alarmTextPrompt({ text: source, sourceLanguage, targetLanguage }), {
      // ⚠ 스키마 없이 JSON 만 요구하면 3.5 Flash-Lite 가 영어 문구의 12% 를 **배열**
      //   `[{"text":…}]` 로 준다(2026-09-23 비교 평가). 파서가 받아 주긴 하지만 형식을 못박는다.
      responseSchema: ALARM_TEXT_RESPONSE_SCHEMA,
    });
  } catch (err) {
    // ⚠ **전송 실패다 — 내용 위반이 아니다.** 이 라우트의 502(`TEXT_PREPARATION_FAILED`)
    // 계약은 그대로 둬야 해서 클래스는 바꾸지 않고, 사유와 `cause` 만 실어 보낸다.
    // 그래야 Sentry 에서 "모델이 금지 문장을 낸다" 와 갈라 볼 수 있다.
    throw new AlarmTextPreparationInvalidError('upstream_unavailable', { cause: err });
  }
  const parsed = parseAlarmTextPreparation(raw);
  if (!parsed.text || isMetaJsonResponse(parsed.text) || (!parsed.parsedJson && isMetaJsonResponse(raw))) {
    throw new AlarmTextPreparationInvalidError(!parsed.text ? 'empty_spoken' : 'meta_json');
  }

  // 번역문에 모델이 옮겨 쓴 글자 웃음(haha·www)도 소리로 — 웃음 수를 맞추기(아래 `canonicalizeLaughterTags`) 전에 바꾼다.
  // 원문에 없던 **톤** 태그는 벗긴다 — 우리는 태그를 붙이지 않는다(위 「태그」 머리말). 사용자가 친 태그 이름은 남긴다.
  const userTagNames = new Set(extractTags(trimmed));
  let preparedText = stripTagsWhere(
    speak(parsed.text),
    (tag) => !isLaughterTag(tag) && !userTagNames.has(tag),
  );
  // 웃음은 원문에 있던 수만큼만(사용자가 친 ㅋㅋ 를 바꾼 `[laughs]` + 사용자가 직접 친 웃음 태그) — 모델이 더한 웃음은
  // 지운다. 사용자가 직접 친 웃음 태그는 **친 수만큼** 철자 그대로 두고, 나머지 웃음은 `[laughs]` 로 맞춘다(Codex #830).
  preparedText = canonicalizeLaughterTags(preparedText, countLaughterTags(source), laughterTagCounts(trimmed));
  if (countLaughterTags(source) > 0 && countLaughterTags(preparedText) === 0) {
    // ⚠ 번역이 사용자의 웃음을 빠뜨렸으면 앞에 한 번 되살린다(Codex #830). 번역은 어순이 바뀌어 원문 자리로
    //   되돌릴 수 없다 — 자리·개수 대신 '사용자가 웃었다' 는 것만 지킨다(스펙 §9). 되살리는 웃음은 원문의 첫 웃음
    //   그대로다 — 글자 웃음이면 `[laughs]`, 사용자가 대괄호로 친 태그면 그 철자(`[chuckles]`).
    preparedText = withLeadingLaugh(
      preparedText,
      (source.match(TAG_RE_GLOBAL) ?? []).find(isLaughterTag) ?? LAUGH_TAG,
    );
  }
  // ⚠ 번역문은 **태그를 벗긴 뒤에도** 낭독할 말이 있어야 한다(Codex #801). `{"text":"[softly]"}` 처럼 태그뿐인
  //   응답을 '번역 성공' 으로 합성·저장하면 말 없는 클립이 된다.
  // ⚠ 웃음만 남은 번역(`haha!`)도 말이 없는 것이다(Codex #830). `speak` 는 웃음뿐인 글을 일부러 글자로 두므로
  //   (사용자가 'ㅋㅋㅋ' 만 친 경우) 그대로 두면 'haha' 를 읽는 클립이 '번역 성공' 이 된다. 원문에 말이 있었는데
  //   번역문의 글자 웃음을 소리로 바꾸면 말이 안 남는다면 거절한다 — 원문도 웃음뿐이면 그대로 둔다.
  if (
    !normalizeAlarmTextWithoutTags(preparedText) ||
    (hasSpokenWords(typedLaughterToTags(trimmed)) && !hasSpokenWords(typedLaughterToTags(preparedText)))
  ) {
    throw new AlarmTextPreparationInvalidError('empty_spoken');
  }

  return {
    text: preparedText,
    translated: true,
    tags: extractTags(preparedText),
    provider: 'vertex',
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await generateContentText(env, prompt, {
        systemInstruction: DYNAMIC_SYSTEM_INSTRUCTION,
        responseSchema: DYNAMIC_RESPONSE_SCHEMA,
      });
    } catch {
      // 네트워크/인증 실패는 재롤로 풀리지 않으므로 즉시 폴백.
      return fallback;
    }

    // 모델이 태그를 내도 합성하지 않는다(위 「태그」 머리말) — 벗긴 글을 수리·검증하고 그대로 합성한다.
    // 화면 문구와 합성 문구가 같은 글이다.
    const spoken = polishDynamicAlarmText(stripAllTags(parseDynamicAlarmTextResult(raw).text.trim()), context);
    if (dynamicTextHardFailure(spoken, context)) {
      continue; // HARD → 1회 재롤
    }
    return { text: spoken, translated: false, tags: [], provider: 'vertex' };
  }

  return fallback;
}

// HARD 차단(§4.7): 차단 시 재롤→폴백.
function dynamicTextHardFailure(text: string, context: DynamicAlarmTextContext): boolean {
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
  // 소괄호 지문·태그 모양이 아닌 대괄호(`[다정하게]`)는 HARD — 태그를 벗긴 뒤에도 남아 낭독된다.
  if (hasStageDirection(text)) return true;
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
  /** 넘기지 않을 시각(epoch ms) — `GenerateContentConfig.deadlineAt`. 없으면 8초 상한 그대로다. */
  deadlineAt?: number,
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

  // 서명(위) 뒤, 요청 **직전에** 잰다 — 마감이 있으면 남은 시간을 넘기지 않는다.
  const timeoutMs = deadlineBoundedTimeoutMs(VERTEX_TOKEN_TIMEOUT_MS, deadlineAt);
  const response = await fetch(credentials.token_uri, {
    method: 'POST',
    // 상류(Google OAuth) 지연이 사용자 대면 요청(알람 생성/TTS)을 워커 상한까지 볼모로
    // 잡지 않도록 타임아웃을 건다. abort 시 fetch reject → 기존 catch 폴백으로 흐른다.
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  }).catch((err: unknown) => {
    throw markTransportFailure(err);
  });
  const json: VertexTokenResponse = await response.json<VertexTokenResponse>().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    const err = new Error(
      json.error_description || json.error || `Vertex auth failed (${response.status})`,
    );
    // 토큰 엔드포인트의 429·5xx 도 상류가 잠깐 못 받은 것이다 — 생성 요청과 같은 규칙으로 다시 묻는다(Codex #844).
    //   400(invalid_grant 등)은 다시 보내도 같으므로 표시하지 않는다.
    throw TRANSIENT_VERTEX_STATUSES.has(response.status) ? markTransportFailure(err) : err;
  }
  return json.access_token;
}

/**
 * 요청 본문에서 호출마다 다른 것은 앞의 둘뿐이다. temperature·출력 상한은 호출부가 정하지 않는다 — 3.x 는
 * temperature 를 무시하고(문서: "temperature, top_p, top_k are ignored"), 상한은 사고 토큰 때문에
 * 한 값(`MAX_OUTPUT_TOKENS`)이어야 한다. 예전에 호출부마다 적던 0.15·0.75·0.6/0.9·0.1 과 256 은
 * 3.x 로 옮긴 뒤로 요청에 실리지 않던 죽은 값이었다.
 */
type GenerateContentConfig = {
  systemInstruction?: string;
  responseSchema?: unknown;
  /**
   * 이 시각(epoch ms)을 넘기지 않는다 — 요청 본문에는 실리지 않는다. 주면 토큰 발급은 min(8초, 남은 시간),
   * 생성 요청은 min(15초, 남은 시간)이고, 둘 다 **그 요청을 보내기 직전에** 잰다. 남은 시간이 없으면 보내지 않고
   * 시간 초과(전송 실패)로 던진다. 말투 분석만 쓴다(`waitUntil` 30초 마감 — `SPEECH_STYLE_ANALYSIS_BUDGET_MS`).
   * ⚠ 생성 상한을 토큰 발급 **앞에서** 미리 재 두지 말 것(2026-10-01 리뷰) — 그 사이 토큰 발급이 8초를 먹으면
   *   생성 요청이 마감을 8초 넘겨 `waitUntil` 에 잘리고, 상태가 'pending' 에 갇힌다.
   */
  deadlineAt?: number;
};

/** 생성 요청 한 번의 기본 대기 상한. */
const VERTEX_GENERATE_TIMEOUT_MS = 15_000;
/** OAuth 토큰 발급 한 번의 대기 상한. */
const VERTEX_TOKEN_TIMEOUT_MS = 8_000;

/**
 * 요청 하나의 대기 상한 — `capMs` 와 마감까지 남은 시간 중 작은 것. 마감이 없으면 `capMs`. 이미 지났으면 요청을
 * 보내지 않고 시간 초과로 던진다(전송 실패로 표시 — `AbortSignal.timeout` 은 0 이하를 받지 않는다).
 */
function deadlineBoundedTimeoutMs(capMs: number, deadlineAt: number | undefined): number {
  if (deadlineAt === undefined) return capMs;
  const remaining = Math.floor(deadlineAt - Date.now());
  if (remaining <= 0) {
    const err = new Error('Vertex request deadline reached before sending');
    err.name = 'TimeoutError';
    throw markTransportFailure(err);
  }
  return Math.min(capMs, remaining);
}

/**
 * **응답을 받지 못한** 실패(시간 초과·네트워크 — fetch 가 던진 것)를 표시해 둔다. 이름으로 가르면 런타임마다 다르다
 * (Node 는 `TypeError: fetch failed`, workerd 는 다른 오류) — 던져진 그 자리에서 표시한다. 오류 객체는 그대로다.
 */
const transportFailures = new WeakSet<object>();

function markTransportFailure(err: unknown): unknown {
  if (typeof err === 'object' && err !== null) transportFailures.add(err);
  return err;
}

/** 생성 요청이 2xx 가 아닌 응답을 받았다. 메시지는 예전과 같다(상류 오류 문장 또는 상태 코드). */
export class VertexHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'VertexHttpError';
  }
}

/** 상류가 잠깐 못 받은 응답 — 같은 요청을 다시 보내면 될 수 있다. 400(요청 자체가 틀림)·403 등은 다시 보내도 같다. */
const TRANSIENT_VERTEX_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * 다시 물어볼 만한 실패인가 — **전송 실패만**(시간 초과·네트워크·429/5xx). 모델이 답을 냈는데 잘렸거나
 * (`GeminiIncompleteResponseError`) 형식이 틀렸거나 내용이 모자란 것은 아니다: 같은 요청은 같은 답을 낸다.
 */
function isVertexTransportFailure(err: unknown): boolean {
  if (err instanceof VertexHttpError) return TRANSIENT_VERTEX_STATUSES.has(err.status);
  return typeof err === 'object' && err !== null && transportFailures.has(err);
}

async function generateContentText(
  env: Env,
  prompt: string,
  config: GenerateContentConfig,
): Promise<string> {
  const location = env.GOOGLE_VERTEX_LOCATION || DEFAULT_VERTEX_LOCATION;
  const model = VERTEX_MODEL;
  // ⚠ 자격 증명 해석·토큰 발급 실패도 호출 한 번으로 남긴다(Codex #801). 생성 요청 앞에서 던지므로 아래
  //   `generateContentAtEndpoint` 의 로그에 닿지 않는데, 호출부는 이것도 삼키고 폴백한다 — 시크릿이 깨졌거나
  //   OAuth 가 죽으면 통째로 안 보인다. 오류 메시지는 `readVertexCredentials` 의 고정 문장이거나 OAuth
  //   응답(invalid_grant 등)이라 비밀키·문구 원문이 없다.
  const authStarted = Date.now();
  let credentials: ReturnType<typeof readVertexCredentials>;
  let accessToken: string;
  try {
    credentials = readVertexCredentials(env);
    accessToken = await createAccessToken(credentials, config.deadlineAt);
  } catch (err) {
    logStructured('warn', {
      at: 'vertex.generate',
      stage: 'auth',
      model,
      status: null,
      error: err instanceof Error ? err.name : 'unknown',
      detail: err instanceof Error ? err.message.slice(0, 120) : null,
      elapsed_ms: Date.now() - authStarted,
    });
    throw err;
  }
  return generateContentAtEndpoint(
    vertexGenerateContentEndpoint(credentials.project_id, location, model),
    model,
    prompt,
    config,
    { authorization: `Bearer ${accessToken}` },
  );
}

/**
 * generateContent 주소. 멀티리전 `us`·`eu` 는 **전용 호스트**(`aiplatform.{loc}.rep.googleapis.com`)
 * 를 쓴다(Vertex 「Locations」). 그 밖은 지금까지처럼 전역 호스트 + 경로의 location 이다.
 */
export function vertexGenerateContentEndpoint(
  projectId: string,
  location: string,
  model: string,
): string {
  const host =
    location === 'us' || location === 'eu'
      ? `https://aiplatform.${location}.rep.googleapis.com`
      : 'https://aiplatform.googleapis.com';
  return (
    `${host}/v1/projects/${projectId}` +
    `/locations/${location}/publishers/google/models/${model}:generateContent`
  );
}

/**
 * 요청의 `generationConfig` — `VERTEX_MODEL` 에 맞춘 한 벌이다. 모델을 바꾸면 여기도 같이 본다.
 *  - `thinkingLevel: 'LOW'` — 3.8 Flash 는 `MINIMAL` 을 400 으로 거절한다(`VERTEX_THINKING_LEVEL`).
 *    `thinkingBudget`(2.x 의 숫자 예산)은 3.x 문서가 "no longer supported" 라 보내지 않는다.
 *  - **temperature 를 보내지 않는다** — 3.8 은 무시하고, Gemini 3 공통 안내는 1.0 미만이면 반복 같은
 *    이상 동작이 날 수 있다고 한다. `frequency_penalty`·`presence_penalty`·`candidate_count` 는 보내면
 *    오류라 넣지 않는다.
 */
export function buildGenerationConfig(config: GenerateContentConfig): Record<string, unknown> {
  return {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
    thinkingConfig: { thinkingLevel: VERTEX_THINKING_LEVEL },
    ...(config.responseSchema ? { responseSchema: config.responseSchema } : {}),
  };
}

/** 응답에서 끝까지 만들어지지 못한 결과. 문구 원문은 싣지 않는다(로그·Sentry 로 새지 않게). */
export class GeminiIncompleteResponseError extends Error {
  constructor(readonly finishReason: string) {
    super(`Gemini generation incomplete (${finishReason})`);
    this.name = 'GeminiIncompleteResponseError';
  }
}

/**
 * 응답에서 답 텍스트를 꺼낸다.
 *  - **`finishReason` 이 `STOP` 이 아니면 던진다.** 상한에 걸리면 잘린 JSON 이 **HTTP 200** 으로 온다
 *    (`{"text": "[cheerful] 엄마, 일` — 2026-09-23 실측). 받아 두면 JSON 파싱이 실패한 원문이 그대로
 *    문구로 쓰여 **`{"text":"` 가 섞인 문장이 클립으로 합성·저장될** 수 있다. 던지면 호출부의 기존
 *    폴백(로컬 태깅·고정 예문·재시도)으로 간다. 2.x 에도 같은 구멍이었다.
 *  - **사고 part(`thought: true`)는 버리고** 나머지 텍스트 part 를 잇는다. `parts[0]` 만 읽으면
 *    답이 여러 part 로 나뉘거나 사고 요약이 앞에 올 때 엉뚱한 것을 문구로 쓴다.
 */
export function extractGeneratedText(json: VertexGenerateContentResponse): string {
  const candidate = json.candidates?.[0];
  const finishReason = candidate?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new GeminiIncompleteResponseError(finishReason);
  }
  return (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

async function generateContentAtEndpoint(
  endpoint: string,
  model: string,
  prompt: string,
  config: GenerateContentConfig,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  // 토큰 발급 **뒤**, 요청 직전에 잰다 — 마감이 있으면 그때 남은 시간을 넘기지 않는다(`deadlineAt`).
  const timeoutMs = deadlineBoundedTimeoutMs(VERTEX_GENERATE_TIMEOUT_MS, config.deadlineAt);
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
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
      generationConfig: buildGenerationConfig(config),
    }),
  }).catch((err: unknown) => {
    // ⚠ **던져진 호출도 한 줄 남긴다**(Codex #801). 15초 타임아웃·DNS·네트워크 오류는 응답이 없어
    //   아래 로그에 닿지 않는데, 호출부는 전부 이걸 삼키고 폴백·재시도한다 — 전환 뒤 감시가 가장
    //   먼저 봐야 할 실패가 기록에서 빠진다. 원문은 싣지 않는다(오류 이름만).
    logStructured('warn', {
      at: 'vertex.generate',
      stage: 'generate',
      model,
      status: null,
      error: err instanceof Error ? err.name : 'unknown',
      elapsed_ms: Date.now() - started,
    });
    throw markTransportFailure(err);
  });
  const json: VertexGenerateContentResponse & { error?: { message?: string } } = await response
    .json<VertexGenerateContentResponse & { error?: { message?: string } }>()
    .catch(() => ({}));
  // 호출마다 한 줄 — 모델 교체 뒤 확인할 길이 이것뿐이다. 호출부 대부분(직접 입력 태깅·등록
  // 미리듣기·말투 분석)이 실패를 삼키고 폴백하므로, 이 줄이 없으면 은퇴·설정 오류·잘림이
  // 사용자에게도 Sentry 에도 드러나지 않는다. ⚠ 프롬프트·응답 **원문은 싣지 않는다.**
  // ⚠ 수준은 **생성이 끝났는가**로 고른다(Codex #801) — HTTP 200 이어도 MAX_TOKENS·SAFETY 로
  //   잘렸거나 답이 비었으면 호출부가 곧바로 버리므로, 전환 뒤 감시가 봐야 할 것은 그쪽이다.
  const finishReason = json.candidates?.[0]?.finishReason ?? null;
  const hasAnswer = (json.candidates?.[0]?.content?.parts ?? []).some(
    (part) => part.thought !== true && typeof part.text === 'string' && part.text.trim() !== '',
  );
  const complete = response.ok && (finishReason === null || finishReason === 'STOP') && hasAnswer;
  logStructured(complete ? 'info' : 'warn', {
    at: 'vertex.generate',
    model,
    status: response.status,
    finish_reason: finishReason,
    model_version: json.modelVersion ?? null,
    output_tokens: json.usageMetadata?.candidatesTokenCount ?? null,
    thought_tokens: json.usageMetadata?.thoughtsTokenCount ?? null,
  });
  if (!response.ok) {
    throw new VertexHttpError(response.status, json.error?.message || `Gemini text preparation failed (${response.status})`);
  }
  return extractGeneratedText(json);
}

/**
 * 직접 입력 번역 프롬프트. 태그는 붙이게 하지 않는다(위 「태그」 머리말) — 사용자가 친 대괄호는 그대로 옮기고
 * 새로 넣지 말라고만 한다. 모델이 그래도 넣은 톤 태그는 `prepareAlarmTextWithVertex` 가 벗긴다.
 */
function alarmTextPrompt(args: { text: string; sourceLanguage: string; targetLanguage: string }): string {
  const sourceName = LANGUAGE_NAMES[args.sourceLanguage] || args.sourceLanguage;
  const targetName = LANGUAGE_NAMES[args.targetLanguage] || args.targetLanguage;
  // 직접 입력의 글자 웃음(ㅋㅋ·haha·www)은 서버가 이미 `[laughs]` 로 바꿔서 보낸다(`speakTypedLaughter`).
  // 모델이 그걸 지우거나 낱말로 풀면 사용자가 친 웃음이 사라진다.
  const typedLaughterInstruction = /\[laughs\]/i.test(args.text)
    ? "LAUGHTER: every [laughs] already in the message is the user's own laughter (they typed it as letters such as ㅋㅋ, haha or www). Keep each one where it belongs in the translation, never turn it into words, and never add another laugh."
    : '';

  // ⚠ 한→영 번역의 결정적 오역 두 가지(2026-10-01 3.8 평가, 2회 다 같았다): '오늘은 우리 딸 생일!' 을 딸에게 하는
  //   말인데 'our daughter's birthday' 로 3인칭으로 옮겼고, '오늘도 힘내!' 를 'Have a great day!'(작별 인사)로 옮겼다.
  const koToEnInstruction =
    args.sourceLanguage === 'ko' && args.targetLanguage === 'en'
      ? "Korean '우리' before a family word is an affectionate 'my' only when that word is the person hearing the alarm — the message calls them or talks about them to them (우리 딸, 일어나 → my girl, wake up; 오늘은 우리 딸 생일! said to the daughter → it's your birthday, my girl). When it names someone else or a group the speaker belongs to, it is a real 'our' (여보, 우리 아들 깨워 줘 → honey, wake our son up; 우리 가족 여행 → our family trip; 우리 팀 → our team). Translate what a phrase does, not a stock line: '힘내' cheers them on ('You've got this!', 'Hang in there!') — it is not 'Have a great day'."
      : '';

  return [
    'You translate short voice-alarm text for text-to-speech.',
    `Translate the user's alarm message from ${sourceName} to ${targetName}.`,
    'Keep any text in square brackets exactly as written, and never add new square brackets — the voice reads the words themselves, so say it the way a native speaker would.',
    ...(typedLaughterInstruction ? [typedLaughterInstruction] : []),
    ...(koToEnInstruction ? [koToEnInstruction] : []),
    'Do not add explanations, markdown, quotes, emojis, or extra fields.',
    'Keep the final text natural, spoken, and 200 characters or fewer.',
    // 채팅처럼 문장부호 없이 친 직접 입력('약 먹을 시간이야 ㅎㅎ 까먹지 말고')을 번역문도 부호 없이 이어 써서, 두 생각을
    // 한 호흡으로 읽고 끝 억양이 열린 채 끝났다(2026-10-01 3.8 평가). 느낌표는 음성을 들뜨게 하므로 마침표·물음표만.
    // ⚠ 웃음 뒤에도 부호를 찍으라고 했더니 'You've got this! [laughs].'·'試合だよ！ [laughs]。' 처럼 부호가 겹쳤다 —
    //   웃음은 부호 뒤에 두고 제 부호를 달지 않게 한다.
    "If the message is typed like a chat with little or no punctuation, punctuate the translation as the spoken sentences it is — a period or question mark where each thought ends — because the voice paces itself by punctuation. A [laughs] goes right after that mark and gets no mark of its own (\"…your medicine. [laughs] Don't forget.\").",
    'Return strict JSON with one field: {"text":"the translated text"}.',
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

/**
 * 관계 라벨이 한국어 어체를 어떻게 정하는가. 프롬프트(`koreanRegisterGuidance`)와 검사
 * (`hasMixedKoreanRegister`)가 **같은 판정**을 쓴다 — 예전에는 검사가 라벨을 정확히 일치로만 봐서
 * '친한 친구'·'큰언니' 처럼 자유 입력한 라벨은 프롬프트가 반말을 시키는데 검사는 존댓말을
 * 통과시켰다(Codex #801). 순서가 곧 우선순위다('엄마친구' 는 엄마 쪽).
 */
type KoreanRelationshipRegister = 'grandchild' | 'younger_to_elder' | 'elder_to_younger' | 'romantic' | 'peer' | 'neutral';

function koreanRelationshipRegister(label: string): KoreanRelationshipRegister {
  if (isGrandchildRelationship(label)) return 'grandchild';
  if (isYoungerToElderRelationship(label)) return 'younger_to_elder';
  if (ELDER_TO_YOUNGER_RELATIONSHIPS.some((k) => label.includes(k))) return 'elder_to_younger';
  if (isRomanticRelationship(label)) return 'romantic';
  if (['친구', ...SIBLING_RELATIONSHIPS].some((k) => label.includes(k))) return 'peer';
  return 'neutral';
}

function koreanRegisterGuidance(relationshipLabel: string | null | undefined): string {
  if (!relationshipLabel) return '';
  const label = relationshipLabel.trim();
  if (!label) return '';
  const register = koreanRelationshipRegister(label);

  if (register === 'grandchild') {
    return ' Speaker is a grandchild speaking to a grandparent: write in warm, familiar 해요체 with respectful verb forms. Prefer "할머니, 일어나실 시간이에요" or "할아버지, 나가실 때 우산 챙기세요"; never write casual elder-address phrases like "할머니, 일어날 시간이에요". It should sound like an actual grandchild speaking beside the listener, not a scripted announcement. Use small caring phrases when natural, such as "조심히 다녀오세요" or "감기 조심하세요". Do NOT use stiff 합니다체 like "~합니다", "~하십시오".';
  }
  if (register === 'younger_to_elder') {
    return ' Speaker is younger than the listener: write in warm, familiar 해요체 that still shows respect (e.g. "할아버지, 일어나실 시간이에요", "나가실 때 우산 꼭 챙기세요"). It should sound like an actual granddaughter/grandson or child speaking beside the listener, not a scripted announcement. Use small caring phrases when natural, such as "조심히 다녀오세요" or "감기 조심하세요". Do NOT use stiff 합니다체 like "~합니다", "~하십시오".';
  }
  if (register === 'elder_to_younger') {
    return ' Speaker is older than the listener: write in caring 반말, or soft 해요체 for the WHOLE line (e.g. "우리 딸, 오늘 비 온대", "오늘도 화이팅이야"). Avoid 합니다체.';
  }
  if (register === 'romantic') {
    return ' Speaker is a romantic partner or spouse: write in intimate 반말 that feels warm and a little heart-fluttering when heard from a boyfriend, girlfriend, wife, or husband. Use soft caring phrases like "자기야", "내 생각도 조금 해", "감기 걸리면 안 돼", or "오늘도 네 편이야" only when they fit. Avoid stiff 해요체/합니다체, childish baby talk, melodrama, or generic slogans as the main emotion.';
  }
  if (register === 'peer') {
    return ' Speaker and listener are peers/intimate: write in natural 반말 (e.g. "일어났어?", "오늘 뭐 입을까?"). For sibling labels such as 형제·자매, 누나, 언니, 오빠, 형, or 동생, avoid 존댓말/해요체 and sound like a real sibling. Never use 합니다체.';
  }
  return ' Use a warm conversational tone in 해요체 for the WHOLE line (no 반말 sentence, no stiff 합니다체). Sound like a real person, not an announcement.';
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

// 고정 철학·출력계약·NEVER 목록(§4.2 전문). 프롬프트 캐시 친화를 위해
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
- Soft-start. Open gently with the listener's title or a short soft opener, then ease into the
  point; acknowledge the wake/sleep transition when natural. Don't assume the time of day — no
  morning greeting unless the intent is itself a greeting (an alarm can ring at any hour). Never jarring, never alarming, never
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

DELIVERY (the voice performs your words alone)
- The TTS voice reads the line and takes its feeling from the words and punctuation. Write NO
  square-bracket tags or stage directions — carry the emotion in word, particle and ending choice
  and in the rhythm of the sentences.
- For pauses/pacing use punctuation and ellipses (…) — the engine has no SSML breaks, and a soft
  '…' or comma after the greeting is the soft-start.

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
- No markdown, emojis, quotes, explanations, square brackets, or extra fields.

OUTPUT
- Return STRICT JSON only, matching the schema: {"text": string}. "text" = the final spoken line
  in the target language, words only (no square brackets). No other fields.`;

/** 직접 입력 번역 응답. */
const ALARM_TEXT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
} as const;

// 구조화 출력(§4.7). responseMimeType/json 과 함께 1차 파서로 쓰고,
// 간헐 빈응답 대비 brace-slice 파서를 최후 폴백으로 유지한다.
// ⚠ **레거시 `tag` 필드는 받지 않는다**(2026-09-23). 백엔드가 읽지 않는 빈 필드를 매번
//   요구하던 것이라 뺐다 — 필요한 것만 받는다. 파서는 여전히 `tag` 가 와도 읽는다.
const DYNAMIC_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
  },
  required: ['text'],
} as const;

// 언어별 네이티브 규칙(§4.3 전문). 활성 언어 블록만 user prompt에 주입한다.
const KOREAN_NATIVE_RULES = `KOREAN — native, spoken, never an announcement. Pick the register from the speaker→listener
relationship and hold it the whole line. NEVER 합니다체(~합니다/~하십시오) for family/friends/partners.
- Grandchild→grandparent (손녀/손자/손주) and child→elder (딸/아들/자식/며느리/사위/조카): warm
  familiar 해요체 WITH honorific verb stems(존대 동사). '할머니, 일어나실 시간이에요.' '나가실 때
  우산 꼭 챙기세요.' Never clipped lower-sounding forms to an elder ('일어날 시간이에요').
  Honor the person, not things ('약 드실 시간이에요'(O), '시간이세요'(X)); use -(으)세요 instead of old-fashioned
  -셔요 but KEEP the honorific -시- ('해 보세요'(O), '해보셔요'(X), '해 봐요'(X) to an elder); never imply the elder forgets or is slow ('금방 잊어버리시니까'(X) →
  '미루면 잊기 쉬우니까요'(O)).
- Elder→younger (부모→자식 등): caring 반말. '우리 딸, 오늘 비 온대.' '오늘도 화이팅이야.' (A parent may use soft
  해요체 instead — but then for the WHOLE line. Never '흐리대요. … 열자' — one sentence 해요체, the next 반말.)
- Sibling/friend (형제/자매/누나/언니/오빠/형/동생/친구): natural 반말. '일어났어?' Never 존댓말/해요체.
- Romantic/spouse (연인/자기/여보/아내/남편): intimate 반말, warm and lightly heart-fluttering;
  never 해요체/합니다체 even for 아내/남편. '자기야, 비 온대. 나가기 전에 우산 챙겨, 감기 걸리면 안 돼.'
  No baby talk, no melodrama, no possessiveness; never new-romance/dating-luck/jealousy.
- Neutral/unknown: warm 해요체.
PARTICLES & SPACING (a writing rule, not a post-fix): keep subject/object particles alive —
'비가 올 수 있대요'(O) not '비 올 수 있대요'(X); '오늘은 비가 와요' reads warmer than '오늘 비 와요'.
Drop redundant 나/너/내가 when obvious.
REPORTED/SOFT endings for relayed weather/fortune: 해요체 '~대요/~래요/~다네요/~면 좋겠어요';
반말 '~대/~래/~다네/~면 좋겠다'. Sounds like relaying, not asserting. Put them ONLY on the relayed fact
itself — never on feelings, empathy or advice ('누워 있기 아까울 정도래요'(X)). Greetings, cheer and
medication relay nothing — say them in your own voice ('좋은 하루가 될 거래요'(X), '바빠지기 마련이래요'(X)).
Fortune stays a possibility ('풀릴지도 몰라'), never a promise ('술술 풀릴 거래'(X)).
NUMBERS: never read raw numbers/units aloud — no 강수확률·기온·시각·날짜 ('강수확률 70%'(X), '최저 10도'(X),
'7시 30분'(X)). Re-express softly instead ('비가 올 수 있대요'(O), '오늘은 좀 쌀쌀하대요'(O)).
AVOID: exaggerated interjections(세상에/맙소사/오 마이 갓), news-anchor openers('예보에 따르면'),
comma-spam (use connective endings). Use 할머니/할아버지 as address ONLY if it matches the listener title.`;

const JAPANESE_NATIVE_RULES = `JAPANESE — write like a native speaker. Do NOT translate Korean/English structure into Japanese.
REGISTER — CRITICAL: Japanese family & intimate speech is CASUAL(タメ口), NOT honorific. Do NOT copy
Korean's polite 해요체 into Japanese.
- Grandchild→grandparent, child→parent, parent→child, sibling, friend, romantic partner: CASUAL
  (だ/〜だよ/〜て/〜よっか/〜ね). e.g. 'おばあちゃん、今日は雨が降るみたい、傘忘れないでね。'
  NOT 'おばあちゃん、起きる時間です。' Address おばあちゃん/おじいちゃん (familiar), never おばあさま,
  and only if it matches the listener title.
- です・ます polite ONLY for distant/unknown/teacher/workplace or when no relationship is given:
  '今日は冷えるみたいなので、一枚羽織ってくださいね。' Avoid over-honorific/business
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
- Most relationships: friendly, like a close person nudging you awake. 'Hey… looks like
  rain later, grab your umbrella before you head out, okay?'
- Elder/respectful or teacher: warm but a touch more composed — still contractions, no stiffness.
- Romantic: tender, low-key intimate, never cheesy. 'Hey, you. Up you get… I've got you today.'
Drop the subject when natural. One light opener/filler max (Hey/Alright/Okay). Address by the given
title if provided, else a soft 'hey'; never a guessed family title or pet name (love, honey, dear,
sweetie) when no title is given. Weather/fortune stays
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
// ⚠ **예시가 곧 계약이다**(2026-08-20). 모델은 지시문보다 **예시와 반환 형식을 따른다** — 지시만 고치고
// 예시를 두면 무효가 된다. 그래서 태그를 뺄 때(2026-09-30) 예시의 대괄호도 함께 뺐다. 예시에 태그가 남으면
// 모델이 태그를 계속 낸다.
const DYNAMIC_FEW_SHOT: Record<string, Array<{ context: string; text: string }>> = {
  ko: [
    { context: 'wake_weather, 손녀→할아버지, rain', text: '할아버지, 일어나실 시간이에요. 오늘은 비가 올 수 있대요, 나가실 때 우산 꼭 챙기세요.' },
    { context: 'wake_weather, 연인, dust', text: '자기야, 일어나자. 오늘 미세먼지 많대 — 마스크 꼭 챙겨, 알았지?' },
    { context: 'wake_fortune, 중립', text: '오늘은 작은 선택에 좋은 기운이 따른대요… 가벼운 마음으로 시작해 봐요.' },
  ],
  ja: [
    { context: 'wake_weather, 孫→祖母(タメ口), rain', text: 'おばあちゃん、起きる時間だよ。今日は雨が降るみたい、出かけるとき傘忘れないでね。' },
    { context: 'wake_weather, 距離/불명(です・ます), cold', text: '今日は冷えるみたいですよ。一枚羽織ってから出かけてくださいね。' },
    { context: 'wake_fortune, 중립/casual', text: '今日はちょっといいことがありそうだよ… 気楽にいこうね。' },
  ],
  en: [
    { context: 'wake_weather, neutral, rain', text: 'Hey… time to get up. Looks like rain later, grab your umbrella before you head out.' },
    // ⚠ **예시가 지시문을 이긴다**(2026-09-03 리뷰 4차). 이 자리는 `love, romantic, babe`
    //   였는데, 지시문만 응원으로 고치고 예시를 두면 모델은 **예시를 따라 연애 문구**를
    //   낸다(바로 아래 `fewShotBlock` 주석이 경고하는 그것). 카테고리 이름을 바꾸면
    //   예시도 함께 바꾼다.
    { context: 'cheer, neutral', text: "Lots on your plate — you don't have to do it all at once. Just start with one thing, okay?" },
  ],
};

function fewShotBlock(targetLanguage: string): string {
  const examples = DYNAMIC_FEW_SHOT[targetLanguage];
  if (!examples || examples.length === 0) return '';
  const lines = examples.map((ex) => `- (${ex.context}) -> {"text":"${ex.text}"}`);
  return ['Few-shot examples (words only — no square brackets):', ...lines].join('\n');
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
    // `cheer` — ⚠ **연애 문구가 아니다**(2026-09-03). 옛 이름이 `love` 라 이 갈래는
    //   "romantic partner wake-up line" 을 요구했는데, 대사가 응원·자기돌봄으로 확정되면서
    //   개념 자체가 바뀌었다. 그대로 두면 `GOOGLE_VERTEX_DYNAMIC_TEXT_ENABLED=true` 인
    //   순간 **없앤 연애 카테고리가 되살아난다** — 로컬 폴백은 이미 응원인데 이 경로만
    //   반대로 간다(`docs/spec/voice-and-message.md` §2).
    //   목소리가 연인이어도 마찬가지다. 응원의 **말투**만 그 관계에 맞추고, 다루는 것은
    //   여전히 오늘을 버틸 힘이다.
    return isRomanticRelationship(context.relationshipLabel)
      ? 'Create an encouraging wake-up line in the private, affectionate voice of a partner: acknowledge that the day ahead may feel heavy, then offer steady support — doing one thing at a time, eating properly, resting when tired, not carrying everything alone. Keep it short enough for a practical alarm. Do NOT make it a romantic/flirtatious message; the warmth comes from how it is said, not from romance as the topic.'
      : 'Create an encouraging wake-up message about getting through the day: acknowledge how the listener might feel, then offer steady support — starting with one small thing, eating properly, resting when tired, or leaning on someone they trust. Personal and caring, never dramatic, and never a romantic/relationship message.';
  })();

  const languageBlock = activeLanguageBlock(context.targetLanguage);
  // 결은 문장이 싣는다 — 태그는 쓰게 하지 않는다(위 「태그」 머리말). 쉼·모양·우선순위 지시는 태그와 무관하게 남긴다.
  const deliveryInstruction = `WORDS ONLY: the voice takes its tone from your words and punctuation — write no square-bracket tags or stage directions.
PACING: prefer an unhurried delivery — a rushed alarm is hard to follow right after waking.
Use an ellipsis ("...") where the speaker would naturally pause or trail off before turning to the point ("그래도 이제... 슬슬 일어나 볼까?"). One or two per line at most — it is a breath, not a mannerism.
SHAPE: acknowledge how the listener feels first, then turn to waking them. A line that only reports facts does not wake anyone; a line that only nags is unpleasant to hear every morning. Lead with the empathy, land on the nudge — this line has to wake someone up, never lull them back to sleep.
⚠ PRIORITY: the relationship and this speaker's own way of talking come FIRST. Everything above is shape, not a script — if a pause or the empathy-then-nudge order would make this person sound like someone else, drop it and sound like them.`;

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
    deliveryInstruction,
    fewShotBlock(context.targetLanguage),
    'Return STRICT JSON only: {"text":"final spoken line in the target language"}. No other fields.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ── 사전렌더(유료 클론) 톤 적응 생성 ─────────────────────────────────────────────
// 라이브 동적 경로(generateDynamicAlarmTextWithVertex)와 분리된, seed 기반 1회 생성기.
// 카테고리 outcome 을 자연어 seed 로 받아 그 목소리의 관계/호칭/말투에 맞춘 알람 문구를 만든다.
// 동적 경로의 품질 규칙(관계 어체·호칭 호출·자연스러움·쉼과 모양·few-shot)을 그대로 재사용해
// "할아버지, 약 먹을 시간이에요. 까먹지 말고 꼭 드시고 건강하셔야 해요!" 수준을 보장한다.
function prerenderClipPrompt(params: {
  seed: string;
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  targetLanguage: string;
  /** 사용자가 등록 미리듣기에서 확정(직접 수정 포함)한 문구 — 톤/어투 기준. 내용 복제 금지. */
  styleReference?: string | null;
  /** 등록 녹음 전사에서 분석한 화자 말투(사투리·존댓말·특징 어미). styleReference 가 우선. */
  speechStyle?: SpeechStyle | null;
  /** 같은 의도를 사람이 직접 쓴 기본 목소리 대사(`STOCK_CLIP_PRESETS`). 리듬·쉼의 본보기. */
  humanReference?: string | null;
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
    : `No relationship label is available, so keep the line generally warm. ${listenerInstruction}${
        params.targetLanguage === 'ko' ? ' In Korean, use warm 해요체 for the WHOLE line — no 반말 sentence at all.' : ''
      }`;
  const romanticToneInstruction =
    params.targetLanguage === 'ko' && isRomanticRelationship(params.relationshipLabel)
      ? '연인/배우자 톤: 실제 남자친구·여자친구·아내·남편이 사적으로 건네는 말투로. 친밀한 반말을 쓰고 해요체/합니다체를 쓰지 말 것(아내·남편도). 따뜻하고 살짝 설레게, 하지만 짧게. 새 인연·연애운·질투·다른 사람에게 끌림 언급 금지.'
      : '';
  const styleReference = params.styleReference?.trim();
  // ⚠ 조심스러운 문장도 **확정 문구가 있으면 '화자 자신의 사투리' 를 말하지 않는다**(2026-10-01 마지막 회차 — 사투리
  //   지시 네 자리 중 여기만 무조건이었다). 사투리냐 표준어냐는 아래 `dialectFollowsReference` 갈래와 끝의 DIALECT 줄이
  //   확정 문구를 보고 정한다 — 여기서는 '줄의 나머지와 같은 말씨' 만 말한다.
  //   ⚠ 여기에 '확정 문구의 사투리/표준어 선택을 따르라' 를 쓰거나 이 문장을 아예 빼면, 표준어 확정 문구의 関西 화자가
  //   더 자주 関西弁 으로 샜다(같은 조건 30줄씩 두 번: 문구를 쓴 것 16/60·뺀 것 16/60, 이 문장 6/60, 고치기 전 10/120).
  const careKeepsVoice = styleReference
    ? 'Care changes the tone only — these sentences keep the same speech level and way of speaking as the rest of the line.'
    : "Care changes the tone only — these sentences keep the speaker's own dialect and speech level.";
  // 사전렌더도 동적 경로와 **같은 규칙**이다 — 결은 문장이 싣고 태그는 쓰게 하지 않는다(위 「태그」 머리말).
  const deliveryInstruction = `WORDS ONLY: the voice takes its tone from your words and punctuation — write no square-bracket tags, stage directions or laughter spelled in letters (ㅋㅋ, haha, www), which text-to-speech reads aloud.
PACING: prefer an unhurried delivery — a rushed alarm is hard to follow right after waking.
MATCH EACH SENTENCE TO ITS CONTENT: apologies, cautions and bad news (rain, snow, fine dust, fog, cold, a failed weather check) are said with care — never playfully or with excitement. A tone written in the intent ('미안한 듯', '가볍게', '다정하게') wins over the voice's usual mood. ${careKeepsVoice} This line has to wake someone up — never let it drift into a sleepy or hushed lull.`;
  // ⚠ **인사 시드는 표준 인사말을 그대로 써도 된다**(2026-10-01 마지막 회차). 확정 문구는 거의 언제나 인사 줄이라
  //   ('복제·살짝 바꿔 쓰기 금지' 의 압력으로) 일본어 인사가 おはよう 를 피해 'いい朝だよ' 로, 関西 이 'おはようさん' 을
  //   피해 열었다. 인사말 낱말만 허용하고 나머지 문장은 새로 쓰게 한다.
  // ⚠ **어미를 본뜨지 말 것**(같은 회차). 경상 확정 문구의 끝 '…보자카이' 를 12줄 중 8줄이 그대로 끝으로 썼다 — 한
  //   목소리의 알람이 전부 같은 꼬리로 끝난다. 피할 끝말은 **코드가 집어 준다**(`lastPhrase`).
  //   ⚠ 이 문장에 'dialect' 를 쓰지 말 것 — '같은 사투리 안에서 어미를 바꾸라' 류의 문장을 다른 수정과 함께 실었더니
  //     표준어 확정 문구의 関西 화자가 関西弁 으로 새는 줄이 22/60 까지 늘었다(고치기 전 10/120). 사투리냐 표준어냐는
  //     말투 블록·끝의 DIALECT 줄이 확정 문구를 보고 정한다.
  const referenceTail = styleReference ? lastPhrase(styleReference) : '';
  const styleReferenceInstruction = styleReference
    ? `STYLE REFERENCE (tone only): the user approved this exact line for this same voice: "${styleReference}". Match its register, warmth, sentence length and overall speaking style — but write NEW content for the current intent; never copy or lightly rephrase the reference line itself.${
        isGreetingSeed(params.seed)
          ? " This intent is a greeting: open with the same plain greeting word the reference uses (e.g. 좋은 아침, おはよう, おはようさん, Good morning) — reusing that word is not copying; only the rest of the line must be new."
          : ''
      } Keep its register and energy, but vary your sentence endings: this voice says many different lines, so do not end your line the way the reference ends${
        referenceTail ? ` ("${referenceTail}")` : ''
      }.`
    : '';
  // ⚠ **사람이 쓴 같은 의도의 대사를 본보기로 준다**(2026-09-27 사용자 지시 — "기본 목소리 대사처럼
  //   사람이 말하는 것처럼"). 시드는 의도를 설명한 글이라 모델이 설명문처럼 옮기기 쉽다. 본보기는
  //   중립 화자의 존댓말이므로 **리듬·쉼·공감→권유 흐름만** 가져오고, 문장과 어체는
  //   이 목소리의 관계·호칭·말투로 새로 쓰게 한다.
  // ⚠ **사투리 화자에게는 본보기의 낱말까지 사투리로 다시 쓰라고 따로 말한다**(2026-10-01 3.8 평가). 어체 예시가
  //   표준 반말뿐이라('온대요'→'온대'), 경상 엄마의 '날씨 확인 실패' 줄이 본보기 뼈대를 표준 반말로만 고쳐 옮겨
  //   사투리가 통째로 빠졌다(2회 중 1회).
  // ⚠ **사용자가 확정한 문구(STYLE REFERENCE)가 있으면 사투리 지시는 그 문구를 따른다**(2026-10-01 리뷰). 운영 크론은
  //   거의 모든 클론에 확정 문구를 넘긴다(`stock-clips.ts` 의 `preview_text`). 그 문구가 표준어면(사용자가 고쳤거나
  //   분석이 실패한 채 만들어졌다) 분석이 사투리라고 해도 표준어로 쓴다 — '확정 문구가 분석을 이긴다' 가 규칙이다
  //   (스펙 §4-2). 문구가 사투리인지는 코드가 가르지 않고 모델이 문구를 보고 고른다.
  const dialectName = params.speechStyle?.dialect;
  const humanReference = params.humanReference?.trim();
  const humanReferenceInstruction = humanReference
    ? `HUMAN-WRITTEN REFERENCE for this same intent (a script line written by a person for a neutral narrator in polite speech): "${humanReference}". This is how a real person says it — match its natural rhythm, short sentence shapes, pauses (…) and its empathy-then-nudge flow. But re-voice it completely for THIS speaker (relationship register, title, dialect, energy); do not copy its sentences. Its endings are polite (해요체/です・ます) because the narrator is neutral — REWRITE EVERY ENDING into this speaker's register (e.g. for 반말: '온대요'→'온대', '볼까요?'→'볼까?', '챙겨요'→'챙겨'); never let one sentence keep the reference's register.${
        !dialectName
          ? ''
          : styleReference
            ? ` This reference is standard language. If the approved STYLE REFERENCE line is in ${dialectName} dialect, re-voice this reference's wording into that dialect too, in every sentence; if the STYLE REFERENCE is in standard language, keep standard language like it.`
            : ` The reference is standard language and this speaker talks in ${dialectName} dialect — re-voice its wording into that dialect too, in every sentence.`
      }`
    : '';
  const speechStyle = params.speechStyle;
  /** 사투리 분석이 있는데 사용자가 확정한 문구도 있다 — 사투리 지시는 전부 그 문구를 따르는 조건부가 된다. */
  const dialectFollowsReference = Boolean(speechStyle?.dialect && styleReference);
  // 목소리의 결(경쾌/진중)이 문장 에너지를 정한다 — 결과 어긋나면 그 목소리의 핵심이 깨진다. 태그가 없으니 결은
  // **문장 모양으로만** 전한다(스펙 §4-2). v4 는 밝은 신호(느낌표·신나는 낱말)가 하나라도 있으면 크게 들뜨므로
  // (스펙 §10) 차분 쪽은 그 신호를 빼게 한다.
  const energyInstruction =
    speechStyle?.energy === 'lively'
      ? 'VOICE ENERGY — this voice is bright and LIVELY. Let the line bounce: short upbeat sentences and a light exclamation where it fits. Never flat, solemn or preachy. Cautions and apologies stay caring, just warm and quick rather than heavy.'
      : speechStyle?.energy === 'calm'
        ? 'VOICE ENERGY — this voice is low-key, CALM and sincere. Keep the line composed and grounded: steady, even sentences, few or no exclamation marks, and no teasing or excited words — the voice lifts at every bright signal, so leave them out. Calm is not sleepy — the line still ends with a clear, firm nudge to get up or act. Calm is not formal either — a calm partner, friend or parent still speaks the relationship\'s own register (반말 stays 반말).'
        : '';
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
        }. Write the line the way THIS speaker actually talks — keep their first-person pronoun, signature sentence endings (語尾癖) and energy${
          dialectFollowsReference ? '' : ", using the dialect's natural endings and vocabulary instead of standard textbook language"
        }.${
          // ⚠ 사투리는 **주제마다 같은 강도로**, **그 지역 것만** 쓴다(2026-10-01 3.8 평가). 사과·주의 줄(날씨 확인
          //   실패)에서 사투리가 빠졌고(경상 2회 중 1회 표준어), 경상 줄에 전라 '~응께' 가 섞였으며(5회 중 3회),
          //   関西 줄에 무대 말투 'なはれ' 가 나왔다. 표지(markers)에 있는 어미는 그 화자의 것이라 허용한다.
          // ⚠ 확정 문구가 있으면 이 블록부터 **조건부**다(2026-10-01 리뷰 재평가). 뒤에 '확정 문구가 이긴다' 만 덧붙였을
          //   때는 표준어 확정 문구에도 '약 알림도 사투리로, 표준어는 절대 안 된다' 는 이 문장이 이겨 경상 약 줄 2/2 가
          //   사투리였고, 関西 은 페르소나·표지까지 겹쳐 12줄 중 9줄이 関西弁 이었다.
          !speechStyle.dialect
            ? ''
            : dialectFollowsReference
              ? ` This dialect applies ONLY if the approved STYLE REFERENCE line below is itself in ${speechStyle.dialect} dialect. If it is, keep the dialect at the same strength on every topic (apologies, a failed weather check and medication reminders included), using only this region's own present-day forms: never another region's endings (e.g. a 경상 speaker never uses 전라 '~응께') and no archaic or stage forms (e.g. 〜なはれ in 関西 speech) unless they are in the markers above. If the STYLE REFERENCE is in standard language, the user chose standard speech for this voice: write standard language with no dialect endings or words at all — ignore the dialect, the markers and any dialect in the verbal identity.`
              : " Keep the dialect at the same strength on every topic — an apology, a failed weather check or a medication reminder is said gently IN the dialect, never in standard language. Use only this region's own present-day forms: never another region's endings (e.g. a 경상 speaker never uses 전라 '~응께') and no archaic or stage forms (e.g. 〜なはれ in 関西 speech) unless they are in the markers above."
        } Do not exaggerate or stack markers; if strength is low, keep it to a light touch on sentence endings only.${
          // 확정 문구는 이 블록 **뒤에** 온다(아래 return 순서) — 예전 문장('present above')은 위치가 틀렸다.
          styleReference ? ' The approved STYLE REFERENCE line given below wins over this analysis.' : ''
        }`
      : '';
  // 아이 목소리로 **판정된 경우에만** 켠다(SpeechStyle.childlike). 어른 목소리가 이렇게
  // 말하면 이상하므로 분석 쪽에서 보수적으로 판단하고, 여기서는 그 결과를 그대로 따른다.
  // 알람이라 알아들을 수 있어야 하므로 '늘어진 발음' 은 한두 낱말까지만 허용한다.
  // ⚠ **아이 말투가 관계 어체 규칙을 이긴다**(2026-09-23). '딸→아빠' 는 KOREAN_NATIVE_RULES 에서
  //   '자식→부모 = 존대 해요체' 로 묶여, 3.5 Flash-Lite 가 "일어나세요오", "술술 풀릴지도 몰라요"
  //   처럼 **어른 존댓말과 아이 말투를 섞었다**(비교 평가). 아이는 부모에게 반말을 쓴다.
  const childlikeInstruction = params.speechStyle?.childlike
    ? [
        'CHILD SPEAKER: this voice is a young child talking to a grown-up they love. Write it as that child, not as an adult imitating one. This OVERRIDES the relationship register rules above: a small child talks to a parent or grandparent in plain casual speech (Korean 반말 — no 요/세요/습니다; Japanese タメ口; simple English).',
        // ⚠ **규칙끼리 부딪히지 않게 하나로 묶었다**(2026-10-01 마지막 회차). 예전에는 (1) 필수 아이 철자의 예가
        //   '이러나아'(일어나)였는데 바로 다음 줄이 '깨우는 낱말은 깨지 말라' 였고, 예문도 '일어나아'·'wake uuup' 이었다.
        //   (2) '추측 화법 금지' 가 '~ㄹ지도' 를 막는데 운세 규칙은 '시드의 ~지도·~수도 를 지켜라' 였다. 이제 아이 철자는
        //   요점이 아닌 낱말에만, 운세는 아이 말로 된 추측('~할지도 몰라!')으로 — 전하는 말('~래')이 아니게.
        'Sound like a child: very short sentences, small everyday words, a bit of repetition, and eager affection. No polished adult phrasing, no advice-giving, no long clauses, no polite or adult hedging ("~ㄹ지도 몰라요", "~면 좋겠어요", "~지요?").',
        'A fortune is still only a maybe: keep its hedge, said the way a child says it ("~할지도 몰라!", "かもね！", "maybe!") — never as a sure thing, and not as passed-on talk ("~래", "~대", "they say").',
        'A child does not pass on the intent\'s reasons or explanations — say only the one thing the child wants the grown-up to do, in child words (the COMPLETENESS rule below is written for a child for this reason): not "미뤄 두면 까먹으니까 알람 끄기 전에 지금 바로 먹어" but "아빠, 지금 약 먹어, 응?".',
        'REQUIRED — spell one or two words per line the way a small child actually says them, instead of textbook-correct spelling: stretch an ending ("가자아", "아빠아"), soften a consonant ("힘드러어", "조아아"), or repeat a word ("빨리빨리"). Only on words that do not carry the point: the wake-up word (일어나, 起きて, wake up), medicine (약, くすり, medicine) and umbrella (우산, かさ, umbrella) stay correctly spelled and unstretched — "일어나" never becomes "이러나" or "일어나아". Never write the whole line in broken spelling — the rest stays normally spelled so the message is still clear enough to wake someone.',
        params.targetLanguage === 'ko'
          ? 'Child examples: "아빠아, 일어나! 오늘 비 온대. 우산 꼭 챙겨!" / "엄마, 약 먹을 시간이야. 빨리빨리 먹어어!" / "아빠, 오늘 조은 일 생길지도 몰라!"'
          : params.targetLanguage === 'ja'
            ? 'Child examples: "パパ、起きて！きょうはあめなんだって。かさ、もってってねー！" / "ママ、おくすりのじかんだよ。はやくのんでー！" / "パパ、きょういいことあるかもね！"'
            : 'Child examples: "Daddy, wake up! It\'s gonna rain, take your umbrella, okaaay?" / "Mommy, medicine time! Take it now-now-now!" / "Daddy, maybe something good happens today!"',
      ].join(' ')
    : '';
  return [
    `LANGUAGE: write the spoken line in ${targetName}.`,
    activeLanguageBlock(params.targetLanguage),
    `Alarm intent (semantic seed): ${params.seed}`,
    relationship,
    romanticToneInstruction,
    speechStyleInstruction,
    energyInstruction,
    childlikeInstruction,
    styleReferenceInstruction,
    humanReferenceInstruction,
    'Write it like ONE real person speaking warmly and naturally to the listener — call them by their title when provided, hold the relationship register, and make it caring and specific. Do NOT just state a bare fact ("비가 와요" alone is not enough); pair it with a short, natural caring action or wish that fits the intent (weather → suggest umbrella/mask/warm clothes/careful steps; medication → remind kindly and wish good health; fortune → a light playful mood, entertainment only: keep every hedge the intent has (\'~수도\', \'~지도\', \'might\', \'かも\'), and luck with people means people the listener already knows — never a new encounter or love luck (\'새 인연\', \'いい出会い\', \'someone special\')). Keep it to one or two short sentences, usable as an alarm.',
    // ⚠ **완결성이 먼저, 길이는 그다음**(2026-09-23 블라인드 판정). 처음엔 "영어 25단어·90자" 로
    //   묶었는데, 시드는 대부분 '사실 → 공감 → 권유' 세 마디라 **마지막 권유("이제 일어나자",
    //   "지금 먹자")가 잘려** 알람이 깨우지를 못했다(시드 누락 지적 72건, 2.5 영어는 새 프롬프트가
    //   10:20 으로 졌다). 그래서 무엇을 먼저 버릴지(인사·호칭 반복)를 정해 주고 상한은 넉넉히 둔다.
    //   3.5 Flash-Lite 가 영어에서 200자를 넘기던 것은 이 상한으로 막는다.
    // ⚠ **아이 목소리는 이유를 옮기지 않는다 — 그래서 이 규칙도 아이에게는 다르게 준다**(2026-10-01 3.8 평가).
    //   CHILD SPEAKER 가 '이유를 빼라' 고 해도 뒤에 오는 이 줄이 '이유까지 전부' 를 요구해 이겼다 — 약 시드는
    //   5회 중 5회 이유를 옮겼고 4회는 비문('나중에 먹으려면 까먹으니까')이었다. 바꾸니 4회 중 1회.
    // ⚠ **'절 하나도 빼지 말 것' 은 영어에만 준다**(2026-10-01 마지막 회차). 영어 운세#0 이 '일이 생각보다 술술 풀릴 수도'
    //   절을 빠뜨렸다(6줄 중 2줄 → 고친 뒤 9/9). 한국어·일본어에는 그 누락이 없었는데, 같은 문장을 모든 언어에 실었더니
    //   표준어 확정 문구의 関西 화자가 関西弁 으로 새는 줄이 늘었다(이 문장만 더해 9/60 — 인사 줄 4/10, 고치기 전 10/120).
    params.speechStyle?.childlike
      ? "COMPLETENESS (child speaker): say the intent's main fact and its closing action in child words; leave out its reasons and explanations. Add nothing the intent does not say, and never say the same thing twice."
      : `COMPLETENESS FIRST: ${
          params.targetLanguage === 'en'
            ? "every clause of the intent must survive in your line — the fact, the empathy, the reason, a maybe it adds ('일이 생각보다 술술 풀릴 수도' → 'things might go more smoothly than you think'), and above all its closing action (get up now, take it now, look outside). Shorten a clause rather than drop it."
            : 'say every part of the intent — the fact, the empathy, the reason, and above all its closing action (get up now, take it now, look outside).'
        } If you must shorten, drop greetings (unless the intent is itself a greeting) and repeated titles first, never the closing action. Never say the same thing twice ('시작해 보자, 일어나자'). Add nothing the intent does not say: no invented circumstances ('I left a glass of water for you', 'traffic will be bad') — the clip is replayed on other days — and no piled-up adjectives ('a really healthy, wonderful day'). Use the shortest line that carries all of it: usually two short sentences, at most three — ${
          params.targetLanguage === 'en' ? 'at most about 30 English words' : 'at most about 110 characters'
        } of spoken text.`,
    'OPENER: do not assume the time of day. Use a morning greeting (좋은 아침, 잘 잤어, good morning, おはよう) only when the intent itself is a greeting — and then DO open with it; skipping the greeting drops part of the intent. Never for medication, which can ring at any hour. Do not open medication or cheer lines with a wake-up call (\'일어나\', \'get up\', \'起きて\') unless the intent asks for it — the listener may already be up. Otherwise start with the listener\'s title (or a short soft opener) and get straight to the point, and vary the opener.',
    'The intent above is written as a neutral Korean description; its wording and politeness are NOT the output register — use the relationship\'s register (e.g. a mom speaking to her daughter never says "드실").',
    params.targetLanguage === 'ko'
      ? '어미를 시드에서 옮겨 오지 말 것: 반말 화자는 한 문장도 \'-요\'로 끝내지 않는다(\'흐리대요\'→\'흐리대\', \'날이래요\'→\'날이래\'). 한 줄 안에서 반말과 해요체를 섞지 않는다. 낱말: 바람은 \'쐬다\'(\'쬐다\' 아님 — 햇볕만 쬔다). \'술술\'은 일이 \'풀리다\'에만 붙는다(\'운이 술술 따라주는\'(X) → \'운이 따라주는 날\', \'일이 술술 풀릴지도\').'
      : // ⚠ 영어·일본어는 **한국어 메모를 번역하지 말 것**(2026-09-23 블라인드 판정 — 직역투가
        //   영어 패배의 절반). 시드 21개 전체에서 옮기기 까다로운 개념만 입말로 대응시켜 준다.
        params.targetLanguage === 'en'
        ? "Don't translate the Korean note — say it the way a native English speaker would say it out loud. Tricky ideas: 미세먼지 → 'the air's pretty bad today' (never 'dust' or 'fine dust' — talk about the air); 재물운 → 'a little extra money might come your way' (never 'money luck' or 'financial luck'); 운이 따라주는 날 → 'luck's on your side today'; 끼니 챙기기 → 'don't skip meals'; 한 박자 늦춰 → 'take a breath and slow down a little' (never 'a beat slower'); 깜빡하기 쉽다 → 'it's easy to forget'; 건강하게 잘 보내 → 'take care of yourself today' (never 'have a healthy day'). The listener's own tasks are 'you', not 'we' (a daughter tells Dad 'take your time', not 'as long as we don't rush') — 'let's get up' is fine."
        : params.targetLanguage === 'ja'
          ? '韓国語のメモを訳さず、日本語話者が実際に口にする言い方で。訳しにくい言葉: 미세먼지 → 「空気がよくない」「PM2.5が多い」(「微小粒子状物質」は使わない)、재물운 → 「ちょっと臨時収入があるかも」、운이 따라주는 날 → 「ツイてる日」、끼니 챙기기 → 「ちゃんとご飯食べてね」、한 박자 늦춰 → 「ひと呼吸おいて」、따뜻한 물 → 「お湯」(「温かいお水」とは言わない)。家族への言葉は普通体で、「〜ます」「〜です」「〜ますように」で終えない。'
          : '',
    'Do not announce the relationship or source of the voice. Do not mention the exact date, weekday, alarm time, numbers/percentages/temperatures, or location/city/country names.',
    params.targetLanguage === 'ko'
      ? '뉴스 앵커처럼 들리지 않게 진짜 옆에서 말하는 톤. 손녀·손자·손주→조부모, 자식→부모는 존대 해요체("일어나실 시간이에요", "챙기세요")로, 형제·자매·친구는 반말, 연인·배우자는 사적인 반말로. 조사와 띄어쓰기를 살려 다정하게.'
      : '',
    'Make it feel warm and human, not a robotic prerecorded template.',
    deliveryInstruction,
    fewShotBlock(params.targetLanguage),
    // ⚠ **인사가 아닌 시드에는 시각 규칙을 끝에서 한 번 더 말한다**(2026-10-01 3.8 평가). 위 OPENER 만으로는 영어가
    //   'Morning, sweetie…'·'Morning, honey…' 로 열어 1회차 거절(`time_of_day`)이 7케이스×3회 중 14~15번이었다 —
    //   맨 'Morning,' 을 인사로 보지 않는다. OPENER 괄호에 그 꼴을 더해도 11번이었고, 이 줄을 **끝에** 두니 0번.
    //   인사 시드는 3/3 그대로 'Good morning' 으로 열었다. 검사기(`hasAssumedMorning`)는 그대로 필요하다.
    isGreetingSeed(params.seed)
      ? ''
      : "TIME OF DAY: this intent is not a greeting and the alarm can ring at any hour — no morning greeting of any kind, including a bare 'Morning,' before the title (좋은 아침, 잘 잤어, good morning, おはよう). Open with the listener's title or go straight to the point.",
    // ⚠ 사투리도 끝에서 한 번 더(2026-10-01 3.8 평가 2차). 위 SPEAKER DIALECT 블록만으로는 경상 응원 줄이 두 번 다
    //   '없응께'(전라)를 썼고, '날씨 확인 실패' 줄은 두 번 중 한 번이 거의 표준어였다 — TIME OF DAY 처럼 끝 위치가 듣는다.
    // ⚠ 확정 문구(STYLE REFERENCE)가 있으면 이 줄도 **그 문구를 따른다** — 끝 위치가 가장 잘 듣는 자리라, 무조건
    //   '사투리로' 라고 하면 사용자가 표준어로 확정한 문구를 이 줄이 이긴다(위 humanReference 주석).
    dialectName
      ? styleReference
        ? `DIALECT — the approved STYLE REFERENCE line decides, not the analysis. If that line is in standard language, every sentence is standard language: no ${dialectName} endings or words at all. If it is in ${dialectName} dialect, every sentence — apologies and cautions included — stays in ${dialectName} dialect at the strength given above, using only ${dialectName}'s own endings${
            /경상/.test(dialectName) ? " (a 경상 speaker never says 전라 '~응께'; '~니까' is fine)" : ''
          }.`
        : `DIALECT: every sentence — apologies and cautions included — stays in ${dialectName} dialect at the strength given above, using only ${dialectName}'s own endings${
            /경상/.test(dialectName) ? " (a 경상 speaker never says 전라 '~응께'; '~니까' is fine)" : ''
          }.`
      : '',
    'Return STRICT JSON only: {"text":"final spoken line in the target language"}. No other fields.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 사전렌더 클립 1개의 톤 적응 문구를 생성한다(유료 클론 전용). 실패(Vertex 미설정/네트워크/
 * 검증 위반)하면 throw 하여 호출자(cron)가 재시도하도록 한다 — 나쁜 폴백 문구를 저장하지 않는다.
 *
 * 돌려주는 문구는 **합성할 글이자 화면 문구**다 — 태그가 없다(위 「태그」 머리말). 모델이 태그나 글자 웃음을
 * 내도 벗긴다.
 */
export async function generatePrerenderClipText(
  env: Env,
  params: {
    seed: string;
    relationshipLabel?: string | null;
    listenerTitle?: string | null;
    targetLanguage: string;
    /** 등록 미리듣기에서 확정된 preview_text — 있으면 톤/어투 스타일 레퍼런스로 쓴다. */
    styleReference?: string | null;
    /** 등록 녹음 전사에서 분석한 화자 말투(사투리 등) — 문구를 그 말투로 작성. */
    speechStyle?: SpeechStyle | null;
    /** 같은 의도를 사람이 쓴 기본 목소리 대사 — 리듬·쉼의 본보기(`stockReferenceLine`). */
    humanReference?: string | null;
  },
): Promise<{ text: string }> {
  const targetLanguage = params.targetLanguage || 'ko';
  if (!hasGeminiConfiguration(env)) {
    throw new AlarmTextPreparationInvalidError('vertex_not_configured');
  }

  // ⚠ **한 번 던지고 끝내지 말 것**(2026-08-20). 예전에는 1회 호출 뒤 검증에 걸리면 곧바로
  // throw 했고, cron 은 그걸 5번 반복한 뒤 큐를 `failed` 로 내렸다. 그런데 거절 사유가
  // **결정적**이면(같은 시드+관계에서 모델이 매번 같은 문장을 낸다) 재시도는 전부 같은
  // 결과라, 21개 중 1개가 영구히 안 만들어지고 '다시 시도' 버튼도 무력했다 —
  // 실제로 사랑 3번 시드 × 관계 '엄마' 에서 그렇게 막혔다.
  // 그래서 **거절될 때마다 제약을 더해** 다시 묻는다. 두 번 거절된 뒤에는 관계 낱말 자체를 금지한다.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown = null;
  /** 직전 회차가 내용 검사에서 걸린 사유 — 그 사유에 맞는 재시도 힌트를 준다. */
  let lastReason: AlarmTextRejectionReason | null = null;
  /** 직전 회차에서 어체가 틀린 낱말들(register_mixed 일 때). */
  let lastWrongEndings: string[] = [];
  /**
   * **내용 검사에서 거절된 횟수** — 재시도 힌트는 회차 번호가 아니라 이것으로 고른다(2026-10-01 3.8 평가).
   * 회차로 고르면 시간 초과 뒤 회차가 거절된 적도 없는데 '앞 시도가 거절됐다' 를 받고, 시간 초과 두 번 뒤
   * 3회차는 '관계 낱말 없이 짧게' 를 받아 자기 지칭('엄마는 늘 네 편이야')과 시드 절을 버렸다(평가 D 282건 중
   * 약 4%). 전송 실패 뒤에는 같은 프롬프트를 그대로 다시 보낸다.
   */
  let rejections = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const label = params.relationshipLabel?.trim();
    const retryHint =
      rejections === 0
        ? ''
        : rejections === 1
          ? 'RETRY: the previous attempt was rejected. Keep the same intent but rephrase it differently — vary the sentence shape and wording.'
          : label
            ? `RETRY (final): earlier attempts were rejected. Write the line WITHOUT using the word "${label}" anywhere — speak purely in the first person ("나는"/"내가") and keep it short.`
            : 'RETRY (final): earlier attempts were rejected. Write a shorter, plainer line in the first person.';
    // ⚠ **길어서 걸렸으면 길이를 숫자로 다시 말한다**(2026-09-23 비교 평가). 첫 시도는
    //   완결성을 앞세우므로(프롬프트 COMPLETENESS FIRST) 3.5 Flash-Lite 가 영어에서 200자를
    //   넘기기도 한다. 일반 힌트('다르게 써 봐')로는 세 번 다 길게 써서 **영구 실패**했다
    //   (엄마→sweetie 흐림·추위·응원). 넘친 경우에만 줄이게 해서 첫 시도의 완결성은 지킨다.
    const lengthHint =
      lastReason === 'too_long'
        ? `The previous line was TOO LONG. Keep the spoken text well under 150 characters (${
            targetLanguage === 'en' ? 'about 25 English words' : 'about 80 characters'
          }): shrink the empathy to a few words${
            // ⚠ 인사 시드는 인사가 곧 의도다 — '인사를 빼라' 고 하면 인사 없는 인사 클립이 저장된다(Codex #801).
            isGreetingSeed(params.seed) ? ' but keep the greeting itself (it is the intent)' : ' and drop the greeting'
          } — and keep the closing action.`
        : '';
    const registerHint =
      lastReason === 'register_mixed' && targetLanguage === 'ja'
        ? 'The previous line ended a sentence in です・ます. Family and friends talk in plain casual Japanese — end every sentence in plain form (〜よ/〜ね/〜てね), wishes included (not 〜ますように).'
        : lastReason === 'register_mixed'
        ? `The previous line used the WRONG speech level${
            lastWrongEndings.length > 0 ? ` in: ${lastWrongEndings.map((w) => `'${w}'`).join(', ')}` : ''
          }. Hold ONE level for the whole line: the approved STYLE REFERENCE's level if one is given, otherwise the one the relationship calls for (romantic partner, sibling, friend or child → 반말 with no '-요' at all; grandchild→grandparent, child→parent or no relationship → warm 해요체 throughout).`
        : lastReason === 'time_of_day'
          ? 'The previous line assumed it was morning. This alarm can ring at any hour — no morning greeting (좋은 아침, 잘 잤어, morning, おはよう); open with the listener\'s title or go straight to the point (medication and cheer lines also skip wake-up calls).'
          : lastReason === 'uncontracted'
            ? "The previous line sounded robotic — spoken English always contracts: it's, don't, let's, you're, I'm."
            : lastReason === 'literal_translation'
              ? "The previous line said 'money luck' or 'financial luck' — a word-for-word copy of the Korean 재물운 that no native speaker says. Say it the natural way: 'a little extra money might come your way'."
              : lastReason === 'korean_collocation'
                ? "The previous line used an unnatural Korean pairing. '술술' goes only with 일이 '풀리다' — write '운이 따라주는 날' and '일이 생각보다 술술 풀릴 수도' (keep the intent's '~수도/~지도' maybe). For forgetting, say '미뤄 두면 잊기 쉬우니까', never '나중에 챙기려면 잊기 쉬우니까'."
                : '';
    const prompt = [prerenderClipPrompt({ ...params, targetLanguage }), retryHint, lengthHint, registerHint]
      .filter(Boolean)
      .join('\n');
    let raw: string;
    try {
      raw = await generateContentText(env, prompt, {
        systemInstruction: DYNAMIC_SYSTEM_INSTRUCTION,
        responseSchema: DYNAMIC_RESPONSE_SCHEMA,
      });
    } catch (err) {
      lastError = err;
      continue;
    }
    // 모델이 태그를 내도 합성하지 않는다(위 「태그」 머리말) — 벗긴다. 글자 웃음(말투 본보기의 ㅋㅋ 를 따라 쓴 것)은
    // TTS 가 글자로 읽으므로(스펙 §9) 소리 태그로 바꾼 뒤 함께 벗긴다. 낭독할 말이 안 남으면 아래
    // `prerenderRejectionReason` 이 `empty_spoken` 으로 다시 묻는다(Codex #830).
    const tidied = tidyEllipsis(stripAllTags(typedLaughterToTags(parseDynamicAlarmTextResult(raw).text.trim())));
    const text = targetLanguage === 'ko' ? modernizeKoreanHonorific(tidied) : tidied;
    // ⚠ **사유를 잃지 말 것**(2026-09-21, ALARMTALK-BACKEND-9). 예전에는 검사 일곱 개가
    // 한 덩어리 `if` 였고 에러에는 아무것도 안 실려서, Sentry 에서 '길이 초과' 와 '관계
    // 라벨 누출' 이 **같은 한 줄**로 보였다 — 무엇을 고쳐야 하는지 알 길이 없었다.
    const reason = prerenderRejectionReason(text, targetLanguage, params);
    if (reason) {
      lastError = new AlarmTextPreparationInvalidError(reason);
      lastReason = reason;
      rejections += 1;
      lastWrongEndings =
        reason === 'register_mixed' && targetLanguage === 'ko'
          ? (koreanRegisterViolation(text, params)?.wrong ?? []).slice(0, 4)
          : [];
      continue;
    }
    return { text };
  }
  // ⚠ **전송 실패를 내용 위반으로 둔갑시키지 말 것**(2026-09-21, ALARMTALK-BACKEND-9).
  // 예전에는 세 회차가 전부 fetch 실패(타임아웃·상류 5xx·서브리퀘스트 소진)여도 마지막에
  // `AlarmTextPreparationInvalidError` 를 **새로 만들어** 던졌다. 그 결과 둘이 망가졌다:
  //  1. Sentry 에서 "모델이 금지 문장을 낸다" 와 "상류가 죽었다" 가 한 그룹이 됐다 —
  //     전자는 프롬프트를, 후자는 쿼터·자격증명을 봐야 하는, 대응이 정반대인 문제다.
  //  2. `runPrerenderBatch` 의 `String(genErr).includes('Too many subrequests')` 단축로가
  //     **구조적으로 맞을 수 없었다** — 그 문자열이 덮여 사라진 뒤였다.
  // 마지막 에러가 내용 위반이면 그대로, 아니면 **원본을 그대로** 올린다.
  if (lastError !== null) throw lastError;
  throw new AlarmTextPreparationInvalidError('unspecified');
}

/**
 * 사전렌더 문구를 **왜** 거절했는가. 조건과 그 순서는 예전 한 덩어리 `if` 와 같다 —
 * 판정을 바꾸는 변경이 아니라, 사유를 잃지 않게 하는 변경이다.
 *
 * ⚠ 반환값에 문구 원문을 섞지 말 것. 이 값은 그대로 Sentry 태그가 된다.
 */
export function prerenderRejectionReason(
  /** 합성할 글 — 모델 응답에서 태그를 벗긴 것(`generatePrerenderClipText`). */
  text: string,
  targetLanguage: string,
  params: {
    /** 의미 시드. 인사 시드인지(아침 인사를 허용할지) 가를 때만 본다. */
    seed?: string | null;
    listenerTitle?: string | null;
    relationshipLabel?: string | null;
    speechStyle?: SpeechStyle | null;
    styleReference?: string | null;
  },
): AlarmTextRejectionReason | null {
  // 길이·언어·호칭·유출은 공백을 접은 본문으로 잰다. 형식·지문 검사만 원문(`text`)을 본다.
  const spoken = normalizeAlarmTextWithoutTags(text);
  // 문장부호만 남아도(`!`) 낭독할 말이 없는 것이다 — 글자·숫자가 있어야 한다. 태그만 온 응답
  // (`{"text":"[happy] [excited]"}`)도 태그를 벗기면 여기 걸린다(Codex #701 P2).
  if (!/[\p{L}\p{N}]/u.test(spoken)) return 'empty_spoken';
  if (isMetaJsonResponse(text)) return 'meta_json';
  if (spoken.length > 200) return 'too_long';
  if (hasLanguageMismatch(spoken, targetLanguage, params.listenerTitle)) return 'language_mismatch';
  if (hasStageDirection(text)) return 'stage_direction';
  if (hasUnsupportedListenerAddress(spoken, params.listenerTitle)) return 'listener_address';
  if (
    hasRelationshipLabelLeak(
      spoken,
      params.relationshipLabel,
      params.listenerTitle,
      targetLanguage,
    )
  ) {
    return 'relationship_leak';
  }
  if (targetLanguage === 'ko' && hasMixedKoreanRegister(spoken, params)) return 'register_mixed';
  if (targetLanguage === 'ja' && hasJapanesePoliteEnding(spoken, params)) return 'register_mixed';
  if (params.seed && hasAssumedMorning(spoken, params.seed, targetLanguage)) return 'time_of_day';
  if (targetLanguage === 'en' && isUncontractedEnglish(spoken)) return 'uncontracted';
  if (targetLanguage === 'en' && hasEnglishLiteralCalque(spoken)) return 'literal_translation';
  if (targetLanguage === 'ko' && hasKoreanCollocationError(spoken)) return 'korean_collocation';
  return null;
}

/**
 * 프롬프트가 금지해도 3.8 이 되풀이한 한국어 낱말 짝 두 가지(2026-10-01 마지막 회차 평가, 손주→조부모 프로필).
 *  - '운이 술술' — '술술' 은 일이 '풀리다' 에만 붙는다. 이 꼴로 쓸 때는 시드의 '~수도'(가능성)까지 같이 떨어졌다(4/13).
 *  - '나중에 챙기려면 잊기 쉬우니까' — '나중에 ~(으)려면' 뒤에 '잊/까먹' 이 오면 '나중에 먹고 싶으면 잊기 쉽다' 는 엉뚱한
 *    뜻이 된다. 시드의 '미뤄 두면 잊기 쉽다' 를 옮기다 생긴다(12/16).
 * **이 두 꼴만** 본다 — '일이 술술 풀릴지도', '미뤄 두면 잊기 쉬우니까' 는 막지 않는다. 거절이 세 회차 연속이면 그 클립이
 * 실패로 남으므로 넓히지 말 것.
 */
export function hasKoreanCollocationError(spoken: string): boolean {
  if (/운이\s*술술/.test(spoken)) return true;
  // '~려면' 과 존대 꼴 '~려 하시면'(2026-10-01 확인 평가에서 이 꼴로 빠져나갔다) 둘 다 본다.
  return /나중에\s+(?:[가-힣]+\s+)?[가-힣]+(?:(?:으)?려면|(?:으)?려\s*하(?:시)?면)\s*(?:금방\s*|쉽게\s*)?(?:잊|까먹|깜빡)/.test(spoken);
}

/**
 * 한국어 '재물운' 을 낱말째 옮긴 영어('money luck'·'financial luck'). 프롬프트가 금지해도 3.8 영어 운세 줄에 다시
 * 나왔다(2026-10-01 3.8 평가) — 원어민은 'a little extra money might come your way' 처럼 말한다. **이 두 꼴만**
 * 본다 — 'luck with money' 같은 자연스러운 말은 막지 않는다.
 */
export function hasEnglishLiteralCalque(spoken: string): boolean {
  return /\b(?:money|financial) luck\b/i.test(spoken);
}

/**
 * です・ます(정중체)로 끝나는 일본어 문장. 기원 '〜ますように' 도 정중체다(프롬프트가 금지한다). 'でした'(=だった)도 넣는다.
 * ⚠ 'でしょう' 는 넣지 않는다(2026-10-01 마지막 회차) — 엄마가 아이에게 하는 'だめでしょう？'·'寒いでしょう' 처럼 가족
 *   말투에도 흔하고, 거절은 세 회차 다 걸리면 그 클립을 영구 실패시킨다. 'ましょう'(行きましょう)는 정중체 그대로다.
 */
const JA_POLITE_SENTENCE_END = /(です|でした|ます|ました|ません|ましょう|ください|下さい|ますように)[よねか]*[。！？!?…〜ー]*$/;
/**
 * 'ます' 로 끝나도 정중체가 **아닌** 문장 끝(2026-10-01 마지막 회차):
 *  - 사전형 자체가 'ます' 로 끝나는 동사 — 覚ます·冷ます·醒ます·励ます·済ます·澄ます·悩ます(かな: さます·すます·
 *    はげます·なやます). 정중형은 覚まします 처럼 'します' 로 끝나므로 여기 걸리지 않는다. 試す(ためす)는 'ます' 가 아니다.
 *  - 누구에게나 그대로 쓰는 인사말 — いただきます·いってきます·ごちそうさまでした. おやすみなさい 는 です・ます 가
 *    아니라 애초에 걸리지 않는다.
 */
const JA_NOT_POLITE_SENTENCE_END =
  /(?:(?:[覚冷醒励済澄悩]|さ|す|はげ|なや)ます|いただきます|頂きます|いってきます|行ってきます|ごちそうさまでした|ご馳走様でした)[よねか]*[。！？!?…〜ー]*$/;

/** 일본어 한 문장이 です・ます(정중체)로 끝나는가 — 사전형이 'ます' 인 동사·인사말은 아니다. */
export function isJapanesePoliteSentence(sentence: string): boolean {
  const s = sentence.trim();
  return JA_POLITE_SENTENCE_END.test(s) && !JA_NOT_POLITE_SENTENCE_END.test(s);
}
/**
 * 일본어로 タメ口 가 **확실한** 관계 라벨 — `JAPANESE_NATIVE_RULES` 가 casual 로 못 박은 갈래만: 조부모↔손주, 부모↔자식,
 * 형제자매, 친구, 연인·배우자(한국어·일본어·영어). 이모·삼촌·사돈·시댁·처가(형수·형부·매형·처형·올케·시누·처제·동서·
 * 사돈·嫁·婿·義母)는 넣지 않는다 — 일본어에서 です・ます 가 맞을 수 있다.
 * 비교는 `compactRelationshipLabel` 로 정리한 **낱말 그 자체**다(아래 함수 주석).
 */
const JA_CASUAL_RELATIONSHIP_LABELS = new Set([
  // 한국어
  '엄마', '어머니', '아빠', '아버지', '할머니', '할아버지', '외할머니', '외할아버지', '친할머니', '친할아버지',
  '딸', '아들', '큰딸', '작은딸', '막내딸', '큰아들', '작은아들', '막내아들', '손녀', '손자', '손주',
  '언니', '누나', '오빠', '형', '큰언니', '작은언니', '큰누나', '작은누나', '큰오빠', '작은오빠', '큰형', '작은형',
  '동생', '여동생', '남동생', '막내동생', '친구', '친한친구', '절친', '베프',
  '남자친구', '여자친구', '남친', '여친', '애인', '연인', '아내', '남편', '와이프', '여보', '자기', '신랑', '배우자',
  // 일본어
  '母', '父', 'ママ', 'パパ', 'お母さん', 'お父さん', 'おかあさん', 'おとうさん', '母さん', '父さん', 'かあさん', 'とうさん',
  'おかん', 'おとん', 'おふくろ', '親父', 'おやじ', '祖母', '祖父', 'おばあちゃん', 'おじいちゃん', 'ばあちゃん', 'じいちゃん',
  'ばあば', 'じいじ', '孫', '娘', '息子', '姉', '兄', '妹', '弟', 'お姉ちゃん', 'お兄ちゃん', '姉ちゃん', '兄ちゃん',
  'お姉さん', 'お兄さん', '姉さん', '兄さん', '友達', '友だち', '友人', '親友', '彼氏', '彼女', '恋人', '妻', '夫', '旦那',
  // 영어
  'mom', 'mum', 'mommy', 'mummy', 'mama', 'mother', 'dad', 'daddy', 'papa', 'father', 'grandma', 'grandpa',
  'grandmother', 'grandfather', 'granny', 'grandson', 'granddaughter', 'grandchild', 'son', 'daughter',
  'sister', 'brother', 'sis', 'bro', 'friend', 'bestfriend', 'bff', 'boyfriend', 'girlfriend', 'wife', 'husband',
]);
/** 라벨 앞에 붙어도 관계가 바뀌지 않는 말('우리 엄마'·'my mom'·'うちの母'). */
const RELATIONSHIP_LABEL_PREFIXES = ['우리', '울', '내', '나의', 'my', 'うちの', '私の'];

/** 라벨을 비교할 꼴로 — 호환 문자를 펴고(NFKC) 소문자로, 글자·숫자 말고는(띄어쓰기·하트·문장부호) 뺀다. */
function compactRelationshipLabel(label: string): string {
  return label.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 가족·친구·연인으로 **확인된** 라벨인가 — 목록의 낱말 그 자체이거나 그 앞에 `RELATIONSHIP_LABEL_PREFIXES` 하나만
 * 붙은 것. 낱말이 **들어 있기만** 한 라벨('이웃 할머니'·'교회 오빠'·'형수'·'息子の嫁'·'ママ友'·'寮母'·
 * '近所のおばあちゃん')은 아니다 — 예전에는 부분 일치(`koreanRelationshipRegister`·정규식)라 이것들이 가족으로 잡혔다.
 */
function isConfirmedCloseRelationshipLabel(label: string): boolean {
  const compact = compactRelationshipLabel(label);
  if (!compact) return false;
  if (JA_CASUAL_RELATIONSHIP_LABELS.has(compact)) return true;
  return RELATIONSHIP_LABEL_PREFIXES.some(
    (prefix) => compact.startsWith(prefix) && JA_CASUAL_RELATIONSHIP_LABELS.has(compact.slice(prefix.length)),
  );
}

/**
 * 일본어 가족·친구·연인 문구가 です・ます 로 끝나는 문장을 냈는가(2026-10-01 3.8 평가 — 엄마→ゆい 의 약 클립이
 * '今日も元気いっぱい過ごせますように。' 로 끝났다. 42줄 중 1줄). 한국어만 어체를 검사하고 일본어는 프롬프트에만
 * 맡겨, 이런 줄이 그대로 영구 저장됐다. 일본어는 가족·친구·연인에게 タメ口 다(`JAPANESE_NATIVE_RULES`).
 *
 * ⚠ **가족·친구·연인으로 확인된 라벨만 본다**(`isConfirmedCloseRelationshipLabel` — 엄격한 허용 목록). 모르는 라벨·
 *   먼 사이('家庭教師'·'先生')·사돈('義母'·'며느리')·이웃('이웃 할머니')은 프롬프트가 です・ます 를 허용하는 '먼 사이'
 *   일 수 있어, 거절하면 세 회차 다 걸려 그 클립이 영구 실패한다. 화자 녹음이 정중체였거나(말투 분석) 사용자가
 *   정중체 문구를 확정했으면 그 말투를 따르므로 검사하지 않는다. 아이 목소리는 라벨과 무관하게 언제나 タメ口 다.
 */
export function hasJapanesePoliteEnding(
  spoken: string,
  params: { relationshipLabel?: string | null; speechStyle?: SpeechStyle | null; styleReference?: string | null },
): boolean {
  if (/polite|jondae|丁寧|敬語/i.test(params.speechStyle?.register ?? '')) return false;
  // 확정 문구가 정중체인지도 **문장 끝**으로 가린다(Codex #844) — '目を覚ます時間だよ' 처럼 사전형 동사의 'ます' 가 있는
  //   반말 문구를 정중체로 읽으면 검사가 통째로 꺼진다.
  if (params.styleReference && params.styleReference.split(/(?<=[。！？!?…])/).some(isJapanesePoliteSentence)) {
    return false;
  }
  const casual =
    params.speechStyle?.childlike === true || isConfirmedCloseRelationshipLabel(params.relationshipLabel ?? '');
  if (!casual) return false;
  return spoken.split(/(?<=[。！？!?…])/).some(isJapanesePoliteSentence);
}

/**
 * 말줄임표 뒤에 마침표·쉼표가 또 붙은 것('못 봤어….', 'okay....', 'みたい…、')을 하나로 줄인다.
 * 3.5 모델들이 '…' 뒤에 습관처럼 '.'·'、' 을 더 찍었다(2026-09-23 블라인드 판정 — 여러 프로필의
 * 날씨 클립). 낭독에서는 쉼이 두 번 겹쳐 끊겨 들린다. 생성 문구에만 쓴다 — 사용자가 직접 친
 * 문구(직접 입력 태깅)는 글자를 바꾸지 않는다.
 */
export function tidyEllipsis(text: string): string {
  return text.replace(/(…|\.\.\.)[.,、。，]+/g, '$1');
}

/**
 * 예스러운 존대 '-셔요' 를 '-세요' 로 고친다('해 보셔요' → '해 보세요'). 뜻이 같은 옛 꼴이라 글자만
 * 바꿔도 안전하다. 프롬프트로 금지해도 3.5 Flash 가 손주→조부모 문구에서 계속 냈다(2026-09-27 실측).
 * 생성 문구에만 쓴다 — 사용자가 직접 친 문구는 바꾸지 않는다.
 */
export function modernizeKoreanHonorific(text: string): string {
  return text.replace(HONORIFIC_SYEOYO_RE, '$1세요');
}

/**
 * 고쳐도 되는 `-(으)셔요` — **존대 `-시-` 가 붙은 줄기만.** 모든 `셔요` 를 바꾸면 줄기가 원래 `시` 로 끝나는
 * 낱말이 깨진다(Codex #802): `눈부셔요`→`눈부세요`, `적셔요`→`적세요`, `마셔요`→`마세요`(마시다 → '하지 마세요'
 * 가 된다), `모셔요`→`모세요`. 그래서 앞 음절을 **줄기 끝으로 확인된 것만** 받는다 — `으`(`-으시-` 는 언제나
 * 존대), 그리고 `시다` 로 끝나는 제 낱말이 없는 줄기 끝(보·가·오·하·드·주무·계·챙기·일어나·일어서·주·쉬·두·
 * 타·내·끄·지키·켜·마치·내리·고르·가지·도우). 목록에 없는 존대형은 옛 모양 그대로 남는다 — 어색할 뿐 뜻은 맞다.
 */
const HONORIFIC_SYEOYO_RE = /(으|보|가|오|하|드|무|계|기|나|서|주|쉬|두|타|내|끄|키|켜|치|리|르|지|우)셔요/g;

/** 글의 마지막 말 — 끝 문장부호를 떼고 띄어쓰기·쉼표·마침표로 끊은 마지막 조각('…시작해 보자카이.' → '보자카이', 'さあ起きよ。' → 'さあ起きよ'). */
function lastPhrase(text: string): string {
  const parts = text.replace(/[\s.!?。！？…~〜"'」』]+$/u, '').split(/[\s、，,。.!?！？…]+/u);
  return parts[parts.length - 1] ?? '';
}

/** 이 시드가 아침 인사 자체인가(`CLONE_CLIP_SEEDS` 의 인사 시드). 아침 인사를 허용하고, 줄일 때도 인사를 남긴다. */
function isGreetingSeed(seed: string | null | undefined): boolean {
  return !!seed && /아침 인사|잘 잤/.test(seed);
}

/**
 * 아침 인사·잠에서 깬 안부. 인사 시드가 아니면 어느 것도 쓰지 않는다. 합성 언어
 * (`SUPPORTED_SYNTHESIS_LANGUAGES`: ko·en·ja·fr·it) 전부 둔다 — 빠진 언어는 검사 없이 통과한다(Codex #801).
 * 프랑스어 bonjour·이탈리아어 buongiorno 는 낮 인사라 밤 약 알람에 어긋나므로 같이 막는다.
 */
const MORNING_GREETING: Record<string, RegExp> = {
  ko: /좋은 아침|잘 잤|잘 주무셨|잘 일어나셨|굿모닝/,
  en: /\bgood morning\b|(?:^|[.!?…]\s*)morning\b|\b(?:sleep|slept) well\b/i,
  ja: /おはよう|よく眠れ/,
  fr: /\bbonjour\b|\bbon matin\b|\bbonne matinée\b|\bbien dormi\b/i,
  it: /\bbuon ?giorno\b|\bbuona mattinata\b|\bdormito bene\b/i,
};
/**
 * 시드가 아침을 말하지 않는데 '아침' 낱말을 쓰면 시간을 가정한 것이다('朝のお薬', '아침 약' — 밤에도 울린다).
 * 합성 언어 전부 둔다(Codex #801).
 */
const MORNING_WORD: Record<string, RegExp> = {
  ko: /아침/,
  ja: /朝/,
  en: /\bmorning\b/i,
  fr: /\bmatin(?:ée)?\b/i,
  it: /\bmattin[ao]\b|\bstamattina\b/i,
};

/**
 * 인사가 아닌 알람에 아침 인사나 수면 안부를 넣었는가. 사전렌더 클립은 몇 시에 울릴지 모른다 —
 * 밤 9시 약 알람이 "좋은 아침이에요" 로 시작하면 안 된다. 프롬프트의 OPENER 규칙만으로는 3.5
 * Flash-Lite 가 25/210 줄에서 어겼다(2026-09-23 비교 평가).
 *
 * 인사 시드('아침 인사', '잘 잤는지')만 통째로 허용한다. 시드가 아침을 **말하기만** 하는 경우
 * ('그래도 아침은 힘차게 시작하자')는 영어의 'morning' 낱말은 두되 인사·안부는 여전히 막는다 —
 * 예전에는 이 경우를 통째로 풀어 "잘 잤니?" 가 새어 나갔다(2026-09-23 블라인드 판정).
 */
export function hasAssumedMorning(spoken: string, seed: string, targetLanguage: string): boolean {
  if (isGreetingSeed(seed)) return false;
  const pattern = MORNING_GREETING[targetLanguage];
  if (pattern?.test(spoken)) return true;
  const word = MORNING_WORD[targetLanguage];
  return !!word && !/아침/.test(seed) && word.test(spoken);
}

const UNCONTRACTED_EN =
  /\b(?:do not|does not|did not|is not|are not|was not|were not|have not|has not|had not|cannot|can not|could not|should not|must not|need not|might not|will not|would not|let us|it is|that is|there is|you are|we are|I am|you will|I will)\b/gi;

/**
 * 영어가 축약 없이 글말로 나왔는가("it is easy… You do not have to… let us just…").
 * 한 번은 강조로 쓸 수 있으니 **두 번 이상**일 때만 본다. 3.5 Flash-Lite 가 응원 시드에서 한 줄
 * 전체를 이렇게 냈다(2026-09-23 블라인드 판정 — "로봇처럼 읽힌다").
 */
export function isUncontractedEnglish(spoken: string): boolean {
  return (spoken.match(UNCONTRACTED_EN) ?? []).length >= 2;
}

/**
 * 문장 끝 음절로 어체를 가른다. 명사로 끝나는 외침('화이팅!')처럼 어느 쪽도 아닌 것은 셈하지 않는다.
 * 평서 '-다'(해라체)도 반말 쪽이다 — '-니다' 는 존댓말 목록이 먼저 잡는다.
 * ⚠ '-아/-어' 는 어간과 합쳐진 모양(일어나·가·와·챙겨·마셔·추워·돼)으로 더 자주 끝난다. 그것까지 둬야
 *   가장 흔한 반말 명령문이 빠지지 않는다.
 */
// '힘내'·'걱정 마'·'오거든'·'먹을까'·'좋군' 처럼 흔한 반말도 둔다('엄마!' 같은 호칭은 `koreanEndings` 가
// 먼저 지운다). '-까'·'-데'(오는데·좋던데) 는 문장 끝에서만 센다 — '…'·',' 앞의 '-니까'·'-는데' 는 이음
// 어미다. '합니까' 는 존댓말이 먼저 잡는다.
// 존댓말은 해요체(-요·-죠)와 합쇼체(-니다·-십시오/-시오) 둘 다다.
const KO_POLITE_END = /(요|니다|죠|시오)$/;
const KO_BANMAL_END = /(어|아|야|지|자|래|대|네|니|냐|게|걸|해|줘|봐|렴|라|다|나|가|와|겨|셔|려|켜|쳐|워|돼|내|마|거든|까|군|데)$/;
/**
 * '…' 앞에서는 **이음 어미와 헷갈리지 않는 끝만** 센다. '…' 는 문장을 끝내기도 하지만("흐리대요…
 * 이제 일어나자") 절 사이 쉼으로도 쓰여서("비 오니까… 우산 챙기세요"), 문장 끝 목록을 그대로 쓰면
 * -니까·-니·-게·-지 같은 이음 어미가 어체로 잘못 세진다.
 */
const KO_BANMAL_END_AT_PAUSE = /(어|아|야|자|래|대|네|해|줘|봐|렴|다|와|겨|셔|켜|쳐|워|돼|내)$/;

/** '합니까/습니까' — ㅂ 받침 뒤 '니까' 만 존댓말이다('오니까' 는 이음 어미). */
/** ㅂ 받침 음절 뒤에 `tail` 로 끝나는가 — '합니까/습니까', '합시다/먹읍시다' 만 존댓말이다('오니까' 는 이음 어미). */
function endsAfterBieup(word: string, tail: string): boolean {
  if (!word.endsWith(tail) || word.length <= tail.length) return false;
  const code = word.charCodeAt(word.length - tail.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 === 17;
}

type KoEnding = 'polite' | 'banmal' | null;

function koreanEnding(word: string, atPause: boolean): KoEnding {
  // '-ㅂ시다'(일어납시다) 는 '-다' 로 끝나도 존댓말이다 — 반말 목록보다 먼저 본다.
  if (KO_POLITE_END.test(word) || endsAfterBieup(word, '니까') || endsAfterBieup(word, '시다')) return 'polite';
  return (atPause ? KO_BANMAL_END_AT_PAUSE : KO_BANMAL_END).test(word) ? 'banmal' : null;
}

/**
 * 문장 첫 마디가 부름말·감탄사인가('자기야,' '우리 아들아,' '자,' '음,'). 쉼표를 경계로 보면 이것들이
 * 끝 음절(야·아·자)로 반말로 세져, 해요체로 말하는 부모의 "우리 아들아, 비 온대요" 가 섞임으로 걸린다.
 */
function isVocativeOrInterjection(part: string): boolean {
  const words = part
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^가-힣]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return true;
  const last = words[words.length - 1]!;
  // ⚠ 부름말 꼴만 건너뛴다(Codex #801). '~아·야' 로 끝나는 한 낱말은 부름말('민지야')과 서술어('괜찮아')가
  //   모양으로 구별되지 않는다 — 그래서 끝 음절로 가르지 않는다. 우리 문구의 부름말은 거의 청자 호칭이고
  //   호칭은 `koreanEndings` 가 먼저 지우므로('자기야' → '야'), 한 낱말은 **한 글자**(남은 조사·'자'·'음')나
  //   감탄사만 건너뛴다. 두 낱말은 '우리/내 + ~아·야'('우리 아들아')만.
  if (words.length === 1) return [...last].length <= 1 || KO_INTERJECTIONS.has(last);
  return words.length === 2 && /^(우리|내|울|사랑하는)$/u.test(words[0]!) && /[아야여]$/u.test(last);
}

const KO_INTERJECTIONS = new Set(['자자', '아이고', '어머', '에이', '얘', '음음', '흠']);

/**
 * 한 줄의 문장(과 '…'·',' 로 끊긴 마디) 끝 어체들. 청자 호칭은 먼저 지운다 — "할머니!" 처럼 호칭만
 * 외친 문장이 끝 음절('니')로 반말로 세지면 안 된다. 쉼표로 이은 두 절의 어체가 다른 것
 * ("비 온대요, 우산 챙겨")도 잡는다(Codex #801) — 쉼표 앞은 '…' 앞처럼 이음 어미와 헷갈리지 않는
 * 끝만 세고, 문장 첫 마디의 부름말·감탄사는 건너뛴다.
 */
type KoEndingEntry = { word: string; kind: 'polite' | 'banmal' };

/** `koreanEndings` 와 같지만 끝 낱말도 함께 — 재시도 힌트에 **틀린 낱말을 그대로** 짚어 주려고. */
function koreanEndingEntries(spoken: string, listenerTitle?: string | null): KoEndingEntry[] {
  const title = listenerTitle?.trim();
  const withoutTitle = title ? spoken.split(title).join(' ') : spoken;
  const lastWord = (s: string) => s.replace(/[\s.!?！？~…,]+$/u, '').match(/[가-힣]+$/u)?.[0] ?? '';
  return withoutTitle
    .split(/(?<=[.!?！？])\s*/)
    .flatMap((sentence) => {
      const parts = sentence.split(/[…,，]/u);
      return parts.map((part, i): KoEndingEntry | null => {
        if (i === 0 && parts.length > 1 && isVocativeOrInterjection(part)) return null;
        const word = lastWord(part);
        const kind = koreanEnding(word, i < parts.length - 1);
        return kind ? { word, kind } : null;
      });
    })
    .filter((e): e is KoEndingEntry => e !== null);
}

function koreanEndings(spoken: string, listenerTitle?: string | null): KoEnding[] {
  return koreanEndingEntries(spoken, listenerTitle).map((e) => e.kind);
}

/**
 * 한국어 한 줄 안에서 반말과 존댓말(해요체·합니다체)이 섞였는가. 시드는 존댓말 서술이라
 * 3.5 Flash-Lite 가 '-대요/-래요' 를 그대로 옮겨 "우리 딸, 흐리대요. … 커튼 열자" 처럼 섞었다
 * (2026-09-23 블라인드 판정 — 3.5 의 말투 지적 7건). 시스템 지시의 "한 줄에 한 어체" 를 코드로 지킨다.
 * 반말만 써야 하는 관계(연인·형제·친구·아이)는 존댓말 문장이, 관계를 모르는 목소리와 손아랫사람→
 * 어르신(손주·자식)은 반말 문장이 하나만 있어도 걸린다.
 */
type KoreanRegisterParams = {
  relationshipLabel?: string | null;
  listenerTitle?: string | null;
  speechStyle?: SpeechStyle | null;
  /** 사용자가 등록 미리듣기에서 확정(직접 수정 포함)한 문구. 프롬프트는 이 어체를 관계보다 앞세운다. */
  styleReference?: string | null;
};

export function hasMixedKoreanRegister(spoken: string, params: KoreanRegisterParams): boolean {
  return koreanRegisterViolation(spoken, params) !== null;
}

/**
 * 어체 규칙을 어겼으면 **틀린 쪽 낱말들**, 아니면 null. 재시도 힌트가 "어체를 맞춰라" 만 말하면 모델이
 * 같은 '-요' 를 되풀이한다(2026-09-27 실측 — 진중한 목소리의 여자친구→오빠가 세 번 다 "비가 온대요").
 * 무엇이 틀렸는지 낱말로 짚어 준다.
 */
export function koreanRegisterViolation(spoken: string, params: KoreanRegisterParams): { wrong: string[] } | null {
  // ⚠ **확정 문구의 어체가 관계보다 앞선다**(Codex #801). 프롬프트(STYLE REFERENCE)가 그 어체를 따르라고
  //   하는데 검사가 관계만 보면, 배우자에게 해요체로 고쳐 확정한 사용자의 클립이 세 번 다 거절돼 **영구
  //   실패**한다 — 같은 확정 문구가 그 목소리의 클립 전부에 실린다. 확정 문구 자체가 섞여 있으면 섞임도
  //   문제 삼지 않는다.
  const reference = params.styleReference?.trim()
    ? koreanEndings(normalizeAlarmTextWithoutTags(params.styleReference), params.listenerTitle)
    : [];
  const referencePolite = reference.includes('polite');
  const referenceBanmal = reference.includes('banmal');
  if (referencePolite && referenceBanmal) return null;
  const entries = koreanEndingEntries(spoken, params.listenerTitle);
  const politeWords = entries.filter((e) => e.kind === 'polite').map((e) => e.word);
  const banmalWords = entries.filter((e) => e.kind === 'banmal').map((e) => e.word);
  const wrong = (words: string[]) => (words.length > 0 ? { wrong: words } : null);
  // 확정 문구가 한 어체만 쓰면 **그 어체로** 고정한다(Codex #801).
  if (referencePolite) return wrong(banmalWords);
  if (referenceBanmal) return wrong(politeWords);
  const label = params.relationshipLabel?.trim() ?? '';
  const childlike = params.speechStyle?.childlike === true;
  const relationship = label ? koreanRelationshipRegister(label) : 'neutral';
  const banmalOnly = childlike || relationship === 'romantic' || relationship === 'peer';
  if (banmalOnly) return wrong(politeWords);
  // 관계를 모르거나 자유 입력 라벨이 어느 갈래에도 안 들면('동료'·'선생님') 해요체다(Codex #801).
  // 손주→조부모·자식→부모도 존대 해요체다. 등록 녹음이 반말인 화자는 그 말투를 따르므로 걸지 않는다.
  const speakerIsCasual = /banmal|casual|반말/i.test(params.speechStyle?.register ?? '');
  const politeOnly =
    relationship === 'neutral' || relationship === 'grandchild' || relationship === 'younger_to_elder';
  if (politeOnly && !speakerIsCasual) return wrong(banmalWords);
  // 부모→자식처럼 둘 다 되는 관계: 한 줄 안에서 섞였을 때만 — 적은 쪽이 튄 것이다.
  if (politeWords.length > 0 && banmalWords.length > 0) {
    return { wrong: politeWords.length <= banmalWords.length ? politeWords : banmalWords };
  }
  return null;
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
  /**
   * 목소리의 결 — 'lively'(밝고 경쾌) / 'calm'(차분·진중) / ''(모름). 알람 문구의 문장 에너지와
   * 딜리버리 태그를 이 결에 맞춘다: 경쾌한 목소리가 굳은 문장을 읽거나, 진중한 목소리가 깔깔대면
   * 그 목소리의 핵심이 깨진다(2026-09-27 사용자 지시).
   *
   * ⚠ 판단 근거는 **전사 텍스트**다(오디오 음향은 보지 않는다 — 전사만 Vertex 로 간다). 옛 행에는
   * 없으므로 `parseSpeechStyle` 이 '' 로 채운다.
   */
  energy?: '' | 'lively' | 'calm';
}

const SPEECH_STYLE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dialect: { type: 'STRING' },
    // ⚠ **enum 을 두지 않는다 — 특히 빈 문자열을 enum 에 넣지 말 것.** Gemini 3 계열은
    //   `enum: ['', 'low', 'medium', 'high']` 를 **400** 으로 거절한다("response_schema.properties
    //   [strength].enum[0]: cannot be empty", 2026-09-23 실측 — us-central1·global·us 모두). 2.5 는
    //   받아 줬다. 그런데 이 함수는 실패를 삼키고 null 을 돌려주므로, 모델만 바꿨으면 **사투리
    //   분석이 아무 경보 없이 전부 꺼졌다.** 빈 값을 빼고 세 값만 두면 표준어 화자에게도 강도를
    //   고르라고 떠미는 셈이라 enum 자체를 없앤다. 허용값 검증은 아래 파서가 한다(그 밖의 값은 '').
    strength: { type: 'STRING' },
    register: { type: 'STRING' },
    markers: { type: 'ARRAY', items: { type: 'STRING' } },
    persona: { type: 'STRING' },
    childlike: { type: 'BOOLEAN' },
    energy: { type: 'STRING' },
    confidence: { type: 'NUMBER' },
  },
  required: ['dialect', 'strength', 'register', 'markers', 'persona', 'childlike', 'energy', 'confidence'],
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
    'Also decide "energy" — the overall feel of this voice as the transcript shows it: "lively" = bright, animated, playful (exclamations, laughter, bouncy or teasing endings, fast upbeat phrasing); "calm" = low-key, composed, sincere or serious (steady measured sentences, few exclamations, gentle or reassuring or formal tone); "" when the transcript does not clearly show either. Every alarm line in this voice will be written and delivered in this energy, so only commit when it is clear.',
    'Return STRICT JSON: {"dialect":"region name in its own language, or empty string for standard","strength":"low|medium|high or empty when standard","register":"banmal|jondaemal for Korean, casual|polite otherwise","markers":["up to 5 verbatim endings/expressions/catchphrases the speaker actually used"],"persona":"one short line describing the speaker\'s verbal identity (tone, first-person pronoun, ending habits), or empty string when unremarkable","childlike":true or false,"energy":"lively|calm or empty","confidence":0.0-1.0}.',
    'Be conservative: when unsure, dialect="" and confidence low. markers must be copied from the transcript, not invented. persona describes only what the transcript shows — no guessed names or identities.',
    `TRANSCRIPT (${language}):`,
    transcript.slice(0, 2000),
  ].join('\n');
}

/**
 * 말투 분석 한 회차(전사 + 분석 + 저장)에 쓸 시간 — 시작 시각부터 센다. 등록 경로는 응답 뒤 `waitUntil` 로 돌고,
 * `waitUntil` 은 응답 뒤 **30초**에 잘린다(Cloudflare 「Context」 문서). 잘리면 상태가 'pending' 인 채 남아
 * 재시도 버튼(`failed` 만 받는다)도 못 쓴다 — 그래서 다시 묻기는 이 안에서만 하고, 남는 4초는 동의 재확인과
 * 결과 기록(DB) 몫이다.
 */
export const SPEECH_STYLE_ANALYSIS_BUDGET_MS = 26_000;

/**
 * 말투 분석이 **전송 실패**(시간 초과·네트워크·429/5xx)로 끝났을 때 다시 묻기 전에 쉬는 시간 — 최대 2번 더 묻는다.
 * 내용 실패(형식이 틀림·확신 낮음·답이 잘림)는 다시 묻지 않는다.
 */
export const SPEECH_STYLE_RETRY_DELAYS_MS: readonly number[] = [500, 1_500];

/**
 * 다시 물을 때 남아 있어야 하는 시간. 이보다 적으면 묻지 않는다 — 답이 올 시간이 없다. 2026-10-01 3.8 평가에서
 * 말투 분석 응답은 44회 모두 4.2초 안에 왔다.
 */
const SPEECH_STYLE_MIN_RETRY_WINDOW_MS = 4_000;

/**
 * 전사 텍스트에서 화자 말투(사투리·격식·특징 어미)를 분석한다. confidence 가 낮거나
 * 실패하면 null — 호출자는 저장을 건너뛴다(표준어로 동작, 사용자 미리듣기 수정으로 교정 가능).
 *
 * ⚠ **전송 실패는 마감 안에서 다시 묻는다**(2026-10-01). 상류 시간 초과 한 번이 곧 `speech_style_status='failed'`
 *   였고, 사전렌더는 'pending' 만 기다리므로 그 목소리의 클립은 **사투리 없이** 구워졌다 — 되살리는 길은 사용자가
 *   재시도 버튼을 누르는 것뿐이었다. **어느 회차도 마감을 넘기지 않는다** — 토큰 발급은 min(8초, 남은 시간), 생성
 *   요청은 min(15초, 남은 시간)이고 둘 다 그 요청을 보내기 직전에 잰다(`GenerateContentConfig.deadlineAt`). 마감이
 *   넉넉한 첫 회차는 예전 그대로(8초·15초)다. `deadlineAt` 은 호출자가 준다(`runSpeechStyleAnalysis` — 전사 전부터
 *   센다). 안 주면 지금부터 예산만큼.
 */
export async function analyzeSpeechStyleWithVertex(
  env: Env,
  transcript: string,
  language: string,
  options: { deadlineAt?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SpeechStyle | null> {
  if (!hasGeminiConfiguration(env)) return null;
  const trimmed = transcript.trim();
  if (trimmed.length < 20) return null;
  const deadlineAt = options.deadlineAt ?? Date.now() + SPEECH_STYLE_ANALYSIS_BUDGET_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const prompt = speechStylePrompt(trimmed, language);
  let raw: string;
  for (let attempt = 0; ; attempt += 1) {
    try {
      raw = await generateContentText(env, prompt, {
        responseSchema: SPEECH_STYLE_RESPONSE_SCHEMA,
        // 상한은 여기서 재지 않는다 — 토큰 발급·생성 요청 각각을 보내기 직전에 마감에서 잰다(`deadlineAt`).
        deadlineAt,
      });
      break;
    } catch (err) {
      const delay = SPEECH_STYLE_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isVertexTransportFailure(err)) return null;
      if (deadlineAt - Date.now() - delay < SPEECH_STYLE_MIN_RETRY_WINDOW_MS) return null;
      logStructured('warn', {
        at: 'vertex.speech_style_retry',
        attempt: attempt + 2,
        error: err instanceof VertexHttpError ? `http_${err.status}` : err instanceof Error ? err.name : 'unknown',
      });
      await sleep(delay);
    }
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
    // 40자 — 20자일 때 'Southern American English' 가 'Southern American En' 으로 잘려 저장되고 그대로 사전렌더
    // 프롬프트에 들어갔다(2026-10-01 3.8 평가). dialect 는 프롬프트에만 쓰인다(클라 응답에 실리지 않는다).
    const dialect = typeof parsed.dialect === 'string' ? parsed.dialect.trim().slice(0, 40) : '';
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
    const energyRaw = String((parsed as { energy?: unknown }).energy ?? '').trim();
    const energy = (energyRaw === 'lively' || energyRaw === 'calm' ? energyRaw : '') as SpeechStyle['energy'];
    if (!dialect && !register && markers.length === 0 && !persona && !childlike && !energy) return null;
    // 표준어인데 사투리 강도만 있는 모순 정리.
    return { dialect, strength: dialect ? strength : '', register, markers, persona, childlike, energy };
  } catch {
    return null;
  }
}

/** voice_profiles.speech_style JSON 컬럼 → SpeechStyle (없거나 깨졌으면 null). */
/**
 * 사용자가 고른 목소리의 결(`voice_profiles.voice_energy`)을 말투 분석 위에 얹는다 — **사용자 선택이
 * 전사 추정보다 앞선다.** 고르지 않았으면('' / NULL) 분석값을 그대로 둔다. 분석이 없어도 결만으로
 * 말투 객체를 만든다(문구 생성이 결을 받게).
 */
export function withVoiceEnergy(style: SpeechStyle | null, voiceEnergy: unknown): SpeechStyle | null {
  const chosen = voiceEnergy === 'lively' || voiceEnergy === 'calm' ? voiceEnergy : '';
  if (!chosen) return style;
  return {
    ...(style ?? { dialect: '', strength: '', register: '', markers: [], persona: '', childlike: false }),
    energy: chosen,
  };
}

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
      // 옛 행에는 없다 — '' 이면 문구 에너지를 따로 정하지 않는다.
      energy: parsed.energy === 'lively' || parsed.energy === 'calm' ? parsed.energy : '',
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
  // 폴백도 태그 없이 문장 그대로 합성한다(위 「태그」 머리말).
  return {
    text: dynamicAlarmTextReadableFallback(context),
    translated: false,
    tags: [],
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
  return 'No listener title was provided, and the relationship label does NOT tell you who the listener is — never guess a family title (mom, dad, grandmother, grandfather, son, daughter, grandson, granddaughter). Open warmly without any title at all — just start with the point (e.g. "오늘은 비 소식이 있대요…") — or use an affectionate title-free address. This is a hard requirement.';
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
/// 태그 모양의 대괄호는 거절하지 않고 벗긴다(`stripAllTags`, 2026-09-30). 막는 것은 벗길 수 없는 것뿐이다:
///  1. **전각/소괄호 지문** — `（다정하게）` `(웃으며)` 는 ElevenLabs 가 태그로 안 읽고
///     **글자 그대로 낭독**한다.
///  2. **태그 모양이 아닌 대괄호** — 아래 `hasUnknownBracketedSegment`.
/**
 * 태그 문법에 **맞지 않는 대괄호**가 남아 있는가 — 예: `[다정하게]`, `[아침 인사]`.
 *
 * ⚠ `TAG_BODY_PATTERN` 은 ASCII 소문자만 받는다(`[a-z][a-z ,-]{1,48}`). 그래서 한글
 * 대괄호 지문은 **태그로 인식되지도, 벗겨지지도 않는다**(`stripAllTags`) — 그대로 두면 합성 문구에도
 * 표시 문구에도 남아 낭독되거나 화면에 뜬다(Codex #701 P2). 그래서 명시적으로 거절한다.
 */
function hasUnknownBracketedSegment(text: string): boolean {
  // 인식되는 태그를 먼저 걷어내고, **대괄호가 한 짝이라도 남으면** 거절한다.
  // ⚠ 닫히지 않은 지문(`[다정하게 좋은 아침이에요`)은 `[...]` 쌍 매칭으로는 잡히지 않는다 —
  // 남은 낱개 `[`·`]` 까지 봐야 합성·표시 문구에 새는 것을 막는다(Codex #701 P2).
  const withoutKnownTags = text.replace(TAG_RE_GLOBAL, '');
  return withoutKnownTags.includes('[') || withoutKnownTags.includes(']');
}

/**
 * 낭독돼 버리는 지문이 있는가 — 태그 모양이 아닌 대괄호, 소괄호 지문(`(다정하게)`). 모델이 쓴 글(동적 생성·사전렌더)에만
 * 쓴다. 태그 모양의 대괄호는 이미 벗긴 뒤다(`stripAllTags`).
 */
function hasStageDirection(text: string): boolean {
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
  return false;
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

/** 번역 응답 파서. 내보내는 건 평가 스크립트(`scripts/eval-gemini-prompts.ts`)가 같은 판정을 하려는 것이다. */
export function parseAlarmTextPreparation(raw: string): {
  text: string;
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
    const parsed = JSON.parse(candidate) as { text?: unknown };
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    return { text: stripWrappingQuotes(text), parsedJson: true };
  } catch {
    return { text: stripWrappingQuotes(cleaned), parsedJson: false };
  }
}

// 동적 생성·사전렌더 응답 파서. responseSchema({text})를 1차로 읽고, 간헐 빈응답/포맷이탈 대비
// brace-slice를 최후 폴백으로 둔다(§4.7: 레거시 파서 유지).
/** 내보내는 건 평가 스크립트(`scripts/eval-gemini-prompts.ts`)가 시도마다 같은 판정을 하려는 것이다. */
export function parseDynamicAlarmTextResult(raw: string): {
  text: string;
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
    const parsed = JSON.parse(candidate) as { text?: unknown };
    const text = typeof parsed.text === 'string' ? stripWrappingQuotes(parsed.text.trim()) : '';
    return { text, parsedJson: true };
  } catch {
    return { text: stripWrappingQuotes(cleaned), parsedJson: false };
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

export function extractTags(text: string): string[] {
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

export function normalizeAlarmTextWithoutTags(text: string): string {
  return text
    .replace(new RegExp(`\\s*\\[${TAG_BODY_PATTERN}\\]\\s*`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 표시/저장 문구(messageText)용: 사용자가 직접 입력한 대괄호는 그대로 보존하고, 그 밖의 대괄호는 벗긴다.
//
// - originalText 에 대괄호가 있으면: 사용자가 친 것이므로 합성 텍스트를 그대로 쓴다(트림만).
//   '[after lunch]'·'오늘도 [happy]'·'[calm]'만 입력해도 문구가 안 지워진다.
// - 없으면: 합성 텍스트 안의 대괄호는 서버가 넣은 것(글자 웃음을 바꾼 `[laughs]`)이거나 옛 태그뿐이므로
//   위치·개수와 무관하게 모두 제거하고 내부 공백을 한 칸으로 정리한다(normalizeAlarmTextWithoutTags 재사용).
//   우리는 이제 태그를 붙이지 않지만(위 「태그」 머리말), 프리셋 경로는 빈 원문을 넘겨 이 갈래로 온다.
//
// ⚠ 사용자가 대괄호를 친 **번역**은 번역문에 서버가 넣은 웃음(`[laughs]` — 사용자가 친 ㅋㅋ 를 바꾼 것)이 섞여
//   있다. 그건 소리로만 남기고 화면에는 싣지 않는다(스펙 §9, Codex #830) — 사용자가 대괄호로 친 웃음 태그만 친
//   수만큼 남긴다(`withoutServerLaughter`). 같은 언어는 친 글 그대로라 바뀌는 것이 없다.
export function deriveAlarmDisplayText(synthesisText: string, originalText: string): string {
  if (TAG_RE.test(originalText.trim())) {
    return withoutServerLaughter(synthesisText.trim(), laughterTagCounts(originalText));
  }
  return normalizeAlarmTextWithoutTags(synthesisText);
}

/// 화면 문구용 — 사용자가 대괄호로 친 웃음 태그(`userTags`, 친 수만큼)만 남기고 나머지 웃음 태그는 벗긴다.
/// 벗길 것이 없으면 **공백까지 그대로** 돌려준다(캐시 키가 화면 문구를 그대로 싣는다 — `routes/tts.ts` `cacheKeyText`).
function withoutServerLaughter(text: string, userTags: ReadonlyMap<string, number>): string {
  const userLeft = new Map(userTags);
  const stripped = text.replace(TAG_WITH_GAP_RE_GLOBAL, (piece: string, offset: number, whole: string) => {
    if (!isLaughterTag(piece.trim())) return piece;
    const name = normalizeTag(piece.trim());
    const left = userLeft.get(name) ?? 0;
    if (left > 0) {
      userLeft.set(name, left - 1);
      return piece;
    }
    return tagGapFill(piece, offset, whole);
  });
  return stripped === text ? text : stripped.replace(/[ \t]{2,}/g, ' ').trim();
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
