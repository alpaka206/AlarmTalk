const DEFAULT_SITE_URL = "https://alarm-talk.com";

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

export const SITE_URL = normalize(
  process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL,
);

export const SITE_NAME = "AlarmTalk";

export const STORE_LINKS = {
  appStore: process.env.NEXT_PUBLIC_APP_STORE_URL ?? "#",
  googlePlay: process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL ?? "#",
} as const;

export const ORGANIZATION = {
  name: "AlarmTalk",
  legalName: "AlarmTalk",
  url: SITE_URL,
  logo: `${SITE_URL}/icon.png`,
  sameAs: [] as string[],
} as const;
