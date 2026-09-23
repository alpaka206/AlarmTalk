/**
 * Gemini 프롬프트·모델 **비교 평가**(로컬 전용, Vertex 실호출).
 *
 * 운영이 Gemini 를 쓰는 세 경로를 **운영 함수 그대로** 부르고, 모델이 준 원문 응답도 따로 기록해
 * 자동 채점한다. 모델을 바꾸거나 프롬프트를 고칠 때 전후를 숫자로 비교하려고 만들었다
 * (2026-09-23 — `gemini-2.5-flash` 은퇴 대비 + 프롬프트 고도화).
 *
 *  - A 직접 입력 태깅(`prepareAlarmTextWithVertex`) — 원문 보존, 오디오 태그, 폴백률, 형식
 *  - D 유료 클론 사전렌더 문구(`generatePrerenderClipText`, 등록 미리듣기 C 도 같은 함수) —
 *    시도별 거절 사유, 날짜·숫자 누출, 호칭·어체·사투리·아이 말투, 오디오 태그, 형식
 *  - F 등록 녹음 말투 분석(`analyzeSpeechStyleWithVertex`) — 정답 라벨 대비 사투리·어체·아이 판정,
 *    표지(markers)가 전사에 실제로 있는가, 형식
 *
 * 사용 (packages/backend 에서):
 *   npm run eval:gemini                                   # 기본: 2.5-flash@us-central1 vs 3.5-flash-lite@us
 *   npm run eval:gemini -- --models gemini-3.5-flash-lite@us --suites A,F --reps 2
 *   npm run eval:gemini -- --label after-prompt-v2
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
  dropLowArousalTags,
  extractTags,
  generatePrerenderClipText,
  normalizeAlarmTextWithoutTags,
  parseAlarmTextPreparation,
  parseDynamicAlarmTextResult,
  prepareAlarmTextWithVertex,
  prerenderRejectionReason,
  type SpeechStyle,
} from '../src/lib/vertex-translate.ts';
import { CLONE_CLIP_SEEDS } from '../src/lib/stock-clips.ts';
import type { Env } from '../src/types.ts';

// ---------------------------------------------------------------- 인자

const KNOWN_FLAGS = ['--models', '--suites', '--reps', '--label', '--concurrency'] as const;

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
const MODELS = (flags.get('--models') ?? 'gemini-2.5-flash@us-central1,gemini-3.5-flash-lite@us')
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
const LABEL = (flags.get('--label') ?? 'baseline').replace(/[^a-z0-9._-]/gi, '-');

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
    GOOGLE_VERTEX_MODEL: m.model,
    GOOGLE_VERTEX_LOCATION: m.location,
  }) as unknown as Env;

// ---------------------------------------------------------------- 원문 응답 기록

type RawCall = {
  status: number;
  finishReason: string | null;
  text: string;
  latencyMs: number;
  outputTokens: number | null;
  thoughtTokens: number | null;
  error: string | null;
};
const callLog = new AsyncLocalStorage<RawCall[]>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes(':generateContent')) return realFetch(input, init);
  const started = Date.now();
  const res = await realFetch(input, init);
  const bucket = callLog.getStore();
  if (bucket) {
    const body = await res.clone().text();
    let j: {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      usageMetadata?: { candidatesTokenCount?: number; thoughtsTokenCount?: number };
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

/** 태그 뒤에 띄어쓰기가 없다(`[warmly]할머니`). */
const tagWithoutSpace = (text: string) => /\[[a-z][a-z ,-]{1,48}\](?=[^\s[])/i.test(text);
const FEAR = ['panic', 'scared', 'terrified', 'afraid', 'frighten'];
const isFear = (tag: string) => FEAR.some((w) => tag.toLowerCase().includes(w));
const LOW_AROUSAL = ['tired', 'sleepy', 'drowsy', 'yawn', 'whisper', 'quiet', 'soft', 'hushed', 'calm', 'soothing', 'gentle', 'mumbl', 'murmur'];
const isLowArousal = (tag: string) => LOW_AROUSAL.some((w) => tag.toLowerCase().includes(w));

/** 날짜·요일·시각·숫자·온도·지명 누출. 사전렌더 규칙이 금지하는 것들. */
function leaks(spoken: string, language: string): string[] {
  const found: string[] = [];
  if (/[0-9０-９]/.test(spoken)) found.push('digit');
  if (language === 'ko') {
    if (/[월화수목금토일]요일/.test(spoken)) found.push('weekday');
    if (/(일|이|삼|사|오|육|칠|팔|구|십)+\s?월\s?(일|이|삼|사|오|육|칠|팔|구|십)+\s?일/.test(spoken)) found.push('date');
    if (/(서울|부산|대구|인천|광주|대전|울산|제주|한국|일본|미국)/.test(spoken)) found.push('place');
    if (/(도씨|섭씨|퍼센트|%)/.test(spoken)) found.push('unit');
  } else if (language === 'ja') {
    if (/[月火水木金土日]曜/.test(spoken)) found.push('weekday');
    if (/(東京|大阪|京都|福岡|日本|韓国|アメリカ)/.test(spoken)) found.push('place');
    if (/(度|パーセント|%)/.test(spoken) && /[0-9０-９一二三四五六七八九十]+\s?(度|パーセント|%)/.test(spoken)) found.push('unit');
  } else {
    if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(spoken)) found.push('weekday');
    if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(spoken)) found.push('date');
    if (/\b(degrees?|percent|°)/i.test(spoken)) found.push('unit');
    if (/\b(seoul|tokyo|new york|korea|japan)\b/i.test(spoken)) found.push('place');
  }
  return found;
}

