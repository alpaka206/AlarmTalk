/**
 * 응원 메시지 페이지의 목소리 목록.
 *
 * 화면은 이 배열만 돈다 — 목소리를 더하거나 빼거나 순서를 바꾸는 일은 **여기서만** 한다.
 * 이름·역할·응원 문장은 `messages/<locale>.json` 의 `cheer.voices.<id>` 에 있고, 소리를
 * 어떻게 내는지는 `cheer-playback.ts` 가 정한다(이 파일은 소리 경로를 모른다).
 *
 * `pitch`/`rate` 는 브라우저 합성 음성으로 낼 때의 톤이다(1.0 이 기본). 전용 생성 경로가
 * 붙으면 그쪽 파라미터로 대체된다.
 */
export type CheerVoice = {
  id: string;
  pitch: number;
  rate: number;
};

export const CHEER_VOICES: readonly CheerVoice[] = [
  { id: "actor", pitch: 0.9, rate: 0.95 },
  { id: "idol", pitch: 1.15, rate: 1.05 },
  { id: "host", pitch: 1.0, rate: 1.1 },
  { id: "announcer", pitch: 0.95, rate: 1.0 },
  { id: "singer", pitch: 1.05, rate: 0.9 },
  { id: "athlete", pitch: 0.85, rate: 1.0 },
] as const;

/** 이름 상한. 응원 한 문장에 들어갈 호칭이라 닉네임(30)보다 짧다. */
export const CHEER_NAME_MAX_LENGTH = 12;

/**
 * 거르는 글자 — 앱 `sanitizeDisplayName` 과 같은 세 묶음. 코드포인트 숫자로 적는다:
 * 이스케이프로 적으면 편집기·리뷰 도구에서 보이지 않는 글자가 그대로 실린다.
 */
function isDroppedCodePoint(cp: number): boolean {
  const control = cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
  const zeroWidth = (cp >= 0x200b && cp <= 0x200f) || cp === 0x2060 || cp === 0xfeff;
  const bidi = (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
  return control || zeroWidth || bidi;
}

/**
 * 이름 입력 정리 — 앱의 `sanitizeDisplayName` 과 **같은 글자 규칙**이다(CLAUDE.md
 * 「입력 규칙은 한 곳에서만」). 랜딩은 shared 패키지를 물지 않으므로 규칙을 옮겨 적되,
 * 거르는 것(제어문자·제로폭·양방향 제어)과 남기는 것(문장부호)을 바꾸지 않는다.
 * 줄바꿈·탭은 지우지 않고 공백으로 바꾼다. 자를 때 서러게이트 쌍을 가르지 않는다.
 */
export function sanitizeCheerName(raw: string): string {
  const chars: string[] = [];
  for (const ch of raw.replace(/[\r\n\t]+/g, " ")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isDroppedCodePoint(cp)) continue;
    chars.push(ch);
  }
  const cleaned = chars.join("").replace(/ {2,}/g, " ").trimStart();
  return Array.from(cleaned).slice(0, CHEER_NAME_MAX_LENGTH).join("");
}
