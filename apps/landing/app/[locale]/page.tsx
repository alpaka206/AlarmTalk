import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/sections/hero";
import { Trust } from "@/components/sections/trust";
import { FeatureSection } from "@/components/sections/feature-section";
import { Declare } from "@/components/sections/declare";
import { Privacy } from "@/components/sections/privacy";
import { Pricing } from "@/components/sections/pricing";
import { FinalCta } from "@/components/sections/final-cta";
import { DeviceShot, DeviceShotPair } from "@/components/device-shot";
import { Scenarios } from "@/components/sections/scenarios";
import { Faq } from "@/components/sections/faq";
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
    operatingSystem: "Android",
    url: localeUrl(locale),
    inLanguage: locale,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    ...(STORE_LINKS.googlePlay !== "#"
      ? { downloadUrl: [STORE_LINKS.googlePlay] }
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
      {/* 순서는 **사용자가 겪는 시간**이 정한다: 이게 뭔가 → 왜 또 알람인가 →
          어떻게 시작하나(등록) → 매일 뭘 얻나 → 같이 쓰면 → 나는 이런 사람인가 →
          안전한가 → 얼마인가 → 나머지 → 어디서 받나.

          '목소리 나누기' 를 뒤로 내린 이유: 그건 인원이 둘 이상일 때만 성립하는데,
          두 번째로 보여주면 혼자 쓰는 사람이 "내 얘기 아니네" 로 떠난다. */}
      <main className="relative">
        <Hero />
        <Declare />
        <Trust />
        <FeatureSection
          id="how"
          namespace="voice"
          visual={<DeviceShot name="register" />}
        />
        <FeatureSection
          namespace="language"
          reverse
          alt
          visual={<DeviceShotPair names={["message", "fortune"]} />}
        />
        <FeatureSection
          namespace="shared"
          visual={<DeviceShotPair names={["voices", "share"]} />}
        />
        <Scenarios />
        <Privacy />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
