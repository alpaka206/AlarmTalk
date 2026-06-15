import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/sections/hero";
import { Trust } from "@/components/sections/trust";
import { FeatureSection } from "@/components/sections/feature-section";
import {
  VoiceVisual,
  SharedVisual,
  LanguageVisual,
} from "@/components/sections/feature-visuals";
import { Scenarios } from "@/components/sections/scenarios";
import { Quotes } from "@/components/sections/quotes";
import { Faq } from "@/components/sections/faq";
import { Waitlist } from "@/components/sections/waitlist";
import { SiteFooter } from "@/components/sections/site-footer";
import { SITE_NAME, STORE_LINKS, localeUrl } from "@/lib/site";

type FaqItem = { q: string; a: string };

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const tMeta = await getTranslations({ locale, namespace: "meta" });
  const tFaq = await getTranslations({ locale, namespace: "faq" });
  const faqItems = tFaq.raw("items") as FaqItem[];

  const softwareApplicationLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: tMeta("description"),
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Android, iOS",
    url: localeUrl(locale),
    inLanguage: locale,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    ...(STORE_LINKS.googlePlay !== "#" || STORE_LINKS.appStore !== "#"
      ? {
          downloadUrl: [STORE_LINKS.googlePlay, STORE_LINKS.appStore].filter(
            (u) => u !== "#",
          ),
        }
      : {}),
  };

  const faqPageLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationLd),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageLd) }}
      />
      <SiteHeader />
      <main className="relative">
        <Hero />
        <Trust />
        <FeatureSection
          id="how"
          namespace="voice"
          visual={<VoiceVisual />}
        />
        <FeatureSection
          namespace="shared"
          reverse
          visual={<SharedVisual />}
        />
        <FeatureSection namespace="language" visual={<LanguageVisual />} />
        <Scenarios />
        <Quotes />
        <Faq />
        <Waitlist />
      </main>
      <SiteFooter />
    </>
  );
}
