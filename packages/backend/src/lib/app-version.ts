// 앱 버전 정책 — 구버전 앱과 신버전 BE/DB 가 공존하는 동안 클라이언트가 스스로
// 강제/권장 업데이트를 판단할 수 있도록 최소·최신 지원 버전을 내려준다.
//
// 운영 방식:
//  - minSupported: 이 버전 미만은 강제 업데이트(앱이 차단 화면 표시). 평소 1 로 두어
//    아무도 막지 않다가, 필수 기능(예: 동의)을 강제해야 할 때만 올린다.
//  - latest: 권장 업데이트 기준(앱이 비차단 배너 표시).
//  versionCode(Android) 정수 기준. (Android 전용 — iOS 는 운영하지 않는다.)

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

// platform 파라미터는 유지한다 — 앱이 이미 붙여 보내고 있고, 향후 플랫폼이 늘면
// 여기서 분기한다. 지금은 어떤 값이 와도 Android 정책을 돌려준다.
export function appVersionPolicy(_platform?: string | null): AppVersionPolicy {
  return ANDROID;
}
