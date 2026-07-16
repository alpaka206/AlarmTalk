import { useTranslations } from "next-intl";
import { PhonePreview } from "../phone-preview";
import { StoreBadges } from "../store-badges";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="relative">
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 pb-20 pt-12 md:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:pb-28 lg:pt-20">
        {/* Left column — staggered on-load entrance. Text stays server-rendered;
            only the thin Reveal wrappers are client. */}
        <RevealGroup className="flex flex-col" stagger={0.07} delay={0.05} trigger="mount">
          <RevealItem
            as="h1"
            className="text-[44px] font-bold leading-[1.04] tracking-[-0.03em] text-text sm:text-[60px] lg:text-[72px]"
          >
            {t("headline1")}
            <span className="mt-3 block text-accent">{t("headline2")}</span>
          </RevealItem>

          <RevealItem
            as="p"
            className="mt-7 max-w-135 text-[17px] leading-[1.65] text-text-muted sm:text-[18px]"
          >
            {t("description")}
          </RevealItem>

          <RevealItem as="div" className="mt-10 flex flex-col gap-4">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <StoreBadges />
            </div>
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
