/**
 * Gemini 프롬프트·모델 **비교 평가**(로컬 전용, Vertex 실호출).
 *
 * 운영이 Gemini 를 쓰는 세 경로를 **운영 함수 그대로** 부르고, 모델이 준 원문 응답도 따로 기록해
 * 자동 채점한다. 모델을 바꾸거나 프롬프트를 고칠 때 전후를 숫자로 비교하려고 만들었다
 * (2026-09-23 — `gemini-2.5-flash` 은퇴 대비 + 프롬프트 고도화).
 *
 *  - A 직접 입력 번역(`prepareAlarmTextWithVertex` 의 번역 — 같은 언어는 2026-09-30 부터 Gemini 를 부르지
 *    않는다) — 형식, 모델이 스스로 붙인 태그(운영은 벗긴다), 사용자 웃음 보존
 *  - D 유료 클론 사전렌더 문구(`generatePrerenderClipText`, 등록 미리듣기 C 도 같은 함수) —
 *    시도별 거절 사유, 날짜·숫자 누출, 호칭·어체·사투리·아이 말투, 모델이 낸 태그(운영은 벗긴다), 형식.
 *    운영 크론(`stock-clips.ts`)처럼 사람이 쓴 본보기(`humanReference`)와 **사용자가 확정한 미리듣기 문구
 *    (`styleReference` — 프로필마다 하나)** 를 함께 넘긴다. 2026-10-01 오후 전의 D 수치(`tuned-38-r2` 까지)는
 *    확정 문구 없이 잰 것이라 운영 프롬프트의 측정값이 아니다.
 *  - F 등록 녹음 말투 분석(`analyzeSpeechStyleWithVertex`) — 정답 라벨 대비 사투리·어체·아이 판정,
 *    표지(markers)가 전사에 실제로 있는가, 형식
 *
 * 사용 (packages/backend 에서):
 *   npm run eval:gemini                                   # 기본: 운영 모델(`VERTEX_MODEL`)@us 하나
 *   npm run eval:gemini -- --models gemini-3.8-flash@us --suites A,D,F --dset all --reps 2
 *   (2026-10-01 소유자 지시: 운영 모델 3.8 하나만 본다 — 다른 모델과 나란히 돌려 비교하지 않는다.)
 *   npm run eval:gemini -- --label after-prompt-v2
 *   npm run eval:gemini -- --suites D --dset core --only en-no-relationship/medication --reps 3
 *   (`--only` 는 쉼표 목록 — D 는 `프로필`·`프로필/카테고리`·`프로필/카테고리#번호`, A·F 는 id)
 *   npm run eval:gemini -- ... --client-timeout-ms 60000
 *   (**진단 전용** — 운영의 15초 abort 를 이 값으로 바꾼다. 상류가 느린 것인지 멈춘 것인지 볼 때만 쓴다.)
 * 운영 코드는 모델을 상수로만 정한다(시크릿으로 덮는 길이 없다). 다른 모델과 비교할 때는 아래 fetch
 * 가로채기가 **요청 주소의 모델만** 갈아 끼우고, 요청 본문(사고 수준 `LOW` 등)은 운영 그대로 보낸다 —
 * 그 설정을 받지 않는 모델(2.x·`LOW` 를 모르는 모델)은 400 으로 기록된다.
 * 결과: `.eval/gemini/<시각>-<label>/results.json`·`summary.md`(gitignore — 응답 원문이 들어 있다).
 *
 * 자격 증명은 `.dev.vars.dev` 의 `GOOGLE_VERTEX_CREDENTIALS_JSON` 을 읽는다 — **출력하지 않는다.**
 * ⚠ `node --experimental-strip-types` 로는 못 돌린다 — `eval:gemini` 가 esbuild 로 먼저 번들한다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  analyzeSpeechStyleWithVertex,
  extractTags,
  generatePrerenderClipText,
  isJapanesePoliteSentence,
  japaneseSentenceEnds,
  normalizeAlarmTextWithoutTags,
  parseAlarmTextPreparation,
  parseDynamicAlarmTextResult,
  prepareAlarmTextWithVertex,
  prerenderRejectionReason,
  stripAllTags,
  tidyEllipsis,
  VERTEX_MODEL,
  type SpeechStyle,
} from '../src/lib/vertex-translate.ts';
import { typedLaughterToTags } from '../src/lib/typed-laughter.ts';
import { CLONE_CLIP_SEEDS, stockReferenceLine } from '../src/lib/stock-clips.ts';
import type { Env } from '../src/types.ts';

// ---------------------------------------------------------------- 인자

const KNOWN_FLAGS = ['--models', '--suites', '--reps', '--label', '--concurrency', '--dset', '--only', '--client-timeout-ms'] as const;

function parseFlags(): Map<string, string> {
  const rest = process.argv.slice(2);
  const out = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!(KNOWN_FLAGS as readonly string[]).includes(token)) {
      throw new Error(`모르는 인자 ${token} (가능한 옵션: ${KNOWN_FLAGS.join(', ')})`);
    }
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} 에 값이 없다`);
    if (out.has(token)) throw new Error(`${token} 이 두 번 있다`);
    out.set(token, value);
    i += 1;
  }
  return out;
}

const flags = parseFlags();
const MODELS = (flags.get('--models') ?? `${VERTEX_MODEL}@us`)
  .split(',')
  .map((spec) => {
    const [model, location] = spec.split('@');
    if (!model || !location) throw new Error(`--models 는 model@location 목록이다: ${spec}`);
    return { model, location, label: `${model}@${location}` };
  });
const SUITES = new Set((flags.get('--suites') ?? 'A,D,F').split(',').map((s) => s.trim().toUpperCase()));
for (const s of SUITES) if (!['A', 'D', 'F'].includes(s)) throw new Error(`--suites 는 A,D,F 중에서: ${s}`);
const REPS = Number(flags.get('--reps') ?? '2');
if (!Number.isInteger(REPS) || REPS < 1 || REPS > 5) throw new Error('--reps 는 1~5');
const CONCURRENCY = Number(flags.get('--concurrency') ?? '6');
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 32) throw new Error('--concurrency 는 1~32');
const LABEL = (flags.get('--label') ?? 'baseline').replace(/[^a-z0-9._-]/gi, '-');
/** 쉼표로 여러 개: core,holdout,fresh,fresh2. 'all' = core,holdout(예전 호환). */
const DSETS = new Set(
  (flags.get('--dset') ?? 'core').split(',').flatMap((d) => (d === 'all' ? ['core', 'holdout'] : [d])),
);
for (const d of DSETS) {
  if (!['core', 'holdout', 'fresh', 'fresh2'].includes(d)) {
    throw new Error('--dset 는 core|holdout|fresh|fresh2|all (쉼표로 여러 개)');
  }
}
/** 한 조합만 다시 볼 때 — 비어 있으면 전부. D 키는 `프로필/카테고리#번호`, A·F 는 id. */
const ONLY = (flags.get('--only') ?? '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
const picked = (key: string) =>
  ONLY.length === 0 || ONLY.some((p) => key === p || key.startsWith(`${p}/`) || key.startsWith(`${p}#`));
/** 진단 전용 — 운영의 15초 abort 를 바꾼다. 이 값을 주면 결과는 운영 재현이 아니다(요약 머리에 적는다). */
const CLIENT_TIMEOUT_MS = flags.has('--client-timeout-ms') ? Number(flags.get('--client-timeout-ms')) : null;
if (CLIENT_TIMEOUT_MS !== null && (!Number.isInteger(CLIENT_TIMEOUT_MS) || CLIENT_TIMEOUT_MS < 1_000 || CLIENT_TIMEOUT_MS > 300_000)) {
  throw new Error('--client-timeout-ms 는 1000~300000');
}

// ---------------------------------------------------------------- 자격 증명(출력 금지)

const backendRoot = process.cwd();
function readCredentialsJson(): string {
  const env = readFileSync(resolve(backendRoot, '.dev.vars.dev'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('GOOGLE_VERTEX_CREDENTIALS_JSON='));
  if (!line) throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON not in .dev.vars.dev');
  const v = line.slice('GOOGLE_VERTEX_CREDENTIALS_JSON='.length).trim();
  for (const cand of [v, v.replace(/^'(.*)'$/s, '$1'), v.replace(/^"(.*)"$/s, '$1')]) {
    try {
      const parsed = JSON.parse(cand);
      if (typeof parsed === 'string') {
        JSON.parse(parsed);
        return parsed;
      }
      return cand;
    } catch {
      /* 다음 후보 */
    }
  }
  throw new Error('GOOGLE_VERTEX_CREDENTIALS_JSON 을 읽지 못했다(값은 출력하지 않는다)');
}
const CREDENTIALS_JSON = readCredentialsJson();
const envFor = (m: (typeof MODELS)[number]): Env =>
  ({
    GOOGLE_VERTEX_CREDENTIALS_JSON: CREDENTIALS_JSON,
    GOOGLE_VERTEX_LOCATION: m.location,
  }) as unknown as Env;
/**
 * 지금 평가하는 모델 — 아래 fetch 가로채기가 요청 주소의 `VERTEX_MODEL` 을 이것으로 바꾼다. 모델은
 * 실행부에서 **차례로** 돌므로(한 모델의 스위트가 다 끝난 뒤 다음 모델) 변수 하나로 충분하다.
 */
let evalModel: string = VERTEX_MODEL;

// ---------------------------------------------------------------- 원문 응답 기록

type RawCall = {
  status: number;
  finishReason: string | null;
  text: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  error: string | null;
  /** 'auth' = OAuth 토큰 발급 실패(생성 요청까지 가지 못했다). */
  stage?: 'auth';
};
const callLog = new AsyncLocalStorage<RawCall[]>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('oauth2.googleapis.com/token')) {
    // 토큰 발급 **실패**도 시도 하나로 센다(Codex #801) — 안 세면 인증 장애 중 시도 수·지연이 0 으로 잡힌다.
    // 성공한 발급은 생성 시도가 아니라서 남기지 않는다.
    const started = Date.now();
    const fail = (status: number, error: string) =>
      callLog.getStore()?.push({
        status,
        finishReason: null,
        text: '',
        latencyMs: Date.now() - started,
        inputTokens: null,
        outputTokens: null,
        thoughtTokens: null,
        error,
        stage: 'auth',
      });
    try {
      const res = await realFetch(input, init);
      if (!res.ok) fail(res.status, `auth ${res.status}`);
      return res;
    } catch (err) {
      fail(0, String(err).slice(0, 200));
      throw err;
    }
  }
  if (!url.includes(':generateContent')) return realFetch(input, init);
  const operational = `/models/${VERTEX_MODEL}:generateContent`;
  // 운영 주소가 아니면 갈아 끼우지 않고 멈춘다 — 조용히 운영 모델로 평가하면 비교표가 거짓이 된다.
  if (!url.includes(operational)) throw new Error(`예상하지 못한 생성 주소다: ${url}`);
  const target = url.replace(operational, `/models/${evalModel}:generateContent`);
  const started = Date.now();
  const bucket = callLog.getStore();
  let res: Response;
  try {
    res = await realFetch(target, CLIENT_TIMEOUT_MS ? { ...init, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) } : init);
  } catch (err) {
    // 타임아웃(운영 클라이언트의 15초 abort)·네트워크 실패도 **시도 하나**로 남긴다(Codex #801) —
    // 안 남기면 재시도 끝에 성공한 문구가 1회차 통과로 잡히고 지연 요약도 느린 쪽에 유리해진다.
    bucket?.push({
      status: 0,
      finishReason: null,
      text: '',
      latencyMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      thoughtTokens: null,
      error: String(err).slice(0, 200),
    });
    throw err;
  }
  if (bucket) {
    const body = await res.clone().text();
    let j: {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      error?: { message?: string };
    } = {};
    try {
      j = JSON.parse(body);
    } catch {
      /* 비 JSON */
    }
    const cand = j.candidates?.[0];
    bucket.push({
      status: res.status,
      finishReason: cand?.finishReason ?? null,
      text: (cand?.content?.parts ?? [])
        .filter((p) => p.thought !== true)
        .map((p) => p.text ?? '')
        .join(''),
      latencyMs: Date.now() - started,
      inputTokens: j.usageMetadata?.promptTokenCount ?? null,
      outputTokens: j.usageMetadata?.candidatesTokenCount ?? null,
      thoughtTokens: j.usageMetadata?.thoughtsTokenCount ?? null,
      error: res.ok ? null : String(j.error?.message ?? res.status).slice(0, 200),
    });
  }
  return res;
}) as typeof fetch;
// 운영 코드의 호출마다 로그 한 줄은 평가 출력에서 뺀다.
const realLog = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('"at":"vertex.generate"')) return;
  realLog(...args);
};

