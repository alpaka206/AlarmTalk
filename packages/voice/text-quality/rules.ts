// 결정적 규칙 검사 — 전부 순수 함수다(네트워크·시계·난수 없음).
//
// 운영 검사(`packages/backend/src/lib/vertex-translate.ts` 의 `prerenderRejectionReason` 등)를 대신하지 않는다.
// 운영 검사는 거절 사유 하나를 돌려주고 재시도를 부르는 문지기이고, 여기는 **제공자끼리 나란히 놓고 보는 눈금**이다.
// 그래서 더 단순하고, 모든 규칙을 끝까지 다 돌려 결과를 모두 남긴다.

import { HANGUL_RE, inferSynthesisLanguage, KANA_RE } from './language.ts';
import type {
  EvalCandidate,
  EvalItem,
  EvalItemKind,
  KoreanRegister,
  RuleId,
  RuleResult,
} from './types.ts';

// ---------------------------------------------------------------- 상한

/**
 * 사용자가 직접 친 문구의 상한 — `routes/tts.ts` 의 `TEXT_TOO_LONG`(낭독 기준 200자).
 * 등록 미리듣기 직접 수정(`VoicePreviewTextUpdateSchema`)과 생성 문구 검증(`prerenderRejectionReason`)도 200 이다.
 */
export const MANUAL_TEXT_MAX_LENGTH = 200;
export const GENERATED_TEXT_MAX_LENGTH = 200;

/** 종류별 상한. 프리셋은 면제다(`routes/tts.ts` — 영어 프리셋은 그 자체로 200자를 넘는다). */
export function maxLengthFor(kind: EvalItemKind): number | null {
  if (kind === 'preset') return null;
  return kind === 'manual' ? MANUAL_TEXT_MAX_LENGTH : GENERATED_TEXT_MAX_LENGTH;
}

// ---------------------------------------------------------------- 공통

/** 소리 태그 이름 모양 — 백엔드 `TAG_BODY_PATTERN` 과 같다. */
const TAG_BODY_PATTERN = '[a-z][a-z ,-]{1,48}';

