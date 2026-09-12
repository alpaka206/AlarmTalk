import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import {
  ORGANIZATION,
  SITE_NAME,
  SITE_URL,
  localePath,
  localeUrl,
  languageAlternates,
} from "@/lib/site";
import { HtmlLangSync } from "@/components/html-lang-sync";

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

  const t = await getTranslations({ locale, namespace: "meta" });
  const title = t("title");
  const description = t("description");

  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description,
    applicationName: SITE_NAME,
    alternates: {
      canonical: localePath(locale),
      languages: languageAlternates(),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale),
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const organizationLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ORGANIZATION.name,
    legalName: ORGANIZATION.legalName,
    url: ORGANIZATION.url,
    logo: ORGANIZATION.logo,
    ...(ORGANIZATION.sameAs.length > 0 ? { sameAs: ORGANIZATION.sameAs } : {}),
  };

  return (
    <NextIntlClientProvider>
      <HtmlLangSync locale={locale} />
      {/* 키보드 사용자가 매 페이지 헤더 링크 여덟 개를 지나지 않게. 초점이 올 때만 보인다. */}
      <a
        href="#main"
        className="sr-only fixed left-3 top-3 z-[60] rounded-[var(--radius-pill)] bg-accent px-4 py-2 text-[14px] font-semibold text-white focus:not-sr-only focus:fixed"
      >
        {tNav("skipToContent")}
      </a>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
      />
      {children}
    </NextIntlClientProvider>
  );
}
