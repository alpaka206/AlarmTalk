/**
 * 홈 본문. `/` 와 `/[locale]/` 두 라우트가 같은 화면을 쓴다 —
 * 한국어는 접두사 없이 루트가 정식 주소라(canonical `/`), 루트에도 **진짜 페이지**가
 * 있어야 한다. 리다이렉트 껍데기를 놓으면 색인의 대표 주소가 껍데기가 된다.
 */
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/site-header";
import { Hero } from "@/components/sections/hero";
import { WhoseVoice } from "@/components/sections/whose-voice";
import { FeatureSection } from "@/components/sections/feature-section";
import { ProductScroll } from "@/components/sections/product-scroll";
import { Declare } from "@/components/sections/declare";
import { FinalCta } from "@/components/sections/final-cta";
import { RecordMini } from "@/components/app-mini/record";
import { PickMessageMini } from "@/components/app-mini/pick-message";
import { SiteFooter } from "@/components/sections/site-footer";
import { APP_STORE_LIVE, SITE_NAME, STORE_LINKS, localeUrl } from "@/lib/site";

export async function HomeContent({ locale }: { locale: string }) {
  const tMeta = await getTranslations({ locale, namespace: "meta" });

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
    downloadUrl: [
      STORE_LINKS.googlePlay,
      ...(APP_STORE_LIVE ? [STORE_LINKS.appStore] : []),
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationLd),
        }}
      />
      <SiteHeader />
      {/* 순서는 **사용자가 겪는 시간**이 정한다: 이게 뭔가(듣는다) → 내일 아침에 무슨
          일이 → 왜 또 알람인가 → 누구 목소리인가 → 어떻게 등록하나 → 그 목소리가 뭐라고
          하나 → 얼마인가 → 나머지 → 어디서 받나.

          숫자 타일(무제한/4/0)은 뺐다 — 근거 숫자가 없는 페이지에서 숫자를 크게 놓으면
          사양표로 읽힌다(2026-09-06 레퍼런스 11곳 실측). 그 자리는 '누구 목소리' 챕터다.
          교대 배경(alt)은 마지막 CTA(bg-alt)와 붙지 않게 등록 섹션에 둔다. */}
      <main id="main" className="relative">
        <Hero />
        {/* 제품이 처음 나오는 자리. 히어로에서 폰을 뺀 대신 여기서 스크롤과 함께 켠다. */}
        <ProductScroll />
        <Declare />
        <WhoseVoice />
        <FeatureSection
          id="how"
          namespace="voice"
          alt
          visual={<RecordMini />}
        />
        <FeatureSection
          namespace="language"
          reverse
          visual={<PickMessageMini />}
        />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
