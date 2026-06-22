import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
import { StoreBadges } from "@/components/store-badges";
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

  const t = await getTranslations({ locale, namespace: "company.meta" });
  const title = t("title");
  const description = t("description");

  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, "company"),
      languages: languageAlternates("company"),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, "company"),
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function CompanyPage({
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
        <CompanyHero />
        <Principles />
        <Products />
        <FutureSlots />
        <CompanyCta />
      </main>
      <SiteFooter />
    </>
  );
}

function CompanyHero() {
  const t = useTranslations("company.hero");
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-16 md:px-8 lg:pb-28 lg:pt-24">
        <div className="max-w-3xl">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className="mt-6 text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-text sm:text-[60px] lg:text-[68px]">
            {t("headline1")}
            <br />
            <span className="text-accent">{t("headline2")}</span>
          </h1>
          <p className="mt-7 max-w-[640px] text-[17px] leading-[1.65] text-text-muted sm:text-[18px]">
            {t("description")}
          </p>
        </div>
      </div>
    </section>
  );
}

type PrincipleItem = { title: string; body: string };

function Principles() {
  const t = useTranslations("company.principles");
  const items = t.raw("items") as PrincipleItem[];
  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
        <div className="max-w-3xl">
          <h2 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-text sm:text-[40px]">
            {t("headline")}
          </h2>
          <p className="mt-5 text-[16px] leading-[1.65] text-text-muted">
            {t("description")}
          </p>
        </div>
        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <li key={item.title} className="card p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 text-[18px] font-semibold leading-[1.35] tracking-[-0.01em] text-text">
                {item.title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-[1.65] text-text-muted">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Products() {
  const t = useTranslations("company.products");
  const alarm = t.raw("alarmtalk") as {
    tag: string;
    title: string;
    body: string;
    cta: string;
  };
  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
        <div className="max-w-3xl">
          <h2 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-text sm:text-[40px]">
            {t("headline")}
          </h2>
          <p className="mt-5 text-[16px] leading-[1.65] text-text-muted">
            {t("description")}
          </p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-2">
          <article className="card-raised p-8 lg:p-10">
            <span className="eyebrow">{alarm.tag}</span>
            <h3 className="mt-5 text-[26px] font-semibold leading-[1.25] tracking-[-0.01em] text-text">
              {alarm.title}
            </h3>
            <p className="mt-4 max-w-[44ch] text-[15.5px] leading-[1.7] text-text-muted">
              {alarm.body}
            </p>
            <Link
              href="/"
              className="group mt-6 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-accent transition hover:text-accent-strong"
            >
              {alarm.cta}
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}

type FutureItem = { tag: string; title: string; body: string };

function FutureSlots() {
  const t = useTranslations("company.future");
  const items = t.raw("items") as FutureItem[];
  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
        <div className="max-w-3xl">
          <h2 className="text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-text sm:text-[40px]">
            {t("headline")}
          </h2>
          <p className="mt-5 text-[16px] leading-[1.65] text-text-muted">
            {t("description")}
          </p>
        </div>
        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li
              key={item.title}
              className="card p-6 opacity-80 transition hover:opacity-100"
            >
              <span className="inline-flex items-center rounded-full border border-line bg-raised px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint">
                {item.tag}
              </span>
              <h3 className="mt-5 text-[17px] font-semibold leading-[1.4] tracking-[-0.01em] text-text">
                {item.title}
              </h3>
              <p className="mt-3 text-[14px] leading-[1.65] text-text-muted">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CompanyCta() {
  const t = useTranslations("company.cta");
  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
        <div className="card-raised mx-auto max-w-3xl p-10 text-center lg:p-14">
          <h2 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-text sm:text-[36px]">
            {t("headline")}
          </h2>
          <p className="mt-4 text-[15.5px] leading-[1.65] text-text-muted">
            {t("body")}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <StoreBadges />
            <Link href="/contact" className="btn btn-secondary">
              {t("secondary")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
