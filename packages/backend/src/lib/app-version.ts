// 앱 버전 정책 — 구버전 앱과 신버전 BE/DB 가 공존하는 동안 클라이언트가 스스로
// 강제/권장 업데이트를 판단할 수 있도록 최소·최신 지원 버전을 내려준다.
//
// 운영 방식:
//  - minSupported: 이 버전 미만은 강제 업데이트(앱이 차단 화면 표시). 평소 1 로 두어
//    아무도 막지 않다가, 필수 기능(예: 동의)을 강제해야 할 때만 올린다.
//  - latest: 권장 업데이트 기준(앱이 비차단 배너 표시).
//  versionCode(Android) / build number(iOS) 정수 기준.

export interface AppVersionPolicy {
  minSupported: number;
  latest: number;
  storeUrl: string;
}

const ANDROID: AppVersionPolicy = {
  minSupported: 1,
  latest: 7,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.alarmtalk.app',
};

const IOS: AppVersionPolicy = {
  minSupported: 1,
  latest: 1,
  storeUrl: 'https://apps.apple.com/app/alarmtalk',
};

const POLICIES: Record<string, AppVersionPolicy> = { android: ANDROID, ios: IOS };

export function appVersionPolicy(platform: string | undefined | null): AppVersionPolicy {
  const key = (platform ?? '').trim().toLowerCase();
  return POLICIES[key] ?? ANDROID;
}
