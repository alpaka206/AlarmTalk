import catalog from "../../../../packages/shared/src/event-voices.json";

/**
 * 이벤트 1 의 목록 — **어떤 목소리로, 어떤 메시지를**.
 *
 * 목소리 목록의 단일 출처는 `packages/shared/src/event-voices.json` 이다(백엔드도 같은 파일을 읽는다).
 * 목소리를 더하는 방법은 그 옆 `schemas/event-voices.ts` 머리 주석에 있다 — JSON 항목 하나와
 * 미리 듣기 샘플 mp3 셋(`public/event/samples/<id>.<locale>.mp3`)이면 끝난다. 여기서는 그 JSON 을
 * 화면이 쓰는 모양으로 옮길 뿐, 목소리를 손으로 적지 않는다.
 *
 * 메시지 종류 이름은 `event.studio.kinds.<kind>.name`. **읽힐 문장은 서버가 정한다**
 * (`packages/backend/src/lib/event-voices.ts`). 여기 종류 id 는 서버의 것과 같아야 한다.
 *
 * `portrait` 는 `public/` 아래 경로다. 빈 문자열이면 화면은 추상 아바타(소리 결 아이콘)를 그린다
 * (`event-studio.tsx` 의 `Portrait`). 실존 인물의 사진·이름은 쓰지 않는다(2026-09-17, 퍼블리시티권).
 */
export type Celebrity = {
  id: string;
  portrait: string;
  /** 언어별 라벨(JSON 의 name). */
  name: Record<string, string>;
};

/** 이 페이지의 이벤트 번호(`lib/events.ts`). 좋아요 카운터·클립 생성의 키다. */
export const EVENT_ID = "1";

export const CELEBRITIES: readonly Celebrity[] = catalog[EVENT_ID].voices.map((v) => ({
  id: v.id,
  portrait: v.portrait ?? "",
  name: v.name,
}));

/** 화면에 보일 라벨. 그 언어가 없으면 한국어. */
export function voiceName(c: Celebrity, locale: string): string {
  return c.name[locale] ?? c.name.ko ?? c.id;
}

/**
 * 미리 듣기 샘플 — 이 목소리로 예시 이름(`event.studio.sampleName`)을 부른 생일 메시지. 생성 전에
 * 목소리를 들어 보라고 두는 정적 파일이다: `public/event/samples/<id>.<locale>.mp3`.
 */
export function sampleSrc(celebrityId: string, locale: string): string {
  return `/event/samples/${celebrityId}.${locale}.mp3`;
}

/** 메시지 종류. 순서가 곧 화면의 선택지 순서다. */
export const MESSAGE_KINDS = ["birthday", "chuseok"] as const;
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
