"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { motion, type Variants } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

// House easing token (mirrors --ease-paper in globals.css).
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export type RevealVariant = "caption" | "rise" | "heavy" | "wipe";

/**
 * 진입 거리는 **요소의 무게에 비례한 3단**이다. 큰 시각물이 뷰포트 대비 작게 움직이면
 * "차분하다"가 아니라 "안 움직였다"로 읽힌다. 반대로 44px 을 넘기면 0.6초짜리 시간 기반
 * 진입에서는 던지는 것처럼 보인다(더 큰 거리는 스크롤 진행률에 묶을 때만 소화된다).
 *
 * opacity 를 transform 보다 **먼저** 끝낸다(비율 0.75). 둘이 같이 끝나면 도착 순간이 딱
 * 끊기는데, 불투명해진 뒤에도 마지막 몇 px 이 계속 올라오면 떠오르는 잔상이 남는다.
 *
 * Each `visible` is a function of a custom delay so a single entrance can be
 * offset without overriding its duration/easing.
 */
export const REVEAL_VARIANTS: Record<RevealVariant, Variants> = {
  // 보조 문구·배지·각주
  caption: {
    hidden: { opacity: 0, y: 10 },
    visible: (d = 0) => ({
      opacity: 1,
      y: 0,
      transition: {
        opacity: { duration: 0.35, ease: EASE, delay: d },
        y: { duration: 0.5, ease: EASE, delay: d },
      },
    }),
  },
  // 텍스트 블록·카드
  rise: {
    hidden: { opacity: 0, y: 16 },
    visible: (d = 0) => ({
      opacity: 1,
      y: 0,
      transition: {
        opacity: { duration: 0.45, ease: EASE, delay: d },
        y: { duration: 0.6, ease: EASE, delay: d },
      },
    }),
  },
  // 기기 목업·스크린샷. blur 는 y 가 아니라 opacity 와 같이 끝난다 — 마지막까지 남으면
  // 글자가 늦게 또렷해져 읽기가 늦어진다.
  heavy: {
    hidden: { opacity: 0, y: 44, filter: "blur(1.2px)" },
    visible: (d = 0) => ({
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: {
        opacity: { duration: 0.5, ease: EASE, delay: d },
        filter: { duration: 0.5, ease: EASE, delay: d },
        y: { duration: 0.75, ease: EASE, delay: d },
      },
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
