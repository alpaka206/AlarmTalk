"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { usePrefersReducedMotion } from "./motion/use-prefers-reduced-motion";
import { Link, usePathname } from "@/i18n/navigation";
import { BrandMark } from "./brand-mark";
import { MobileMenu } from "./mobile-menu";
import { LocaleSwitcher } from "./locale-switcher";

export function SiteHeader() {
  const t = useTranslations("nav");
  // Single scroll subscriber for the page: scrollY drives the chrome threshold,
  // the spring-smoothed progress drives the coral voice-spine fill.
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 60, damping: 20 });

  // Scroll-linked, not class-toggled, so the chrome fades in smoothly.
  const bgOpacity = useTransform(scrollY, [0, 48], [0, 0.85]);
  const backdropFilter = useTransform(
    scrollY,
    [0, 48],
    ["saturate(140%) blur(0px)", "saturate(140%) blur(12px)"],
  );

  // 내리면 숨고 올리면 나온다(2026-09-15 지시, 모든 페이지). 맨 위 근처에서는 늘 보이고,
  // 방향이 바뀌어도 몇 px 흔들림에는 반응하지 않는다(히스테리시스). 숨는 동안 헤더 안에
  // 초점이 있으면(탭 이동) 숨기지 않는다 — 보이지 않는 곳에 초점이 가면 안 된다.
  const reduced = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? y;
    const delta = y - prev;
    if (y < 80) {
      setHidden(false);
    } else if (delta > 8) {
      setHidden(true);
    } else if (delta < -8) {
      setHidden(false);
    }
  });
  useEffect(() => {
    if (focusWithin) setHidden(false);
  }, [focusWithin]);

  return (
    <motion.header
      className="sticky top-0 z-30"
      animate={{ y: hidden && !focusWithin ? "-100%" : "0%" }}
      transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.35, bounce: 0 }}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      {/* translucent backdrop that fades in on scroll */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-surface"
        style={{ opacity: bgOpacity, backdropFilter, WebkitBackdropFilter: backdropFilter }}
      />
      {/* faint static hairline */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      {/* coral voice-spine — tracks page scroll progress */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px origin-left bg-accent"
        style={{ scaleX: progress }}
      />

      <div className="mx-auto flex max-w-site items-center justify-between px-5 py-5 md:px-8">
        <Link
          href="/"
          aria-label="AlarmTalk"
          className="flex items-center gap-2.5 whitespace-nowrap"
        >
          <BrandMark size={32} alt="" />
          <span translate="no" className="text-[17px] font-bold tracking-tight text-text">
            AlarmTalk
          </span>
        </Link>

        {/* 라벨과 도착지를 맞춘다 — 기능만 홈 안의 앵커이고 나머지는 각자 페이지다.
            지금 있는 페이지는 알약으로 강조한다(2026-09-15 지시 — 페이지 제목 대신 내비가 말한다). */}
        <nav className="hidden items-center gap-1 lg:flex">
          <NavLink href="/#how">{t("features")}</NavLink>
          <NavLink href="/pricing">{t("pricing")}</NavLink>
          <NavLink href="/event">{t("event")}</NavLink>
          <NavLink href="/faq">{t("faq")}</NavLink>
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden lg:block">
            <LocaleSwitcher />
          </div>
          <MobileMenu />
        </div>
      </div>
    </motion.header>
  );
}

/**
 * 헤더 링크. 현재 페이지(경로가 href 로 시작)면 `aria-current="page"` 와 강조 알약. 앵커(`/#how`)
 * 는 홈의 한 구간이라 강조하지 않는다 — 홈에서 '기능' 이 켜져 있으면 다른 구간에 있어도 거짓이다.
 */
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const page = href.startsWith("/#") ? null : href;
  const active = page !== null && (pathname === page || pathname.startsWith(`${page}/`));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-[color,background-color] duration-150 ease-[var(--ease-ui)] ${
        active
          ? "bg-accent-soft font-semibold text-accent"
          : "text-text-muted hover:text-text focus-visible:text-text"
      }`}
    >
      {children}
    </Link>
  );
}
