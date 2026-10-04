import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import app from '../src/index';
import { appVersionPolicy } from '../src/lib/app-version';
import { WEATHER_ATTRIBUTION } from '../src/lib/weather-attribution';

const SRC = join(import.meta.dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

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
  it('latest 는 출시된 versionCode(30) 이상이다 — 안 올리면 안내가 안 뜬다', () => {
    expect(appVersionPolicy('android').latest).toBeGreaterThanOrEqual(30);
  });

  // 1.2.10 강제 업데이트(2026-09-28). 잠금 화면 울림 화면(26~28)·개인 플랜 종료 안내 —
  // 이유와 순서(Play 30 게재 뒤)는 app-version.ts 주석.
  // 차단이 목적이라 권장 기준(latest)이 아니라 하한을 고정한다.
  it('android minSupported 는 1.2.10(30) 이상이다 — 강제 업데이트', () => {
    const p = appVersionPolicy('android');
    expect(p.minSupported).toBeGreaterThanOrEqual(30);
    expect(p.latest).toBeGreaterThanOrEqual(p.minSupported);
  });

  // --- iOS ---

  it('ios 정책은 android 와 분리돼 있다', () => {
    const ios = appVersionPolicy('ios');
    expect(ios).not.toEqual(appVersionPolicy('android'));
    expect(ios.storeUrl).toContain('apps.apple.com');
    expect(ios.latest).toBeGreaterThanOrEqual(ios.minSupported);
  });

  // 1.2.10 강제 업데이트(2026-09-29, App Store 게재 확인 뒤) — 빌드 5(1.2.8)·6(1.2.9)을 막는다.
  // iOS 빌드 번호는 versionCode 와 다른 수열이라 Android 하한(30)을 물려주면 1.2.10 까지
  // 막힌다 — 하한은 정확히 1.2.10 의 빌드 번호다. 이유는 app-version.ts 주석.
  it('ios minSupported 는 1.2.10 의 빌드 번호(7)다 — 강제 업데이트', () => {
    expect(appVersionPolicy('ios').minSupported).toBe(7);
  });

  // iOS 클라는 `latest` 를 읽지 않는다 — `AppVersionGate.checkAppVersion()` 이
  // `min_supported_version` 만 보고 `updateRequired` 를 정한다(FLEXIBLE 인앱 업데이트에
  // 해당하는 것이 iOS 에 없다). 그래서 게재본을 따라 올리지 않고, 하한과의 모순("필수가
  // 최신보다 높다")만 없애도록 **하한과 같은 값**으로 둔다. 권장 배너를 만들 때 이 단언을
  // 게재 빌드 기준으로 바꾼다.
  it('ios latest 는 minSupported 와 같다 — 읽는 클라가 없으므로 모순만 없앤다', () => {
    const ios = appVersionPolicy('ios');
    expect(ios.latest).toBe(ios.minSupported);
  });

  it('ios 도 대소문자를 무시한다', () => {
    expect(appVersionPolicy('iOS')).toEqual(appVersionPolicy('ios'));
    expect(appVersionPolicy('IOS')).toEqual(appVersionPolicy('ios'));
  });

  // 모르는 플랫폼에 iOS 정책(빌드 번호 수열의 하한)이 새면 차단이 필요한 구버전 Android 가
  // 빠져나간다. 폴백은 반드시 Android 여야 한다.
  it('모르는 플랫폼이 ios 정책으로 새지 않는다', () => {
    expect(appVersionPolicy('windows')).not.toEqual(appVersionPolicy('ios'));
    expect(appVersionPolicy(undefined)).not.toEqual(appVersionPolicy('ios'));
  });
});

// 지역 시트의 날씨 출처 줄은 **서버가 원천을 말할 때만** 보인다(코덱스 #845) — 두 앱은 이 필드가 정확히
// 'kma_jma_nws' 일 때만 "기상청 · 気象庁 · 미국 기상청(NWS)" 출처를 그리고, 그 밖은 숨긴다.
// 규칙: docs/spec/voice-and-message.md 「지역 시트의 날씨 출처 줄 — 서버가 원천을 말할 때만」.
describe('GET /api/app/version — weather_attribution', () => {
  // ⚠ 원천을 공식 예보로 바꾸는 변경은 `WEATHER_ATTRIBUTION` 과 **함께** 이 기대값을 'kma_jma_nws' 로 바꾼다.
  it('두 플랫폼 응답에 필드가 실리고, 지금(Open-Meteo)은 null 이다 — 앱이 출처 줄을 숨긴다', async () => {
    for (const platform of ['android', 'ios']) {
      const res = await app.fetch(
        new Request(`http://localhost/api/app/version?platform=${platform}`),
        {} as never,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // 키가 있어야 한다 — `undefined` 면 JSON 에서 빠져 옛 서버와 구별되지 않는다.
      expect(body).toHaveProperty('weather_attribution');
      expect(body.weather_attribution).toBeNull();
      // 기존 계약은 그대로다.
      expect(body.platform).toBe(platform);
      expect(body.min_supported_version).toBe(appVersionPolicy(platform).minSupported);
    }
  });

  // 토큰을 실제 원천과 묶는다 — Open-Meteo 호스트를 부르는 코드가 남아 있는 동안 공식 예보 원천을 말하면,
  // 앱이 쓰지 않는 기관을 출처로 적는다(원천 교체 일부만 되돌린 경우 포함).
  it('Open-Meteo 를 부르는 코드가 남아 있으면 토큰은 null 이다', () => {
    const callers = walk(SRC).filter((file) =>
      /['"`]https:\/\/[a-z.-]*open-meteo\.com/.test(readFileSync(file, 'utf8')),
    );
    if (callers.length > 0) {
      expect(WEATHER_ATTRIBUTION, `Open-Meteo 를 부르는 파일: ${callers.join(', ')}`).toBeNull();
    }
  });
});
