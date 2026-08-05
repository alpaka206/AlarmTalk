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
  // 권장 업데이트 기준(비차단). 미만이면 클라가 FLEXIBLE 인앱 업데이트를 띄운다
  // (`InAppUpdateManager` — 백그라운드 다운로드 후 재시작 안내). minSupported 보다
  // 낮으면 "필수 버전이 최신 버전보다 높다" 는 모순이라 함께 올린다.
  //
  // 22 는 건너뛰고 23 으로 올렸다 — 1.2.2 때 이 값을 안 올려 22 가 권장 기준이 된 적이
  // 없다. 그때 올린 이유는 1.2.3 이 **고쳐 둔 알람 시각이 조용히 되돌아가던** 버그를
  // 고치기 때문이었다.
  //
  // 24 로 올리는 이유: 1.2.4 는 **저장을 두 번 누르면 화면이 검게 남아 앱을 다시 켜야
  // 하던** 문제를 고친다. 그 상태에서는 알람이 저장됐는지 확인할 방법조차 없다. 문구
  // 선택이 저장에서 사라지던 것도 같은 출시에 들어간다.
  //
  // ⚠️ 배포 순서: **1.2.4(versionCode 24)가 Play 에 올라간 뒤** 이 변경을 main 에 머지할 것.
  // 먼저 나가면 23 이하 사용자에게 받을 것이 없는 업데이트 안내가 뜬다(차단은 아니다 —
  // Play 에 새 버전이 없으면 인앱 업데이트는 no-op 이라 배너만 헛돈다). dev 는 무관하다.
  latest: 24,
  storeUrl: 'https://play.google.com/store/apps/details?id=com.alarmtalk.app',
};

const IOS: AppVersionPolicy = {
  // iOS 는 아직 아무도 안 쓴다 — App Store 에 올라간 적이 없다. 막을 사용자가 없으므로
  // 하한은 1 로 시작한다. Android 정책(21)을 그대로 물려주면 iOS 빌드번호(CFBundleVersion,
  // 현재 project.yml 의 CURRENT_PROJECT_VERSION = 1)가 즉시 강제 업데이트 차단 화면에 걸린다.
  //
  // 올릴 시점은 Android 와 같은 기준이다 — 서버가 요구하는 필수 계약(예: 동의
  // document_version)을 못 보내는 빌드를 잘라내야 할 때만. 그전에는 1 로 둔다.
  minSupported: 1,
  // 권장 업데이트 기준. 첫 릴리스 전이라 latest 도 1 이다(= 아무 배너도 뜨지 않는다).
  latest: 1,
  // ⚠ 앱을 App Store 에 올린 뒤 실제 앱 ID 로 교체할 것. 그전까지는 iOS 클라가 이 URL 을
  // 열 일이 없다(minSupported/latest 가 둘 다 1 이라 업데이트 화면 자체가 안 뜬다).
  storeUrl: 'https://apps.apple.com/app/id0000000000',
};

// platform 파라미터로 정책을 고른다. 앱이 이미 붙여 보내고 있다.
// 값이 없거나 모르는 값이면 Android 정책으로 폴백한다 — 운영 중인 클라이언트가
// Android 뿐이라, 모르는 플랫폼에 iOS 의 느슨한 정책(하한 1)을 주는 것보다 안전하다.
export function appVersionPolicy(platform?: string | null): AppVersionPolicy {
  return platform?.toLowerCase() === 'ios' ? IOS : ANDROID;
}