// ---------------------------------------------------------------- 공통 채점 도구

/** 모델이 스스로 낸 태그 — 운영은 붙이게 하지 않고, 내면 벗긴다. 사용자 웃음(`[laughs]`)은 뺀다. */
const modelTags = (text: string) => extractTags(text).filter((tag) => tag !== 'laughs');

/** 날짜·요일·시각·숫자·온도·지명 누출. 사전렌더 규칙이 금지하는 것들. */
function leaks(spoken: string, language: string): string[] {
  const found: string[] = [];
  // 'PM2.5' 는 일본어 프롬프트가 권하는 표현이라 일본어에서만 숫자로 세지 않는다(Codex #801) — 다른
  // 언어 프롬프트는 수치를 금지하므로 거기서는 누출이다.
  const digitsIn = language === 'ja' ? spoken.replace(/PM\s?2[.．]5/giu, '') : spoken;
  if (/[0-9０-９]/.test(digitsIn)) found.push('digit');
  if (language === 'ko') {
    if (/[월화수목금토일]요일/.test(spoken)) found.push('weekday');
    if (/(일|이|삼|사|오|육|칠|팔|구|십)+\s?월\s?(일|이|삼|사|오|육|칠|팔|구|십)+\s?일/.test(spoken)) found.push('date');
    if (/(서울|부산|대구|인천|광주|대전|울산|제주|한국|일본|미국)/.test(spoken)) found.push('place');
    if (/(도씨|섭씨|퍼센트|%)/.test(spoken)) found.push('unit');
  } else if (language === 'ja') {
    if (/[月火水木金土日]曜/.test(spoken)) found.push('weekday');
    if (/(東京|大阪|京都|福岡|日本|韓国|アメリカ)/.test(spoken)) found.push('place');
    // 숫자 + 단위만 — 二度寝(다시 잠들기)·一度に(한꺼번에) 같은 관용구를 온도로 세지 않는다.
    if (/[0-9０-９]+\s?(度|パーセント|%)/.test(spoken)) found.push('unit');
  } else {
    if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(spoken)) found.push('weekday');
    if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(spoken)) found.push('date');
    if (/\b(degrees?|percent|°)/i.test(spoken)) found.push('unit');
    if (/\b(seoul|tokyo|new york|korea|japan)\b/i.test(spoken)) found.push('place');
  }
  return found;
}

/** 'string[]' 은 원소 타입까지 본다(말투 분석 markers — 운영 파서는 문자열이 아닌 원소를 조용히 버린다). */
type FieldType = 'string' | 'number' | 'boolean' | 'string[]';
/**
 * 응답이 **지금 스키마대로** 왔는가. 객체이기만 하면 통과시키면 `{}`·`{"text":123}` 도 형식 정답이
 * 되어 모델 비교가 부풀려진다(Codex #801). 필수 필드는 타입까지 보고, 스키마에 없는 필드(옛 `tag`
 * 포함)는 여분으로 센다.
 */
function rawJsonShape(
  raw: string,
  required: Record<string, FieldType>,
): { ok: boolean; extraKeys: string[]; keys: string[] } {
  try {
    const parsed = JSON.parse(raw.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, extraKeys: [], keys: [] };
    const keys = Object.keys(parsed);
    const typeOk = Object.entries(required).every(([k, t]) =>
      t === 'string[]'
        ? Array.isArray(parsed[k]) && (parsed[k] as unknown[]).every((v) => typeof v === 'string')
        : typeof parsed[k] === t,
    );
    return { ok: typeOk, keys, extraKeys: keys.filter((k) => !(k in required)) };
  } catch {
    return { ok: false, extraKeys: [], keys: [] };
  }
}
const TEXT_ONLY: Record<string, FieldType> = { text: 'string' };

async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
      done += 1;
      if (done % 20 === 0 || done === items.length) process.stderr.write(`  ${done}/${items.length}\r`);
    }
  });
  await Promise.all(workers);
  process.stderr.write('\n');
  return out;
}

// ---------------------------------------------------------------- A 직접 입력 번역

/**
 * `holdout: true` 는 `--dset holdout`(또는 all)일 때만 돈다 — 2026-10-01 번역 지시(한→영 '우리'·'힘내', 채팅식 입력의
 * 문장부호)를 고친 뒤, 그 지시가 **고친 입력에만 맞춘 것이 아닌지** 보려고 둔 반례다(진짜 복수 '우리 가족' 등).
 */
const A_INPUTS: { id: string; text: string; lang: 'ko' | 'en' | 'ja'; holdout?: boolean }[] = [
  { id: 'ko-mom-cheer', text: '엄마, 일어날 시간이야. 오늘도 힘내!', lang: 'ko' },
  { id: 'ko-meeting-time', text: '일어나세요! 7시 30분 회의 있어요.', lang: 'ko' },
  { id: 'ko-meds-casual', text: '약 먹을 시간이야 ㅎㅎ 까먹지 말고', lang: 'ko' },
  { id: 'ko-grandma-hospital', text: '할머니 좋은 아침이에요~ 오늘 병원 가시는 날이에요.', lang: 'ko' },
  { id: 'ko-late-shout', text: '야 일어나 지각한다!!', lang: 'ko' },
  { id: 'ko-birthday', text: '오늘은 우리 딸 생일! 축하해 사랑해', lang: 'ko' },
  { id: 'en-vitamins', text: 'Good morning! Time to get up and take your vitamins.', lang: 'en' },
  { id: 'en-dentist', text: "Hey sleepyhead, you've got a dentist appointment at 9.", lang: 'en' },
  { id: 'en-game', text: 'Rise and shine, champ. Big game today! haha', lang: 'en' },
  { id: 'ja-ganbarou', text: 'おはよう。今日も一日がんばろうね。', lang: 'ja' },
  { id: 'ja-train', text: '起きて！8時の電車に遅れるよ。', lang: 'ja' },
  { id: 'ja-grandma-meds', text: 'おばあちゃん、お薬の時間ですよ〜', lang: 'ja' },
  { id: 'ko-family-trip', text: '오늘 우리 가족 여행 가는 날! 늦지 말고 일어나', lang: 'ko', holdout: true },
  { id: 'ko-son-exam', text: '우리 아들 오늘 시험 잘 봐 힘내 ㅋㅋ', lang: 'ko', holdout: true },
  { id: 'ko-team-cheer', text: '우리 팀 오늘 발표 있는 날 다들 힘내자', lang: 'ko', holdout: true },
  { id: 'en-chat-gym', text: 'gym time lol dont skip it again', lang: 'en', holdout: true },
];
/** 번역 방향 — 세 언어를 한 바퀴 돈다. */
const A_TARGET: Record<'ko' | 'en' | 'ja', 'ko' | 'en' | 'ja'> = { ko: 'en', en: 'ja', ja: 'ko' };

