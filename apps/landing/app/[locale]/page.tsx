import { setRequestLocale } from "next-intl/server";
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
import { Faq } from "@/components/sections/faq";
import { Waitlist } from "@/components/sections/waitlist";
import { SiteFooter } from "@/components/sections/site-footer";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
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
        <Faq />
        <Waitlist />
      </main>
      <SiteFooter />
    </>
  );
}
