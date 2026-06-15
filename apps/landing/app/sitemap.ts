import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { localeUrl } from "@/lib/site";

const PAGES = ["", "company", "contact", "privacy", "terms", "account-deletion"] as const;

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  // ko 는 접두사 없이 루트(/, /privacy/ …), en·ja 는 /en, /ja 접두사. (localeUrl 가 처리)
  return routing.locales.flatMap((locale) =>
    PAGES.map((page) => ({
      url: localeUrl(locale, page),
      lastModified,
      changeFrequency: "weekly" as const,
      priority:
        page === "" ? (locale === routing.defaultLocale ? 1 : 0.8) : 0.5,
      alternates: {
        languages: {
          ...Object.fromEntries(
            routing.locales.map((l) => [l, localeUrl(l, page)]),
          ),
          "x-default": localeUrl(routing.defaultLocale, page),
        },
      },
    })),
  );
}
