import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import {
  ORGANIZATION,
  SITE_NAME,
  SITE_URL,
  localePath,
  localeUrl,
  languageAlternates,
} from "@/lib/site";
import { HtmlLangSync } from "@/components/html-lang-sync";
import { HomeContent } from "@/components/home-content";

/**
 * 루트 `/` — **한국어 홈의 정식 주소다.**
 *
 * 기본 로케일은 접두사를 쓰지 않으므로(`localePrefix: "as-needed"`) canonical·hreflang
 * x-default·사이트맵이 전부 `/` 를 가리킨다. 그런데 라우트가 `[locale]` 하나뿐이면
 * 정작 그 주소에 파일이 없어서, 배포에서는 rewrite 에 기대고 로컬에서는 404 가 났다.
 *
 * 여기에 **리다이렉트 껍데기를 두면 안 된다.** 정적 export 에서는 이 파일이
 * `out/index.html` 이 되고, 호스팅은 rewrite 보다 파일시스템을 먼저 본다 — 즉 색인의
 * 대표 주소가 껍데기가 된다. 그래서 진짜 본문을 렌더한다.
 *
 * 로케일 컨텍스트는 `[locale]/layout.tsx` 가 주는데 루트는 그 레이아웃 밖이라,
 * 그 레이아웃이 하는 일(로케일 고정 · 프로바이더 · html lang · 조직 LD)을 여기서 한다.
 */

const LOCALE = routing.defaultLocale;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: LOCALE, namespace: "meta" });
  const title = t("title");
  const description = t("description");

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description,
    applicationName: SITE_NAME,
    alternates: {
      canonical: localePath(LOCALE),
      languages: languageAlternates(),
    },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      url: localeUrl(LOCALE),
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function RootHomePage() {
  setRequestLocale(LOCALE);

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
    <NextIntlClientProvider locale={LOCALE}>
      <HtmlLangSync locale={LOCALE} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
      />
      <HomeContent locale={LOCALE} />
    </NextIntlClientProvider>
  );
}
