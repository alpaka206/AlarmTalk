"use client";

import { motion } from "motion/react";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

/**
 * "아래에 더 있다" 는 신호. 히어로에서 제품 화면을 뺐으니, 다음 구간이 스크롤로만
 * 열린다는 걸 알려 줄 것이 필요하다.
 *
 * 스스로 도는 애니메이션이라 **켜는 방향**으로 짠다 — reduced-motion 이면 아예 정지한
 * 선분만 남는다(끄는 방향으로 짜면 훅이 붙기 전 첫 프레임이 샌다).
 */
export function ScrollCue({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();

  return (
    <div
      aria-hidden="true"
      className={`h-14 w-px overflow-hidden bg-line ${className ?? ""}`}
    >
      {reduced ? null : (
        <motion.span
          className="block h-1/2 w-px bg-accent"
          initial={{ y: "-100%" }}
          animate={{ y: "200%" }}
          transition={{
            duration: 1.9,
            ease: [0.4, 0, 0.2, 1],
            repeat: Infinity,
            repeatDelay: 0.35,
          }}
        />
      )}
    </div>
  );
}
