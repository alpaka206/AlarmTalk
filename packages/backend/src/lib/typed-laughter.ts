/**
 * 직접 입력 문구의 **글자 웃음**(ㅋㅋ·ㅎㅎ·haha·lol·www·(笑))을 ElevenLabs 소리 태그 `[laughs]` 로 바꾼다.
 *
 * 왜: TTS 는 글자를 **읽는다**. 2026-09-29 비교(v3·v4·v4 Turbo, 받아쓰기 기준)에서 `ㅋㅋㅋ` 는
 * v4 가 "크크크/큭큭큭" 으로 읽었고 v3 는 건너뛰었다. `www` 는 "www"·"笑笑笑" 로 읽혔고, `(笑)` 는
 * v3 에서 엉뚱한 외국어가 됐다. `lol` 은 모든 모델이 낱말로 읽었다. 반대로 `[laughs]` 는 한국어에서
 * 세 모델 모두 웃음소리가 났고, 안 날 때도 **글자로 읽지는 않았다**(생략) — 그래서 이 태그 하나로 모은다.
 *
 * ⚠ **`[soft laugh]`·`[chuckles]` 로 바꾸지 말 것.** `soft` 는 깨우는 경로의 졸린 태그 가드
 *   (`LOW_AROUSAL_WORDS`)에 걸려 모델 출력에서 지워지고, v3 에서 받아쓰기상 웃음이 안 난 적이 있다.
 *   `[chuckles]` 는 v3 남자 목소리에서 한 번 **다른 언어**로 합성됐다. 같은 비교에서 둘 다 없었던
 *   실패가 `[laughs]` 에는 없었다.
 *
 * ⚠ **이 변환은 합성 글자에만 쓴다 — 화면 문구는 사용자가 친 그대로다**(`routes/tts.ts` 의 `messageText`).
 *
 * 건드리지 않는 것:
 * - 이미 소리 나는 낱말(하하하·호호·크크·히히) — 하하하는 세 모델 모두 웃음으로 났다.
 * - 다른 자모와 붙은 ㅋ·ㅎ(ㅇㅋ·ㅎㅇ·ㅎㄷㄷ·ㅋㅋㅠㅠ) — 웃음이 아니거나 웃음만이 아니다.
 * - 낱말 속 글자(Lolita·work·笑顔·微笑)와 주소(www.example.com).
 */

/** 이 모듈이 만드는 유일한 태그. */
export const LAUGH_TAG = '[laughs]';

// 한국어: 호환 자모 ㅋ(U+314B)·ㅎ(U+314E)의 연속. 앞뒤에 다른 호환 자모(U+3131–U+318E)가 붙어 있으면 건너뛴다.
const KOREAN_JAMO_LAUGH = /(?<![ㄱ-ㆎ])[ㅋㅎ]+(?![ㄱ-ㆎ])/gu;

// 영어: haha(ha)·ahaha·hehe·lol(ol)·lmao·lmfao. 라틴 글자·숫자 사이에 끼어 있으면 낱말의 일부다.
const LATIN_LAUGH =
  /(?<![\p{Script=Latin}\p{N}])(?:a?(?:ha){2,}h?|(?:he){2,}h?|lol(?:ol)*|lmf?ao+)(?![\p{Script=Latin}\p{N}])/giu;

// 일본어: (笑)·（笑）·(爆笑).
const JAPANESE_PAREN_LAUGH = /[(（]爆?笑[)）]/gu;

// 일본어: 문장 끝에 붙는 笑(「だよ笑」). 앞이 한자면 낱말(微笑·苦笑·爆笑)이고, 뒤에 글자가 오면
// 낱말(笑顔·笑う)이라 건너뛴다.
const JAPANESE_BARE_LAUGH =
  /(?<=^|[\s\p{Script=Hiragana}\p{Script=Katakana}ー〜~、。！？!?])笑(?![\p{L}\p{N}])/gu;

// 주소·영단어가 이어지는가 — w 뒤에 라틴 글자·숫자, 또는 '.글자' 가 오면 웃음이 아니다.
const NOT_URL_OR_WORD = '(?![\\p{Script=Latin}\\p{N}]|\\.[\\p{Script=Latin}\\p{N}])';

// 일본어: 가나·한자·일본어 문장부호 바로 뒤의 w 는 한 글자라도 웃음이다(「だよw」).
const JAPANESE_W_AFTER_KANA = new RegExp(
  `(?<=[\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}ー〜、。！？」』）])[wWｗＷ]+${NOT_URL_OR_WORD}`,
  'gu',
);

// 그 밖의 자리(문두·공백 뒤)에서는 두 글자 이상일 때만(ww·www) — 한 글자 w 는 흔한 약어라 건드리지 않는다.
const STANDALONE_W = new RegExp(
  `(?<![\\p{Script=Latin}\\p{N}])[wWｗＷ]{2,}${NOT_URL_OR_WORD}`,
  'gu',
);

const LAUGH_PATTERNS = [
  JAPANESE_PAREN_LAUGH,
  JAPANESE_BARE_LAUGH,
  KOREAN_JAMO_LAUGH,
  LATIN_LAUGH,
  JAPANESE_W_AFTER_KANA,
  STANDALONE_W,
];

/**
 * 글자 웃음을 `[laughs]` 로 바꾼다. 웃음이 없으면 **입력을 한 글자도 바꾸지 않고** 돌려준다 —
 * 웃음 없는 문구의 합성 글자(곧 캐시 키)가 이 변환 때문에 바뀌면 안 된다.
 *
 * ⚠ 웃음만 있는 문구('ㅋㅋㅋ')도 여기서는 바꾼다. '낭독할 말이 남는가' 는 호출부가 본다
 *   (`vertex-translate.ts` 의 `speakTypedLaughter`) — 태그를 벗기는 규칙이 거기 있다.
 */
export function typedLaughterToTags(text: string): string {
  let converted = text;
  let changed = false;
  for (const pattern of LAUGH_PATTERNS) {
    converted = converted.replace(pattern, () => {
      changed = true;
      return ` ${LAUGH_TAG} `;
    });
  }
  if (!changed) return text;
  return (
    converted
      // 붙어 있던 웃음(ㅋㅋ haha, 사용자가 이미 친 [laughs] 옆의 ㅋㅋ)은 한 번만 웃는다.
      .replace(/\[laughs\](?:\s*\[laughs\])+/gi, LAUGH_TAG)
      // 문장부호 앞의 공백은 되돌린다('좋아ㅋㅋ.' → '좋아 [laughs].').
      .replace(/\[laughs\] +(?=[.,!?…~〜。、！？])/gi, LAUGH_TAG)
      .replace(/ {2,}/g, ' ')
      .trim()
  );
}