function rawJsonShape(raw: string, allowed: string[]): { ok: boolean; extraKeys: string[]; keys: string[] } {
  try {
    const parsed = JSON.parse(raw.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, extraKeys: [], keys: [] };
    const keys = Object.keys(parsed);
    return { ok: true, keys, extraKeys: keys.filter((k) => !allowed.includes(k)) };
  } catch {
    return { ok: false, extraKeys: [], keys: [] };
  }
}

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

// ---------------------------------------------------------------- A 직접 입력 태깅

const A_INPUTS: { id: string; text: string; lang: 'ko' | 'en' | 'ja' }[] = [
  { id: 'ko-mom-cheer', text: '엄마, 일어날 시간이야. 오늘도 힘내!', lang: 'ko' },
  { id: 'ko-meeting-time', text: '일어나세요! 7시 30분 회의 있어요.', lang: 'ko' },
  { id: 'ko-meds-casual', text: '약 먹을 시간이야 ㅎㅎ 까먹지 말고', lang: 'ko' },
  { id: 'ko-grandma-hospital', text: '할머니 좋은 아침이에요~ 오늘 병원 가시는 날이에요.', lang: 'ko' },
  { id: 'ko-late-shout', text: '야 일어나 지각한다!!', lang: 'ko' },
  { id: 'ko-birthday', text: '오늘은 우리 딸 생일! 축하해 사랑해', lang: 'ko' },
  { id: 'en-vitamins', text: 'Good morning! Time to get up and take your vitamins.', lang: 'en' },
  { id: 'en-dentist', text: "Hey sleepyhead, you've got a dentist appointment at 9.", lang: 'en' },
  { id: 'en-game', text: 'Rise and shine, champ. Big game today!', lang: 'en' },
  { id: 'ja-ganbarou', text: 'おはよう。今日も一日がんばろうね。', lang: 'ja' },
  { id: 'ja-train', text: '起きて！8時の電車に遅れるよ。', lang: 'ja' },
  { id: 'ja-grandma-meds', text: 'おばあちゃん、お薬の時間ですよ〜', lang: 'ja' },
];

