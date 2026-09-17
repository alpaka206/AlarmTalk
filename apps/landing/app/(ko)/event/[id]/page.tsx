import { routing } from "@/i18n/routing";
import { EVENTS } from "@/lib/events";
import LocalePage, { generateMetadata as localeMetadata } from "@/app/[locale]/event/[id]/page";

// 접두사 없는 한국어 정식 주소(/event/1/). 본문·메타데이터는 `[locale]/event/[id]/page.tsx` 하나뿐이다.
export function generateStaticParams() {
  return EVENTS.map((e) => ({ id: e.id }));
}

type Params = { params: Promise<{ id: string }> };

const withLocale = (params: Params["params"]) =>
  params.then(({ id }) => ({ locale: routing.defaultLocale, id }));

export const generateMetadata = ({ params }: Params) => localeMetadata({ params: withLocale(params) });

export default function Page({ params }: Params) {
  return LocalePage({ params: withLocale(params) });
}
