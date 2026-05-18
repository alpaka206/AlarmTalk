import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalMarkdown } from "@/components/legal-markdown";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/site-header";
import { readLegalDoc } from "@/lib/legal-docs";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  return {
    title: "개인정보 처리방침",
    description: "Naro 음성 알람 서비스의 개인정보 처리방침입니다.",
    alternates: { canonical: `/${locale}/privacy` },
    robots: { index: true, follow: true },
  };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 py-16 md:px-8 md:py-24">
        <LegalMarkdown content={readLegalDoc("privacy")} />
      </main>
      <SiteFooter />
    </>
  );
}
