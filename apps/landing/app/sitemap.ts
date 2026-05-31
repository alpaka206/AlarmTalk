import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site";

const PAGES = ["", "company", "contact", "privacy", "terms", "account-deletion"] as const;

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return routing.locales.flatMap((locale) =>
    PAGES.map((page) => {
      const path = page ? `${locale}/${page}/` : `${locale}/`;

      return {
        url: `${SITE_URL}/${path}`,
        lastModified,
        changeFrequency: "weekly" as const,
        priority:
          page === "" ? (locale === routing.defaultLocale ? 1 : 0.8) : 0.5,
        alternates: {
          languages: {
            ...Object.fromEntries(
              routing.locales.map((l) => [
                l,
                `${SITE_URL}/${page ? `${l}/${page}/` : `${l}/`}`,
              ]),
            ),
            "x-default": `${SITE_URL}/${page ? `${routing.defaultLocale}/${page}/` : `${routing.defaultLocale}/`}`,
          },
        },
      };
    }),
  );
}
