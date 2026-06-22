"use client";

import { useEffect, useRef } from "react";
import { animate, useInView } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
// Slight overshoot-then-settle for the "odometer" feel.
const EASE_BACK: [number, number, number, number] = [0.34, 1.56, 0.64, 1];

type Mode = "number" | "odometer" | "text";

type Props = {
  /** Target value for number / odometer modes. */
  to?: number;
  /** Start value (defaults: 0 for number, a small roll for odometer). */
  from?: number;
  /** Literal string for text mode (no counting — a blur settle instead). */
  text?: string;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  mode?: Mode;
  className?: string;
};

/**
 * In-view number ticker. SSR renders the FINAL value (SEO / no-JS safe); when the
 * element scrolls into view and motion is allowed, it counts from `from` to `to`.
 * Reduced-motion → the final value, instantly. Only transform/opacity/filter
 * animate (never layout properties) and the digits sit in a fixed-width box, so
 * the count never causes layout shift. `text` mode does a one-shot blur settle.
 */
export function CountUp({
  to = 0,
  from,
  text,
  prefix = "",
  suffix = "",
  durationMs = 1000,
  mode = "number",
  className,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });

  const start = from ?? (mode === "odometer" ? (to === 0 ? 9 : 0) : 0);

  useEffect(() => {
    if (reduced || !inView) return;
    const node = ref.current;
    if (!node) return;

    if (mode === "text") {
      const controls = animate(0, 1, {
        duration: durationMs / 1000,
        ease: EASE,
        onUpdate: (t) => {
          // filter + opacity only — never letter-spacing (would reflow siblings).
          node.style.filter = `blur(${(1 - t) * 4}px)`;
          node.style.opacity = String(0.4 + t * 0.6);
        },
        onComplete: () => {
          node.style.filter = "";
          node.style.opacity = "";
        },
      });
      return () => controls.stop();
    }

    const controls = animate(start, to, {
      duration: durationMs / 1000,
      ease: mode === "odometer" ? EASE_BACK : EASE,
      onUpdate: (v) => {
        node.textContent = `${prefix}${Math.round(v)}`;
      },
    });
    return () => controls.stop();
  }, [inView, reduced, mode, start, to, durationMs, prefix]);

  if (mode === "text") {
    return (
      <span ref={ref} className={className}>
        {text ?? ""}
      </span>
    );
  }

  // Digits live in a fixed-width, right-aligned box so 0→60 (1→2 glyphs) never
  // shifts the trailing unit. SSR shows the final value.
  return (
    <span className={className}>
      <span
        ref={ref}
        style={{
          display: "inline-block",
          minWidth: `${(prefix + String(to)).length}ch`,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {prefix}
        {to}
      </span>
      {suffix}
    </span>
  );
}
