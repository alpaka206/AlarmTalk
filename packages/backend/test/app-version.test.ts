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
  it('latest 는 출시된 versionCode(24) 이상이다 — 안 올리면 안내가 안 뜬다', () => {
    expect(appVersionPolicy('android').latest).toBeGreaterThanOrEqual(24);
  });
});