/** 낭독되는 말 — 태그를 벗기고 공백을 접는다(백엔드 `normalizeAlarmTextWithoutTags` 와 같은 셈). */
export function spokenText(text: string): string {
  return text
    .replace(new RegExp(`\\s*\\[${TAG_BODY_PATTERN}\\]\\s*`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pass = (rule: RuleId, detail: string | null = null): RuleResult => ({
  rule,
  status: 'pass',
  detail,
});
const fail = (rule: RuleId, detail: string): RuleResult => ({ rule, status: 'fail', detail });
const skip = (rule: RuleId, detail: string): RuleResult => ({ rule, status: 'skip', detail });

// ---------------------------------------------------------------- 빈 문장·길이

export function checkNonEmpty(output: string | null): RuleResult {
  if (output == null) return fail('non_empty', '출력 없음');
  // 문장부호·태그만 남으면 낭독할 말이 없다 — 글자나 숫자가 하나는 있어야 한다.
  if (!/[\p{L}\p{N}]/u.test(spokenText(output))) return fail('non_empty', '낭독할 글자가 없다');
  return pass('non_empty');
}

/** 길이는 낭독 기준(태그 제외)으로, 백엔드처럼 UTF-16 코드 유닛으로 센다. */
export function checkMaxLength(output: string | null, max: number | null): RuleResult {
  if (max == null) return skip('max_length', '프리셋은 상한 면제');
  if (output == null) return skip('max_length', '출력 없음');
  const length = spokenText(output).length;
  return length <= max
    ? pass('max_length', `${length}/${max}`)
    : fail('max_length', `${length}자 > ${max}자`);
}

// ---------------------------------------------------------------- 마크업·이모지

/** 사용자가 친 글자 웃음(ㅋㅋ·ㅎㅎ·haha·lol·www·(笑)) — 있으면 운영이 `[laughs]` 로 바꿔 합성한다. */
export function hasTypedLaughter(text: string): boolean {
  return (
    /(?<![ㄱ-ㆎ])[ㅋㅎ]{2,}(?![ㄱ-ㆎ])/u.test(text) ||
    /\b(?:ha){2,}\b|\blol\b|\bw{3,}\b/i.test(text) ||
    /[(（]笑[)）]/u.test(text)
  );
}

const SSML_OR_HTML_RE = /<\s*\/?\s*[a-zA-Z][^>]*>|<!--|&lt;|&gt;/;
const MARKDOWN_RE = /\*\*|__|`|^\s*#{1,6}\s|^\s*[-*]\s+\S/m;
const BRACKET_RE = /\[[^\]\n]{0,60}\]/g;
const PAREN_RE = /[(（][^)）\n]{1,30}[)）]/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * 출력에 **입력에 없던** 마크업이 생겼는가: SSML·HTML 태그, 마크다운, 대괄호 태그, 지문 괄호, 이모지.
 *
 * 입력에 있던 것은 사용자의 의도라 그대로 허용한다(운영도 사용자가 친 대괄호는 거르지 않는다 —
 * `prepareAlarmTextWithVertex`). 입력에 글자 웃음이 있으면 `[laughs]` 도 허용한다.
 */
export function checkNoMarkup(output: string | null, input: string): RuleResult {
  if (output == null) return skip('no_markup', '출력 없음');
  const found: string[] = [];
  if (SSML_OR_HTML_RE.test(output) && !SSML_OR_HTML_RE.test(input)) found.push('SSML/HTML 태그');
  if (MARKDOWN_RE.test(output) && !MARKDOWN_RE.test(input)) found.push('마크다운');

  const inputBrackets = new Set((input.match(BRACKET_RE) ?? []).map((b) => b.toLowerCase()));
  if (hasTypedLaughter(input)) inputBrackets.add('[laughs]');
  const newBrackets = (output.match(BRACKET_RE) ?? []).filter(
    (b) => !inputBrackets.has(b.toLowerCase()),
  );
  if (newBrackets.length > 0) found.push(`대괄호 태그 ${newBrackets.join(' ')}`);

  const newParens = (output.match(PAREN_RE) ?? []).filter((p) => !input.includes(p));
  if (newParens.length > 0) found.push(`지문 괄호 ${newParens.join(' ')}`);

  const inputEmoji = new Set(input.match(EMOJI_RE) ?? []);
  const newEmoji = (output.match(EMOJI_RE) ?? []).filter((e) => !inputEmoji.has(e));
  if (newEmoji.length > 0) found.push(`이모지 ${[...new Set(newEmoji)].join('')}`);

  return found.length === 0 ? pass('no_markup') : fail('no_markup', found.join(', '));
}

// ---------------------------------------------------------------- 숫자·시각

/** 글 속의 숫자(전각 포함)를 앞자리 0 을 뗀 정수 문자열로. '07:30' → ['7', '30']. */
export function extractNumbers(text: string): string[] {
  return (text.match(/[0-9０-９]+/g) ?? []).map((run) => {
    const ascii = run.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
    return ascii.replace(/^0+(?=\d)/, '');
  });
}

/**
 * 입력의 숫자가 출력에 **개수까지** 남았는가('7시 30분' → 7·30). 번역('7:30 AM')도 숫자는 그대로라 같은 셈으로 본다.
 * 출력에만 있는 숫자는 실패로 치지 않고 detail 에만 적는다(생성 문구가 날짜를 덧붙이는 것은 다른 규칙의 몫이다).
 */
export function checkNumbersPreserved(
  output: string | null,
  input: string,
  enabled = true,
): RuleResult {
  if (!enabled) return skip('numbers_preserved', '이 문항은 숫자 보존을 보지 않는다');
  const wanted = extractNumbers(input);
  if (wanted.length === 0) return skip('numbers_preserved', '입력에 숫자 없음');
  if (output == null) return fail('numbers_preserved', '출력 없음');
  const have = extractNumbers(output);
  const pool = [...have];
  const missing: string[] = [];
  for (const n of wanted) {
    const at = pool.indexOf(n);
    if (at === -1) missing.push(n);
    else pool.splice(at, 1);
  }
  if (missing.length > 0) return fail('numbers_preserved', `빠진 숫자 ${missing.join(', ')}`);
  return pass(
    'numbers_preserved',
    pool.length > 0 ? `출력에만 있는 숫자 ${pool.join(', ')}` : null,
  );
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function checkRequiredPhrases(
  output: string | null,
  phrases: string[] | undefined,
): RuleResult {
  if (!phrases || phrases.length === 0) return skip('required_phrases', '지정 구절 없음');
  if (output == null) return fail('required_phrases', '출력 없음');
  const text = collapse(output);
  const missing = phrases.filter((p) => !text.includes(collapse(p)));
  return missing.length === 0
    ? pass('required_phrases')
    : fail('required_phrases', `빠진 구절 ${missing.join(' / ')}`);
}

// ---------------------------------------------------------------- 언어

/**
 * 허용 언어로 쓰였는가. 판정은 백엔드 `inferSynthesisLanguage` 사본이다(한글 한 글자면 ko).
 * 거기에 더해, 허용 목록에 없는 문자(한국어 줄의 가나 등)가 섞여도 실패로 본다.
 */
export function checkLanguage(
  output: string | null,
  allowed: string[],
  ignoreTerms: string[] = [],
): RuleResult {
  if (output == null) return skip('language', '출력 없음');
  let text = spokenText(output);
  for (const term of ignoreTerms) text = text.split(term).join(' ');
  const inferred = inferSynthesisLanguage(text, allowed[0] ?? 'ko');
  if (!allowed.includes(inferred))
    return fail('language', `${inferred} 로 판정(허용 ${allowed.join(',')})`);
  if (!allowed.includes('ja') && KANA_RE.test(text)) return fail('language', '가나가 섞였다');
  if (!allowed.includes('ko') && HANGUL_RE.test(text)) return fail('language', '한글이 섞였다');
  return pass('language', inferred);
}

// ---------------------------------------------------------------- 변형 선택

/** 후보 id 모양 — 영숫자로 시작하고 영숫자·`._:-` 만, 128자 이하. */
export const CANDIDATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** 고른 id 가 후보 목록에 있는가. 후보 목록 자체의 id 형식·중복도 본다. */
export function checkCandidateId(
  selectedId: string | null,
  candidates: EvalCandidate[] | undefined,
): RuleResult {
  if (!candidates || candidates.length === 0) return skip('candidate_id', '선택 문항 아님');
  const ids = candidates.map((c) => c.id);
  const malformed = ids.filter((id) => !CANDIDATE_ID_RE.test(id));
  if (malformed.length > 0)
    return fail('candidate_id', `후보 id 형식 오류 ${malformed.join(', ')}`);
  if (new Set(ids).size !== ids.length) return fail('candidate_id', '후보 id 중복');
  if (selectedId == null) return fail('candidate_id', '고른 id 없음');
  return ids.includes(selectedId)
    ? pass('candidate_id', selectedId)
    : fail('candidate_id', `후보에 없는 id ${selectedId}`);
}

/**
 * 최근 N개 제외 — 최근 목록(**최신이 앞**)의 앞 N개는 고르지 않는다.
 * 후보가 전부 그 안에 있으면 지킬 수 없으므로 skip 으로 남긴다(고른 것을 탓하지 않는다).
 */
export function checkRecentExcluded(
  selectedId: string | null,
  candidates: EvalCandidate[] | undefined,
  recent: string[] | undefined,
  window: number | undefined,
): RuleResult {
  if (!candidates || candidates.length === 0) return skip('recent_excluded', '선택 문항 아님');
  if (!recent || recent.length === 0 || !window || window <= 0)
    return skip('recent_excluded', '최근 기록 없음');
  const excluded = new Set(recent.slice(0, window));
  const eligible = candidates.filter((c) => !excluded.has(c.id));
  if (eligible.length === 0)
    return skip('recent_excluded', `후보 전부가 최근 ${window}개 안 — 적용 불가`);
  if (selectedId == null) return fail('recent_excluded', '고른 id 없음');
  return excluded.has(selectedId)
    ? fail('recent_excluded', `최근 ${window}개 안의 ${selectedId} 를 골랐다`)
    : pass('recent_excluded');
}

// ---------------------------------------------------------------- 한국어 어체

const KO_POLITE_END = /(?:요|니다|니까|시오|죠)$/u;
// 문장 끝 반말 어미. '-고'·'-게' 처럼 이음 어미와 겹치는 것은 일부러 뺐다 — 문장 끝만 보므로 그래도 대개 맞는다.
const KO_BANMAL_END =
  /(?:야|어|아|나|여|해|봐|와|줘|겨|켜|돼|워|가|지|자|래|대|네|냐|니|다|라|걸|까|거든|잖아|구나|군|게)$/u;

const KO_PARTICLE_END = /(?:까지|부터|에게|한테|처럼|보다)$/u;

export type KoreanEnding = { word: string; kind: 'polite' | 'banmal' };

/**
 * 문장마다 끝 낱말의 어체. 문장부호·이모지·웃음(ㅋㅋ) 같은 장식은 걷고 읽는다.
 * 한 낱말짜리 문장이 '-야/-아' 로 끝나면 부름말('민지야!')로 보고 건너뛴다.
 *
 * ⚠ 운영 검사(`koreanRegisterViolation`)보다 단순하다 — 쉼표로 이은 절과 관계·청자 호칭은 보지 않는다.
 *   어긋나는 판정을 찾으면 여기를 넓히기 전에 운영 쪽 판정과 견주어 본다.
 */
export function koreanEndings(text: string): KoreanEnding[] {
  return spokenText(text)
    .split(/(?<=[.!?！？…~\n])/u)
    .map((s) => s.replace(/[^가-힣\s]+/gu, ' ').trim())
    .filter(Boolean)
    .flatMap((sentence): KoreanEnding[] => {
      const words = sentence.split(/\s+/);
      const word = words[words.length - 1]!;
      if (words.length === 1 && /[야아]$/u.test(word)) return [];
      // 조사로 끝난 마디('6시 전까지')는 서술어가 아니다. 명사로 끝난 마디('빨래')는 못 가른다 — 이 검사의 한계다.
      if (KO_PARTICLE_END.test(word)) return [];
      if (KO_POLITE_END.test(word)) return [{ word, kind: 'polite' }];
      if (KO_BANMAL_END.test(word)) return [{ word, kind: 'banmal' }];
      return [];
    });
}

export function checkKoreanRegister(
  output: string | null,
  targetLanguage: string,
  expected: KoreanRegister = 'consistent',
): RuleResult {
  if (targetLanguage !== 'ko') return skip('korean_register', '한국어 문항 아님');
  if (output == null) return skip('korean_register', '출력 없음');
  const endings = koreanEndings(output);
  if (endings.length === 0) return pass('korean_register', '어미를 읽지 못함');
  const polite = endings.filter((e) => e.kind === 'polite').map((e) => e.word);
  const banmal = endings.filter((e) => e.kind === 'banmal').map((e) => e.word);
  if (expected === 'polite' && banmal.length > 0)
    return fail('korean_register', `존댓말이어야 하는데 반말 ${banmal.join(', ')}`);
  if (expected === 'banmal' && polite.length > 0)
    return fail('korean_register', `반말이어야 하는데 존댓말 ${polite.join(', ')}`);
  if (polite.length > 0 && banmal.length > 0) {
    return fail(
      'korean_register',
      `섞임 — 존댓말 ${polite.join(', ')} / 반말 ${banmal.join(', ')}`,
    );
  }
  return pass('korean_register', polite.length > 0 ? 'polite' : 'banmal');
}

// ---------------------------------------------------------------- 금지 약속

/**
 * 알람이 해서는 안 되는 약속 — 건강(낫는다·살 빠진다), 운세(당첨·반드시), 수익(돈 번다).
 * **작은 출발 목록**이다. 문구에 이 낱말이 있다고 다 틀린 것은 아니어서, 입력에 이미 있던 말은 보지 않는다
 * (사용자가 '로또 사러 가자' 라고 쳤으면 그건 사용자의 글이다). 제공자가 **새로 만든** 약속만 잡는다.
 */
export const BANNED_PROMISES: Record<'health' | 'fortune' | 'revenue', string[]> = {
  health: [
    '완치',
    '병이 나을',
    '병이 낫',
    '치료됩니다',
    '치료돼',
    '면역력이 올라',
    '면역력이 좋아',
    '살이 빠질',
    '살이 쏙',
    '부작용 없',
    '효과가 보장',
    '건강이 보장',
    '약 안 먹어도',
    '약을 끊어도',
    'cure',
    'cures',
    'will heal',
    'heal you',
    'no side effects',
    'guaranteed to work',
    'lose weight',
    'boost your immune',
    'stop taking your',
    '完治',
    '治ります',
    '病気が治',
    '副作用なし',
    '副作用はない',
    '必ず痩せ',
    '痩せられ',
    '免疫力が上が',
  ],
  fortune: [
    '로또',
    '복권 당첨',
    '당첨될',
    '반드시 좋은 일',
    '무조건 좋은 일',
    '대박 날 거',
    '대박이 날',
    '틀림없이',
    '100%',
    'lottery',
    'jackpot',
    'you will win',
    "you'll win",
    'guaranteed luck',
    'definitely lucky',
    '宝くじ',
    '当選',
    '必ず当たる',
    '絶対に幸運',
    '大当たり',
  ],
  revenue: [
    '수익 보장',
    '수익이 보장',
    '돈을 벌 수 있',
    '돈이 들어올 거',
    '부자가 될',
    '부자 될',
    '원금 보장',
    '주식이 오를',
    '코인이 오를',
    '투자하면',
    'get rich',
    'make money',
    'guaranteed return',
    'double your money',
    'stocks will',
    'crypto',
    '必ず儲か',
    '儲かる',
    '稼げる',
    '元本保証',
    'お金持ちになれ',
    '株が上が',
  ],
};

function containsTerm(text: string, term: string): boolean {
  // 라틴 낱말은 낱말 경계로 본다('cure' 가 'secure' 에 걸리지 않게). 나머지는 부분 문자열이다.
  if (/^[a-z' ]+$/i.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  }
  return text.includes(term);
}

export function checkBannedPromises(output: string | null, input: string): RuleResult {
  if (output == null) return skip('banned_promise', '출력 없음');
  const hits: string[] = [];
  for (const [category, terms] of Object.entries(BANNED_PROMISES)) {
    for (const term of terms) {
      if (containsTerm(output, term) && !containsTerm(input, term))
        hits.push(`${category}:${term}`);
    }
  }
  return hits.length === 0 ? pass('banned_promise') : fail('banned_promise', hits.join(', '));
}

// ---------------------------------------------------------------- 한 문항 전체

/** 한 문항에 모든 규칙을 돌린다. 순서는 보고서의 열 순서다. */
export function runRules(
  item: EvalItem,
  output: { text: string | null; selectedId: string | null },
): RuleResult[] {
  const expect = item.expect ?? {};
  const allowed = expect.allowedLanguages ?? [item.targetLanguage];
  return [
    checkNonEmpty(output.text),
    checkMaxLength(output.text, maxLengthFor(item.kind)),
    checkNoMarkup(output.text, item.input),
    checkNumbersPreserved(output.text, item.input, expect.preserveNumbers ?? true),
    checkRequiredPhrases(output.text, expect.mustContain),
    checkLanguage(output.text, allowed, expect.allowedForeignTerms),
    checkCandidateId(output.selectedId, item.candidates),
    checkRecentExcluded(output.selectedId, item.candidates, item.recent, item.recentWindow),
    checkKoreanRegister(output.text, item.targetLanguage, expect.register),
    checkBannedPromises(output.text, item.input),
  ];
}
