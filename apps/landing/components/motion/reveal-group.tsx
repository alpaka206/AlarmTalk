"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";
import { REVEAL_VARIANTS, type RevealVariant } from "./reveal";

const containerVariants = (stagger: number, delay: number): Variants => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

type GroupProps = {
  as?: ElementType;
  stagger?: number;
  delay?: number;
  /** "view" = animate when scrolled into view (default); "mount" = on load (for
   *  above-the-fold groups so the LCP region isn't gated on an observer). */
  trigger?: "view" | "mount";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * Staggered container for grids and lists. The parent orchestrates timing; each
 * <RevealItem> inherits the entrance via Framer variant propagation, so the children
 * need no individual triggers. Reduced-motion / no-JS behave exactly like <Reveal>.
 *
 * NOTE: <RevealItem> is a separate named export (not RevealGroup.Item) on purpose —
 * a static compound property would be stripped across the server→client boundary,
 * so server components importing it would see `undefined`.
 */
export function RevealGroup({
  as = "div",
  stagger = 0.08,
  delay = 0.05,
  trigger = "view",
  className,
  style,
  children,
}: GroupProps) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    const Plain = as;
    return (
      <Plain className={className} style={style}>
        {children}
      </Plain>
    );
  }

  const MotionTag = (motion as unknown as Record<string, ElementType>)[
    as as string
  ];

  const triggerProps =
    trigger === "mount"
      ? { animate: "visible" }
      : {
          whileInView: "visible",
          viewport: { once: true, margin: "0px 0px -12% 0px" },
        };

  return (
    <MotionTag
      className={className}
      style={style}
      variants={containerVariants(stagger, delay)}
      initial="hidden"
      {...triggerProps}
    >
      {children}
    </MotionTag>
  );
}

type ItemProps = {
  as?: ElementType;
  variant?: RevealVariant;
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export function RevealItem({
  as = "div",
  variant = "rise",
  id,
  className,
  style,
  children,
}: ItemProps) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    const Plain = as;
    return (
      <Plain id={id} className={className} style={style}>
        {children}
      </Plain>
    );
  }

  const MotionTag = (motion as unknown as Record<string, ElementType>)[
    as as string
  ];

  return (
    <MotionTag
      id={id}
      className={className}
      style={style}
      data-reveal
      variants={REVEAL_VARIANTS[variant]}
      custom={0}
    >
      {children}
    </MotionTag>
  );
}

