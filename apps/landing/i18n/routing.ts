import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en", "ja"] as const,
  defaultLocale: "ko",
  // 기본 로케일(ko)은 접두사 없이 루트(/, /company/ …)로, en·ja 만 /en, /ja 접두사.
  // 정적 export 라 미들웨어가 없으므로 공개 URL → 빌드 산출물(/ko/*) 매핑은 vercel.json 의
  // rewrite/redirect 가 담당한다. 내부 <Link> href 는 이 설정만으로 접두사가 정리된다.
  localePrefix: "as-needed",
});

export type Locale = (typeof routing.locales)[number];
