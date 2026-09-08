"use client";

import { useTranslations } from "next-intl";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { Link } from "@/i18n/navigation";
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

      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
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

        {/* 라벨과 도착지를 맞춘다 — 앵커는 홈 안의 섹션 id 와 1:1 이다. */}
        <nav className="hidden items-center gap-1 lg:flex">
          <Link
            href="/#how"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            {t("features")}
          </Link>
          <Link
            href="/#pricing"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            {t("pricing")}
          </Link>
          <Link
            href="/cheer"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            {t("cheer")}
          </Link>
          <Link
            href="/#faq"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            {t("faq")}
          </Link>
          <Link
            href="/company"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            {t("company")}
          </Link>
          <Link
            href="/contact"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            {t("contact")}
          </Link>
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
