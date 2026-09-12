import type { CheerVoice } from "./cheer-voices";

/**
 * 목소리·문장 → **무엇을 재생할지.** 재생기(`use-cheer-player.ts`)는 이 값만 안다.
 *
 * 지금은 브라우저의 음성 합성으로 읽는다. 전용 생성 경로가 붙으면 이 함수가 `url` 을
 * 돌려주고, 나머지(카드·버튼·이름 입력)는 손대지 않는다 — 그러려고 갈라 둔 자리다.
 */
export type CheerPlayback =
  | { kind: "speech"; text: string; lang: string; pitch: number; rate: number }
  | { kind: "url"; src: string };

const SPEECH_LANG: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
};

export function resolveCheerPlayback(
  voice: CheerVoice,
  text: string,
  locale: string,
): CheerPlayback {
  return {
    kind: "speech",
    text,
    lang: SPEECH_LANG[locale] ?? SPEECH_LANG.ko,
    pitch: voice.pitch,
    rate: voice.rate,
  };
}
