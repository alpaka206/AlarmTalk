import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale, useTranslations } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/sections/site-footer";
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

  const t = await getTranslations({ locale, namespace: "contact.meta" });
  const title = t("title");
  const description = t("description");

  const ogLocale = ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
    locale as Locale
  ];

  return {
    title,
    description,
    alternates: {
      canonical: localePath(locale, "contact"),
      languages: languageAlternates("contact"),
    },
    openGraph: {
      type: "website",
      locale: ogLocale,
      url: localeUrl(locale, "contact"),
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ContactPage({
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
        <ContactHero />
        <Channels />
        <ResponseNote />
      </main>
      <SiteFooter />
    </>
  );
}

function ContactHero() {
  const t = useTranslations("contact.hero");
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-16 md:px-8 lg:pb-20 lg:pt-24">
        <div className="max-w-3xl">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h1 className="mt-6 text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-text sm:text-[58px] lg:text-[64px]">
            {t("headline1")}
            <br />
            <span className="text-accent">{t("headline2")}</span>
          </h1>
          <p className="mt-7 max-w-155 text-[17px] leading-[1.65] text-text-muted">
            {t("description")}
          </p>
        </div>
      </div>
    </section>
  );
}

type ChannelItem = {
  tag: string;
  title: string;
  body: string;
  email: string;
  cta: string;
};

function Channels() {
  const t = useTranslations("contact.channels");
  const items = t.raw("items") as ChannelItem[];
  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 lg:py-24">
        <div className="max-w-3xl">
          <h2 className="text-[28px] font-bold leading-[1.2] tracking-[-0.02em] text-text sm:text-[36px]">
            {t("headline")}
          </h2>
          <p className="mt-4 text-[15.5px] leading-[1.65] text-text-muted">
            {t("description")}
          </p>
        </div>

        <ul className="mt-12 grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.email} className="card group flex flex-col p-7">
              <span className="inline-flex w-fit items-center rounded-full border border-line bg-raised px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-text-faint">
                {item.tag}
              </span>
              <h3 className="mt-5 text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-text">
                {item.title}
              </h3>
              <p className="mt-3 text-[14.5px] leading-[1.65] text-text-muted">
                {item.body}
              </p>
              <a
                href={`mailto:${item.email}`}
                className="mt-6 inline-flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:border-line/0 hover:bg-raised"
              >
                <span className="flex flex-col leading-tight">
                  <span className="text-[10.5px] uppercase tracking-wider text-text-faint">
                    {item.cta}
                  </span>
                  <span className="text-[14px] font-semibold text-text">
                    {item.email}
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 text-text-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-text" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ResponseNote() {
  const t = useTranslations("contact.note");
  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 lg:py-20">
        <div className="card mx-auto max-w-3xl p-8 lg:p-10">
          <h2 className="text-[20px] font-semibold leading-[1.3] tracking-[-0.01em] text-text sm:text-[22px]">
            {t("headline")}
          </h2>
          <p className="mt-4 text-[14.5px] leading-[1.7] text-text-muted">
            {t("body")}
          </p>
        </div>
      </div>
    </section>
  );
}
