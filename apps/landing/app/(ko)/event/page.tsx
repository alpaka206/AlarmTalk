import { routing } from "@/i18n/routing";
import LocalePage, { generateMetadata as localeMetadata } from "@/app/[locale]/event/page";

// 접두사 없는 한국어 정식 주소. 본문·메타데이터는 `[locale]/event/page.tsx` 하나뿐이고 여기는 ko 로 고정한 껍데기다.
const params = Promise.resolve({ locale: routing.defaultLocale });

export const generateMetadata = () => localeMetadata({ params });

export default function Page() {
  return LocalePage({ params });
}
