import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static";

/**
 * 막을 것이 없다 — 전부 공개 소개 페이지다. 그래서 규칙은 최소로 두고, 크롤러가
 * **찾아야 할 것**을 가리키는 데 집중한다.
 *
 * `/_next/` 를 막지 않는 것은 의도다. CSS·JS 를 못 읽으면 검색엔진이 페이지를 사람이
 * 보는 대로 렌더하지 못해 모바일 친화성·레이아웃 판정이 틀어진다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
