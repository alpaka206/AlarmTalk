// 気象庁 17시 발표 원본(2026-10-01) → **다음 날 05시 발표** 모양. 05시 발표의 실측 원본은 없다 — 2026-09-24~10-01
// XML 1,056개로 확인한 구조(05~10시대 발표는 날씨 2일, 강수확률 7칸, 기온 4칸)대로 모양만 바꾼다. 주간은 전날 17시
// 그대로다(05시에는 주간 발표가 없다). 모든 구역·지점을 같은 값으로 바꾸므로 office 를 가리지 않는다.
//
// 기온 4칸 = [오늘 최고, 오늘 최고(24h), 내일 최저, 내일 최고] = ['22', '22', '17', '24'] — 오늘(10-02) 최저는 없다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 픽스처를 고쳐 쓰는 도우미라 모양을 느슨하게 둔다
export function toMorningBulletin(doc: any): any {
  const short = doc[0];
  short.reportDatetime = '2026-10-02T05:00:00+09:00';
  short.timeSeries[0].timeDefines = ['2026-10-02T05:00:00+09:00', '2026-10-03T00:00:00+09:00'];
  for (const area of short.timeSeries[0].areas) {
    area.weatherCodes = ['202', '101'];
    area.weathers = area.weathers.slice(0, 2);
    area.winds = area.winds.slice(0, 2);
    area.waves = area.waves?.slice(0, 2);
  }
  short.timeSeries[1].timeDefines = [
    '2026-10-02T06:00:00+09:00',
    '2026-10-02T12:00:00+09:00',
    '2026-10-02T18:00:00+09:00',
    '2026-10-03T00:00:00+09:00',
    '2026-10-03T06:00:00+09:00',
    '2026-10-03T12:00:00+09:00',
    '2026-10-03T18:00:00+09:00',
  ];
  for (const area of short.timeSeries[1].areas) area.pops = ['50', '30', '20', '10', '20', '20', '10'];
  short.timeSeries[2].timeDefines = [
    '2026-10-02T09:00:00+09:00',
    '2026-10-02T00:00:00+09:00',
    '2026-10-03T00:00:00+09:00',
    '2026-10-03T09:00:00+09:00',
  ];
  for (const area of short.timeSeries[2].areas) area.temps = ['22', '22', '17', '24'];
  return doc;
}
