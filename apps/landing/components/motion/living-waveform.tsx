"use client";

import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Mode = "breathe" | "playOnce";

type Props = {
  /** Per-bar levels, 0..1. */
  bars: number[];
  mode?: Mode;
  /** Color of active ("played") bars. */
  color?: string;
  /** Color of bars at/after `playedTo` (defaults to `color`). */
  restColor?: string;
  /** Index up to which bars are "active"/played (undefined = all active). */
  playedTo?: number;
  /** Breathe amplitude as a fraction of height (0.12 = ±12%). */
  amplitude?: number;
  /** Breathe loop period in seconds. */
  period?: number;
  /** Bar width in px, or "flex" to fill the row evenly. */
  barWidth?: number | "flex";
  gapPx?: number;
  minPx?: number;
  spanPx?: number;
  align?: "center" | "end";
  /** Per-level opacity (used when activeOpacity is not set): base + level*scale. */
  opacityBase?: number;
  opacityScale?: number;
  /** Fixed opacities by played state (overrides the per-level formula). */
  activeOpacity?: number;
  restOpacity?: number;
  radius?: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * The signature "voice you can see" motif — pure div bars (no canvas) driven by
 * Framer. `breathe` runs a slow per-bar sine loop while in view (a traveling wave);
 * `playOnce` raises bars left→right once, the colored "played" portion reading like
 * a playhead sweep. Decorative + aria-hidden. Reduced-motion / no-JS → the exact
 * static bar heights the component renders today (never empty).
 */
export function LivingWaveform({
  bars,
  mode = "breathe",
  color = "var(--color-accent)",
  restColor,
  playedTo,
  amplitude = 0.12,
  period = 4,
  barWidth = 1.5,
  gapPx = 1.5,
  minPx = 5,
  spanPx = 22,
  align = "center",
  opacityBase = 1,
  opacityScale = 0,
  activeOpacity,
  restOpacity,
  radius = 9999,
  className,
  style,
}: Props) {
  const reduced = usePrefersReducedMotion();
  const n = bars.length;
  const flex = barWidth === "flex";

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: align === "center" ? "center" : "flex-end",
        justifyContent: flex ? "space-between" : "space-between",
        gap: `${gapPx}px`,
        ...style,
      }}
    >
      {bars.map((raw, i) => {
        const level = Math.max(0, Math.min(1, raw));
        const height = minPx + level * spanPx;
        const isActive = playedTo == null || i < playedTo;
        const barColor = isActive ? color : (restColor ?? color);
        const opacity =
          activeOpacity != null
            ? isActive
              ? activeOpacity
              : (restOpacity ?? 1)
            : opacityBase + level * opacityScale;

        const barStyle: CSSProperties = {
          height: `${height}px`,
          width: flex ? undefined : `${barWidth}px`,
          flex: flex ? "1 1 0%" : undefined,
          backgroundColor: barColor,
          opacity,
          borderRadius: radius,
          transformOrigin: mode === "breathe" ? "center" : "bottom",
        };

        if (reduced) {
          return <span key={i} style={barStyle} />;
        }

        if (mode === "playOnce") {
          return (
            <motion.span
              key={i}
              data-reveal
              style={barStyle}
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, margin: "0px 0px -10% 0px" }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.012 }}
            />
          );
        }

        return (
          <motion.span
            key={i}
            style={barStyle}
            initial={{ scaleY: 1 }}
            whileInView={{
              scaleY: [1 - amplitude, 1 + amplitude, 1 - amplitude],
            }}
            viewport={{ once: false }}
            transition={{
              duration: period,
              repeat: Infinity,
              ease: "easeInOut",
              delay: (i / n) * period,
            }}
          />
        );
      })}
    </div>
  );
}
