import { setRequestLocale } from "next-intl/server";
import { HomeContent } from "@/components/home-content";

/** `/en/`, `/ja/` (그리고 빌드 산출물의 `/ko/`). 본문은 루트와 공유한다. */
export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeContent locale={locale} />;
}
