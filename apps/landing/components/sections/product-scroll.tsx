"use client";

import { useTranslations } from "next-intl";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { PhonePreview, SCREEN_ACCENT, SCREEN_LINE } from "../phone-preview";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";

/**
 * 제품이 처음 등장하는 자리. 히어로에서 폰을 뺀 대신 여기서 **스크롤과 함께** 켠다.
 *
 * 이 연출을 여기에만 쓰는 이유: 스크롤은 사용자의 행동이고, 이 제품의 핵심 동작도
 * 스위치를 켜는 것이다. 둘이 같은 몸짓이라 스크롤이 곧 제품 동작이 된다. 다른 섹션에
 * 같은 걸 또 쓰면 그 의미가 사라지고 그냥 화려한 페이지가 된다.
 *
 * 값은 `%`·`scale` 로만 쓴다 — `px` 로 잡으면 뷰포트 폭에서 어긋난다.
 *
 * 구간 배분(진행률):
 *   0.00–0.30  폰이 올라오며 자리를 잡는다
 *   0.38–0.55  토글이 켜진다 (이 구간이 이 섹션의 이유다)
 *   0.60–0.85  문구가 바뀐다
 */
export function ProductScroll() {
  const t = useTranslations("productScroll");
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });
  // 스크롤 값을 그대로 쓰면 휠 한 칸마다 툭툭 끊긴다. 감쇠비를 1 근처로 둬서
  // 되튀지 않게 한다(바운스가 보이면 그건 제품이 아니라 장난감처럼 읽힌다).
  const p = useSpring(scrollYProgress, { stiffness: 90, damping: 26, mass: 0.4 });

  const phoneY = useTransform(p, [0, 0.3], ["12%", "0%"]);
  const phoneOpacity = useTransform(p, [0, 0.18], [0, 1]);
  const phoneScale = useTransform(p, [0, 0.3], [0.94, 1]);

  // 토글: 손잡이가 왼쪽 끝에서 오른쪽 끝으로. 트랙 색도 같이 산다.
  const knobX = useTransform(p, [0.38, 0.55], ["0%", "100%"]);
  const trackOn = useTransform(p, [0.38, 0.55], [0, 1]);
  const trackBg = useTransform(
    trackOn,
    [0, 1],
    ["rgba(255,255,255,0.14)", SCREEN_ACCENT],
  );

  const beforeOpacity = useTransform(p, [0.6, 0.72], [1, 0]);
  const afterOpacity = useTransform(p, [0.73, 0.85], [0, 1]);

  // reduced-motion 이면 핀도 스크럽도 없다. 최종 상태(켜진 알람)를 그냥 보여준다 —
  // 300vh 를 강제로 스크롤시키는 건 전정 장애가 있는 사람에게 접근성 문제다.
  if (reduced) {
    return (
      <section className="bg-bg-alt">
        <div className="section-pad mx-auto flex max-w-6xl flex-col items-center px-5 text-center md:px-8">
          <h2 className="t-h1 max-w-2xl text-text">{t("after")}</h2>
          <div className="mt-14">
            <PhonePreview widthClass="[--w:min(320px,74vw)]" />
          </div>
        </div>
      </section>
    );
  }

  return (
    // 높이가 스크롤 예산이다. 240vh = 뷰포트 1.4개분을 이 장면에 쓴다.
    <section ref={ref} className="relative h-[240vh] bg-bg-alt">
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden px-5">
        <div className="relative h-24 w-full max-w-2xl">
          <motion.h2
            className="t-h1 absolute inset-x-0 top-0 text-center text-text"
            style={{ opacity: beforeOpacity }}
          >
            {t("before")}
          </motion.h2>
          <motion.h2
            className="t-h1 absolute inset-x-0 top-0 text-center text-text"
            style={{ opacity: afterOpacity }}
          >
            {t("after")}
          </motion.h2>
        </div>

        <motion.div
          className="mt-6"
          style={{ y: phoneY, opacity: phoneOpacity, scale: phoneScale }}
        >
          <PhonePreview
            widthClass="[--w:min(300px,68vw)]"
            toggle={
              <motion.span
                aria-hidden="true"
                className="relative block h-6 w-11 shrink-0 rounded-full"
                style={{ background: trackBg, border: `1px solid ${SCREEN_LINE}` }}
              >
                {/* 손잡이는 트랙 안쪽 폭만큼만 움직인다. calc 로 자기 크기를 빼서
                    어느 폭에서도 끝에 정확히 붙는다. */}
                <motion.span
                  className="absolute top-0.5 block h-5 w-5 rounded-full bg-white"
                  style={{ left: "2px", x: knobX, translateX: "0%" }}
                />
              </motion.span>
            }
          />
        </motion.div>
      </div>
    </section>
  );
}
