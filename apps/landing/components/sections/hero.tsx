import { ArrowRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { PhonePreview } from "../phone-preview";
import { StoreBadges } from "../store-badges";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { Magnetic } from "../motion/magnetic";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="relative">
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 pb-20 pt-12 md:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:pb-28 lg:pt-20">
        {/* Left column — staggered on-load entrance. Text stays server-rendered;
            only the thin Reveal/Magnetic wrappers are client. */}
        <RevealGroup className="flex flex-col" stagger={0.07} delay={0.05} trigger="mount">
          <RevealItem
            as="span"
            className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-medium text-text-muted"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            {t("badge")}
          </RevealItem>

          <RevealItem
            as="h1"
            className="mt-7 text-[44px] font-bold leading-[1.04] tracking-[-0.03em] text-text sm:text-[60px] lg:text-[72px]"
          >
            {t("headline1")}
            <br />
            <span className="text-accent">{t("headline2")}</span>
          </RevealItem>

          <RevealItem
            as="p"
            className="mt-7 max-w-[540px] text-[17px] leading-[1.65] text-text-muted sm:text-[18px]"
          >
            {t("description")}
          </RevealItem>

          <RevealItem as="div" className="mt-10 flex flex-col gap-4">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <Magnetic>
                <a href="#waitlist" className="group btn btn-primary">
                  {t("ctaPrimary")}
                  <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-0.5" />
                </a>
              </Magnetic>
              <StoreBadges />
            </div>
            <p className="text-[13px] text-text-faint">{t("ctaNote")}</p>
          </RevealItem>

          <RevealItem as="div" className="mt-8">
            <span className="animate-bob inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-[0.14em] text-text-faint">
              {t("scrollHint")}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </RevealItem>
        </RevealGroup>

        {/* Phone — "powers on" after the text settles. */}
        <Reveal
          variant="focus"
          delay={0.42}
          trigger="mount"
          className="flex items-center justify-center"
        >
          <PhonePreview />
        </Reveal>
      </div>
    </section>
  );
}
