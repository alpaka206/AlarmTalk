"use client";

import type { ReactNode } from "react";
import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

/**
 * 스크롤 진행률에 묶인 아주 작은 흐름.
 *
 * 한 번 나타나고 멈추는 리빌과 달리, 이건 **뷰포트를 지나는 내내** 아주 조금씩 움직인다.
 * 그래서 페이지가 스크롤에 반응한다는 감각이 생긴다. 값이 크면 멀미가 나므로 기본 6%,
 * 그것도 요소 자기 높이 기준이다(`px` 로 잡으면 뷰포트 폭마다 어긋난다).
 *
 * 리빌과 겹쳐 쓰지 않는다 — 둘 다 y 를 만지면 서로 상쇄되거나 두 배가 된다.
 * 여기서는 리빌을 대신한다.
 */
export function ScrollDrift({
  children,
  amount = 6,
  className,
}: {
  children: ReactNode;
  /** 이동량(자기 높이 대비 %). 위로 흘러가므로 양수면 아래→위. */
  amount?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });

  // 진입 구간에서만 불투명해지고, 이동은 통과하는 내내 이어진다.
  // opacity 가 transform 보다 먼저 끝나는 원칙은 여기서도 같다.
  const y = useTransform(scrollYProgress, [0, 1], [`${amount}%`, `-${amount}%`]);
  const opacity = useTransform(scrollYProgress, [0, 0.22], [0, 1]);

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div ref={ref} className={className} style={{ y, opacity }}>
      {children}
    </motion.div>
  );
}
