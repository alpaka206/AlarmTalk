// 날씨 원천 점검의 드라이런 분류 — `scripts/weather-sources-dry-run.ts` 의 `dryRunVariants`. 점검 스크립트
// (`scripts/weather-sources-check.ts`, `npm run check:weather`)가 나라별 자리 분포를 셀 때 부르는 **바로 그 함수**다
// (스크립트 본문은 불러오면 네트워크를 부르므로 분류만 따로 두었다).
//
// 점검은 운영과 **같은 분류**여야 한다(스펙 5-1 「검증 방법」) — 원천 종류를 넘겨 KR·JP 는 강수확률 60 부터만 비,
// NWS 는 30 부터다(결정 D7). 예전 스크립트는 원천 종류를 빠뜨려 KR·JP 의 강수확률 30~59 날을 비로 셌다(코덱스 #846).
import { describe, expect, it } from 'vitest';
import { WeatherRegions } from '@alarmtalk/shared';
import { dryRunVariants } from '../scripts/weather-sources-dry-run';
import { CLONE_WEATHER_CONDITIONS } from '../src/lib/stock-clips';
import { WEATHER_PROXY_CODE } from '../src/lib/weather-signal';
import { addDaysToDate, type SourceDay } from '../src/lib/weather-source';

const idx = (k: (typeof CLONE_WEATHER_CONDITIONS)[number]) => CLONE_WEATHER_CONDITIONS.indexOf(k);
/** 2026-10-01 21:30 KST·JST, 08:30 EDT — 세 나라 모두 지역의 오늘이 2026-10-01 이다. */
const NOW = new Date('2026-10-01T12:30:00Z');
const TODAY = '2026-10-01';

/**
 * 오늘부터 하루씩, 강수 **형태가 없는** 날(맑음 코드 · 강수량 없음) — 강수확률만 `rainProbabilities` 대로다.
 * 기온은 더위·추위가 아니다. 気象庁 은 강수량을 재지 않는다(NaN).
 */
function clearDays(source: string, rainProbabilities: number[]): Map<string, SourceDay> {
  return new Map(
    rainProbabilities.map((rainProbability, i) => [
      addDaysToDate(TODAY, i),
      {
        code: WEATHER_PROXY_CODE.clear,
        maxTemp: 22,
        minTemp: 14,
        rainProbability,
        precipitation: source === 'jma' ? Number.NaN : 0,
      },
    ]),
  );
}

describe('dryRunVariants — 점검 스크립트의 드라이런은 운영과 같은 분류다(결정 D7)', () => {
  it('KR·JP 는 강수 형태가 없으면 강수확률 60 부터만 비 — 30~59 는 맑음', () => {
    for (const key of ['kr-seoul', 'jp-tokyo']) {
      const region = WeatherRegions.byKey(key)!;
      expect(dryRunVariants(region, clearDays(region.source.kind, [30, 45, 59, 60]), NOW), key).toEqual([
        idx('nice'),
        idx('nice'),
        idx('nice'),
        idx('rain'),
      ]);
    }
  });

  it('NWS 는 강수확률 30 부터 비', () => {
    const region = WeatherRegions.byKey('us-new-york')!;
    expect(dryRunVariants(region, clearDays(region.source.kind, [29, 30, 45, 59]), NOW)).toEqual([
      idx('nice'),
      idx('rain'),
      idx('rain'),
      idx('rain'),
    ]);
  });

  it('지역의 오늘부터 +3 까지 날짜 순서 — 원천에 없는 날짜와 오늘의 빈 극값은 미해결(DB 를 보지 않아 이어받지 않는다)', () => {
    const region = WeatherRegions.byKey('kr-seoul')!;
    const days = clearDays(region.source.kind, [10, 10, 10]); // +3 이 없다
    days.set(TODAY, { ...days.get(TODAY)!, minTemp: null });
    expect(dryRunVariants(region, days, NOW)).toEqual([null, idx('nice'), idx('nice'), null]);
  });
});