async function runA(m: (typeof MODELS)[number]) {
  const jobs = A_INPUTS.flatMap((input) => Array.from({ length: REPS }, (_, rep) => ({ input, rep })));
  return pool(jobs, CONCURRENCY, async ({ input, rep }) => {
    const calls: RawCall[] = [];
    let result: { text: string; tags: string[]; provider: string } | null = null;
    let error: string | null = null;
    await callLog.run(calls, async () => {
      try {
        result = await prepareAlarmTextWithVertex(envFor(m), input.text, {
          targetLanguage: input.lang,
          sourceLanguage: input.lang,
          translate: false,
          autoTag: true,
        });
      } catch (e) {
        error = (e as Error).message;
      }
    });
    const r = result as { text: string; tags: string[]; provider: string } | null;
    const raw = calls[0]?.text ?? '';
    const shape = rawJsonShape(raw, ['text', 'tags']);
    const rawParsed = raw ? parseAlarmTextPreparation(raw) : null;
    const rawInlineTags = rawParsed ? extractTags(rawParsed.text) : [];
    const finalTags = r ? extractTags(r.text) : [];
    const spoken = r ? normalizeAlarmTextWithoutTags(r.text) : '';
    return {
      suite: 'A',
      model: m.label,
      id: input.id,
      rep,
      input: input.text,
      output: r?.text ?? null,
      provider: r?.provider ?? null,
      error,
      rawText: raw,
      raw: {
        status: calls[0]?.status ?? null,
        finishReason: calls[0]?.finishReason ?? null,
        jsonOk: shape.ok,
        extraKeys: shape.extraKeys,
        inlineTags: rawInlineTags,
        // 원문 보존: 태그를 벗긴 모델 출력이 입력과 같은가(모델 자체의 준수율 — 폴백 전).
        preserved: rawParsed ? normalizeAlarmTextWithoutTags(rawParsed.text) === normalizeAlarmTextWithoutTags(input.text) : false,
        lowArousal: rawInlineTags.filter(isLowArousal),
        fear: rawInlineTags.filter(isFear),
        tagWithoutSpace: rawParsed ? tagWithoutSpace(rawParsed.text) : false,
        latencyMs: calls[0]?.latencyMs ?? null,
        outputTokens: calls[0]?.outputTokens ?? null,
        thoughtTokens: calls[0]?.thoughtTokens ?? null,
      },
      final: {
        fallback: r?.provider === 'local',
        preserved: r ? spoken === normalizeAlarmTextWithoutTags(input.text) : false,
        tagCount: finalTags.length,
        tags: finalTags,
        lowArousal: finalTags.filter(isLowArousal),
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
  expect?: 'polite' | 'banmal' | 'dialect' | 'child';
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
  { id: 'ko-mom-to-daughter', lang: 'ko', relationshipLabel: '엄마', listenerTitle: '우리 딸', expect: 'banmal' },
  { id: 'en-mom-to-sweetie', lang: 'en', relationshipLabel: 'mom', listenerTitle: 'sweetie' },
  { id: 'ja-mom-to-yui', lang: 'ja', relationshipLabel: '母', listenerTitle: 'ゆい' },
];
const D_SUBSET_PROFILES: Profile[] = [
  { id: 'ko-granddaughter-to-grandma', lang: 'ko', relationshipLabel: '손녀', listenerTitle: '할머니', expect: 'polite' },
  { id: 'ko-boyfriend-to-jagi', lang: 'ko', relationshipLabel: '남자친구', listenerTitle: '자기', expect: 'banmal' },
  { id: 'ko-mom-gyeongsang', lang: 'ko', relationshipLabel: '엄마', listenerTitle: '우리 아들', speechStyle: GYEONGSANG, expect: 'dialect' },
  { id: 'ko-child-to-dad', lang: 'ko', relationshipLabel: '딸', listenerTitle: '아빠', speechStyle: CHILD, expect: 'child' },
  { id: 'ko-no-relationship', lang: 'ko', relationshipLabel: null, listenerTitle: null },
  { id: 'ja-okan-kansai', lang: 'ja', relationshipLabel: 'おかん', listenerTitle: 'たろう', speechStyle: KANSAI, expect: 'dialect' },
  { id: 'en-no-relationship', lang: 'en', relationshipLabel: null, listenerTitle: null },
];
function subsetSeeds() {
  const pick = (category: string, index: number) => {
    const group = CLONE_CLIP_SEEDS.find((g) => g.category === category)!;
    const i = index < 0 ? group.seeds.length + index : index;
    return { category, index: i, seed: group.seeds[i]!, defaultTag: group.defaultTag };
  };
  return [pick('greeting', 0), pick('weather', 0), pick('weather', -1), pick('medication', 0), pick('fortune', 0), pick(CLONE_CLIP_SEEDS.find((g) => g.category === 'cheer') ? 'cheer' : 'love', 0)];
}
function allSeeds() {
  return CLONE_CLIP_SEEDS.flatMap((g) => g.seeds.map((seed, index) => ({ category: g.category, index, seed, defaultTag: g.defaultTag })));
}

const POLITE_KO = /(요|세요|니다|시죠|께요|죠)[.!?~…\s]*$/;
/** 반말로 끝나는 문장(해/야/어/아/지/자/래/네/니/냐/게/걸 + 문장부호). 이어지는 절(는데…, 니까,)은 세지 않는다. */
const BANMAL_KO = /(해|야|어|아|지|자|래|네|니|냐|게|걸|다)[!?.~]+$/;
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
  const cases = [
    ...D_FULL_PROFILES.flatMap((p) => allSeeds().map((s) => ({ p, s }))),
    ...D_SUBSET_PROFILES.flatMap((p) => subsetSeeds().map((s) => ({ p, s }))),
  ];
  const jobs = cases.flatMap((c) => Array.from({ length: REPS }, (_, rep) => ({ ...c, rep })));
  return pool(jobs, CONCURRENCY, async ({ p, s, rep }) => {
    const calls: RawCall[] = [];
    let result: { text: string; tag: string } | null = null;
    let error: string | null = null;
    const params = {
      seed: s.seed,
      relationshipLabel: p.relationshipLabel,
      listenerTitle: p.listenerTitle,
      targetLanguage: p.lang,
      defaultTag: s.defaultTag,
      speechStyle: p.speechStyle ?? null,
    };
    await callLog.run(calls, async () => {
      try {
        result = await generatePrerenderClipText(envFor(m), params);
      } catch (e) {
        error = (e as Error).message;
      }
    });
    const r = result as { text: string; tag: string } | null;
    // 시도마다 운영과 같은 판정을 다시 한다 — 어느 규칙이 몇 번째 시도에서 막혔는가.
    const attempts = calls.map((c) => {
      if (c.error || c.status !== 200) return { reason: `http_${c.status}`, finishReason: c.finishReason };
      const parsed = parseDynamicAlarmTextResult(c.text);
      // 운영과 같게 — 졸린 태그는 거절하지 않고 지운 뒤 판정한다.
      const text = dropLowArousalTags(parsed.text.trim());
      const spoken = normalizeAlarmTextWithoutTags(text);
      const shape = rawJsonShape(c.text, ['text', 'tag']);
      return {
        reason: prerenderRejectionReason(spoken, text, p.lang, params) ?? 'ok',
        finishReason: c.finishReason,
        jsonOk: shape.ok,
        extraKeys: shape.extraKeys,
        legacyTagFilled: parsed.tag.trim() !== '',
        inlineTags: extractTags(text),
        rawLowArousal: extractTags(parsed.text).filter(isLowArousal),
      };
    });
    const spoken = r ? normalizeAlarmTextWithoutTags(r.text) : '';
    const tags = r ? extractTags(r.text) : [];
    const endings = sentenceEndings(spoken);
    return {
      suite: 'D',
      model: m.label,
      profile: p.id,
      category: s.category,
      seedIndex: s.index,
      rep,
      seed: s.seed,
      output: r?.text ?? null,
      error,
      attempts,
      calls: calls.map((c) => ({ status: c.status, finishReason: c.finishReason, latencyMs: c.latencyMs, outputTokens: c.outputTokens, thoughtTokens: c.thoughtTokens, text: c.text })),
      final: r
        ? {
            length: spoken.length,
            tagCount: tags.length,
            tags,
            lowArousal: tags.filter(isLowArousal),
            leaks: leaks(spoken, p.lang),
            titleUsed: p.listenerTitle ? spoken.includes(p.listenerTitle) : null,
            politeAllEndings: p.lang === 'ko' ? !endings.some((e) => BANMAL_KO.test(e)) && endings.some((e) => POLITE_KO.test(e)) : null,
            anyPoliteEnding: p.lang === 'ko' ? endings.some((e) => POLITE_KO.test(e)) : null,
            tagWithoutSpace: tagWithoutSpace(r.text),
            dialectMarkers: p.speechStyle?.dialect
              ? p.speechStyle.markers.filter((mk) => spoken.includes(mk.replace(/^[~〜]/, '')))
              : null,
            childSpelling: p.speechStyle?.childlike
              ? hasStretchedVowel(spoken) || /([가-힣]{2})\1|ー[!！]?|u{2,}/.test(spoken)
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
  const jobs = F_CASES.flatMap((c) => Array.from({ length: REPS }, (_, rep) => ({ c, rep })));
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
    const raw = calls[0]?.text ?? '';
    const shape = rawJsonShape(raw, ['dialect', 'strength', 'register', 'markers', 'persona', 'childlike', 'confidence']);
    let rawConfidence: number | null = null;
    try {
      rawConfidence = Number(JSON.parse(raw).confidence);
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
        status: calls[0]?.status ?? null,
        httpError: calls[0]?.error ?? null,
        finishReason: calls[0]?.finishReason ?? null,
        jsonOk: shape.ok,
        extraKeys: shape.extraKeys,
        confidence: rawConfidence,
        latencyMs: calls[0]?.latencyMs ?? null,
      },
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
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—');
function hist(xs: string[]): string {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ') || '—';
}

function summarize(rows: AnyRow[]): string {
  const lines: string[] = [`# Gemini 비교 평가 — ${LABEL}`, '', `모델: ${MODELS.map((m) => m.label).join(' vs ')} · 반복 ${REPS}`, ''];
  const byModel = (suite: string) => MODELS.map((m) => ({ m, rs: rows.filter((r) => r.suite === suite && r.model === m.label) }));

  if (SUITES.has('A')) {
    lines.push('## A 직접 입력 태깅', '', '| 모델 | n | 모델 원문 보존 | JSON 형식 | 여분 필드 | 폴백(로컬) | 최종 보존 | 평균 태그 | 저각성(모델) | 저각성(최종) | 공포 태그 | 태그 뒤 붙여쓰기 | 평균 지연 ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { m, rs } of byModel('A')) {
      const raw = rs.map((r) => r.raw as AnyRow);
      const fin = rs.map((r) => r.final as AnyRow);
      lines.push(`| ${m.label} | ${rs.length} | ${pct(raw.filter((x) => x.preserved).length, rs.length)} | ${pct(raw.filter((x) => x.jsonOk).length, rs.length)} | ${pct(raw.filter((x) => (x.extraKeys as string[]).length).length, rs.length)} | ${pct(fin.filter((x) => x.fallback).length, rs.length)} | ${pct(fin.filter((x) => x.preserved).length, rs.length)} | ${avg(fin.map((x) => x.tagCount as number))} | ${pct(raw.filter((x) => (x.lowArousal as string[]).length).length, rs.length)} | ${pct(fin.filter((x) => ((x.lowArousal as string[]) ?? []).length).length, rs.length)} | ${pct(raw.filter((x) => ((x.fear as string[]) ?? []).length).length, rs.length)} | ${pct(raw.filter((x) => x.tagWithoutSpace).length, rs.length)} | ${avg(raw.map((x) => (x.latencyMs as number) ?? 0))} |`);
    }
    lines.push('');
    for (const { m, rs } of byModel('A')) {
      lines.push(`### A 표본 — ${m.label}`, '');
      for (const r of rs.filter((x) => x.rep === 0)) lines.push(`- \`${r.id}\` ${(r.final as AnyRow).fallback ? '**[폴백]** ' : ''}${r.output}`);
      lines.push('');
    }
  }

  if (SUITES.has('D')) {
    lines.push('## D 사전렌더 문구(등록 미리듣기 포함)', '', '| 모델 | n | 최종 성공 | 1회차 통과 | 평균 시도 | 1회차 거절 사유 | 최종 실패 사유 | 누출(날짜·숫자 등) | 호칭 사용 | 평균 태그 | legacy tag 채움 | 여분 필드 | 평균 길이 | 평균 지연 ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const { m, rs } of byModel('D')) {
      const ok = rs.filter((r) => r.final);
      const first = rs.map((r) => ((r.attempts as AnyRow[])[0]?.reason as string) ?? 'none');
      const allAttempts = rs.flatMap((r) => r.attempts as AnyRow[]);
      const titled = ok.filter((r) => (r.final as AnyRow).titleUsed !== null);
      lines.push(`| ${m.label} | ${rs.length} | ${pct(ok.length, rs.length)} | ${pct(first.filter((x) => x === 'ok').length, rs.length)} | ${avg(rs.map((r) => (r.attempts as AnyRow[]).length))} | ${hist(first.filter((x) => x !== 'ok'))} | ${hist(rs.filter((r) => !r.final).map((r) => String(r.error).slice(0, 40)))} | ${pct(ok.filter((r) => ((r.final as AnyRow).leaks as string[]).length).length, ok.length)} | ${pct(titled.filter((r) => (r.final as AnyRow).titleUsed).length, titled.length)} | ${avg(ok.map((r) => (r.final as AnyRow).tagCount as number))} | ${pct(allAttempts.filter((a) => a.legacyTagFilled).length, allAttempts.length)} | ${pct(allAttempts.filter((a) => ((a.extraKeys as string[]) ?? []).length).length, allAttempts.length)} | ${avg(ok.map((r) => (r.final as AnyRow).length as number))} | ${avg(rs.flatMap((r) => (r.calls as AnyRow[]).map((c) => c.latencyMs as number)))} |`);
    }
    lines.push('', '### D 프로필별 규칙 준수', '', '| 모델 | 프로필 | n | 성공 | 규칙 |', '|---|---|---|---|---|');
    for (const { m, rs } of byModel('D')) {
      for (const pid of [...new Set(rs.map((r) => r.profile as string))]) {
        const prs = rs.filter((r) => r.profile === pid);
        const ok = prs.filter((r) => r.final);
        const f = ok.map((r) => r.final as AnyRow);
        const rule =
          pid.includes('grandma') ? `존대 전 문장 ${pct(f.filter((x) => x.politeAllEndings).length, f.length)}` :
          pid.includes('boyfriend') || pid === 'ko-mom-to-daughter' ? `반말(존대 어미 없음) ${pct(f.filter((x) => x.anyPoliteEnding === false).length, f.length)}` :
          pid.includes('gyeongsang') || pid.includes('kansai') ? `사투리 표지 1개 이상 ${pct(f.filter((x) => ((x.dialectMarkers as string[]) ?? []).length).length, f.length)}` :
          pid.includes('child') ? `아이 철자 ${pct(f.filter((x) => x.childSpelling).length, f.length)} · 존대 섞임 ${pct(f.filter((x) => x.childPolite).length, f.length)}` :
          `누출 ${pct(f.filter((x) => (x.leaks as string[]).length).length, f.length)}`;
        lines.push(`| ${m.label} | ${pid} | ${prs.length} | ${pct(ok.length, prs.length)} | ${rule} · 태그 붙여쓰기 ${pct(f.filter((x) => x.tagWithoutSpace).length, f.length)} · 평균 길이 ${avg(f.map((x) => x.length as number))} |`);
      }
    }
    lines.push('');
    for (const { m, rs } of byModel('D')) {
      lines.push(`### D 표본 — ${m.label}`, '');
      for (const r of rs.filter((x) => x.rep === 0 && (x.profile !== 'ko-mom-to-daughter' || (x.seedIndex as number) < 2)).slice(0, 40)) {
        lines.push(`- \`${r.profile}/${r.category}#${r.seedIndex}\` ${r.output ?? `**실패** ${String(r.error).slice(0, 60)}`}`);
      }
      lines.push('');
    }
  }

  if (SUITES.has('F')) {
    lines.push('## F 말투 분석', '', '| 모델 | n | 결과 있음 | HTTP 오류 | 사투리 정답 | 어체 정답 | 아이 판정 정답 | 표지 원문 일치 | 평균 확신 | 여분 필드 |', '|---|---|---|---|---|---|---|---|---|---|');
    for (const { m, rs } of byModel('F')) {
      const sc = rs.filter((r) => r.score).map((r) => r.score as AnyRow);
      lines.push(`| ${m.label} | ${rs.length} | ${pct(sc.length, rs.length)} | ${pct(rs.filter((r) => (r.raw as AnyRow).status !== 200).length, rs.length)} | ${pct(sc.filter((x) => x.dialect).length, rs.length)} | ${pct(sc.filter((x) => x.register).length, rs.length)} | ${pct(sc.filter((x) => x.childlike).length, rs.length)} | ${avg(sc.filter((x) => x.markersVerbatim !== null).map((x) => (x.markersVerbatim as number) * 100))}% | ${avg(rs.map((r) => ((r.raw as AnyRow).confidence as number) ?? 0))} | ${pct(rs.filter((r) => ((r.raw as AnyRow).extraKeys as string[]).length).length, rs.length)} |`);
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
