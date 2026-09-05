import { useTranslations } from "next-intl";
import { APP_STORE_LIVE, STORE_LINKS } from "@/lib/site";

function GooglePlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
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

function AppleGlyph() {
  // 애플 로고 실루엣. 배지 안에서 흰색 단색으로만 쓴다(브랜드 가이드: 단색·왜곡 금지).
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="#fff">
      <path d="M16.37 12.78c.02 2.53 2.22 3.37 2.25 3.38-.02.06-.35 1.2-1.16 2.38-.7 1.02-1.42 2.03-2.56 2.05-1.12.02-1.48-.66-2.76-.66s-1.68.64-2.74.68c-1.1.04-1.94-1.1-2.64-2.11-1.44-2.08-2.54-5.89-1.06-8.46.73-1.28 2.05-2.09 3.47-2.11 1.08-.02 2.1.73 2.76.73.66 0 1.9-.9 3.2-.77.54.02 2.07.22 3.05 1.65-.08.05-1.82 1.06-1.81 3.24ZM14.26 6.44c.58-.71.98-1.69.87-2.67-.84.03-1.86.56-2.46 1.27-.54.63-1.01 1.63-.88 2.59.94.07 1.89-.48 2.47-1.19Z" />
    </svg>
  );
}

type BadgeProps = {
  href: string;
  live: boolean;
  glyph: React.ReactNode;
  eyebrow: string;
  label: string;
  ariaLive: string;
  ariaSoon: string;
};

/**
 * 스토어 배지 하나. 텍스트는 aria-hidden 으로 감추고 접근형 이름은 aria-label 한 줄로
 * 노출한다(검은 배경 위 흰 글자 — WCAG 1.4.3 AA 대비 충분).
 *
 * 링크가 아직 안 열리면(`live=false`) 죽은 링크 대신 정직한 '곧 출시' 상태로 그린다 —
 * role="img" + aria-label 이라야 비대화형 배지도 스크린리더가 한 번에 읽는다.
 */
function Badge({ href, live, glyph, eyebrow, label, ariaLive, ariaSoon }: BadgeProps) {
  const inner = (
    <span aria-hidden="true" className="flex items-center gap-3">
      {glyph}
      <span className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-white/70">
          {eyebrow}
        </span>
        <span className="text-[15px] font-semibold text-white">{label}</span>
      </span>
    </span>
  );

  if (!live) {
    return (
      <span
        role="img"
        aria-label={ariaSoon}
        className="inline-flex h-14 w-fit cursor-default items-center gap-3 rounded-md bg-black/75 px-5"
      >
        {inner}
      </span>
    );
  }

  return (
    <a
      href={href}
      aria-label={ariaLive}
      className="group inline-flex h-14 w-fit items-center gap-3 rounded-md bg-black px-5 transition-[background-color,transform] duration-150 ease-[var(--ease-ui)] hover:bg-neutral-800 active:scale-[0.97]"
    >
      {inner}
    </a>
  );
}

/**
 * 스토어 배지 두 개 — Google Play 와 App Store 를 **같은 무게로** 나란히 둔다.
 *
 * 앱은 안드로이드에 먼저 나왔고 iOS 는 심사 전이다. 그래도 배지는 둘 다 그린다:
 * 아이폰 사용자가 첫 화면에서 "나는 아니구나" 로 떠나지 않게, 그리고 게재 당일에
 * 페이지를 다시 만들지 않아도 되게(`APP_STORE_LIVE` 스위치 하나로 켠다).
 */
export function StoreBadges({ className }: { className?: string }) {
  const t = useTranslations("store");
  const playLive = STORE_LINKS.googlePlay !== "#";

  return (
    <div className={`flex flex-wrap items-center justify-center gap-3 ${className ?? ""}`}>
      <Badge
        href={STORE_LINKS.googlePlay}
        live={playLive}
        glyph={<GooglePlayGlyph />}
        eyebrow={playLive ? t("googlePlayEyebrow") : t("comingSoonEyebrow")}
        label={t("googlePlayLabel")}
        ariaLive={t("googlePlayAria")}
        ariaSoon={t("comingSoonAria")}
      />
      <Badge
        href={STORE_LINKS.appStore}
        live={APP_STORE_LIVE}
        glyph={<AppleGlyph />}
        eyebrow={APP_STORE_LIVE ? t("appStoreEyebrow") : t("comingSoonEyebrow")}
        label={t("appStoreLabel")}
        ariaLive={t("appStoreAria")}
        ariaSoon={t("appStoreSoonAria")}
      />
    </div>
  );
}
