"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CheerPlayback } from "./cheer-playback";

/**
 * 한 번에 하나만 말한다. 다른 카드를 누르면 앞 것을 **즉시** 끊고 새 것을 시작한다
 * (끝날 때까지 기다리게 하지 않는다 — apple-design 의 interruptibility).
 */
export function useCheerPlayer() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setActiveId(null);
  }, []);

  const play = useCallback(
    (id: string, playback: CheerPlayback) => {
      stop();
      const release = () => setActiveId((cur) => (cur === id ? null : cur));

      if (playback.kind === "url") {
        const audio = audioRef.current ?? (audioRef.current = new Audio());
        audio.src = playback.src;
        audio.onended = release;
        audio.onerror = release;
        setActiveId(id);
        audio.play().catch(release);
        return;
      }

      if (!("speechSynthesis" in window)) {
        setUnsupported(true);
        return;
      }
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(playback.text);
      utterance.lang = playback.lang;
      utterance.pitch = playback.pitch;
      utterance.rate = playback.rate;
      // 같은 언어의 목소리가 있으면 붙인다. 없으면 브라우저가 lang 을 보고 기본 목소리를 고른다.
      const lang2 = playback.lang.slice(0, 2);
      const voice = synth
        .getVoices()
        .find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang2));
      if (voice) utterance.voice = voice;
      utterance.onend = release;
      utterance.onerror = release;
      setActiveId(id);
      synth.speak(utterance);
    },
    [stop],
  );

  // 목소리 목록은 비동기로 채워진다 — 미리 한 번 불러 두면 첫 재생에서 언어가 맞는다.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const warm = () => {
      synth.getVoices();
    };
    warm();
    synth.addEventListener("voiceschanged", warm);
    return () => synth.removeEventListener("voiceschanged", warm);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { activeId, play, stop, unsupported };
}
