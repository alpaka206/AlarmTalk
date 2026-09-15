"use client";

import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

/**
 * 언어 전환은 **링크**다 — `/en/…` 로 가는 내비게이션이지 상태 토글이 아니다.
 *
 * 버튼 + `router.replace` 로 만들면 정적 export 에서 JS 가 붙기 전에는 아무 일도 없고,
 * 크롤러가 대체 언어를 따라갈 수 없으며, 새 탭으로 열 수도 없다. 주소는 직접 만든다:
 * next-intl `Link` 에 `locale` 을 넘기면 as-needed 에서도 ko 에 `/ko` 접두사를 붙이는데,
 * ko 의 정식 주소는 접두사 없는 쪽이다(`app/(ko)/`). 라벨은 각자의 언어로 적혀 있으므로
 * `lang` 을 붙여 스크린리더가 그 언어로 읽게 한다.
 */
export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("language_switcher");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="inline-flex items-center rounded-full border border-line bg-surface p-1"
    >
      {routing.locales.map((l) => {
        const active = l === locale;
        const href = l === routing.defaultLocale ? pathname : `/${l}${pathname}`;
        return (
          <NextLink
            key={l}
            href={href}
            hrefLang={l}
            lang={l}
            aria-current={active ? "true" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-[color,background-color] duration-150 ease-[var(--ease-ui)] ${
              active
                ? "bg-raised text-text"
                : "text-text-muted hover:text-text"
            }`}
          >
            {t(l)}
          </NextLink>
        );
      })}
    </nav>
  );
}
