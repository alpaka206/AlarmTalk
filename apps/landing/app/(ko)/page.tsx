import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { HomeContent } from "@/components/home-content";

/**
 * 루트 `/` — 한국어 홈의 정식 주소. 리다이렉트 껍데기가 아니라 진짜 본문이다(정적 export
 * 에서는 이 파일이 `out/index.html` 이 되고, 호스팅은 rewrite 보다 파일시스템을 먼저 본다).
 * 프로바이더·메타데이터는 `(ko)/layout.tsx` 가 준다.
 */
export default async function RootHomePage() {
  setRequestLocale(routing.defaultLocale);
  return <HomeContent locale={routing.defaultLocale} />;
}
