import { API_BASE } from "@/lib/site";
import type { Celebrity, MessageKind } from "./event-catalog";

/**
 * 이벤트 1 의 바깥 세계 — **생성**과 **좋아요**. 화면(카드·버튼·입력)은 이 파일만 안다.
 *
 * 생성: 지금은 서버가 없다. Perso 로 인물 목소리를 다시 만드는 경로가 붙으면
 * `generateVoiceMessage` 가 서버에 `{ celebrity, kind, name, locale }` 를 보내고
 * `{ kind: "url", src }` 를 돌려주면, 재생기(`use-event-player.ts`)의 url 갈래와 다운로드가
 * 그대로 살아난다. 그때까지는 브라우저 음성 합성으로 **흐름만** 보여 준다 — 만드는 시간을
 * 흉내 내는 짧은 지연은 "만드는 중" 상태가 실제로 어떻게 보이는지 확인하려는 것이다.
 *
 * 좋아요: 백엔드의 공개 카운터(`packages/backend/src/routes/event.ts`)에 누른 횟수만큼
 * 더한다. 숫자는 서버가 준 것만 보여 준다 — 서버에 못 닿으면 숫자를 지어내지 않고 하트만 남긴다.
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

/** 좋아요 수. 서버가 모르는 대상은 키가 없다(= 숫자를 보여 주지 않는다). */
export type LikeCounts = Record<string, number>;

const LIKES_TIMEOUT_MS = 4000;

export async function fetchLikes(eventId: string): Promise<LikeCounts> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIKES_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/event/${encodeURIComponent(eventId)}/likes`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { likes?: Record<string, unknown> };
    const out: LikeCounts = {};
    for (const [id, n] of Object.entries(body.likes ?? {})) {
      if (typeof n === "number" && Number.isFinite(n)) out[id] = n;
    }
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** 누른 횟수만큼 더한다. 서버가 돌려준 새 수, 못 닿으면 null(화면은 낙관 값을 유지). */
export async function addLike(eventId: string, subjectId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/event/${encodeURIComponent(eventId)}/likes/${encodeURIComponent(subjectId)}`,
      { method: "POST", cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { count?: unknown };
    return typeof body.count === "number" ? body.count : null;
  } catch {
    return null;
  }
}
