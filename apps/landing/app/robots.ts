import type { MetadataRoute } from "next";

// TODO: 새 도메인 확정 후 갱신 (AlarmTalk 리브랜딩 — Phase 미정)
const SITE_URL = "https://waker.com";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
