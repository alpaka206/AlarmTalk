import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale, useTranslations } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
import { StoreBadges } from "@/components/store-badges";
import { PricingTable } from "@/components/pricing-table";
import { Reveal } from "@/components/motion/reveal";
import { RevealGroup, RevealItem } from "@/components/motion/reveal-group";
import { SITE_NAME, localeUrl, localePath, languageAlternates, OG_IMAGES } from "@/lib/site";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "pricing.meta" });
  const title = t("title");
  const description = t("description");
  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, "pricing"),
      languages: languageAlternates("pricing"),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, "pricing"),
      siteName: SITE_NAME,
      title,
      description,
      images: OG_IMAGES,
    },
    twitter: { card: "summary_large_image", title, description, images: OG_IMAGES },
  };
}

/**
 * 요금 페이지 — 홈에서 떼어 낸 자리(2026-09-15 지시). 홈은 "무엇인가" 만 말하고, 얼마인지는
 * 여기서 표로 비교한다. 표 자체의 원칙은 `components/pricing-table.tsx` 에.
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <SiteHeader />
      <main id="main" className="relative">
        <PricingHero />
        <section className="relative">
          <div className="mx-auto max-w-site px-5 pb-24 md:px-8 lg:pb-32">
            <PricingTable />
          </div>
        </section>
        <PricingCta />
      </main>
      <SiteFooter />
    </>
  );
}

function PricingHero() {
  const t = useTranslations("pricing");
  return (
    <section className="relative">
      <div className="mx-auto flex max-w-site flex-col items-center px-5 pb-12 pt-16 text-center md:px-8 lg:pb-14 lg:pt-24">
        <RevealGroup className="flex flex-col items-center" stagger={0.07} trigger="mount">
          <RevealItem as="h1" className="t-display max-w-3xl text-text">
            {t("headline")}
          </RevealItem>
          <RevealItem as="p" className="t-lead mt-6 max-w-2xl text-balance text-text-body">
            {t("lead")}
          </RevealItem>
        </RevealGroup>
      </div>
    </section>
  );
}

function PricingCta() {
  const t = useTranslations("pricing.cta");
  return (
    <section className="bg-bg-alt">
      <div className="section-pad mx-auto max-w-site px-5 md:px-8">
        <Reveal className="mx-auto flex max-w-155 flex-col items-center text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
          <p className="t-lead mt-5 text-text-body">{t("body")}</p>
          <div className="mt-9">
            <StoreBadges />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