async function runA(m: (typeof MODELS)[number]) {
  const inputs = A_INPUTS.filter((input) => DSETS.has(input.holdout ? 'holdout' : 'core') && picked(input.id));
  const jobs = inputs.flatMap((input) => Array.from({ length: REPS }, (_, rep) => ({ input, rep })));
  return pool(jobs, CONCURRENCY, async ({ input, rep }) => {
    const calls: RawCall[] = [];
    let result: { text: string; tags: string[]; provider: string } | null = null;
    let error: string | null = null;
    await callLog.run(calls, async () => {
      try {
        result = await prepareAlarmTextWithVertex(envFor(m), input.text, {
          targetLanguage: A_TARGET[input.lang],
          sourceLanguage: input.lang,
          translate: true,
          speakTypedLaughter: true,
        });
      } catch (e) {
        error = (e as Error).message;
      }
    });
    const r = result as { text: string; tags: string[]; provider: string } | null;
    const raw = calls[0]?.text ?? '';
    const shape = rawJsonShape(raw, TEXT_ONLY);
    const rawParsed = raw ? parseAlarmTextPreparation(raw) : null;
    const typedLaugh = typedLaughterToTags(input.text) !== input.text;
    return {
      suite: 'A',
      model: m.label,
      id: input.id,
      dset: input.holdout ? 'holdout' : 'core',
      rep,
      input: input.text,
      target: A_TARGET[input.lang],
      output: r?.text ?? null,
      error,
      rawText: raw,
      raw: {
        status: calls[0]?.status ?? null,
        finishReason: calls[0]?.finishReason ?? null,
        jsonOk: shape.ok,
        extraKeys: shape.extraKeys,
        // 지시("새 대괄호를 넣지 말 것")를 어기고 모델이 붙인 태그 — 운영은 벗긴다.
        modelTags: rawParsed ? modelTags(rawParsed.text) : [],
        latencyMs: calls[0]?.latencyMs ?? null,
        inputTokens: calls[0]?.inputTokens ?? null,
        outputTokens: calls[0]?.outputTokens ?? null,
        thoughtTokens: calls[0]?.thoughtTokens ?? null,
      },
      final: {
        ok: r !== null,
        tags: r ? extractTags(r.text) : [],
        // 사용자가 친 글자 웃음이 번역문에 소리(`[laughs]`)로 남았는가.
        laughKept: typedLaugh ? Boolean(r && /\[laughs\]/i.test(r.text)) : null,
      },
    };
  });
}

// ---------------------------------------------------------------- D 사전렌더 문구

type Profile = {
  id: string;
  lang: 'ko' | 'en' | 'ja';
  relationshipLabel: string | null;
  listenerTitle: string | null;
  speechStyle?: SpeechStyle | null;
  /**
   * 사용자가 등록 때 듣고 확정한 미리듣기 문구(`voice_profiles.preview_text`) — 운영 크론이 거의 모든 클론에
   * `styleReference` 로 넘긴다(`stock-clips.ts`). 그 문구는 인사 시드로 만든 줄이라(`routes/tts.ts` 첫 미리듣기)
   * 여기도 인사 줄이다. 대부분은 3.8·3.5 가 그 프로필로 실제로 낸 인사 줄에서 태그만 뺀 것이다.
   */
  styleReference: string;
  /**
   * 'standard_ref' — 말투 분석은 사투리인데 확정 문구가 표준어다(사용자가 고쳤거나 분석이 실패한 채 만들어졌다).
   * 확정 문구가 분석을 이기므로 **사투리가 없어야** 맞다(스펙 §4-2).
   */
  expect?: 'polite' | 'banmal' | 'dialect' | 'standard_ref' | 'child';
};
const GYEONGSANG: SpeechStyle = {
  dialect: '경상',
  strength: 'high',
  register: 'banmal',
  markers: ['~카이', '~나', '~래이', '묵었나'],
  persona: '경상도 사투리를 진하게 쓰는 다정한 어른',
  childlike: false,
};
const KANSAI: SpeechStyle = {
  dialect: '関西',
  strength: 'medium',
  register: 'casual',
  markers: ['ほんまに', 'やねん', 'あかんで', 'ほな'],
  persona: '関西弁で話す世話好きな母親',
  childlike: false,
};
const CHILD: SpeechStyle = {
  dialect: '',
  strength: '',
  register: 'banmal',
  markers: ['~했어', '~해'],
  persona: '유치원생 아이',
  childlike: true,
};
const D_FULL_PROFILES: Profile[] = [
  { id: 'ko-mom-to-daughter', lang: 'ko', relationshipLabel: '엄마', listenerTitle: '우리 딸', expect: 'banmal', styleReference: '우리 딸, 좋은 아침이야… 밤새 잘 잤어? 오늘 하루도 기분 좋게 일어나서 힘차게 시작해 보자.' },
  { id: 'en-mom-to-sweetie', lang: 'en', relationshipLabel: 'mom', listenerTitle: 'sweetie', styleReference: "Good morning, sweetie… did you sleep well? Let's get up and start today on a happy note." },
  { id: 'ja-mom-to-yui', lang: 'ja', relationshipLabel: '母', listenerTitle: 'ゆい', styleReference: 'ゆい、おはよう…よく眠れた？今日も気持ちのいい一日にしようね、さあ起きよ。' },
];
const D_SUBSET_PROFILES: Profile[] = [
  { id: 'ko-granddaughter-to-grandma', lang: 'ko', relationshipLabel: '손녀', listenerTitle: '할머니', expect: 'polite', styleReference: '할머니, 좋은 아침이에요… 밤새 안녕히 주무셨어요? 오늘 하루도 기분 좋게 일어나 보세요.' },
  { id: 'ko-boyfriend-to-jagi', lang: 'ko', relationshipLabel: '남자친구', listenerTitle: '자기', expect: 'banmal', styleReference: '자기야, 좋은 아침… 밤새 잘 잤어? 오늘 하루도 기분 좋게 시작해 보자, 일어나야지.' },
  // 사투리 프로필은 확정 문구가 사투리인 것(운영의 보통 경우)과 표준어인 것 둘 다 잰다.
  { id: 'ko-mom-gyeongsang', lang: 'ko', relationshipLabel: '엄마', listenerTitle: '우리 아들', speechStyle: GYEONGSANG, expect: 'dialect', styleReference: '우리 아들, 좋은 아침이다… 밤새 편안하게 잘 잤나? 얼른 털고 일어나가 오늘도 기분 좋게 시작해 보자카이.' },
  { id: 'ko-mom-gyeongsang-stdref', lang: 'ko', relationshipLabel: '엄마', listenerTitle: '우리 아들', speechStyle: GYEONGSANG, expect: 'standard_ref', styleReference: '우리 아들, 좋은 아침이야… 밤새 편안하게 잘 잤어? 얼른 털고 일어나서 오늘도 기분 좋게 시작해 보자.' },
  { id: 'ko-child-to-dad', lang: 'ko', relationshipLabel: '딸', listenerTitle: '아빠', speechStyle: CHILD, expect: 'child', styleReference: '아빠아, 잘 잤어? 오늘 하루도 기분 조은 하루 보내자, 일어나아!' },
  { id: 'ko-no-relationship', lang: 'ko', relationshipLabel: null, listenerTitle: null, styleReference: '좋은 아침이에요, 밤새 잘 주무셨어요? 오늘 하루도 기분 좋게 시작해 봐요.' },
  { id: 'ja-okan-kansai', lang: 'ja', relationshipLabel: 'おかん', listenerTitle: 'たろう', speechStyle: KANSAI, expect: 'dialect', styleReference: 'たろう、おはようさん…ぐっすり眠れたか？今日もええ一日にしよな、ほな起きよか。' },
  { id: 'ja-okan-kansai-stdref', lang: 'ja', relationshipLabel: 'おかん', listenerTitle: 'たろう', speechStyle: KANSAI, expect: 'standard_ref', styleReference: 'たろう、おはよう…ぐっすり眠れた？今日もいい一日にしようね、さあ起きよう。' },
  { id: 'en-no-relationship', lang: 'en', relationshipLabel: null, listenerTitle: null, styleReference: "Morning… did you sleep well? Let's take it easy and start today off on a good note." },
];
/** 튜닝(v2~v5)에 한 번도 쓰지 않은 관계·호칭. 여기서도 좋아야 과적합이 아니다. */
const D_HOLDOUT_PROFILES: Profile[] = [
  { id: 'ko-dad-to-son', lang: 'ko', relationshipLabel: '아빠', listenerTitle: '우리 아들', expect: 'banmal', styleReference: '우리 아들, 좋은 아침… 밤새 잘 잤어? 기지개 시원하게 켜고 오늘 하루도 기분 좋게 시작해 보자.' },
  { id: 'ko-grandson-to-grandpa', lang: 'ko', relationshipLabel: '손자', listenerTitle: '할아버지', expect: 'polite', styleReference: '할아버지, 좋은 아침이에요. 밤새 편안히 잘 주무셨어요? 오늘 하루도 기분 좋게 시작해 봐요.' },
  { id: 'ko-friend-to-minji', lang: 'ko', relationshipLabel: '친구', listenerTitle: '민지야', expect: 'banmal', styleReference: '민지야, 좋은 아침… 밤새 편하게 잘 잤어? 오늘 하루도 기분 좋게 같이 시작해 보자.' },
  { id: 'en-dad-to-buddy', lang: 'en', relationshipLabel: 'dad', listenerTitle: 'buddy', styleReference: "Morning, buddy… sleep well? Let's get up and start today off on a good note." },
  { id: 'ja-grandchild-to-grandma', lang: 'ja', relationshipLabel: '孫', listenerTitle: 'おばあちゃん', styleReference: 'おばあちゃん、おはよう…よく眠れた？今日も気持ちのいい一日にしようね、さあ起きて。' },
  { id: 'ja-friend-to-saki', lang: 'ja', relationshipLabel: '友達', listenerTitle: 'さき', styleReference: 'さき、おはよう…よく眠れた？今日も気持ちよく一日を始めようね。' },
];
/**
 * v6 이후에 만든 관계·호칭과 시드 조합. **튜닝 판정에 한 번도 쓰지 않았다** — 마지막 모델 비교
 * (같은 프롬프트, 모델만 다르게)는 여기서 한다. 영어는 앞선 판정에서 가장 약했으므로 넉넉히 둔다.
 */
