import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
import { Faq } from "@/components/sections/faq";
import { SITE_NAME, localeUrl, localePath, languageAlternates, OG_IMAGES } from "@/lib/site";

type FaqItem = { q: string; a: string };

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

  const t = await getTranslations({ locale, namespace: "faq.meta" });
  const title = t("title");
  const description = t("description");
  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, "faq"),
      languages: languageAlternates("faq"),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, "faq"),
      siteName: SITE_NAME,
      title,
      description,
      images: OG_IMAGES,
    },
    twitter: { card: "summary_large_image", title, description, images: OG_IMAGES },
  };
}

/**
 * 자주 묻는 질문 — 홈에서 떼어 낸 페이지(2026-09-15 지시). FAQPage JSON-LD 도 홈이 아니라
 * 여기 붙는다: 검색엔진은 질문·답이 실제로 있는 URL 에서만 그 마크업을 믿는다.
 */
export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "faq" });
  const items = t.raw("items") as FaqItem[];
  const faqPageLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageLd) }}
      />
      <SiteHeader />
      <main id="main" className="relative">
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
