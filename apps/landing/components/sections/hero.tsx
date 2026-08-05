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
          {/* 강조색 예산의 절반이 여기 있다. 예전에는 아이브로가 비어 있고 60px 헤드라인
              한 줄 전체가 파랬다 — 예산이 정확히 거꾸로 쓰이고 있었다. */}
          <RevealItem as="p" className="eyebrow mb-4">
            {t("tag")}
          </RevealItem>

          <RevealItem as="h1" className="t-display text-text">
            {t("headline")}
          </RevealItem>

          <RevealItem as="p" className="t-lead mt-6 max-w-135 text-text-body">
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
          variant="heavy"
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