const D_FRESH_PROFILES: Profile[] = [
  { id: 'ko-wife-to-yeobo', lang: 'ko', relationshipLabel: '아내', listenerTitle: '여보', expect: 'banmal', styleReference: '여보, 잘 잤어? 오늘 하루도 우리 기분 좋게 시작해 보자.' },
  { id: 'ko-daughter-to-mom', lang: 'ko', relationshipLabel: '딸', listenerTitle: '엄마', expect: 'polite', styleReference: '엄마, 어제 좋은 꿈 꾸고 잘 주무셨어요? 오늘도 기분 좋게 일어나서 활기찬 하루 시작해 봐요.' },
  { id: 'ko-unni-to-sujin', lang: 'ko', relationshipLabel: '언니', listenerTitle: '수진아', expect: 'banmal', styleReference: '우리 수진아, 잘 잤어? 오늘도 기분 좋게 시작하자, 얼른 일어나!' },
  { id: 'en-grandma-to-sam', lang: 'en', relationshipLabel: 'grandma', listenerTitle: 'Sam', styleReference: "Good morning, Sam… did you sleep well? Take your time getting up, and let's make today a really good day." },
  { id: 'en-wife-to-honey', lang: 'en', relationshipLabel: 'wife', listenerTitle: 'honey', styleReference: "Good morning, honey… did you sleep well? Let's start the day with a smile." },
  { id: 'en-sister-to-jake', lang: 'en', relationshipLabel: 'sister', listenerTitle: 'Jake', styleReference: "Morning, Jake… did you sleep well? Let's start the day with a smile and make it a great one." },
  { id: 'en-daughter-to-dad', lang: 'en', relationshipLabel: 'daughter', listenerTitle: 'Dad', styleReference: "Good morning, Dad… did you sleep well? Let's start the day with a smile." },
  { id: 'ja-dad-to-haruto', lang: 'ja', relationshipLabel: '父', listenerTitle: 'はると', styleReference: 'はると、よく眠れた？今日も気持ちよくスタートして、いい一日にしようね。' },
  { id: 'ja-wife-to-kenta', lang: 'ja', relationshipLabel: '妻', listenerTitle: 'けんた', styleReference: 'けんた、よく眠れた？今日も気持ちよく一日をスタートしようね。' },
];
/**
 * v7 을 확인하려고 만든 세 번째 세트. fresh 는 v6 판정 코멘트를 보고 v7 을 고쳤으므로 다시 쓰지 않는다.
 */
const D_FRESH2_PROFILES: Profile[] = [
  { id: 'ko-daughterinlaw-to-eomeonim', lang: 'ko', relationshipLabel: '며느리', listenerTitle: '어머님', expect: 'polite', styleReference: '어머님, 잘 주무셨어요? 오늘도 기분 좋게 하루 시작하세요.' },
  { id: 'ko-grandpa-to-granddaughter', lang: 'ko', relationshipLabel: '할아버지', listenerTitle: '우리 손녀', expect: 'banmal', styleReference: '우리 손녀, 잘 잤어? 할아버지는 우리 손녀가 오늘 하루도 기분 좋게 시작하면 좋겠어.' },
  { id: 'ko-dongsaeng-to-hyeong', lang: 'ko', relationshipLabel: '동생', listenerTitle: '형', expect: 'banmal', styleReference: '형, 잘 잤어? 오늘도 좋은 하루 시작하자.' },
  { id: 'en-boyfriend-to-babe', lang: 'en', relationshipLabel: 'boyfriend', listenerTitle: 'babe', styleReference: "Hey babe, good morning. Did you sleep well? Let's make today a really good one." },
  { id: 'en-grandpa-to-kiddo', lang: 'en', relationshipLabel: 'grandpa', listenerTitle: 'kiddo', styleReference: "Hey kiddo, hope you slept well. Let's start the day feeling good, okay?" },
  { id: 'en-friend-to-alex', lang: 'en', relationshipLabel: 'friend', listenerTitle: 'Alex', styleReference: "Hey Alex, good morning. Hope you slept well, let's have a great day today." },
  { id: 'en-son-to-mom', lang: 'en', relationshipLabel: 'son', listenerTitle: 'Mom', styleReference: "Hey Mom, I hope you slept well. Let's make today a really good one, okay?" },
  { id: 'ja-grandpa-to-hinata', lang: 'ja', relationshipLabel: '祖父', listenerTitle: 'ひなた', styleReference: 'ひなた、おはよう。よく眠れたかな？今日も一日、気持ちよく始めようね。' },
  { id: 'ja-sister-to-yuto', lang: 'ja', relationshipLabel: '姉', listenerTitle: 'ゆうと', styleReference: 'ゆうと、おはよう！よく眠れたかな？今日も一日、楽しいこといっぱいの一日にしようね。' },
  { id: 'ja-boyfriend-to-misaki', lang: 'ja', relationshipLabel: '彼氏', listenerTitle: 'みさき', styleReference: 'みさき、おはよう。よく眠れた？今日も一日、楽しく過ごそうね。' },
];
function fresh2Seeds() {
  const pick = (category: string, index: number) => {
    const group = CLONE_CLIP_SEEDS.find((g) => g.category === category)!;
    return { category, index, seed: group.seeds[index]! };
  };
  return [
    pick('greeting', 0),
    pick('weather', 0),
    pick('weather', 3),
    pick('weather', 4),
    pick('weather', 6),
    pick('weather', 8),
    pick('medication', 0),
    pick('fortune', 0),
    pick('fortune', 2),
    pick('fortune', 4),
    pick('cheer', 0),
    pick('cheer', 1),
  ];
}
function freshSeeds() {
  const pick = (category: string, index: number) => {
    const group = CLONE_CLIP_SEEDS.find((g) => g.category === category)!;
    return { category, index, seed: group.seeds[index]! };
  };
  return [
    pick('greeting', 0),
    pick('weather', 1),
    pick('weather', 2),
    pick('weather', 5),
    pick('weather', 7),
    pick('medication', 1),
    pick('medication', 2),
    pick('fortune', 1),
    pick('fortune', 3),
    pick('cheer', 2),
  ];
}
function subsetSeeds() {
  const pick = (category: string, index: number) => {
    const group = CLONE_CLIP_SEEDS.find((g) => g.category === category)!;
    const i = index < 0 ? group.seeds.length + index : index;
    return { category, index: i, seed: group.seeds[i]! };
  };
  return [pick('greeting', 0), pick('weather', 0), pick('weather', -1), pick('medication', 0), pick('fortune', 0), pick(CLONE_CLIP_SEEDS.find((g) => g.category === 'cheer') ? 'cheer' : 'love', 0)];
}
function allSeeds() {
  return CLONE_CLIP_SEEDS.flatMap((g) => g.seeds.map((seed, index) => ({ category: g.category, index, seed })));
}

const POLITE_KO = /(요|세요|니다|시죠|께요|죠)[.!?~…\s]*$/;
/** 반말로 끝나는 문장(해/야/어/아/지/자/래/네/니/냐/게/걸 + 문장부호). 이어지는 절(는데…, 니까,)은 세지 않는다. */
const BANMAL_KO = /(해|야|어|아|지|자|래|네|니|냐|게|걸|다)[!?.~]+$/;
/**
 * 반말 문장인가. ⚠ '다' 가 BANMAL_KO 에 있어서 '합니다.' 도 반말로 잡혔다 — 합쇼체 한 문장이 섞이면
 * 존대 프로필이 '존대 전 문장' 에서 떨어졌다(2026-10-01 채점 오류). 존대 어미로 끝나면 반말이 아니다.
 */
const isBanmalEnding = (e: string) => BANMAL_KO.test(e) && !POLITE_KO.test(e);

/**
 * 사투리별 **표준어에는 나오지 않는** 어미·낱말. 프로필 markers 는 분석이 그 화자의 녹음에서 뽑은 몇 개뿐이라,
 * 모델이 같은 사투리를 다른 어미로 쓰면(関西: ええ/へん/おおきに) 0 으로 잡혔다(2026-10-01 3.8 평가 채점 오류).
 * ⚠ 보수적으로만 넣는다 — 표준어에도 나오는 조각은 앞뒤 조건을 붙이거나 뺀다: 일본어 'ええ'(네)·'へん'
 * (たいへん/このへん/そこらへん)·'や'(いや/〜しようや)·'やけど'(화상), 한국어 '나'·'아이가'(주어)·'묵'(침묵)·
 * '제'(이제/문제)·'예'(명예). 여기 걸리면 사투리가 **있다**는 뜻이고, 안 걸려도 없다는 증명은 아니다.
 */
