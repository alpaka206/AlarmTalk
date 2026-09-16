/**
 * 이벤트 1 의 목록 — **누구 목소리로, 어떤 메시지를**.
 *
 * 화면은 이 두 배열만 돈다. 인물을 더하거나 빼거나 순서를 바꾸는 일은 여기서만 한다. 이름·사진
 * 대체 텍스트는 `messages/<locale>.json` 의 `event.celebrities.<id>`, 메시지 종류 이름은
 * `event.studio.kinds.<kind>.name`. **읽힐 문장은 서버가 정한다**(`packages/backend/src/lib/
 * event-voices.ts`) — 화면은 서버가 만든 문장을 그대로 보여 준다. 여기 인물 id 와 종류 id 는
 * 서버의 것과 같아야 한다.
 *
 * `portrait` 는 `public/` 아래 경로다. 파일이 없으면 화면은 이니셜 원으로 대신 그린다
 * (`event-studio.tsx` 의 `Portrait`) — 사진은 초상권 허락을 받은 것만 넣는다.
 */
export type Celebrity = {
  id: string;
  portrait: string;
};

/** 이 페이지의 이벤트 번호(`lib/events.ts`). 좋아요 카운터·클립 생성의 키다. */
export const EVENT_ID = "1";

export const CELEBRITIES: readonly Celebrity[] = [
  { id: "winter", portrait: "/event/winter.jpg" },
  // 나나미는 서버에 목소리 슬롯이 아직 없어 뺀다(2026-09-16 지시: 윈터부터). 사진·문구는 남겨 둔다.
  // { id: "nanami", portrait: "/event/nanami.jpg" },
] as const;

/** 메시지 종류. 순서가 곧 화면의 선택지 순서다. */
export const MESSAGE_KINDS = ["birthday", "comfort"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** 이름 상한. 영어 이름·성까지 들어가게 넉넉히(2026-09-15 지시). 한 문장의 호칭이라 닉네임(30)보다는 짧다. */
export const EVENT_NAME_MAX_LENGTH = 20;

/**
 * 이름에 남기는 글자 — **허용 목록**이다. 서버 `packages/backend/src/lib/event-voices.ts` 의
 * `sanitizeEventName` 과 같은 규칙(한쪽을 고치면 다른 쪽도).
 *
 * 계정 닉네임(`sanitizeDisplayName`)은 문장부호를 살리지만, 이 값은 **실제 인물 목소리로 읽힌다** —
 * 대괄호로 감정 태그를 심거나 기호로 문장을 꾸미는 길을 열어 두지 않는다. 글자(문자·결합 부호)·
 * 숫자·공백·하이픈·아포스트로피(O'Brien, Jean-Luc)만. 서버가 같은 규칙으로 한 번 더 거른다.
 */
const NAME_ALLOWED_RE = /[\p{L}\p{M}\p{N} '’-]/u;

/**
 * 이름 입력 정리. 줄바꿈·탭은 지우지 않고 공백으로 바꾼다(지우면 두 낱말이 붙는다). 자를 때
 * 서러게이트 쌍을 가르지 않는다. 긴 붙여넣기는 앞부분만 본다 — 20자 상한이라 뒤는 볼 일이 없다.
 */
export function sanitizeEventName(raw: string): string {
  const chars: string[] = [];
  for (const ch of raw.slice(0, EVENT_NAME_MAX_LENGTH * 8).replace(/[\r\n\t]+/g, " ")) {
    if (NAME_ALLOWED_RE.test(ch)) chars.push(ch);
  }
  const cleaned = chars.join("").replace(/ {2,}/g, " ").trimStart();
  return Array.from(cleaned).slice(0, EVENT_NAME_MAX_LENGTH).join("");
}
