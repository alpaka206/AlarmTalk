/**
 * 이벤트 1 의 목록 — **누구 목소리로, 어떤 메시지를**.
 *
 * 화면은 이 두 배열만 돈다. 인물을 더하거나 빼거나 순서를 바꾸는 일은 여기서만 한다. 이름·사진
 * 대체 텍스트는 `messages/<locale>.json` 의 `event.celebrities.<id>`, 메시지 문장은
 * `event.studio.kinds.<kind>.line`. 소리를 어떻게 만드는지는 `event-api.ts` 가 정한다.
 *
 * `portrait` 는 `public/` 아래 경로다. 파일이 없으면 화면은 이니셜 원으로 대신 그린다
 * (`event-studio.tsx` 의 `Portrait`) — 사진은 초상권 허락을 받은 것만 넣는다.
 * `pitch`/`rate` 는 생성 서버가 붙기 전 브라우저 합성 음성으로 낼 때의 톤이다(1.0 이 기본).
 */
export type Celebrity = {
  id: string;
  portrait: string;
  pitch: number;
  rate: number;
};

/** 이 페이지의 이벤트 번호(`lib/events.ts`). 좋아요 카운터의 키다. */
export const EVENT_ID = "1";

export const CELEBRITIES: readonly Celebrity[] = [
  { id: "winter", portrait: "/event/winter.jpg", pitch: 1.12, rate: 1.02 },
  { id: "nanami", portrait: "/event/nanami.jpg", pitch: 1.06, rate: 0.96 },
] as const;

/** 메시지 종류. 순서가 곧 화면의 선택지 순서다. */
export const MESSAGE_KINDS = ["birthday", "comfort"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** 이름 상한. 영어 이름·성까지 들어가게 넉넉히(2026-09-15 지시). 한 문장의 호칭이라 닉네임(30)보다는 짧다. */
export const EVENT_NAME_MAX_LENGTH = 20;

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
export function sanitizeEventName(raw: string): string {
  const chars: string[] = [];
  for (const ch of raw.replace(/[\r\n\t]+/g, " ")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isDroppedCodePoint(cp)) continue;
    chars.push(ch);
  }
  const cleaned = chars.join("").replace(/ {2,}/g, " ").trimStart();
  return Array.from(cleaned).slice(0, EVENT_NAME_MAX_LENGTH).join("");
}

/**
 * 고정 본문 클립 경로. 이름 뒤에 붙는 문장(`event.studio.kinds.<kind>.line` 에서 이름을 뺀 부분)을
 * 그 인물 목소리로 **미리** 만들어 둔 파일이다 — 요청마다 만드는 것은 이름뿐(`event-api.ts`).
 *
 *   public/event/clips/<celebrity>-<kind>.<locale>.mp3   예) winter-birthday.ko.mp3
 *
 * 파일이 없으면(아직 안 만든 언어·인물) 생성이 실패하고 화면은 브라우저 합성 음성으로 물러난다.
 */
export function bodyClipSrc(celebrityId: string, kind: MessageKind, locale: string): string {
  return `/event/clips/${celebrityId}-${kind}.${locale}.mp3`;
}

/**
 * 부르는 꼴 — 이름 클립에 **읽힐** 글자이자 화면의 문장에 **보일** 글자.
 *
 * 한국어는 받침이 있으면 「아」, 없으면 「야」(지민→지민아, 하나→하나야). 마지막 글자가
 * 한글이 아니면(영어 이름·숫자·이모지) 조사를 붙이지 않는다 — 어떤 소리로 끝나는지 알 수
 * 없어 틀린 조사가 붙느니 없는 편이 낫다. 영어·일본어는 이름만 부른다.
 *
 * 백엔드 `routes/event.ts` 의 `vocative` 와 같은 규칙이다(랜딩은 shared 를 물지 않아 옮겨 적음).
 * 한쪽을 고치면 다른 쪽도 같이 고친다 — 서버가 만든 소리와 화면 글자가 어긋나면 안 된다.
 */
export function vocative(name: string, locale: string): string {
  if (locale !== "ko" || !name) return name;
  const lastCp = Array.from(name).at(-1)!.codePointAt(0)!;
  if (lastCp < 0xac00 || lastCp > 0xd7a3) return name;
  const hasFinal = (lastCp - 0xac00) % 28 !== 0;
  return name + (hasFinal ? "아" : "야");
}
