"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 한 번에 하나만 말한다. 다른 카드를 누르면 앞 것을 **즉시** 끊고 새 것을 시작한다
 * (끝날 때까지 기다리게 하지 않는다 — apple-design 의 interruptibility).
 *
 * 소리는 이 탭이 들고 있는 mp3 의 Blob URL 하나다(`event-api.ts` 의 `Clip.src`). `<audio>` 요소
 * 하나를 돌려 쓴다 — iOS 는 사용자 동작 안에서 만든 요소만 소리를 내므로 새로 만들지 않는다.
 * 재생 중인 것의 위치·길이(초)를 같이 준다 — 카드가 진행 막대와 "0:05 / 0:13" 을 그린다.
 */
export function useEventPlayer() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * 재생 회차. **id 로는 못 가른다** — 같은 카드를 멈췄다 다시 누르면 id 가 같다. 지난 재생의
   * `onended`/`onerror` 가 새 재생의 상태를 지우지 않도록 회차가 다르면 무시한다.
   */
  const generationRef = useRef(0);

  const stop = useCallback(() => {
    generationRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setActiveId(null);
    setPosition(0);
    setDuration(null);
  }, []);

  /** 돌려준 Promise 는 실제로 소리가 나기 시작했는지(자동 재생이 막히면 false). */
  const play = useCallback(
    (id: string, src: string): Promise<boolean> => {
      stop();
      const generation = generationRef.current;
      const mine = () => generationRef.current === generation;
      const release = () => {
        if (!mine()) return;
        setActiveId((cur) => (cur === id ? null : cur));
        setPosition(0);
        setDuration(null);
      };
      const audio = audioRef.current ?? (audioRef.current = new Audio());
      audio.src = src;
      audio.onended = release;
      audio.onerror = release;
      audio.onloadedmetadata = () => {
        if (mine() && Number.isFinite(audio.duration)) setDuration(audio.duration);
      };
      audio.ontimeupdate = () => {
        if (mine()) setPosition(audio.currentTime);
      };
      setActiveId(id);
      return audio.play().then(
        () => true,
        () => {
          release();
          return false;
        },
      );
    },
    [stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { activeId, position, duration, play, stop };
}

/**
 * 클립의 길이(초). 카드가 재생 전에도 "0:13" 을 보여 주려고 메타데이터만 읽는다.
 * 못 읽으면(브라우저·형식) null — 그러면 길이를 그냥 안 보여 준다.
 */
export function probeDuration(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      audio.removeAttribute("src");
      resolve(value);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    setTimeout(() => done(null), 3000);
    audio.src = src;
  });
}

/** 초 → "m:ss". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
