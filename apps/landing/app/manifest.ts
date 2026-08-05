import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";

export const dynamic = "force-static";

/**
 * 웹 앱 매니페스트. 우리 랜딩은 설치형 웹앱이 아니라 **소개 페이지**라
 * `display: "browser"` 로 둔다 — standalone 으로 두면 홈 화면에 담았을 때 주소창 없는
 * 껍데기가 되고, 사용자는 실제 앱을 받은 줄 알게 된다. 진짜 앱은 Play 에 있다.
 *
 * 그래서 여기 매니페스트가 하는 일은 하나다: 검색·공유·북마크에서 이름과 아이콘,
 * 브랜드색을 일관되게 보여주는 것.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description:
      "좋아하는 목소리로 시작하는 아침. 직접 녹음한 목소리, 가족이 나눠준 목소리, 기본 목소리로 알람이 울립니다.",
    start_url: "/",
    scope: "/",
    display: "browser",
    lang: "ko",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["lifestyle", "productivity"],
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/brand-icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
