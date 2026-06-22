"use client";

import { useScroll, useSpring, type MotionValue } from "motion/react";

type ScrollProgress = {
  /** Raw window scroll offset in px (for threshold checks). */
  scrollY: MotionValue<number>;
  /** Spring-smoothed 0→1 page scroll progress (for the coral voice-spine). */
  progress: MotionValue<number>;
};

/**
 * The single scroll subscriber for the page. One useScroll instance feeds both the
 * header's scroll-state threshold and the coral "voice-spine" fill, keeping the page
 * to one continuous scroll listener.
 */
export function useScrollProgress(): ScrollProgress {
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 60, damping: 20 });
  return { scrollY, progress };
}
