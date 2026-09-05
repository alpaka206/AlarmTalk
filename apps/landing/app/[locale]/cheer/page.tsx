import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
import { StoreBadges } from "@/components/store-badges";
import { CheerStudio } from "@/components/cheer/cheer-studio";
import { Reveal } from "@/components/motion/reveal";
import { RevealGroup, RevealItem } from "@/components/motion/reveal-group";
import { SITE_NAME, localeUrl, localePath, languageAlternates } from "@/lib/site";

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

  const t = await getTranslations({ locale, namespace: "cheer.meta" });
  const title = t("title");
  const description = t("description");
  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, "cheer"),
      languages: languageAlternates("cheer"),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, "cheer"),
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CheerPage({
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
        <CheerHero />
        <CheerStudio />
        <CheerSteps />
        <CheerCta />
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * 첫 화면은 한 문장으로 무엇인지 넘기고, **AI 목소리라는 사실을 같은 화면에서** 말한다.
 * 그 문장을 각주로 내리면 카드 여섯 장을 다 듣고 나서야 알게 된다.
 */
function CheerHero() {
  const t = useTranslations("cheer.hero");
  return (
    <section className="relative">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-14 pt-16 text-center md:px-8 lg:pb-20 lg:pt-24">
        <RevealGroup className="flex flex-col items-center" stagger={0.07} trigger="mount">
          <RevealItem as="span" className="eyebrow">
            {t("eyebrow")}
          </RevealItem>
          <RevealItem as="h1" className="t-display mt-5 max-w-4xl text-text">
            {t("headline")}
          </RevealItem>
          <RevealItem as="p" className="t-lead mt-6 max-w-2xl text-balance text-text-body">
            {t("description")}
          </RevealItem>
          <RevealItem
            as="p"
            className="mt-7 inline-flex items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-bg-alt px-4 py-2 text-[13px] font-semibold text-text-strong"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
            {t("disclaimer")}
          </RevealItem>
        </RevealGroup>
      </div>
    </section>
  );
}

type Step = { title: string; body: string };

function CheerSteps() {
  const t = useTranslations("cheer.steps");
  const items = t.raw("items") as Step[];
  return (
    <section className="bg-bg-alt">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <Reveal className="mx-auto max-w-155 text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
        </Reveal>
        <RevealGroup as="ol" className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8" stagger={0.07}>
          {items.map((item, i) => (
            <RevealItem as="li" key={item.title} className="flex flex-col">
              {/* 번호는 장식이 아니다 — 실제로 이 순서대로 한다(이름 → 목소리 → 재생). */}
              <span className="t-metric text-text">{i + 1}</span>
              <span className="t-h3 mt-3 text-text">{item.title}</span>
              <p className="t-body mt-2 text-text-body">{item.body}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}

function CheerCta() {
  const t = useTranslations("cheer.cta");
  return (
    <section className="relative">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
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
