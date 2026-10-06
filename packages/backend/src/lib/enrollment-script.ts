import {
  VOICE_ENROLLMENT_SCRIPT_LANGUAGES,
  VOICE_ENROLLMENT_SCRIPTS,
  type VoiceEnrollmentScriptLanguage,
} from '@alarmtalk/shared';

/**
 * 등록 녹음 전사가 **제시 대본을 읽은 것인가** — 말투 분석이 어체(register)를 버릴지 정한다(스펙 §4-2
 * '제시 대본을 읽은 녹음의 어체는 화자의 것이 아니다').
 *
 * 대본(`VOICE_ENROLLMENT_SCRIPTS`)은 세 언어 모두 존댓말이라, 그대로 읽은 사람은 누구든 '정중체' 로 분석됐다. 그 어체가
 * 사전렌더 프롬프트에 실리고 일본어 가족 です・ます 검사까지 꺼서, 대본을 읽은 엄마 목소리가 딸에게 존댓말로 알람을
 * 읽었다. 모델에게 "대본이면 어체를 비워라" 고만 시키면 따를지 말지가 모델에 달려 있으므로 **서버가 글자로 가린다.**
 *
 * 판정은 둘 다 맞아야 한다:
 * - **포함률** — 전사의 서로 다른 비교 단위 중 대본에도 있는 것의 비율이 이 값 이상. 대본의 일부만 읽어도(등록 최소
 *   길이는 12초라 두세 문장이면 된다) 전사 전부가 대본이라 1 에 가깝고, 전사 오류(띄어쓰기·받아쓰기 틀림·한자/가나
 *   바꿈)는 그 낱말 둘레의 묶음만 깎는다. 대본을 읽다 자유롭게 덧붙이면 덧붙인 만큼 내려간다.
 * - **대본 분량** — 대본과 겹친 서로 다른 단위가 `ENROLLMENT_SCRIPT_MIN_MATCHED_UNITS` 이상(Codex #864). 같은 말을
 *   되풀이한 자유 발화('안녕하세요' 네 번)는 포함률만 보면 대본처럼 보인다 — 되풀이는 세지 않고(서로 다른 단위), 대본의
 *   가장 짧은 문장만큼은 겹쳐야 대본으로 본다.
 */
export const ENROLLMENT_SCRIPT_READ_THRESHOLD = 0.5;

/**
 * 대본과 겹쳐야 하는 서로 다른 비교 단위의 최소 수 — 대본의 가장 짧은 문장 하나 분량이다('이번에는 숫자도 읽어 볼까요?'
 * 는 글자 셋 묶음 10개, 'Now, shall we read some numbers together?' 는 낱말 둘 묶음 6개).
 */
export const ENROLLMENT_SCRIPT_MIN_MATCHED_UNITS = { letters: 10, words: 6 } as const;

/**
 * 대본의 숫자 줄을 받아쓰기는 아라비아 숫자로(일본어는 한자 숫자로도) 적는다 — 그 꼴도 대본으로 센다(Codex #864). 안 그러면
 * 숫자 줄을 읽은 부분이 통째로 대본 밖으로 세어진다. `spoken` 은 대본에 있는 글 그대로다(테스트가 대본에 있는지 지킨다).
 */
export const ENROLLMENT_SCRIPT_NUMBER_LINES: Readonly<
  Record<VoiceEnrollmentScriptLanguage, { spoken: string; written: readonly string[] }>
> = {
  ko: {
    spoken: '하나, 둘, 셋, 넷, 다섯, 여섯, 일곱, 여덟, 아홉, 열',
    written: ['1, 2, 3, 4, 5, 6, 7, 8, 9, 10'],
  },
  en: {
    spoken: 'One, two, three, four, five, six, seven, eight, nine, ten',
    written: ['1, 2, 3, 4, 5, 6, 7, 8, 9, 10'],
  },
  ja: {
    spoken: 'いち、に、さん、し、ご、ろく、なな、はち、きゅう、じゅう',
    written: ['1、2、3、4、5、6、7、8、9、10', '一、二、三、四、五、六、七、八、九、十'],
  },
};

/** 글자·숫자만 남긴다(NFKC·소문자) — 문장부호·띄어쓰기·줄바꿈은 전사마다 달라 비교에서 뺀다. */
function lettersOnly(text: string): string[] {
  return Array.from(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, ''),
  );
}

function words(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * 비교 단위(서로 다른 것만). 한국어·일본어는 **연이은 글자 셋** — 띄어쓰기가 전사마다 다르고(한국어) 아예 없다(일본어).
 * 영어는 **연이은 낱말 둘** — 글자 묶음은 흔한 철자('the'·'ing')가 아무 영어 글에나 있어 자유 발화도 대본처럼 보인다.
 */
function comparisonUnits(text: string, language: VoiceEnrollmentScriptLanguage): Set<string> {
  const units = new Set<string>();
  if (language === 'en') {
    const list = words(text);
    for (let i = 1; i < list.length; i += 1) units.add(`${list[i - 1]} ${list[i]}`);
    return units;
  }
  const letters = lettersOnly(text);
  for (let i = 0; i + 3 <= letters.length; i += 1) units.add(letters.slice(i, i + 3).join(''));
  return units;
}

const SCRIPT_UNITS = VOICE_ENROLLMENT_SCRIPT_LANGUAGES.map((language) => {
  const script = VOICE_ENROLLMENT_SCRIPTS[language];
  const { spoken, written } = ENROLLMENT_SCRIPT_NUMBER_LINES[language];
  const units = comparisonUnits(script, language);
  for (const form of written) {
    for (const unit of comparisonUnits(script.replace(spoken, form), language)) units.add(unit);
  }
  return {
    language,
    units,
    minMatched:
      language === 'en'
        ? ENROLLMENT_SCRIPT_MIN_MATCHED_UNITS.words
        : ENROLLMENT_SCRIPT_MIN_MATCHED_UNITS.letters,
  };
});

/**
 * 세 언어 대본 각각에 대한 전사의 포함률(0~1)과 겹친 서로 다른 단위 수. 앱 언어와 목소리 언어가 다를 수 있어(한국어
 * 앱에서 일본어 목소리를 만든다) 대본 언어를 가정하지 않는다.
 */
function scriptMatches(
  transcript: string,
): { coverage: number; matched: number; minMatched: number }[] {
  return SCRIPT_UNITS.map((script) => {
    const units = comparisonUnits(transcript, script.language);
    let matched = 0;
    for (const unit of units) if (script.units.has(unit)) matched += 1;
    return {
      coverage: units.size === 0 ? 0 : matched / units.size,
      matched,
      minMatched: script.minMatched,
    };
  });
}

/** 세 대본 중 가장 높은 포함률(0~1). */
export function enrollmentScriptCoverage(transcript: string): number {
  return Math.max(...scriptMatches(transcript).map((match) => match.coverage));
}

export function isEnrollmentScriptReading(transcript: string): boolean {
  return scriptMatches(transcript).some(
    (match) =>
      match.matched >= match.minMatched && match.coverage >= ENROLLMENT_SCRIPT_READ_THRESHOLD,
  );
}