const KO_END = String.raw`(?=[\s.,!?~…]|$)`;
const JA_END = String.raw`(?=[\s。、！？!?…〜ー」』]|$)`;
const DIALECT_LEXICON: Record<string, { label: string; re: RegExp }[]> = {
  경상: [
    { label: '~카이', re: new RegExp(`카이${KO_END}`, 'u') },
    { label: '~아이가', re: /아이가(?=[.,!?~…]|$)/u },
    { label: '~아이다', re: /아이다(?=[.,!?~…]|$)/u },
    { label: '~래이', re: /래이/u },
    { label: '~대이', re: new RegExp(`대이${KO_END}`, 'u') },
    { label: '~데이', re: new RegExp(`(?<![스디])데이${KO_END}`, 'u') },
    { label: '묵-(먹-)', re: /(?<![침묵])묵(?:었|고|어|자|으|는)/u },
    { label: '~노?', re: /[가-힣]노\?/u },
    { label: '~꼬?', re: /[가-힣]꼬\?/u },
    { label: '~능교', re: new RegExp(`[능는]교${KO_END}`, 'u') },
    { label: '~니더/심더', re: new RegExp(`[니심]더${KO_END}`, 'u') },
    { label: '~이소/시소/하소', re: new RegExp(`(?:이|시|하)소${KO_END}`, 'u') },
    { label: '~예', re: new RegExp(`(?<=[가-힣])(?<![명원노도학기공문연유수무서])예${KO_END}`, 'u') },
    { label: '~제', re: new RegExp(`(?:맞|좋|그렇|했|알|있|됐|봤|쉽|춥|덥|았|었|겠)제${KO_END}`, 'u') },
    { label: '~기라', re: new RegExp(`기라${KO_END}`, 'u') },
    // '~라 카네'·'~다 카니까'(하네·하니까). 카네이션·스카- 는 거른다.
    { label: '카네/카니까/카면', re: /(?<!스)카(?:네(?!이)|니까|면|믄)/u },
    { label: '온나(오너라)', re: /온나(?!라)/u },
    { label: '무라(먹어라)', re: new RegExp(`무라${KO_END}`, 'u') },
    { label: '그라-', re: /그라[믄모노]/u },
    { label: '억수로', re: /억수로/u },
    { label: '단디', re: /단디/u },
    { label: '퍼뜩', re: /퍼뜩/u },
    { label: '쪼매', re: /쪼매/u },
    { label: '우째/우짜', re: /우[째짜]/u },
    { label: '어데', re: /어데/u },
    { label: '문디/가시나/머스마/얼라', re: /문디|가시나|머스마|얼라/u },
  ],
  // 경상 프로필에 **다른 사투리가 섞였는가** 를 보려고 둔다(2026-10-01 3.8 — 경상 문구가 '없응께' 를 썼다).
  // '아따'·'겁나' 는 경상에서도 쓰거나 전국 구어라 넣지 않는다.
  전라: [
    { label: '~응께/당께/랑께', re: /[응닝당랑]께/u },
    // '가는디'·'좋은디'(=는데). 표준어 '어디' 는 앞 글자가 달라 걸리지 않는다.
    { label: '~는디/은디', re: new RegExp(`[는은]디${KO_END}`, 'u') },
    { label: '~잉', re: new RegExp(`[가-힣]잉${KO_END}`, 'u') },
    { label: '~부러', re: new RegExp(`(?<!일)부러${KO_END}`, 'u') },
    { label: '거시기/허벌나게/징하게', re: /거시기|허벌나게|징하게/u },
  ],
  // 경상 문구에 섞인 충청·전라식 '~니께'(2026-10-01 마지막 회차 — 경상 응원 줄이 '없으니께' 를 썼다). 경상 '~니까네'·
  // '~이께네' 와 헷갈리지 않게 뒤의 '네' 는 거른다. '~유' 는 '아유'·'이유'·'우유' 를 피하려고 어미 꼴만 본다.
  충청: [
    { label: '~니께', re: /니께(?!네)/u },
    { label: '~유(해유·좋아유)', re: new RegExp(`(?<=[가-힣])(?:해|아|어|게|셔|와|워|져)유${KO_END}`, 'u') },
    { label: '~슈', re: new RegExp(`(?<=[가-힣])[하가오셨했]슈${KO_END}`, 'u') },
  ],
  関西: [
    { label: 'ぎょうさん', re: /ぎょうさん/u },
    // 과거 〜てん(見られへんかってん・言うてん). 言ってんの(=言ってるの)·やってんだ 는 뒤 글자로 거른다.
    { label: '〜てん(過去)', re: new RegExp(`ってん(?:${JA_END}|[でなか])`, 'u') },
    { label: 'ほんま', re: /ほんま/u },
    { label: 'あかん', re: /あかん/u },
    { label: 'おおきに', re: /おおきに/u },
    { label: 'ほな', re: /ほな/u },
    { label: 'せや', re: /せや/u },
    { label: 'なんぼ', re: /なんぼ/u },
    { label: 'しよな', re: /しよな/u },
    { label: 'てまう/てもうた', re: /[てで]まう|[てで]もうた/u },
    { label: '〜やで', re: /(?<!い)やで/u },
    { label: '〜ねん', re: new RegExp(`ねん(?:${JA_END}|[でなけかて])`, 'u') },
    // 否定 〜へん(行かへん・知らへん・でけへん). たいへん/このへん/そこらへん 은 앞 글자로 거른다.
    { label: '〜へん', re: /(?:[かがさたなばまわきぎしちにびみりけげせてねべめれえ]|(?<!こ)ら)へん/u },
    { label: 'ええ(良い)', re: /ええ(?=[天日子感具よなでんやわか顔気一])/u },
    { label: '〜やん', re: new RegExp(`(?<![いおう])やん(?:${JA_END}|か)`, 'u') },
    { label: '〜やな', re: new RegExp(`(?<!い)やな(?:${JA_END}|あ)`, 'u') },
    { label: '〜やろ', re: /(?<![いう])やろ(?![うっ])/u },
    { label: '〜やから', re: /(?<![いお])やから/u },
    { label: '〜や。', re: /(?<![いうゃ])や(?=[。！？!?…〜ー]|$)/u },
  ],
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * 프로필 markers 가 문구에 있는가. '~' 로 시작하는 것은 **어미**라 낱말 끝에서만 센다. 한 글자 어미('~나')는
 * 표준어에도 흔해('나는', '하나') 근거로 세지 않는다 — 예전엔 `includes('나')` 라 거의 모든 문장이 사투리로 잡혔다.
 */
function profileMarkerHits(spoken: string, markers: string[]): string[] {
  return markers.filter((mk) => {
    const core = mk.replace(/^[~〜]/, '').trim();
    if ([...core].length < 2) return false;
    if (/^[~〜]/.test(mk)) return new RegExp(`${escapeRe(core)}(?=[\\s.,!?~…。、！？〜ー」』]|$)`, 'u').test(spoken);
    return spoken.includes(core);
  });
}
/** 같은 언어의 다른 사투리 — 섞이면 화자 사투리가 아니라 '아무 사투리' 가 된 것이다. */
const OTHER_DIALECTS: Record<string, string[]> = { 경상: ['전라', '충청'], 전라: ['경상'] };
const lexiconHits = (spoken: string, dialect: string) =>
  (DIALECT_LEXICON[dialect] ?? []).filter((x) => x.re.test(spoken)).map((x) => x.label);
/** 프로필 markers + 사투리 어휘 사전 — 둘 중 하나라도 걸린 표지. foreign = 다른 사투리 표지. */
function dialectHits(spoken: string, style: SpeechStyle): { profile: string[]; lexicon: string[]; foreign: string[] } {
  return {
    profile: profileMarkerHits(spoken, style.markers),
    lexicon: lexiconHits(spoken, style.dialect),
    foreign: (OTHER_DIALECTS[style.dialect] ?? []).flatMap((d) => lexiconHits(spoken, d).map((l) => `${d}:${l}`)),
  };
}
function sentenceEndings(spoken: string): string[] {
  // `…` 는 문장 끝이 아니다 — 3.5 가 절을 이어 쓸 때 쓴다(기준선 채점 오류였다).
  return spoken
    .split(/(?<=[.!?！？。])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}
/** 받침 없는 음절 뒤에 같은 모음만 있는 음절이 온다(나+아, 러+어) — 아이가 끝을 늘이는 철자. */
function hasStretchedVowel(text: string): boolean {
  const chars = [...text];
  const vowelOnly: Record<number, string> = { 0: '아', 4: '어', 8: '오', 13: '우', 20: '이', 1: '애', 5: '에', 18: '으' };
  for (let i = 0; i + 1 < chars.length; i += 1) {
    const a = chars[i]!.codePointAt(0)! - 0xac00;
    if (a < 0 || a > 11171) continue;
    const jong = a % 28;
    const jung = Math.floor(a / 28) % 21;
    if (jong === 0 && vowelOnly[jung] && chars[i + 1] === vowelOnly[jung]) return true;
  }
  return false;
}

async function runD(m: (typeof MODELS)[number]) {
  const core = [
    ...D_FULL_PROFILES.flatMap((p) => allSeeds().map((s) => ({ p, s }))),
    ...D_SUBSET_PROFILES.flatMap((p) => subsetSeeds().map((s) => ({ p, s }))),
  ];
  const holdout = D_HOLDOUT_PROFILES.flatMap((p) => subsetSeeds().map((s) => ({ p, s })));
  const fresh = D_FRESH_PROFILES.flatMap((p) => freshSeeds().map((s) => ({ p, s })));
  const fresh2 = D_FRESH2_PROFILES.flatMap((p) => fresh2Seeds().map((s) => ({ p, s })));
  // 행마다 어느 세트인지 남긴다 — core 와 holdout 을 따로 비교해야 과적합을 본다.
  const tag = (dset: string, xs: { p: Profile; s: { category: string; index: number; seed: string } }[]) =>
    xs.map((x) => ({ ...x, dset }));
  const cases = [
    ...(DSETS.has('core') ? tag('core', core) : []),
    ...(DSETS.has('holdout') ? tag('holdout', holdout) : []),
    ...(DSETS.has('fresh') ? tag('fresh', fresh) : []),
    ...(DSETS.has('fresh2') ? tag('fresh2', fresh2) : []),
  ].filter((c) => picked(`${c.p.id}/${c.s.category}#${c.s.index}`));
  const jobs = cases.flatMap((c) => Array.from({ length: REPS }, (_, rep) => ({ ...c, rep })));
  return pool(jobs, CONCURRENCY, async ({ p, s, rep, dset }) => {
    const calls: RawCall[] = [];
    let result: { text: string } | null = null;
    let error: string | null = null;
    const params = {
      seed: s.seed,
      relationshipLabel: p.relationshipLabel,
      listenerTitle: p.listenerTitle,
      targetLanguage: p.lang,
      speechStyle: p.speechStyle ?? null,
      // 운영 크론(`stock-clips.ts` 의 사전렌더)과 같게 — 사람이 쓴 같은 의도의 대사를 본보기로 준다
      // (2026-09-27 운영 도입). 예전 평가는 이걸 빠뜨려 **운영에 없는 프롬프트**를 재고 있었다.
      // 인사·약 3번째는 짝이 없어 null 이다(등록 미리듣기도 인사라 같은 null).
      humanReference: stockReferenceLine(s.category, s.index, p.lang),
      // 운영 크론과 같게 — 사용자가 확정한 미리듣기 문구(`preview_text`)를 말투 본보기로 준다(2026-10-01 리뷰:
      // 예전 평가는 이것도 빠뜨려, 사투리 지시가 확정 문구와 부딪히는 운영 모양을 재지 못했다).
      styleReference: p.styleReference,
    };
    await callLog.run(calls, async () => {
      try {
        result = await generatePrerenderClipText(envFor(m), params);
      } catch (e) {
        error = (e as Error).message;
      }
    });
    const r = result as { text: string } | null;
    // 시도마다 운영과 같은 판정을 다시 한다 — 어느 규칙이 몇 번째 시도에서 막혔는가.
    const attempts = calls.map((c) => {
      if (c.stage === 'auth') return { reason: `auth_${c.status}`, finishReason: null };
      if (c.error || c.status !== 200) return { reason: `http_${c.status}`, finishReason: c.finishReason };
      // 운영(`extractGeneratedText`)은 STOP 이 아니면 던지고 다시 묻는다 — 잘린 본문을 채점하지 않는다.
      if (c.finishReason && c.finishReason !== 'STOP') return { reason: `finish_${c.finishReason}`, finishReason: c.finishReason };
      const parsed = parseDynamicAlarmTextResult(c.text);
      // 운영(`generatePrerenderClipText`)과 같게 — 글자 웃음·태그를 벗긴 뒤 판정한다.
      const text = tidyEllipsis(stripAllTags(typedLaughterToTags(parsed.text.trim())));
      const shape = rawJsonShape(c.text, TEXT_ONLY);
      return {
        reason: prerenderRejectionReason(text, p.lang, params) ?? 'ok',
        finishReason: c.finishReason,
        jsonOk: shape.ok,
        extraKeys: shape.extraKeys,
        // 지시를 어기고 모델이 낸 태그 — 운영은 벗긴다. 얼마나 자주 어기는지만 본다.
        modelTags: modelTags(parsed.text),
      };
    });
    const spoken = r ? normalizeAlarmTextWithoutTags(r.text) : '';
    const endings = sentenceEndings(spoken);
    const dialect = r && p.speechStyle?.dialect ? dialectHits(spoken, p.speechStyle) : null;
    return {
      suite: 'D',
      model: m.label,
      dset,
      profile: p.id,
      category: s.category,
      seedIndex: s.index,
      rep,
      seed: s.seed,
      humanReference: params.humanReference,
      styleReference: params.styleReference,
      expect: p.expect ?? null,
      speechRegister: p.speechStyle?.register ?? null,
      output: r?.text ?? null,
      error,
      attempts,
      calls: calls.map((c) => ({ status: c.status, finishReason: c.finishReason, latencyMs: c.latencyMs, inputTokens: c.inputTokens, outputTokens: c.outputTokens, thoughtTokens: c.thoughtTokens, text: c.text })),
      final: r
        ? {
            length: spoken.length,
            leaks: leaks(spoken, p.lang),
            // 대소문자 무시 — 'Sweetie, …' 가 호칭 'sweetie' 로 안 잡혔다(2026-10-01 채점 오류). 한글·가나는 영향 없다.
            titleUsed: p.listenerTitle ? spoken.toLowerCase().includes(p.listenerTitle.toLowerCase()) : null,
            politeAllEndings: p.lang === 'ko' ? !endings.some(isBanmalEnding) && endings.some((e) => POLITE_KO.test(e)) : null,
            anyPoliteEnding: p.lang === 'ko' ? endings.some((e) => POLITE_KO.test(e)) : null,
            // 일본어 정중체(です・ます) 문장 수 — 가족·친구 프로필에서 보이면 어체가 어긋난 것이다(정보 표시만). 판정은
            // 운영 검사(`hasJapanesePoliteEnding`)와 같은 함수다 — 문장 끊기(부름말 자리의 청자 호칭만 지우기·'…' 끊기)도
            // 같은 `japaneseSentenceEnds` 다. 따로 정규식·끊기를 두면 둘이 갈라진다('…ですよ、ゆい。' 를 한쪽만 세거나,
            // 호칭 'しょう' 의 'がんばりましょう' 를 깨서 못 센다).
            jaPoliteEndings:
              p.lang === 'ja' ? japaneseSentenceEnds(spoken, p.listenerTitle).filter(isJapanesePoliteSentence).length : null,
            // 프로필 markers 또는 사투리 어휘 사전 — 둘 다 합친 것이 '사투리가 남았는가' 의 근거다.
            dialectMarkers: dialect ? [...dialect.profile, ...dialect.lexicon.filter((l) => !dialect.profile.includes(l))] : null,
            dialectProfileMarkers: dialect?.profile ?? null,
            dialectLexicon: dialect?.lexicon ?? null,
            dialectForeign: dialect?.foreign ?? null,
            childSpelling: p.speechStyle?.childlike
              ? hasStretchedVowel(spoken) || /([가-힣]{2})\1|ー[!！]?|([a-z])\2{2,}/i.test(spoken)
              : null,
            childPolite: p.speechStyle?.childlike && p.lang === 'ko' ? endings.some((e) => POLITE_KO.test(e)) : null,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------- F 말투 분석

type FCase = { id: string; lang: 'ko' | 'ja' | 'en'; transcript: string; dialect: string[]; register: string[]; childlike: boolean };
const F_CASES: FCase[] = [
  { id: 'ko-gyeongsang-banmal', lang: 'ko', transcript: '아이고 오늘은 날씨가 참 좋네예. 밥은 묵었나? 내 어제 시장 댕겨왔는데 사람이 억수로 많더라카이. 니도 밥 잘 챙겨 묵고 댕기래이.', dialect: ['경상'], register: ['banmal'], childlike: false },
  { id: 'ko-gyeongsang-polite', lang: 'ko', transcript: '어무이, 오늘 날씨 억수로 좋네예. 밥 잘 챙겨 드시소. 내 퇴근하고 전화 드릴게예. 추분데 옷 따시게 입으이소.', dialect: ['경상'], register: ['jondaemal'], childlike: false },
  { id: 'ko-jeolla', lang: 'ko', transcript: '아따 오늘 날씨 겁나 좋구마잉. 밥은 묵었냐? 나가 어제 장에 갔는디 사람이 징하게 많더랑께. 니도 밥 잘 챙겨 묵어부러.', dialect: ['전라'], register: ['banmal'], childlike: false },
  { id: 'ko-chungcheong', lang: 'ko', transcript: '오늘 날씨가 참 좋아유. 밥은 잡쉈어유? 천천히 댕겨오셔유. 그려유, 저녁에 전화 드릴게유.', dialect: ['충청'], register: ['jondaemal'], childlike: false },
  { id: 'ko-jeju', lang: 'ko', transcript: '어멍, 오늘 날씨 좋수다. 밥 먹읍서. 혼저 옵서예. 무사 영 늦었수과? 조심행 갑서.', dialect: ['제주'], register: ['jondaemal'], childlike: false },
  { id: 'ko-standard-polite', lang: 'ko', transcript: '안녕하세요. 오늘은 날씨가 맑고 기온도 적당해서 산책하기 좋은 날이에요. 아침은 꼭 챙겨 드시고 좋은 하루 보내세요.', dialect: [''], register: ['jondaemal'], childlike: false },
  { id: 'ko-standard-banmal', lang: 'ko', transcript: '야 오늘 날씨 진짜 좋다. 밥은 먹었어? 나 어제 시장 갔는데 사람 엄청 많더라. 너도 밥 잘 챙겨 먹고 다녀.', dialect: [''], register: ['banmal'], childlike: false },
  { id: 'ko-child', lang: 'ko', transcript: '엄마 나 오늘 유치원에서 그림 그렸어! 엄마 그려써. 빨리 와. 보고 시퍼. 엄마 사랑해 많이많이.', dialect: [''], register: ['banmal'], childlike: true },
  { id: 'ko-adult-short-casual', lang: 'ko', transcript: '응 알겠어, 이따 회사 끝나고 전화할게. 저녁은 먹고 들어갈게. 먼저 자.', dialect: [''], register: ['banmal'], childlike: false },
  { id: 'ja-kansai', lang: 'ja', transcript: 'おはよう。今日はほんまにええ天気やねん。朝ごはんちゃんと食べなあかんで。ほな、気ぃつけて行ってきてな。', dialect: ['関西'], register: ['casual'], childlike: false },
  { id: 'ja-hakata', lang: 'ja', transcript: 'おはよう。今日はよか天気やね。ご飯ちゃんと食べんといかんよ。気をつけて行ってきんしゃい。なんしよーと？はよ起きんね。', dialect: ['博多', '九州', '福岡'], register: ['casual'], childlike: false },
  { id: 'ja-standard-polite', lang: 'ja', transcript: 'おはようございます。今日はとてもいい天気ですね。朝ごはんをしっかり食べて、気をつけて行ってきてください。', dialect: [''], register: ['polite'], childlike: false },
  { id: 'ja-character-quirk', lang: 'ja', transcript: 'おはようだってばよ！今日も修行がんばるってばよ！オレってば、ラーメン食べてから行くってばよ！', dialect: [''], register: ['casual'], childlike: false },
  { id: 'ja-child', lang: 'ja', transcript: 'ママ、きょうね、ようちえんでおえかきしたの！はやくかえってきてね。だいすき！いっしょにあそぼ！', dialect: [''], register: ['casual'], childlike: true },
  { id: 'en-casual', lang: 'en', transcript: "Hey! Morning, buddy. Gonna be a great day, y'know? Grab some coffee and let's roll. Don't forget your keys again, dude.", dialect: [''], register: ['casual'], childlike: false },
  { id: 'en-polite', lang: 'en', transcript: 'Good morning. I hope you slept well. Please remember to take your medicine and have a wonderful day at work.', dialect: [''], register: ['polite'], childlike: false },
  // --- 헷갈리기 쉬운 것들(오판하면 문구가 엉뚱한 말투가 된다) ---
  // 대본을 읽느라 거의 표준어인데 끝에 한두 번만 사투리가 샌다 → 약한 경상.
  { id: 'ko-gyeongsang-light', lang: 'ko', transcript: '좋은 아침입니다. 오늘은 날씨가 맑고 따뜻하다고 합니다. 아침 식사 꼭 챙기시고요. 늦지 않게 나가이소.', dialect: ['경상'], register: ['jondaemal'], childlike: false },
  // 어른이 아기에게 아기 말투로 말한다 — 화자는 아이가 아니다.
  { id: 'ko-adult-babytalk', lang: 'ko', transcript: '우리 아가 일어났쪄요? 맘마 먹을까? 엄마가 맛있는 거 해 줄게. 옳지 옳지, 잘한다 우리 강아지.', dialect: [''], register: ['banmal'], childlike: false },
  // 표준어 존댓말인데 '~거든요' 같은 개인 말버릇만 있다 — 사투리로 오판하면 안 된다.
  { id: 'ko-standard-habit', lang: 'ko', transcript: '제가요, 아침마다 커피를 꼭 마시거든요. 그래야 정신이 들거든요. 오늘도 힘내세요, 진짜로요.', dialect: [''], register: ['jondaemal'], childlike: false },
  { id: 'ja-kansai-light', lang: 'ja', transcript: 'おはようございます。今日は晴れるそうです。朝ごはんはちゃんと食べてくださいね。ほな、行ってらっしゃい。', dialect: ['関西'], register: ['polite'], childlike: false },
  { id: 'en-southern', lang: 'en', transcript: "Mornin', sugar. Y'all better get up now, ya hear? Fixin' to make some biscuits. Don't be late, darlin'.", dialect: ['southern', 'south', 'texas', 'appalachian'], register: ['casual'], childlike: false },
  { id: 'en-child', lang: 'en', transcript: 'Daddy daddy! I drawed a doggy at school today! It is so big. Come home fast okay? I love you this much!', dialect: [''], register: ['casual'], childlike: true },
];
const DIALECT_ALIASES: Record<string, string[]> = {
  경상: ['경상', '경상도', 'gyeongsang', '부산', '대구'],
  전라: ['전라', '전라도', 'jeolla', '광주'],
  충청: ['충청', '충청도', 'chungcheong'],
  제주: ['제주', '제주도', 'jeju'],
  関西: ['関西', '関西弁', '大阪', 'kansai'],
  博多: ['博多', '博多弁', '九州', '福岡', 'hakata', 'kyushu'],
  southern: ['southern', 'south', 'texas', 'appalachian', 'dixie'],
};
function dialectMatches(got: string, expected: string[]): boolean {
  const g = got.trim().toLowerCase();
  if (expected.includes('')) return g === '' || /^(표준|標準|standard)/.test(g);
  return expected.some((e) => (DIALECT_ALIASES[e] ?? [e]).some((a) => g.includes(a.toLowerCase())));
}
function registerMatches(got: string, expected: string[]): boolean {
  const g = got.trim().toLowerCase();
  return expected.some((e) => {
    if (e === 'jondaemal') return /jondae|polite|존댓|존대|해요|formal/.test(g);
    if (e === 'banmal') return /banmal|반말|casual|informal/.test(g);
    if (e === 'polite') return /polite|jondae|丁寧|敬語|formal/.test(g);
    return /casual|informal|banmal|タメ|くだけ/.test(g);
  });
}

async function runF(m: (typeof MODELS)[number]) {
  const jobs = F_CASES.filter((c) => picked(c.id)).flatMap((c) => Array.from({ length: REPS }, (_, rep) => ({ c, rep })));
  return pool(jobs, CONCURRENCY, async ({ c, rep }) => {
    const calls: RawCall[] = [];
    let style: SpeechStyle | null = null;
    let error: string | null = null;
    await callLog.run(calls, async () => {
      try {
        style = await analyzeSpeechStyleWithVertex(envFor(m), c.transcript, c.lang);
      } catch (e) {
        error = (e as Error).message;
      }
    });
    const s = style as SpeechStyle | null;
    // 운영은 전송 실패(시간 초과·429/5xx)를 마감 안에서 다시 묻는다(2026-10-01) — 형식 채점은 **답을 받은 호출**로 한다.
    // 첫 호출만 보면 시간 초과 뒤 살아난 결과가 '형식 오류' 로 잡힌다.
    const answered = [...calls].reverse().find((c) => c.status === 200) ?? calls[calls.length - 1];
    const raw = answered?.text ?? '';
    const shape = rawJsonShape(raw, {
      dialect: 'string',
      strength: 'string',
      register: 'string',
      markers: 'string[]',
      persona: 'string',
      childlike: 'boolean',
      // 운영 스키마(`SPEECH_STYLE_RESPONSE_SCHEMA`)의 필수 필드다 — 빼 두면 정상 응답이 전부 '여분 필드' 로 잡혔다.
      energy: 'string',
      confidence: 'number',
    });
    let rawConfidence: number | null = null;
    try {
      // 숫자가 아니면(빠졌거나 문자열) 형식 실패로만 세고 평균에는 넣지 않는다 — NaN 이 평균 칸 전체를 먹는다.
      const value = JSON.parse(raw).confidence;
      rawConfidence = typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch {
      /* */
    }
    const markers = s?.markers ?? [];
    return {
      suite: 'F',
      model: m.label,
      id: c.id,
      rep,
      output: s,
      error,
      rawText: raw,
      raw: {
        status: answered?.status ?? null,
        httpError: answered?.error ?? null,
        finishReason: answered?.finishReason ?? null,
        jsonOk: shape.ok,
        extraKeys: shape.extraKeys,
        confidence: rawConfidence,
        latencyMs: answered?.latencyMs ?? null,
        inputTokens: answered?.inputTokens ?? null,
        outputTokens: answered?.outputTokens ?? null,
      },
      // 호출 수와 전송 실패(시간 초과·네트워크·HTTP 오류) 수 — 재시도가 살린 회차를 따로 본다.
      callCount: calls.length,
      transportFailures: calls.filter(isTransportCall).length,
      score: s
        ? {
            dialect: dialectMatches(s.dialect, c.dialect),
            register: registerMatches(s.register, c.register),
            childlike: s.childlike === c.childlike,
            markersVerbatim: markers.length ? markers.filter((mk) => c.transcript.includes(mk.replace(/^[~〜]/, '').replace(/^\.{3}|…/, ''))).length / markers.length : null,
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------- 요약

type AnyRow = Record<string, unknown>;
/**
 * 전송 실패 — 모델이 문구를 내지 못한 것이라 **내용 판정과 따로** 센다. 예전에는 '1회차 통과' 가 둘을 섞어, 상류가
 * 느린 날(2026-10-01 — 호출의 24% 가 15초 시간 초과)에는 문구 품질이 74% 로 보였다(응답 받은 것만 보면 98%).
 * ⚠ **운영 판정(`isVertexTransportFailure`)과 같은 것만** 센다(2026-10-01 마지막 회차): 응답 없음(`http_0` — 시간 초과·
 *   네트워크), 429·500·502·503·504 — 생성 요청이든 토큰 발급이든 같다(`auth_0`·`auth_429`·`auth_5xx`, Codex #844 부터
 *   운영도 토큰 발급의 429·5xx 를 다시 묻는다). 400·403·404 와 토큰 발급의 그 밖 HTTP 오류(`auth_400` 등)는 다시 보내도
 *   같은 **진짜 실패**다 — 예전에는 `http_`·`auth_` 전부를 전송 실패로 빼서 그런 실패가 품질 분모에서 사라졌다.
 */
const TRANSPORT_REASON = /^(?:http|auth)_(?:0|429|500|502|503|504)$/;
/** 기록된 호출 하나가 운영 기준 전송 실패인가 — `TRANSPORT_REASON` 과 같은 판정(F 의 '전송 실패 호출'). */
const isTransportCall = (c: RawCall) => TRANSPORT_REASON.test(`${c.stage === 'auth' ? 'auth' : 'http'}_${c.status}`);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—');
function hist(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
}

function summarize(rows: AnyRow[]): string {
  const lines: string[] = [
    `# Gemini 비교 평가 — ${LABEL}`,
    '',
    `모델: ${MODELS.map((m) => m.label).join(' vs ')} · 반복 ${REPS} · 세트 ${[...DSETS].join(',')}${ONLY.length ? ` · 한정 ${ONLY.join(',')}` : ''}`,
    ...(CLIENT_TIMEOUT_MS ? ['', `⚠ **진단 실행** — 생성 요청 상한을 ${CLIENT_TIMEOUT_MS}ms 로 바꿨다(운영은 15초). 운영 재현 수치가 아니다.`] : []),
    '',
  ];
  const byModel = (suite: string) => MODELS.map((m) => ({ m, rs: rows.filter((r) => r.suite === suite && r.model === m.label) }));

  if (SUITES.has('A')) {
    lines.push('## A 직접 입력 번역', '', '| 모델 | n | 성공 | JSON 형식 | 여분 필드 | 모델이 붙인 태그 | 웃음 보존 | 평균 지연 ms | 평균 사고 토큰 |', '|---|---|---|---|---|---|---|---|---|');
    for (const { m, rs } of byModel('A')) {
      const raw = rs.map((r) => r.raw as AnyRow);
      const fin = rs.map((r) => r.final as AnyRow);
      const laughCases = fin.filter((x) => x.laughKept !== null);
      lines.push(`| ${m.label} | ${rs.length} | ${pct(fin.filter((x) => x.ok).length, rs.length)} | ${pct(raw.filter((x) => x.jsonOk).length, rs.length)} | ${pct(raw.filter((x) => (x.extraKeys as string[]).length).length, rs.length)} | ${pct(raw.filter((x) => ((x.modelTags as string[]) ?? []).length).length, rs.length)} | ${pct(laughCases.filter((x) => x.laughKept).length, laughCases.length)} | ${avg(raw.map((x) => (x.latencyMs as number) ?? 0))} | ${avg(raw.map((x) => (x.thoughtTokens as number) ?? 0))} |`);
    }
    lines.push('');
    for (const { m, rs } of byModel('A')) {
      lines.push(`### A 표본 — ${m.label}`, '');
      for (const r of rs.filter((x) => x.rep === 0)) lines.push(`- \`${r.id}\` → ${r.target}: ${r.output ?? `**실패** ${String(r.error).slice(0, 60)}`}`);
      lines.push('');
    }
  }

  if (SUITES.has('D')) {
    lines.push('## D 사전렌더 문구(등록 미리듣기 포함)', '', '| 모델 | n | 최종 성공 | 1회차 통과 | 1회차 내용 통과(응답 받은 것 중) | 전송 실패(시간 초과 등) 호출 | 평균 시도 | 1회차 거절 사유 | 최종 실패 사유 | 누출(날짜·숫자 등) | 호칭 사용 | 모델이 낸 태그(벗김) | 여분 필드 | 평균 길이 | 평균 지연 ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { m, rs } of byModel('D')) {
      const ok = rs.filter((r) => r.final);
      const first = rs.map((r) => ((r.attempts as AnyRow[])[0]?.reason as string) ?? 'none');
      const allAttempts = rs.flatMap((r) => r.attempts as AnyRow[]);
      const titled = ok.filter((r) => (r.final as AnyRow).titleUsed !== null);
      lines.push(`| ${m.label} | ${rs.length} | ${pct(ok.length, rs.length)} | ${pct(first.filter((x) => x === 'ok').length, rs.length)} | ${pct(first.filter((x) => x === 'ok').length, first.filter((x) => !TRANSPORT_REASON.test(x)).length)} | ${pct(allAttempts.filter((a) => TRANSPORT_REASON.test(String(a.reason))).length, allAttempts.length)} | ${avg(rs.map((r) => (r.attempts as AnyRow[]).length))} | ${hist(first.filter((x) => x !== 'ok'))} | ${hist(rs.filter((r) => !r.final).map((r) => String(r.error).slice(0, 40)))} | ${pct(ok.filter((r) => ((r.final as AnyRow).leaks as string[]).length).length, ok.length)} | ${pct(titled.filter((r) => (r.final as AnyRow).titleUsed).length, titled.length)} | ${pct(allAttempts.filter((a) => ((a.modelTags as string[]) ?? []).length).length, allAttempts.length)} | ${pct(allAttempts.filter((a) => ((a.extraKeys as string[]) ?? []).length).length, allAttempts.length)} | ${avg(ok.map((r) => (r.final as AnyRow).length as number))} | ${avg(rs.flatMap((r) => (r.calls as AnyRow[]).map((c) => c.latencyMs as number)))} |`);
    }
    lines.push('', '### D 프로필별 규칙 준수', '', '| 모델 | 프로필 | n | 성공 | 규칙 |', '|---|---|---|---|---|');
    for (const { m, rs } of byModel('D')) {
      for (const pid of [...new Set(rs.map((r) => r.profile as string))]) {
        const prs = rs.filter((r) => r.profile === pid);
        const ok = prs.filter((r) => r.final);
        const f = ok.map((r) => r.final as AnyRow);
        // 규칙은 프로필이 **선언한** expect 로 고른다 — id 조각으로 추측하면 새 프로필이 빠진다(Codex #801).
        const expect = prs[0]?.expect as Profile['expect'] | null;
        const leakRate = `누출 ${pct(f.filter((x) => (x.leaks as string[]).length).length, f.length)}`;
        const rule =
          expect === 'polite' ? `존대 전 문장 ${pct(f.filter((x) => x.politeAllEndings).length, f.length)} · ${leakRate}` :
          expect === 'banmal' ? `반말(존대 어미 없음) ${pct(f.filter((x) => x.anyPoliteEnding === false).length, f.length)} · ${leakRate}` :
          expect === 'dialect'
            ? `사투리 표지 1개 이상 ${pct(f.filter((x) => ((x.dialectMarkers as string[]) ?? []).length).length, f.length)} · 평균 표지 ${avg(f.map((x) => ((x.dialectMarkers as string[]) ?? []).length))} · 4개 이상 ${pct(f.filter((x) => ((x.dialectMarkers as string[]) ?? []).length >= 4).length, f.length)} · 다른 사투리 섞임 ${pct(f.filter((x) => ((x.dialectForeign as string[]) ?? []).length).length, f.length)}${
                prs[0]?.speechRegister === 'banmal' ? ` · 반말(존대 어미 없음) ${pct(f.filter((x) => x.anyPoliteEnding === false).length, f.length)}` : ''
              } · ${leakRate}` :
          expect === 'standard_ref'
            ? `표준어(사투리 표지 없음) ${pct(f.filter((x) => !((x.dialectMarkers as string[]) ?? []).length).length, f.length)} · 평균 표지 ${avg(f.map((x) => ((x.dialectMarkers as string[]) ?? []).length))} · 다른 사투리 섞임 ${pct(f.filter((x) => ((x.dialectForeign as string[]) ?? []).length).length, f.length)}${
                prs[0]?.speechRegister === 'banmal' ? ` · 반말(존대 어미 없음) ${pct(f.filter((x) => x.anyPoliteEnding === false).length, f.length)}` : ''
              } · ${leakRate}` :
          expect === 'child' ? `아이 철자 ${pct(f.filter((x) => x.childSpelling).length, f.length)} · 존대 섞임 ${pct(f.filter((x) => x.childPolite).length, f.length)} · ${leakRate}` :
          leakRate;
        // 일본어는 어체 기대값을 선언하지 않는다 — です・ます 문장이 섞인 비율만 보여 준다(가족·친구면 어긋난 것).
        const jaPolite = f.some((x) => x.jaPoliteEndings !== null && x.jaPoliteEndings !== undefined)
          ? ` · です・ます 문장 있음 ${pct(f.filter((x) => ((x.jaPoliteEndings as number) ?? 0) > 0).length, f.length)}`
          : '';
        lines.push(`| ${m.label} | ${pid} | ${prs.length} | ${pct(ok.length, prs.length)} | ${rule}${jaPolite} · 평균 길이 ${avg(f.map((x) => x.length as number))} |`);
      }
    }
    lines.push('');
    // 사투리 프로필은 **전부** 싣는다 — 확정 문구가 사투리면 사투리, 표준어면 표준어로 나왔는지 눈으로 본다.
    for (const { m, rs } of byModel('D')) {
      const dialectRows = rs.filter((r) => r.expect === 'dialect' || r.expect === 'standard_ref');
      if (dialectRows.length === 0) continue;
      lines.push(`### D 사투리 표본(확정 문구별) — ${m.label}`, '');
      for (const r of dialectRows) {
        const f = r.final as AnyRow | null;
        const marks = f ? `[표지 ${((f.dialectMarkers as string[]) ?? []).join('/') || '없음'}${((f.dialectForeign as string[]) ?? []).length ? ` · 다른 사투리 ${(f.dialectForeign as string[]).join('/')}` : ''}]` : '';
        lines.push(`- \`${r.profile}/${r.category}#${r.seedIndex}·${r.rep}\` ${marks} ${r.output ?? `**실패** ${String(r.error).slice(0, 60)}`}`);
      }
      lines.push('');
    }
    for (const { m, rs } of byModel('D')) {
      lines.push(`### D 표본 — ${m.label}`, '');
      for (const r of rs.filter((x) => x.rep === 0 && (x.profile !== 'ko-mom-to-daughter' || (x.seedIndex as number) < 2)).slice(0, 40)) {
        lines.push(`- \`${r.profile}/${r.category}#${r.seedIndex}\` ${r.output ?? `**실패** ${String(r.error).slice(0, 60)}`}`);
      }
      lines.push('');
    }
  }

  if (SUITES.has('F')) {
    lines.push('## F 말투 분석', '', '| 모델 | n | 결과 있음 | 최종 HTTP 오류 | 전송 실패 호출 | 재시도로 살아남 | 사투리 정답 | 어체 정답 | 아이 판정 정답 | 표지 원문 일치 | 평균 확신 | 여분 필드 |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { m, rs } of byModel('F')) {
      const sc = rs.filter((r) => r.score).map((r) => r.score as AnyRow);
      const calls = rs.reduce((n, r) => n + ((r.callCount as number) ?? 0), 0);
      const failedCalls = rs.reduce((n, r) => n + ((r.transportFailures as number) ?? 0), 0);
      lines.push(`| ${m.label} | ${rs.length} | ${pct(sc.length, rs.length)} | ${pct(rs.filter((r) => (r.raw as AnyRow).status !== 200).length, rs.length)} | ${failedCalls}/${calls} | ${rs.filter((r) => r.output && ((r.transportFailures as number) ?? 0) > 0).length} | ${pct(sc.filter((x) => x.dialect).length, rs.length)} | ${pct(sc.filter((x) => x.register).length, rs.length)} | ${pct(sc.filter((x) => x.childlike).length, rs.length)} | ${avg(sc.filter((x) => x.markersVerbatim !== null).map((x) => (x.markersVerbatim as number) * 100))}% | ${avg(rs.map((r) => (r.raw as AnyRow).confidence).filter((v): v is number => typeof v === 'number'))} | ${pct(rs.filter((r) => ((r.raw as AnyRow).extraKeys as string[]).length).length, rs.length)} |`);
    }
    lines.push('', '### F 오답 목록', '');
    for (const { m, rs } of byModel('F')) {
      for (const r of rs) {
        const s = r.score as AnyRow | null;
        if (!s || !s.dialect || !s.register || !s.childlike) {
          const o = r.output as SpeechStyle | null;
          lines.push(`- ${m.label} \`${r.id}#${r.rep}\` → ${o ? `dialect="${o.dialect}" register="${o.register}" childlike=${o.childlike} markers=${JSON.stringify(o.markers)}` : `null ${(r.raw as AnyRow).httpError ?? ''}`}`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 실행

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(backendRoot, '.eval/gemini', `${stamp}-${LABEL}`);
mkdirSync(outDir, { recursive: true });
const rows: AnyRow[] = [];
for (const m of MODELS) {
  evalModel = m.model;
  for (const suite of ['A', 'D', 'F'] as const) {
    if (!SUITES.has(suite)) continue;
    process.stderr.write(`${m.label} · ${suite}\n`);
    const r = suite === 'A' ? await runA(m) : suite === 'D' ? await runD(m) : await runF(m);
    rows.push(...(r as AnyRow[]));
  }
}
if (rows.length === 0) throw new Error('평가한 것이 없다 — --suites·--models 를 확인할 것');
writeFileSync(resolve(outDir, 'results.json'), JSON.stringify(rows, null, 2));
const summary = summarize(rows);
writeFileSync(resolve(outDir, 'summary.md'), summary);
realLog(`\n결과: ${outDir}`);
