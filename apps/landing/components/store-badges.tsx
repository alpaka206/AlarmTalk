import { useTranslations } from "next-intl";
import { STORE_LINKS } from "@/lib/site";

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
  const href = STORE_LINKS.googlePlay;
  const live = href !== "#";

  const inner = (
    <>
      <GooglePlayGlyph />
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-text-faint">
          {live ? t("googlePlayEyebrow") : t("comingSoonEyebrow")}
        </span>
        <span className="text-[15px] font-semibold text-text">
          {t("googlePlayLabel")}
        </span>
      </span>
    </>
  );

  // 정식 출시 전(URL 미설정)에는 죽은 링크 대신 정직한 '곧 출시' 상태로 노출한다.
  if (!live) {
    return (
      <span
        aria-label={t("comingSoonAria")}
        className="inline-flex w-fit cursor-default items-center gap-3 rounded-2xl border border-dashed border-line bg-surface/50 px-5 py-3"
      >
        {inner}
      </span>
    );
  }

  return (
    <a
      href={href}
      aria-label={t("googlePlayAria")}
      className="group inline-flex w-fit items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3 transition hover:border-line/0 hover:bg-raised"
    >
      {inner}
    </a>
  );
}
