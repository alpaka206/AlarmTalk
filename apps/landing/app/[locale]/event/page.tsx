import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
import { EventList } from "@/components/event/event-list";
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

  const t = await getTranslations({ locale, namespace: "eventList.meta" });
  const title = t("title");
  const description = t("description");
  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, "event"),
      languages: languageAlternates("event"),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, "event"),
      siteName: SITE_NAME,
      title,
      description,
      images: OG_IMAGES,
    },
    twitter: { card: "summary_large_image", title, description, images: OG_IMAGES },
  };
}

/**
 * 이벤트 목록. 번호로 쌓이고(1, 2, 3 …) 각 이벤트는 `/event/<id>/`. 목록 데이터는
 * `lib/events.ts`, 카피는 `eventList.items.<key>`, 그림은 `components/event/event-list.tsx`.
 */
export default async function EventListPage({
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
        <EventList />
      </main>
      <SiteFooter />
    </>
  );
}
