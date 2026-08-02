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
  // 21 = 1.2.1. 동의 기록에 document_version(앱이 실제로 띄운 법무 문서의 버전)을 요구하기
  // 시작한 뒤에 나간 첫 릴리스다. 그 이전 빌드는 이 필드를 보내지 못해 POST /user/consents 가
  // 400 으로 거부하는데, 자기가 어떤 문서를 띄웠는지 증명할 방법이 없으니 받아 줄 수도 없다.
  // 막지 않으면 첫 동의·재동의가 필요한 사용자가 동의 게이트에서 빠져나오지 못한다.
  //
  // 20 이 아니라 21 인 이유: versionCode 20 을 찍은 빌드가 7/29 에 이미 Play 에 올라갔고,
  // 클라가 document_version 을 보내기 시작한 건 그 다음날(7/30)이다. 그래서 "20" 은
  // 이 필드를 보내는 앱과 못 보내는 앱을 모두 가리켜 하한으로 쓸 수 없다 — 20 을 하한으로
  // 두면 구 20 번 설치본이 차단도 안 되고 동의도 못 해 갇힌다. 21 은 그 모호함이 없다.
  //
  // ⚠️ 배포 순서: 이 값이 올라간 백엔드가 나가면 21 미만 설치본은 즉시 차단 화면을 본다.
  // **1.2.1(versionCode 21)을 스토어에 먼저 올린 뒤** 이 변경을 main 에 머지할 것.
  minSupported: 21,
  // 권장 업데이트 기준. minSupported 보다 낮으면 "필수 버전이 최신 버전보다 높다" 는
  // 모순이라 함께 올린다.
  latest: 21,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.alarmtalk.app',
};

// platform 파라미터는 유지한다 — 앱이 이미 붙여 보내고 있고, 향후 플랫폼이 늘면
// 여기서 분기한다. 지금은 어떤 값이 와도 Android 정책을 돌려준다.
export function appVersionPolicy(_platform?: string | null): AppVersionPolicy {
  return ANDROID;
}
