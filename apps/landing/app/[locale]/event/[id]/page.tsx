import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { EVENTS, findEvent } from "@/lib/events";
import { SiteFooter } from "@/components/sections/site-footer";
import { StoreBadges } from "@/components/store-badges";
import { EventStudio } from "@/components/event/event-studio";
import { Reveal } from "@/components/motion/reveal";
import { RevealGroup, RevealItem } from "@/components/motion/reveal-group";
import { SITE_NAME, localeUrl, localePath, languageAlternates, OG_IMAGES } from "@/lib/site";

export function generateStaticParams() {
  return routing.locales.flatMap((locale) => EVENTS.map((e) => ({ locale, id: e.id })));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  if (!hasLocale(routing.locales, locale) || !findEvent(id)) return {};
  const page = `event/${id}`;

  const t = await getTranslations({ locale, namespace: "event.meta" });
  const title = t("title");
  const description = t("description");
  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, page),
      languages: languageAlternates(page),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, page),
      siteName: SITE_NAME,
      title,
      description,
      images: OG_IMAGES,
    },
    twitter: { card: "summary_large_image", title, description, images: OG_IMAGES },
  };
}

/**
 * 이벤트 1, 내 이름 음성 메시지. 목록(`/event/`)에서 번호로 들어온다. 지금은 이벤트가 하나라
 * id 별로 본문을 가르지 않고, 아는 id 가 아니면 404 다(`lib/events.ts`).
 *
 * 상단 내비는 두지 않는다(2026-09-15 지시) — 이벤트 본문은 공유 링크로 들어와 한 가지만 하는
 * 화면이라, 나가는 길은 위의 "이벤트 목록" 과 아래 푸터면 된다.
 */
export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!findEvent(id)) notFound();
  setRequestLocale(locale);

  return (
    <>
      <main id="main" className="relative">
        <BackToList />
        <EventHero />
        <EventStudio />
        <EventCta />
      </main>
      <SiteFooter />
    </>
  );
}

function BackToList() {
  const t = useTranslations("eventList");
  return (
    <div className="mx-auto max-w-site px-5 pt-6 md:px-8 md:pt-8">
      <Link
        href="/event"
        className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("backToList")}
      </Link>
    </div>
  );
}

/**
 * 첫 화면은 헤드라인 한 문장뿐이다(2026-09-15 지시로 설명·아이브로·AI 고지 칩을 뺐다).
 * AI 목소리 고지는 카드 아래 각주 한 곳에서 한다.
 */
function EventHero() {
  const t = useTranslations("event.hero");
  return (
    <section className="relative">
      <div className="mx-auto flex max-w-site flex-col items-center px-5 pb-12 pt-10 text-center md:px-8 lg:pb-16 lg:pt-16">
        <RevealGroup className="flex flex-col items-center" stagger={0.07} trigger="mount">
          <RevealItem as="h1" className="t-display text-text">
            {t("headline")}
          </RevealItem>
        </RevealGroup>
      </div>
    </section>
  );
}

function EventCta() {
  const t = useTranslations("event.cta");
  return (
    <section className="bg-bg-alt">
      <div className="section-pad mx-auto max-w-site px-5 md:px-8">
        <Reveal className="mx-auto flex max-w-155 flex-col items-center text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
          <p className="t-lead mt-5 text-text-body">{t("body")}</p>
          <div className="mt-9">
            <StoreBadges />
          </div>
          <Link
            href="/"
            className="mt-6 text-[14px] font-semibold text-accent transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-accent-strong"
          >
            {t("secondary")}
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
