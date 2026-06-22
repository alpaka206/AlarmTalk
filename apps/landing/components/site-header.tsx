"use client";

import { useTranslations } from "next-intl";
import { motion, useTransform } from "motion/react";
import { Link } from "@/i18n/navigation";
import { BrandMark } from "./brand-mark";
import { MobileMenu } from "./mobile-menu";
import { Magnetic } from "./motion/magnetic";
import { useScrollProgress } from "./motion/use-scroll-progress";

export function SiteHeader() {
  const t = useTranslations("nav");
  const { scrollY, progress } = useScrollProgress();

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
      {/* coral voice-spine — page scroll progress; resolves at the Waitlist */}
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
          <BrandMark size={32} className="rounded-[8px]" />
          <span className="text-[17px] font-bold tracking-tight text-text">
            AlarmTalk
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/#voices"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("voices")}
          </Link>
          <Link
            href="/#how"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("how")}
          </Link>
          <Link
            href="/#faq"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("faq")}
          </Link>
          <Link
            href="/company"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("company")}
          </Link>
          <Link
            href="/contact"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("contact")}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <Magnetic>
              <Link href="/#waitlist" className="btn btn-primary btn-sm">
                {t("cta")}
              </Link>
            </Magnetic>
          </div>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
