/**
 * 날씨 원천 점검(`weather-sources-check.ts`)의 **드라이런 분류**. 스크립트 본문은 불러오는 순간 네트워크를 부르고
 * `console` 을 덮어써서 테스트가 가져다 쓸 수 없다 — 그래서 분류만 여기 두고, 스크립트와 회귀 테스트
 * (`test/weather-sources-dry-run.test.ts`)가 **같은 함수**를 거친다.
 *
 * ⚠ 운영(cron `refreshWeatherRegionDaily` · 읽기 `resolveRegionVariantIndex`)과 **같은 분류**여야 한다 — 원천 종류를
 * 넘긴다(결정 D7: KR·JP 는 강수확률 60 부터만 비, NWS 는 30 부터). 빠뜨리면 KR·JP 의 강수확률 30~59 날이 비로 세어져
 * 점검이 운영과 다른 분포를 낸다(코덱스 #846). 규칙 전문은 `docs/spec/voice-and-message.md` 5-1 「검증 방법」.
 */
import type { WeatherRegion } from '@alarmtalk/shared';
import { WEATHER_REGION_HORIZON_DAYS } from '../src/lib/weather-region-daily.ts';
import { resolvePrerenderWeatherIndex } from '../src/lib/weather-signal.ts';
import { addDaysToDate, finalizeSourceDay, zonedParts, type SourceDay } from '../src/lib/weather-source.ts';

/**
 * 한 지역의 원천 결과 → 지역의 오늘부터 +3 까지, 날짜 순서의 클립 자리. 못 구한 날짜는 null(미해결).
 *
 * DB 를 보지 않으므로 오늘 행의 극값을 이어받지 않는다 — KR(1700 회차 이후)·JP·NWS(아침 이후)의 오늘은 미해결이
 * 정상이다.
 */
export function dryRunVariants(
  region: WeatherRegion,
  days: ReadonlyMap<string, SourceDay>,
  now: Date,
): (number | null)[] {
  const today = zonedParts(now, region.tz).date;
  return Array.from({ length: WEATHER_REGION_HORIZON_DAYS + 1 }, (_, i) => {
    const input = finalizeSourceDay(days.get(addDaysToDate(today, i)), {
      isToday: i === 0,
      now,
      source: region.source.kind,
    });
    return input ? resolvePrerenderWeatherIndex(input) : null;
  });
}
