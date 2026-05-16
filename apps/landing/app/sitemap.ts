import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const SITE_URL = "https://vocawake.com";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return routing.locales.map((locale) => ({
    url: `${SITE_URL}/${locale}/`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: locale === routing.defaultLocale ? 1 : 0.8,
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `${SITE_URL}/${l}/`])
      ),
    },
  }));
}
