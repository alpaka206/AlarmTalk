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
 *   ⚠ 심사 전이라 게재 뒤에야 열린다. 그전에는 배지가 '곧 출시' 로 떨어진다 —
 *   `NEXT_PUBLIC_APP_STORE_LIVE=1` 을 켜는 순간 링크가 산다. 죽은 링크를 사람에게
 *   누르게 하지 않으면서, 게재 당일에 코드 변경 없이 켤 수 있게 둔 스위치다.
 */
export const STORE_LINKS = {
  googlePlay:
    process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL ??
    "https://play.google.com/store/apps/details?id=com.alarmtalk.app",
  appStore:
    process.env.NEXT_PUBLIC_APP_STORE_URL ??
    "https://apps.apple.com/app/id6799711245",
} as const;

/** App Store 링크가 실제로 열리는가(게재 뒤 환경변수로 켠다). */
export const APP_STORE_LIVE = process.env.NEXT_PUBLIC_APP_STORE_LIVE === "1";

export const ORGANIZATION = {
  name: "AlarmTalk",
  legalName: "AlarmTalk",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  sameAs: [] as string[],
} as const;
