import type { Celebrity, MessageKind } from "./event-catalog";

/**
 * 이벤트 1 의 **생성 경로** — 이름·메시지·인물을 넣으면 재생할 것을 돌려준다. 화면(카드·버튼·
 * 입력)은 이 함수만 안다.
 *
 * 지금은 서버가 없다. 생성 서버(Perso 로 인물 목소리를 다시 만드는 경로)가 붙으면 이 파일만
 * 바꾼다: `generateVoiceMessage` 가 서버에 `{ celebrity, kind, name, locale }` 를 보내고
 * `{ kind: "url", src }` 를 돌려주면, 재생기(`use-event-player.ts`)의 url 갈래와 다운로드가
 * 그대로 살아난다. 그때까지는 브라우저 음성 합성으로 **흐름만** 보여 준다 — 만드는 시간을
 * 흉내 내는 짧은 지연은 화면의 "만드는 중" 상태가 실제로 어떻게 보이는지 확인하려는 것이다.
 *
 * 좋아요도 같다: 서버가 붙기 전에는 이 브라우저 안에서만 기억한다(localStorage). 숫자는
 * 서버가 줄 때만 보여 준다 — 없는 숫자를 지어내지 않는다.
 */
export type EventPlayback =
  | { kind: "speech"; text: string; lang: string; pitch: number; rate: number }
  | { kind: "url"; src: string };

const SPEECH_LANG: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
};

/** 생성 서버가 붙기 전의 흉내 지연. 0 이면 즉시. */
const MOCK_GENERATION_MS = 1100;

export type GenerateRequest = {
  celebrity: Celebrity;
  kind: MessageKind;
  /** 태그를 벗긴 **문자열** 문장(이름이 이미 들어간 것). */
  text: string;
  locale: string;
};

export async function generateVoiceMessage(req: GenerateRequest): Promise<EventPlayback> {
  await new Promise((r) => setTimeout(r, MOCK_GENERATION_MS));
  return {
    kind: "speech",
    text: req.text,
    lang: SPEECH_LANG[req.locale] ?? SPEECH_LANG.ko,
    pitch: req.celebrity.pitch,
    rate: req.celebrity.rate,
  };
}

/** 다운로드할 파일이 있는가 — 서버가 만든 소리(url)일 때만. 합성 음성은 파일이 없다. */
export function downloadableSrc(playback: EventPlayback | undefined): string | null {
  return playback?.kind === "url" ? playback.src : null;
}

const LIKES_KEY = "alarmtalk.event1.likes";

export type LikeState = { liked: boolean; count?: number };

function readLikedIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(LIKES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function loadLikes(ids: readonly string[]): Record<string, LikeState> {
  const liked = readLikedIds();
  return Object.fromEntries(ids.map((id) => [id, { liked: liked.has(id) }]));
}

export async function toggleLike(id: string, next: boolean): Promise<LikeState> {
  const liked = readLikedIds();
  if (next) liked.add(id);
  else liked.delete(id);
  try {
    window.localStorage.setItem(LIKES_KEY, JSON.stringify([...liked]));
  } catch {
    // 저장이 막힌 브라우저(사생활 모드 등)에서는 이 세션 안에서만 기억된다.
  }
  return { liked: next };
}
