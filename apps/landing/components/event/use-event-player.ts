"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 한 번에 하나만 말한다. 다른 카드를 누르면 앞 것을 **즉시** 끊고 새 것을 시작한다
 * (끝날 때까지 기다리게 하지 않는다 — apple-design 의 interruptibility).
 *
 * 소리는 서버가 만든 mp3 주소 하나다(`event-api.ts` 의 `Clip.src`). `<audio>` 요소 하나를 돌려
 * 쓴다 — iOS 는 사용자 동작 안에서 만든 요소만 소리를 내므로 새로 만들지 않는다.
 */
export function useEventPlayer() {
  const [activeId, setActiveId] = useState<string | null>(null);
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
  }, []);

  /** 돌려준 Promise 는 실제로 소리가 나기 시작했는지(자동 재생이 막히면 false). */
  const play = useCallback(
    (id: string, src: string): Promise<boolean> => {
      stop();
      const generation = generationRef.current;
      const release = () => {
        if (generationRef.current !== generation) return;
        setActiveId((cur) => (cur === id ? null : cur));
      };
      const audio = audioRef.current ?? (audioRef.current = new Audio());
      audio.src = src;
      audio.onended = release;
      audio.onerror = release;
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

  return { activeId, play, stop };
}
