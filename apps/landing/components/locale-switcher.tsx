"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

export function LocaleSwitcher() {
  const locale = useLocale() as Locale;
  const t = useTranslations("language_switcher");
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(next: Locale) {
    if (next === locale) return;
    router.replace(pathname, { locale: next });
  }

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="inline-flex items-center rounded-full border border-line bg-surface p-1"
    >
      {routing.locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => handleChange(l)}
            aria-pressed={active}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-[color,background-color] duration-150 ease-[var(--ease-ui)] ${
              active
                ? "bg-raised text-text"
                : "text-text-muted hover:text-text"
            }`}
          >
            {t(l)}
          </button>
        );
      })}
    </div>
  );
}
