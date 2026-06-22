"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

// House easing token (mirrors --ease-paper in globals.css).
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export type RevealVariant = "rise" | "focus" | "wipe";

// Each `visible` is a function of a custom delay so a single entrance can be
// offset without overriding its duration/easing.
export const REVEAL_VARIANTS: Record<RevealVariant, Variants> = {
  rise: {
    hidden: { opacity: 0, y: 16 },
    visible: (d = 0) => ({
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: EASE, delay: d },
    }),
  },
  focus: {
    hidden: { opacity: 0, y: 20, filter: "blur(1.2px)", scale: 1.005 },
    visible: (d = 0) => ({
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      scale: 1,
      transition: { duration: 0.7, ease: EASE, delay: d },
    }),
  },
  wipe: {
    hidden: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
    visible: (d = 0) => ({
      opacity: 1,
      clipPath: "inset(0 0 0 0)",
      transition: { duration: 0.8, ease: EASE, delay: d },
    }),
  },
};

type RevealProps = {
  as?: ElementType;
  variant?: RevealVariant;
  /** Seconds to delay the entrance. */
  delay?: number;
  /** "view" = animate when scrolled into view (default); "mount" = animate on load. */
  trigger?: "view" | "mount";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

/**
 * The workhorse entrance. Renders an element that animates in once (on scroll or on
 * mount). Safety:
 *  - reduced-motion → renders a plain element in its final visible state, no motion.
 *  - no-JS → the `data-reveal` attribute is forced visible by the <noscript> override
 *    in the root layout, so SSR content is never stuck hidden.
 *  - only transform / opacity / clip-path / filter animate → CLS-safe.
 */
export function Reveal({
  as = "div",
  variant = "rise",
  delay = 0,
  trigger = "view",
  className,
  style,
  children,
}: RevealProps) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    const Plain = as;
    return (
      <Plain className={className} style={style}>
        {children}
      </Plain>
    );
  }

  // motion's proxy resolves any intrinsic tag at runtime; the cast keeps it generic.
  const MotionTag = (motion as unknown as Record<string, ElementType>)[
    as as string
  ];

  const shared = {
    className,
    style,
    "data-reveal": true,
    variants: REVEAL_VARIANTS[variant],
    custom: delay,
    initial: "hidden" as const,
  };

  if (trigger === "mount") {
    return (
      <MotionTag {...shared} animate="visible">
        {children}
      </MotionTag>
    );
  }

  return (
    <MotionTag
      {...shared}
      whileInView="visible"
      viewport={{ once: true, margin: "0px 0px -12% 0px" }}
    >
      {children}
    </MotionTag>
  );
}
