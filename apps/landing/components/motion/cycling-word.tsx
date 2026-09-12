"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Props = {
  words: readonly string[];
  /** 한 단어가 머무는 시간(ms). */
  holdMs?: number;
  /** 몇 바퀴 돌고 멈추는가. 끝없이 돌리지 않는다 — 멈출 수단 없는 무한 모션은 두지 않는다. */
  loops?: number;
  className?: string;
};

/**
 * 헤드라인 안에서 **누구 목소리인가**를 돌려 보여 준다(엄마 → 최애 → 딸 → 그 사람).
 *
 * 순환하는 것은 기능이 아니라 사람이다 — 이 앱의 약속은 '어떤 기술' 이 아니라 '누가
 * 깨우는가' 이므로, 그 자리만 움직인다. 서버는 첫 단어를 그대로 그리고(하이드레이션
 * 안전), 축소 동작 설정에서는 첫 단어에 멈춘다. 스크린리더에는 첫 단어만 읽힌다 —
 * 돌아가는 글자를 매번 읽어 주면 문장이 끊긴다.
 *
 * 두 바퀴 돌고 첫 단어에서 멈춘다. 그 사이 마우스를 올리거나 초점이 들어오면 멈춰 있는다
 * (읽는 중에 글자가 바뀌면 문장을 놓친다). 탭이 숨겨진 동안도 돌리지 않는다.
 * 폭이 바뀌면 줄 전체가 당겨지므로 `layout` 으로 부드럽게 옮긴다.
 */
export function CyclingWord({ words, holdMs = 2400, loops = 2, className }: Props) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const pausedRef = useRef(false);
  const ticksRef = useRef(0);
  const cycling = !reduced && words.length > 1 && !done;

  useEffect(() => {
    if (!cycling) return;
    const total = words.length * loops;
    const id = setInterval(() => {
      if (document.hidden || pausedRef.current) return;
      ticksRef.current += 1;
      if (ticksRef.current >= total) {
        setIndex(0);
        setDone(true);
        return;
      }
      setIndex((i) => (i + 1) % words.length);
    }, holdMs);
    return () => clearInterval(id);
  }, [cycling, holdMs, loops, words.length]);

  if (reduced || words.length < 2) {
    return <span className={className}>{words[0]}</span>;
  }

  const word = words[index];
  return (
    <>
      <span className="sr-only">{words[0]}</span>
      <motion.span
        layout
        aria-hidden="true"
        onPointerEnter={() => {
          pausedRef.current = true;
        }}
        onPointerLeave={() => {
          pausedRef.current = false;
        }}
        onFocus={() => {
          pausedRef.current = true;
        }}
        onBlur={() => {
          pausedRef.current = false;
        }}
        transition={{ layout: { duration: 0.45, ease: EASE } }}
        className={`relative inline-grid align-baseline ${className ?? ""}`}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={word}
            className="col-start-1 row-start-1 whitespace-nowrap"
            initial={{ opacity: 0, y: 12, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -12, filter: "blur(2px)" }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </motion.span>
    </>
  );
}
