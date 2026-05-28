import { useTranslations } from "next-intl";
import { STORE_LINKS } from "@/lib/site";

function AppStoreGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="h-6 w-6"
    >
      <path d="M16.365 1.43c.043 1.18-.34 2.34-1.099 3.18-.74.83-1.95 1.47-3.13 1.38-.05-1.15.41-2.34 1.16-3.16.77-.83 2.06-1.45 3.07-1.4Zm3.59 16.21c-.62 1.34-.92 1.94-1.72 3.13-1.13 1.67-2.72 3.74-4.69 3.76-1.75.02-2.2-1.13-4.57-1.12-2.37.01-2.86 1.14-4.61 1.12-1.97-.02-3.48-1.9-4.61-3.57-3.18-4.7-3.51-10.21-1.55-13.14 1.39-2.07 3.59-3.29 5.66-3.29 2.11 0 3.43 1.16 5.17 1.16 1.69 0 2.72-1.16 5.16-1.16 1.84 0 3.79.99 5.18 2.71-4.55 2.49-3.81 8.99 1.58 10.4Z" />
    </svg>
  );
}

function GooglePlayGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-6 w-6"
    >
      <path
        fill="#5BC9F4"
        d="M3.6 1.78c-.36.21-.6.62-.6 1.16v18.12c0 .53.24.94.6 1.16l9.6-10.22-9.6-10.22Z"
      />
      <path
        fill="#FFCD40"
        d="M16.86 8.34 13.2 12l3.66 3.66 4.54-2.6c1.06-.61 1.06-2.13 0-2.74l-4.54-2.58Z"
      />
      <path
        fill="#FF625B"
        d="M16.86 8.34 4.62 1.36c-.38-.22-.78-.21-1.02-.04l9.6 10.22 3.66-3.2Z"
      />
      <path
        fill="#52C16C"
        d="M16.86 15.66 13.2 12l-9.6 10.22c.24.17.64.18 1.02-.04l12.24-6.52Z"
      />
    </svg>
  );
}

export function StoreBadges() {
  const t = useTranslations("store");
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <a
        href={STORE_LINKS.appStore}
        aria-label={t("appStoreAria")}
        className="group inline-flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3 transition hover:border-line/0 hover:bg-raised"
      >
        <AppStoreGlyph />
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-wider text-text-faint">
            {t("appStoreEyebrow")}
          </span>
          <span className="text-[15px] font-semibold text-text">
            {t("appStoreLabel")}
          </span>
        </span>
      </a>
      <a
        href={STORE_LINKS.googlePlay}
        aria-label={t("googlePlayAria")}
        className="group inline-flex items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3 transition hover:border-line/0 hover:bg-raised"
      >
        <GooglePlayGlyph />
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] uppercase tracking-wider text-text-faint">
            {t("googlePlayEyebrow")}
          </span>
          <span className="text-[15px] font-semibold text-text">
            {t("googlePlayLabel")}
          </span>
        </span>
      </a>
    </div>
  );
}
