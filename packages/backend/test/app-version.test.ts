import { describe, it, expect } from 'vitest';
import { appVersionPolicy } from '../src/lib/app-version';

describe('appVersionPolicy', () => {
  it('android 정책 반환', () => {
    const p = appVersionPolicy('android');
    expect(p.minSupported).toBeGreaterThanOrEqual(1);
    expect(p.latest).toBeGreaterThanOrEqual(p.minSupported);
    expect(p.storeUrl).toContain('play.google.com');
  });

it('대소문자 무시', () => {
    expect(appVersionPolicy('Android')).toEqual(appVersionPolicy('android'));
  });

  it('알 수 없는/빈 플랫폼은 android 로 폴백', () => {
    expect(appVersionPolicy('windows')).toEqual(appVersionPolicy('android'));
    expect(appVersionPolicy('')).toEqual(appVersionPolicy('android'));
    expect(appVersionPolicy(undefined)).toEqual(appVersionPolicy('android'));
    expect(appVersionPolicy(null)).toEqual(appVersionPolicy('android'));
  });

  // 동의 기록이 document_version(앱이 실제로 띄운 문서의 버전)을 요구하므로, 그 필드를
  // 보내지 못하는 구버전은 동의 게이트를 통과할 방법이 없다 — 막는 게 유일한 선택이다.
  // 값을 내릴 일이 생기면 POST /user/consents 의 호환 경로부터 먼저 만들어야 한다.
  // 하한이 21 인 이유는 app-version.ts 주석 참고 — versionCode 20 은 document_version 을
  // 보내는 빌드와 못 보내는 빌드가 섞여 있어 하한으로 쓸 수 없다.
  it('minSupported 는 document_version 을 보내는 첫 릴리스(21) 이상이다', () => {
    expect(appVersionPolicy('android').minSupported).toBeGreaterThanOrEqual(21);
  });

  // latest 를 안 올리면 구버전 사용자에게 업데이트 안내가 영영 안 뜬다(1.2.2 때 실제로
  // 그랬다). 이 단언은 "권장 기준이 출시된 버전을 따라가고 있는가" 를 묻는다 — 앱의
  // versionCode 를 올릴 때 여기도 같이 보게 하는 장치다.
  //
  // 24 → 29 (2026-09-23): 장치가 **네 회차 동안 말이 없었다.** 하한이 24 라 25 에 멈춘
  // 값도 통과했고, 1.2.6~1.2.9 사용자는 배너를 한 번도 못 봤다. 하한은 게재된 최신
  // versionCode 와 같이 올린다 — 낮게 두면 이 테스트가 다시 조용해진다.
  it('latest 는 출시된 versionCode(29) 이상이다 — 안 올리면 안내가 안 뜬다', () => {
    expect(appVersionPolicy('android').latest).toBeGreaterThanOrEqual(29);
  });

  // --- iOS ---

  it('ios 정책은 android 와 분리돼 있다', () => {
    const ios = appVersionPolicy('ios');
    expect(ios).not.toEqual(appVersionPolicy('android'));
    expect(ios.storeUrl).toContain('apps.apple.com');
    expect(ios.latest).toBeGreaterThanOrEqual(ios.minSupported);
  });

  // iOS 는 2026-09-22 에 1.2.8(빌드 5)로 게재됐지만 하한은 그대로 1 이다 — 그보다 낮은
  // 설치본은 TestFlight 뿐이라 막을 사용자가 없고, Android 하한(25)을 물려주면 iOS
  // 빌드번호(CFBundleVersion)가 즉시 강제 업데이트 차단 화면에 걸려 앱을 아예 못 쓴다.
  // 올리는 것은 필수 계약을 못 보내는 빌드를 잘라내야 할 때뿐이다.
  it('ios minSupported 는 1 이다 — 아무도 막지 않는다', () => {
    expect(appVersionPolicy('ios').minSupported).toBe(1);
  });

  // iOS 클라는 `latest` 를 읽지 않는다 — `AppVersionGate.checkAppVersion()` 이
  // `min_supported_version` 만 보고 `updateRequired` 를 정한다(FLEXIBLE 인앱 업데이트에
  // 해당하는 것이 iOS 에 없다). 게재됐다는 이유로 여기를 올리면 **아무 일도 일어나지
  // 않는데 올라가 있는 값**이 남아, 나중에 배너를 붙이는 사람이 이미 맞는 값으로 읽는다.
  it('ios latest 는 1 이다 — 읽는 클라가 없으므로 앱이 먼저다', () => {
    expect(appVersionPolicy('ios').latest).toBe(1);
  });

  it('ios 도 대소문자를 무시한다', () => {
    expect(appVersionPolicy('iOS')).toEqual(appVersionPolicy('ios'));
    expect(appVersionPolicy('IOS')).toEqual(appVersionPolicy('ios'));
  });

  // 모르는 플랫폼에 iOS 의 느슨한 정책(하한 1)이 새면 차단이 필요한 구버전 Android 가
  // 빠져나간다. 폴백은 반드시 Android 여야 한다.
  it('모르는 플랫폼이 ios 정책으로 새지 않는다', () => {
    expect(appVersionPolicy('windows')).not.toEqual(appVersionPolicy('ios'));
    expect(appVersionPolicy(undefined)).not.toEqual(appVersionPolicy('ios'));
  });
});
