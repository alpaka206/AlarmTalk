import { routing } from "@/i18n/routing";

const DEFAULT_SITE_URL = "https://alarm-talk.com";

// 환경변수에 경로가 섞여 들어오면(`https://…/ko` 등) sitemap/canonical 전체가
// `/ko/ko/` 같은 존재하지 않는 URL로 생성되므로 origin만 취한다.
function resolveSiteUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_SITE_URL;
  try {
    const url = new URL(raw);
    if (url.pathname !== "/" || url.search || url.hash) {
      console.warn(
        `[site] NEXT_PUBLIC_SITE_URL 은 origin 만 허용합니다. "${raw}" → "${url.origin}" 으로 보정합니다.`,
      );
    }
    return url.origin;
  } catch {
    console.warn(
      `[site] NEXT_PUBLIC_SITE_URL "${raw}" 이 유효한 URL 이 아니라 기본값 ${DEFAULT_SITE_URL} 을 사용합니다.`,
    );
    return DEFAULT_SITE_URL;
  }
}

export const SITE_URL = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

export const SITE_NAME = "AlarmTalk";

/**
 * 로케일·페이지에 대응하는 공개 경로(항상 trailing slash).
 * 기본 로케일(ko)은 접두사 없이 루트로: localePath("ko") → "/", localePath("ko","privacy") → "/privacy/".
 * 그 외: localePath("en","privacy") → "/en/privacy/".
 * canonical/hreflang 은 이 경로를 그대로 쓰고, 절대 URL 이 필요하면 localeUrl 을 쓴다.
 */
export function localePath(locale: string, page = ""): string {
  const seg = page ? `${page}/` : "";
  return locale === routing.defaultLocale
    ? `/${seg}`
    : `/${locale}/${seg}`;
}

/** localePath 의 절대 URL(SITE_URL 접두). og:url, JSON-LD, sitemap 용. */
export function localeUrl(locale: string, page = ""): string {
  return `${SITE_URL}${localePath(locale, page)}`;
}

/** hreflang(alternates.languages) 맵 — ko/en/ja + x-default(ko). */
export function languageAlternates(page = ""): Record<string, string> {
  return {
    ...Object.fromEntries(
      routing.locales.map((l) => [l, localePath(l, page)]),
    ),
    "x-default": localePath(routing.defaultLocale, page),
  };
}

/**
 * 스토어 링크 — 두 곳 다 **앱과 백엔드가 쓰는 식별자 그대로**다.
 *
 * - Google Play: 패키지명 `com.alarmtalk.app`. 출시된 앱이라 기본값이 실제 주소다 —
 *   배포 환경변수 하나 빠뜨렸다고 출시된 앱을 '곧 출시' 로 말하게 두지 않는다.
 * - App Store: App Store Connect 앱 레코드의 Apple ID `6799711245`
 *   (`packages/backend/src/lib/app-version.ts` 의 `IOS.storeUrl` 과 같은 값).
 *   2026-09-15 심사 제출 — 배지는 기본으로 **링크가 살아 있다**(게재 승인 즉시 열리게).
 *   다시 '곧 출시' 로 내려야 하면 `NEXT_PUBLIC_APP_STORE_LIVE=0` 을 켠다.
 */
export const STORE_LINKS = {
  googlePlay:
    process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL ??
    "https://play.google.com/store/apps/details?id=com.alarmtalk.app",
  appStore:
    process.env.NEXT_PUBLIC_APP_STORE_URL ??
    "https://apps.apple.com/app/id6799711245",
} as const;

/**
 * 백엔드 API 원점. 랜딩이 부르는 것은 인증 없는 공개 라우트뿐이다(이벤트 좋아요).
 * 로컬에서 dev 백엔드를 보려면 `NEXT_PUBLIC_API_BASE=https://api-dev.alarm-talk.com`.
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "https://api.alarm-talk.com").replace(/\/+$/, "");

/** App Store 배지가 링크로 사는가. 기본 켜짐 — `NEXT_PUBLIC_APP_STORE_LIVE=0` 으로만 끈다. */
export const APP_STORE_LIVE = process.env.NEXT_PUBLIC_APP_STORE_LIVE !== "0";

/**
 * OG·트위터 카드 이미지. `app/opengraph-image.png` 파일 규약은 `app/page.tsx` 한 곳에만 붙고
 * `[locale]`·`(ko)` 아래 라우트에는 상속되지 않는다(2026-09-15 빌드 산출물 실측: 그 페이지들에
 * og:image 가 0건). 그래서 메타데이터마다 명시한다. 파일 규약이 만드는 `/opengraph-image.png`
 * 라우트는 그대로 쓴다.
 */
export const OG_IMAGES = [
  {
    url: "/opengraph-image.png",
    width: 1200,
    height: 630,
    alt: "AlarmTalk: wake up to a voice you love",
  },
];

export const ORGANIZATION = {
  name: "AlarmTalk",
  legalName: "AlarmTalk",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  sameAs: [] as string[],
} as const;
