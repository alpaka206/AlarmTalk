"use client";

import { useTranslations } from "next-intl";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
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

  return (
    <header className="sticky top-0 z-30">
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
    </header>
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
