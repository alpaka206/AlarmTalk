import { ArrowRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { PhonePreview } from "../phone-preview";
import { StoreBadges } from "../store-badges";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="relative">
      <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 pb-20 pt-12 md:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:gap-12 lg:pb-28 lg:pt-20">
        <div className="flex flex-col">
          <span className="inline-flex w-fit items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            {t("badge")}
          </span>

          <h1 className="mt-7 text-[44px] font-bold leading-[1.04] tracking-[-0.03em] text-text sm:text-[60px] lg:text-[72px]">
            {t("headline1")}
            <br />
            <span className="text-accent">{t("headline2")}</span>
          </h1>

          <p className="mt-7 max-w-[540px] text-[17px] leading-[1.65] text-text-muted sm:text-[18px]">
            {t("description")}
          </p>

          <div className="mt-10">
            <StoreBadges />
            <a
              href="#waitlist"
              className="group mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-text-muted transition hover:text-text"
            >
              {t("waitlistHint")}
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <PhonePreview />
        </div>
      </div>

      <a
        href="#voices"
        aria-label={t("scrollHint")}
        className="group absolute bottom-3 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-text-faint transition hover:text-text-muted md:flex"
      >
        {t("scrollHint")}
        <ChevronDown className="h-4 w-4 animate-bounce text-text-faint group-hover:text-text-muted" />
      </a>
    </section>
  );
}
