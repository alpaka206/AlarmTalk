"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useRef } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import {
  useCoarsePointer,
  usePrefersReducedMotion,
} from "./use-prefers-reduced-motion";

const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));

type Props = {
  children: ReactNode;
  /** Max pull toward the cursor in px. */
  strength?: number;
  className?: string;
};

/**
 * Subtle magnetic pull toward the cursor for a single CTA. No-ops on touch
 * (coarse pointer) and under reduced-motion, rendering a plain inline wrapper.
 */
export function Magnetic({ children, strength = 6, className }: Props) {
  const reduced = usePrefersReducedMotion();
  const coarse = useCoarsePointer();
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 150, damping: 15 });
  const sy = useSpring(y, { stiffness: 150, damping: 15 });

  const cls = ["inline-flex", className].filter(Boolean).join(" ");

  if (reduced || coarse) {
    return <span className={cls}>{children}</span>;
  }

  const onMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = event.clientX - (r.left + r.width / 2);
    const dy = event.clientY - (r.top + r.height / 2);
    x.set(clamp((dx / (r.width / 2)) * strength, strength));
    y.set(clamp((dy / (r.height / 2)) * strength, strength));
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      ref={ref}
      className={cls}
      style={{ x: sx, y: sy }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </motion.span>
  );
}
