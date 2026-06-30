"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * SSR-stable reduced-motion flag. motion v12's useReducedMotion resolves the real
 * preference synchronously on the FIRST client render, which would diverge from the
 * server (where it is always false) and cause a hydration mismatch on every revealed
 * node. So we return `false` on SSR + the first client render (matching the server
 * markup) and only apply the real preference after mount. Reduced-motion users stay
 * visible in the meantime via the `[data-reveal]` rule inside the
 * `@media (prefers-reduced-motion: reduce)` block in globals.css.
 */
export function usePrefersReducedMotion(): boolean {
  const reduced = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && reduced;
}

/**
 * True on coarse pointers (touch). SSR-stable (false until mounted). Used to no-op
 * pointer-tracking effects like <Magnetic> on phones/tablets.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return coarse;
}
