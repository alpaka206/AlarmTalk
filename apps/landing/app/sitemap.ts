import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const SITE_URL = "https://waker.com";
const PAGES = ["", "privacy", "terms"] as const;

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
          languages: Object.fromEntries(
            routing.locales.map((l) => [
              l,
              `${SITE_URL}/${page ? `${l}/${page}/` : `${l}/`}`,
            ]),
          ),
        },
      };
    }),
  );
}
