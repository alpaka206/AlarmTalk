"use client";

import { useTranslations } from "next-intl";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { PhonePreview, SCREEN_ACCENT, SCREEN_LINE } from "../phone-preview";

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
 *
 * **reduced-motion 을 JS 로 가르지 않는다.** 그 훅은 하이드레이션 뒤에야 참을 돌려주므로
 * 마크업을 갈라 놓으면 그 순간 섹션이 접힌다 — 아래 앵커(#pricing·#faq)로 들어온 사람은
 * 스크롤이 끝난 뒤 엉뚱한 자리에 남는다. 핀·높이·최종 상태는 전부 `globals.css` 의
 * `.scrub-*` 규칙이 맡는다(미디어 쿼리는 첫 페인트에 이미 적용된다).
 */
export function ProductScroll() {
  const t = useTranslations("productScroll");
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

  return (
    <section
      ref={ref}
      className="scrub-stage bg-bg-alt"
      // reduced-motion 에서 토글을 켜진 색으로 되돌릴 때 CSS 가 읽는 값.
      style={{ "--scrub-on": SCREEN_ACCENT } as React.CSSProperties}
    >
      <div className="scrub-pin px-5">
        {/* 문구 자리를 두 줄 높이로 잡아 둔다 — 높이를 고정해야 문구가 바뀔 때 폰이
            위아래로 밀리지 않는다. */}
        <div className="relative h-28 w-full max-w-2xl sm:h-32">
          {/* 앞 문구는 스크럽 장면의 시각 요소다 — 스크린리더에는 완성형(after) 하나만 읽힌다. */}
          <motion.p
            data-scrub="before"
            aria-hidden="true"
            className="t-h1 absolute inset-x-0 top-0 text-center text-text"
            style={{ opacity: beforeOpacity }}
          >
            {t("before")}
          </motion.p>
          <motion.h2
            data-scrub="after"
            className="t-h1 absolute inset-x-0 top-0 text-center text-text"
            style={{ opacity: afterOpacity }}
          >
            {t("after")}
          </motion.h2>
        </div>

        <motion.div
          data-scrub="phone"
          className="mt-10 sm:mt-12"
          style={{ y: phoneY, opacity: phoneOpacity, scale: phoneScale }}
        >
          <PhonePreview
            widthClass="[--w:min(300px,68vw,34vh)]"
            toggle={
              <motion.span
                data-scrub-track
                aria-hidden="true"
                className="relative block h-6 w-11 shrink-0 rounded-full"
                style={{ background: trackBg, border: `1px solid ${SCREEN_LINE}` }}
              >
                {/* 손잡이는 자기 폭만큼만 움직인다 — 트랙 안쪽 여백이 좌우 2px 이라
                    100% 이동이면 오른쪽 끝에 정확히 붙는다. */}
                <motion.span
                  data-scrub-knob
                  className="absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white"
                  style={{ x: knobX }}
                />
              </motion.span>
            }
          />
        </motion.div>
      </div>
    </section>
  );
}
