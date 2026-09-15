import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { EVENTS } from "@/lib/events";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
import { RevealGroup, RevealItem } from "@/components/motion/reveal-group";
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
 * 이벤트 목록. 번호로 쌓인다(1, 2, 3 …)고 각 이벤트는 `/event/<id>/`. 목록 데이터는
 * `lib/events.ts`, 카피는 `eventList.items.<key>`.
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

function EventList() {
  const t = useTranslations("eventList");
  return (
    <section className="relative">
      <div className="mx-auto max-w-site px-5 pb-24 pt-16 md:px-8 lg:pb-32 lg:pt-24">
        <RevealGroup className="flex flex-col" stagger={0.07} trigger="mount">
          <RevealItem as="h1" className="t-display text-text">
            {t("headline")}
          </RevealItem>
          <RevealItem as="p" className="t-lead mt-5 max-w-2xl text-text-body">
            {t("lead")}
          </RevealItem>
        </RevealGroup>

        <RevealGroup as="ol" className="mt-12 flex flex-col gap-4" stagger={0.07}>
          {EVENTS.map((event) => (
            <RevealItem as="li" key={event.id}>
              {/* 번호는 장식이 아니라 주소다. /event/1/ 의 그 1. */}
              <Link
                href={`/event/${event.id}`}
                className="card card-interactive flex items-center gap-5 p-6 sm:gap-7 sm:p-8"
              >
                <span
                  className="t-metric w-10 shrink-0 tabular-nums text-text-muted sm:w-14"
                  aria-hidden="true"
                >
                  {event.id}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{t("numberAria", { n: event.id })} </span>
                  <span className="t-h2 block text-text [overflow-wrap:anywhere]">
                    {t(`items.${event.key}.title`)}
                  </span>
                </span>
                <ArrowRight className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
