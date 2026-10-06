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
 * 판정은 '전사의 몇 할이 대본에서 왔는가'(포함률)다 — 대본의 일부만 읽어도(등록 최소 길이는 12초라 두세 문장이면
 * 된다) 전사 전부가 대본이라 1 에 가깝고, 전사 오류(띄어쓰기·받아쓰기 틀림·한자/가나 바꿈·숫자를 아라비아 숫자로)는
 * 그 낱말 둘레의 묶음만 깎는다. 대본을 읽다 자유롭게 덧붙이면 덧붙인 만큼 내려간다.
 */
export const ENROLLMENT_SCRIPT_READ_THRESHOLD = 0.5;

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
 * 비교 단위. 한국어·일본어는 **연이은 글자 셋** — 띄어쓰기가 전사마다 다르고(한국어) 아예 없다(일본어). 영어는 **연이은
 * 낱말 둘** — 글자 묶음은 흔한 철자('the'·'ing')가 아무 영어 글에나 있어 자유 발화도 대본처럼 보인다.
 */
function comparisonUnits(text: string, language: VoiceEnrollmentScriptLanguage): string[] {
  if (language === 'en') {
    const list = words(text);
    return list.slice(1).map((word, i) => `${list[i]} ${word}`);
  }
  const letters = lettersOnly(text);
  const units: string[] = [];
  for (let i = 0; i + 3 <= letters.length; i += 1) units.push(letters.slice(i, i + 3).join(''));
  return units;
}

const SCRIPT_UNITS = VOICE_ENROLLMENT_SCRIPT_LANGUAGES.map((language) => ({
  language,
  units: new Set(comparisonUnits(VOICE_ENROLLMENT_SCRIPTS[language], language)),
}));

/**
 * 전사의 비교 단위 중 대본에도 있는 것의 비율(0~1) — 세 언어 대본 중 가장 높은 값. 앱 언어와 목소리 언어가 다를 수
 * 있어(한국어 앱에서 일본어 목소리를 만든다) 대본 언어를 가정하지 않는다.
 */
export function enrollmentScriptCoverage(transcript: string): number {
  let best = 0;
  for (const script of SCRIPT_UNITS) {
    const units = comparisonUnits(transcript, script.language);
    if (units.length === 0) continue;
    const coverage = units.filter((unit) => script.units.has(unit)).length / units.length;
    if (coverage > best) best = coverage;
  }
  return best;
}

export function isEnrollmentScriptReading(transcript: string): boolean {
  return enrollmentScriptCoverage(transcript) >= ENROLLMENT_SCRIPT_READ_THRESHOLD;
}
