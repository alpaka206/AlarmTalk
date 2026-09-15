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
  languageAlternates, OG_IMAGES
} from "@/lib/site";
import { HtmlLangSync } from "@/components/html-lang-sync";

/**
 * 접두사 없는 한국어 라우트 묶음 — `/`, `/pricing/`, `/faq/`, `/event/` … 의 **정식 주소**.
 *
 * 기본 로케일(ko)은 접두사를 쓰지 않는데(`localePrefix: "as-needed"`) 라우트가 `[locale]`
 * 하나뿐이면 그 주소에 파일이 없다. 배포에서는 Vercel rewrite 에 기댔고 로컬 dev 에서는
 * `/pricing/` 이 `[locale]=pricing` 으로 잡혀 500 이 났다(2026-09-15). 그래서 한국어
 * 페이지를 **진짜 파일**로 한 벌 더 만든다: 이 그룹의 페이지들은 `[locale]/<page>/page.tsx` 를
 * 로케일만 ko 로 고정해 다시 내보내는 얇은 껍데기다. 본문·메타데이터는 한 곳에만 있다.
 *
 * 이 레이아웃은 `[locale]/layout.tsx` 가 하는 일(로케일 고정 · 프로바이더 · html lang ·
 * 건너뛰기 링크 · 조직 LD)을 ko 로 고정해서 똑같이 한다.
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
      images: OG_IMAGES,
    },
    twitter: { card: "summary_large_image", title, description, images: OG_IMAGES },
    robots: { index: true, follow: true },
  };
}

export default async function KoLayout({ children }: { children: React.ReactNode }) {
  setRequestLocale(LOCALE);
  const tNav = await getTranslations({ locale: LOCALE, namespace: "nav" });

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
