import { describe, expect, it } from 'vitest';
import {
  WEATHER_REGION_CATALOG,
  WeatherRegionCatalogSchema,
  WeatherRegions,
  canonicalizeWeatherLabel,
  weatherAliasKey,
} from '../src/index.js';

const key = (country: unknown, city: unknown) => WeatherRegions.resolveAlias(country, city)?.key;

describe('weather-regions.json — 날씨 지역 목록', () => {
  it('한국 17개 시·도, 일본 47개 도도부현, 미국은 50개 주 + D.C. 이상이다', () => {
    expect(WeatherRegions.byCountry('KR')).toHaveLength(17);
    expect(WeatherRegions.byCountry('JP')).toHaveLength(47);
    const us = WeatherRegions.byCountry('US');
    expect(us.length).toBeGreaterThanOrEqual(51);
    expect(us.length).toBeLessThanOrEqual(80);
    expect(WeatherRegions.all).toHaveLength(17 + 47 + us.length);
  });

  it('키는 겹치지 않고, 나라 접두사가 맞고, 순서는 나라마다 1..n 이다', () => {
    const keys = WeatherRegions.all.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const code of ['KR', 'JP', 'US'] as const) {
      const regions = WeatherRegions.byCountry(code);
      expect(regions.map((r) => r.order)).toEqual(regions.map((_, i) => i + 1));
      for (const r of regions) expect(r.key.startsWith(`${code.toLowerCase()}-`)).toBe(true);
    }
  });

  it('좌표는 그 나라 안에 있고, 시간대는 실재하는 IANA 이름이다', () => {
    const box = {
      KR: { lat: [33, 39], lon: [124, 132] },
      JP: { lat: [24, 46], lon: [122, 146] },
      US: { lat: [18, 72], lon: [-170, -65] },
    } as const;
    for (const r of WeatherRegions.all) {
      const b = box[r.country];
      expect(r.lat, r.key).toBeGreaterThanOrEqual(b.lat[0]);
      expect(r.lat, r.key).toBeLessThanOrEqual(b.lat[1]);
      expect(r.lon, r.key).toBeGreaterThanOrEqual(b.lon[0]);
      expect(r.lon, r.key).toBeLessThanOrEqual(b.lon[1]);
      expect(() => new Intl.DateTimeFormat('en', { timeZone: r.tz }), r.key).not.toThrow();
    }
    for (const r of WeatherRegions.byCountry('KR')) expect(r.tz).toBe('Asia/Seoul');
    for (const r of WeatherRegions.byCountry('JP')) expect(r.tz).toBe('Asia/Tokyo');
    for (const r of WeatherRegions.byCountry('US')) expect(r.tz).toMatch(/^(America|Pacific)\//);
  });

  it('별칭은 정규형으로 적혀 있고, 이름·대표 도시·별칭이 지역 사이에서 겹치지 않는다', () => {
    const owner = new Map<string, string>();
    for (const r of WeatherRegions.all) {
      for (const alias of r.aliases) expect(canonicalizeWeatherLabel(alias), r.key).toBe(alias);
      const labels = [
        ...Object.values(r.names),
        ...(r.seatNames ? Object.values(r.seatNames) : []),
        ...r.aliases,
      ];
      for (const label of labels) {
        const k = weatherAliasKey(label);
        expect(k.length, `${r.key} '${label}'`).toBeGreaterThan(0);
        const prev = owner.get(k);
        expect(prev === undefined || prev === r.key, `'${label}' 이 ${prev}·${r.key} 에 겹친다`).toBe(true);
        owner.set(k, r.key);
        // 나라 표기와도 겹치면 안 된다 — "도시" 칸의 글자를 나라로 읽게 된다.
        expect(WeatherRegions.countryForLabel(label), `${r.key} '${label}'`).toBeNull();
        // 나라가 비어도, 아는 나라가 붙어도 그 지역으로 되짚힌다.
        expect(key('', label), `${r.key} '${label}'`).toBe(r.key);
        expect(key('대한민국', label), `${r.key} '${label}'`).toBe(r.key);
      }
    }
  });

  it('옛 앱용 글자(한국어 나라 + 한국어 이름)는 언제나 자기 지역으로 되짚힌다', () => {
    for (const r of WeatherRegions.all) {
      const labels = WeatherRegions.canonicalLabels(r.key)!;
      expect(labels.country).toBe({ KR: '대한민국', JP: '일본', US: '미국' }[r.country]);
      expect(labels.city).toBe(r.names.ko);
      expect(key(labels.country, labels.city)).toBe(r.key);
    }
    expect(WeatherRegions.canonicalLabels('kr-nowhere')).toBeUndefined();
  });

  it('한국·일본의 대표 지점은 시·도청 소재지다(경기 → 수원 등)', () => {
    const seat = (k: string) => WeatherRegions.byKey(k)?.seatNames?.ko;
    expect(seat('kr-gyeonggi')).toBe('수원');
    expect(seat('kr-gangwon')).toBe('춘천');
    expect(seat('kr-chungbuk')).toBe('청주');
    expect(seat('kr-chungnam')).toBe('홍성');
    expect(seat('kr-jeonbuk')).toBe('전주');
    expect(seat('kr-jeonnam')).toBe('무안');
    expect(seat('kr-gyeongbuk')).toBe('안동');
    expect(seat('kr-gyeongnam')).toBe('창원');
    expect(seat('jp-aichi')).toBe('나고야');
    expect(seat('jp-kanagawa')).toBe('요코하마');
    expect(WeatherRegions.byKey('kr-seoul')?.seatNames).toBeUndefined();
  });

  it('모양이 틀린 목록은 거절한다(키 겹침·접두사 불일치)', () => {
    const base = structuredClone(WEATHER_REGION_CATALOG);
    const dup = { ...base, regions: [...base.regions, base.regions[0]] };
    expect(WeatherRegionCatalogSchema.safeParse(dup).success).toBe(false);
    const wrong = { ...base, regions: [{ ...base.regions[0], country: 'JP' }, ...base.regions.slice(1)] };
    expect(WeatherRegionCatalogSchema.safeParse(wrong).success).toBe(false);
  });
});

/**
 * 기상청 단기예보 격자 변환 — 「기상청41_단기예보 조회서비스_오픈API활용가이드」(2609) 참고자료의 C 예제
 * `lamcproj`/`map_conv`(위경도 → 격자) 를 그대로 옮겼다. 상수도 가이드 원문 그대로다(지구 반경 6371.00877km,
 * 격자 5km, 표준위도 30·60, 기준점 126E·38N, 기준점 격자 210/5·675/5, 결과는 `(int)(x + 1.5)`).
 * 서버는 이 식을 쓰지 않는다 — 격자를 JSON 에 박아 두고, 여기서 다시 계산해 대조만 한다.
 */
function latLonToKmaGrid(lat: number, lon: number): { nx: number; ny: number } {
  const PI = Math.asin(1.0) * 2.0;
  const DEGRAD = PI / 180.0;
  const re = 6371.00877 / 5.0;
  const slat1 = 30.0 * DEGRAD;
  const slat2 = 60.0 * DEGRAD;
  const olon = 126.0 * DEGRAD;
  const olat = 38.0 * DEGRAD;
  const sn =
    Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(PI * 0.25 + slat2 * 0.5) / Math.tan(PI * 0.25 + slat1 * 0.5));
  const sf = (Math.pow(Math.tan(PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1)) / sn;
  const ro = (re * sf) / Math.pow(Math.tan(PI * 0.25 + olat * 0.5), sn);
  const ra = (re * sf) / Math.pow(Math.tan(PI * 0.25 + lat * DEGRAD * 0.5), sn);
  let theta = lon * DEGRAD - olon;
  if (theta > PI) theta -= 2.0 * PI;
  if (theta < -PI) theta += 2.0 * PI;
  theta *= sn;
  const x = ra * Math.sin(theta) + 210 / 5;
  const y = ro - ra * Math.cos(theta) + 675 / 5;
  return { nx: Math.trunc(x + 1.5), ny: Math.trunc(y + 1.5) };
}

describe('weather-regions.json — 날씨 원천의 칸(source)', () => {
  it('나라마다 원천이 하나다 — KR 은 기상청, JP 는 気象庁, US 는 NWS', () => {
    for (const r of WeatherRegions.all) {
      const expected = { KR: 'kma', JP: 'jma', US: 'nws' }[r.country];
      expect(r.source.kind, r.key).toBe(expected);
    }
  });

  it('LCC 식은 가이드의 C 예제와 같다 — (126.929810, 37.488201) → (59, 125)', () => {
    expect(latLonToKmaGrid(37.488201, 126.92981)).toEqual({ nx: 59, ny: 125 });
    // 공식 격자 엑셀(2607)의 서울 종로구 행: (126.98164, 37.57038) → 60,127.
    expect(latLonToKmaGrid(37.57038, 126.98164)).toEqual({ nx: 60, ny: 127 });
  });

  it('한국 17곳의 격자는 박아 둔 소재지 좌표를 LCC 로 바꾼 값과 같다(시·도청이 아니라 앱이 보여 주는 소재지)', () => {
    for (const r of WeatherRegions.byCountry('KR')) {
      if (r.source.kind !== 'kma') throw new Error(r.key);
      expect({ nx: r.source.nx, ny: r.source.ny }, r.key).toEqual(latLonToKmaGrid(r.lat, r.lon));
    }
    const grid = (key: string) => {
      const source = WeatherRegions.byKey(key)?.source;
      return source?.kind === 'kma' ? [source.nx, source.ny] : null;
    };
    // 시·도청 칸과 다른 곳(소재지가 다르다) — 경북은 예천 도청(87,106)이 아니라 안동이다.
    expect(grid('kr-seoul')).toEqual([60, 127]);
    expect(grid('kr-gyeongbuk')).toEqual([91, 106]);
    expect(grid('kr-chungnam')).toEqual([55, 106]);
    expect(grid('kr-gyeonggi')).toEqual([60, 121]);
    expect(grid('kr-jeju')).toEqual([53, 38]);
    // 17곳이 모두 다른 칸이다.
    const cells = WeatherRegions.byCountry('KR').map((r) => JSON.stringify(grid(r.key)));
    expect(new Set(cells).size).toBe(17);
  });

  it('일본: office·class10 은 6자리, 기온 지점은 5자리, class10 은 그 office 안이다', () => {
    for (const r of WeatherRegions.byCountry('JP')) {
      if (r.source.kind !== 'jma') throw new Error(r.key);
      const { office, class10, tempStation, week } = r.source;
      expect(office, r.key).toMatch(/^\d{6}$/);
      expect(class10, r.key).toMatch(/^\d{6}$/);
      expect(tempStation, r.key).toMatch(/^\d{5}$/);
      // class10 의 앞 두 자리는 현 코드다(大阪·香川는 class10 = office).
      expect(class10.slice(0, 2), r.key).toBe(office.slice(0, 2));
      expect(week.length, r.key).toBeGreaterThan(0);
      for (const w of week) {
        expect(w.area.slice(0, 2), r.key).toBe(office.slice(0, 2));
        expect(w.tempStation, r.key).toMatch(/^\d{5}$/);
      }
    }
    // 주간 구역이 계절마다 갈리는 곳은 후보가 여럿이다(실제로 있는 첫 구역을 쓴다).
    const aomori = WeatherRegions.byKey('jp-aomori')!.source;
    expect(aomori.kind === 'jma' && aomori.week.map((w) => w.area)).toEqual(['020000', '020010', '020100']);
    const shiga = WeatherRegions.byKey('jp-shiga')!.source;
    expect(shiga.kind === 'jma' && shiga.week).toEqual([
      { area: '250000', tempStation: '60131' },
      { area: '250010', tempStation: '60216' },
    ]);
  });

  it('미국: gridId 는 예보청 세 글자, 격자는 0 이상 정수다', () => {
    for (const r of WeatherRegions.byCountry('US')) {
      if (r.source.kind !== 'nws') throw new Error(r.key);
      expect(r.source.gridId, r.key).toMatch(/^[A-Z]{3}$/);
      expect(Number.isInteger(r.source.gridX) && r.source.gridX >= 0, r.key).toBe(true);
      expect(Number.isInteger(r.source.gridY) && r.source.gridY >= 0, r.key).toBe(true);
    }
    expect(WeatherRegions.byKey('us-new-york')!.source).toEqual({ kind: 'nws', gridId: 'OKX', gridX: 33, gridY: 42 });
  });

  it('원천이 없거나 나라와 다르면 목록을 거절한다 — 모르는 키를 조용히 지우지 않게 필수다', () => {
    const base = structuredClone(WEATHER_REGION_CATALOG);
    const first = base.regions[0]!;
    const { source: _omitted, ...withoutSource } = first;
    void _omitted;
    expect(
      WeatherRegionCatalogSchema.safeParse({ ...base, regions: [withoutSource, ...base.regions.slice(1)] }).success,
    ).toBe(false);
    const crossed = { ...first, source: { kind: 'nws', gridId: 'OKX', gridX: 1, gridY: 1 } };
    expect(WeatherRegionCatalogSchema.safeParse({ ...base, regions: [crossed, ...base.regions.slice(1)] }).success).toBe(
      false,
    );
    const typo = { ...first, source: { kind: 'kma', nx: 60 } };
    expect(WeatherRegionCatalogSchema.safeParse({ ...base, regions: [typo, ...base.regions.slice(1)] }).success).toBe(
      false,
    );
  });
});

describe('WeatherRegions.resolveAlias — 옛 (나라, 도시) 글자 되짚기', () => {
  it('안드로이드 30(main)·develop·iOS 1.2.10 의 프리셋은 전부 되짚힌다', () => {
    // 한국어 프리셋 — 모든 빌드가 나라 '대한민국' 으로 보냈다.
    const ko: Record<string, string> = {
      서울: 'kr-seoul', 부산: 'kr-busan', 인천: 'kr-incheon', 대구: 'kr-daegu', 대전: 'kr-daejeon',
      광주: 'kr-gwangju', 울산: 'kr-ulsan', 수원: 'kr-gyeonggi', 제주: 'kr-jeju',
    };
    for (const [city, expected] of Object.entries(ko)) expect(key('대한민국', city), city).toBe(expected);
    // main 의 일본어 목록 — 일본 도시인데 나라는 大韓民国 으로 보냈다.
    const jaMain: Record<string, string> = {
      東京: 'jp-tokyo', 大阪: 'jp-osaka', 名古屋: 'jp-aichi', 横浜: 'jp-kanagawa', 札幌: 'jp-hokkaido',
      福岡: 'jp-fukuoka', 仙台: 'jp-miyagi', 那覇: 'jp-okinawa',
    };
    for (const [city, expected] of Object.entries(jaMain)) {
      expect(key('大韓民国', city), city).toBe(expected);
      expect(key('대한민국', city), city).toBe(expected);
    }
    // develop 의 일본어·영어 표시 이름(저장은 한국어였지만, 화면 글자가 저장된 옛 행도 되짚는다).
    const jaDevelop = ['ソウル', '釜山', '仁川', '大邱', '大田', '光州', '蔚山', '水原', '済州'];
    const enDevelop = ['Seoul', 'Busan', 'Incheon', 'Daegu', 'Daejeon', 'Gwangju', 'Ulsan', 'Suwon', 'Jeju'];
    jaDevelop.forEach((city, i) => {
      expect(key('大韓民国', city), city).toBe(Object.values(ko)[i]);
      expect(key('South Korea', enDevelop[i]), enDevelop[i]).toBe(Object.values(ko)[i]);
    });
  });

  // ⚠ 이 표는 두 앱의 생성 코드 테스트에도 **그대로** 옮긴다(양 앱이 같은 답을 내야 한다).
  it.each([
    // 옛 입력칸은 첫 낱말을 나라로 떼었다 — 이어 붙여 찾는다.
    ['New', 'York', 'us-new-york'],
    ['Los', 'Angeles', 'us-los-angeles'],
    ['Salt', 'Lake City', 'us-salt-lake-city'],
    ['San', 'Francisco', 'us-san-francisco'],
    // 공백 없는 입력에는 나라가 자동으로 붙었다 — 나라가 어긋나도 도시로 찾는다.
    ['South Korea', 'Tokyo', 'jp-tokyo'],
    ['대한민국', 'NYC', 'us-new-york'],
    ['대한민국', 'Portland', 'us-portland-or'],
    // 한국식 주소 — 앞 낱말(넓은 쪽)로.
    ['경기도', '수원시', 'kr-gyeonggi'],
    ['서울', '강남구', 'kr-seoul'],
    ['부산광역시', '해운대구', 'kr-busan'],
    // 아는 나라 + 여러 낱말 도시 — 첫 낱말로.
    ['미국', '뉴욕 맨해튼', 'us-new-york'],
    ['대한민국', '서울 강남구', 'kr-seoul'],
    // 행정 접미사·표기 흔들림.
    ['대한민국', ' 서울특별시 ', 'kr-seoul'],
    ['대한민국', '제주도', 'kr-jeju'],
    ['大韓民国', '津市', 'jp-mie'],
    ['일본', '東京都', 'jp-tokyo'],
    ['日本', '名古屋市', 'jp-aichi'],
    ['Japan', 'Osaka-fu', 'jp-osaka'],
    ['US', 'Washington, D.C.', 'us-washington-dc'],
    ['미국', '워싱턴DC', 'us-washington-dc'],
    ['미국', '오클라호마 시티', 'us-oklahoma-city'],
    ['USA', 'St. Louis', 'us-st-louis'],
    ['미국', 'Portland, ME', 'us-portland-me'],
    ['미국', '포틀랜드(메인)', 'us-portland-me'],
    ['아메리카', '', undefined],
    ['', 'ＳＥＯＵＬ', 'kr-seoul'],
    ['대한민국', '　부산　', 'kr-busan'],
    ['東京都', '新宿区', 'jp-tokyo'],
    ['대한민국', 'LA', 'us-los-angeles'],
    // 되짚지 않는 것 — 옛 경로(엄격한 지오코딩)에 맡긴다.
    // 로마자 첫 낱말은 다시 찾지 않는다 — 영어는 도시가 앞이고 뒤가 주·나라다.
    ['Birmingham', 'England', undefined],
    ['La', 'Paz', undefined],
    ['Jackson', 'Hole', undefined],
    ['미국', 'Columbus Georgia', undefined],
    ['Tokyo', 'Shinjuku', undefined],
    // 일본·미국이라고 적었으면 그 나라 안에서만 찾는다(대한민국만 옛 앱의 자동 값이라 어긋나도 받는다).
    ['USA', 'Seoul', undefined],
    ['미국', '광주', undefined],
    ['일본', '뉴욕', undefined],
    ['영국', '버밍엄', undefined],
    ['영국', '런던', undefined],
    ['대한민국', '속초', undefined],
    ['대한민국', '', undefined],
    ['', '', undefined],
    [null, null, undefined],
  ])('(%s, %s) → %s', (country, city, expected) => {
    expect(key(country, city)).toBe(expected);
  });
});

describe('WeatherRegions — 설정 정리·날짜', () => {
  it('알맞은 region 은 옛 앱용 글자로 덮는다', () => {
    expect(WeatherRegions.normalizeSetting({ region: 'jp-aichi', country: 'x', city: 'y' })).toEqual({
      region: 'jp-aichi',
      country: '일본',
      city: '아이치',
    });
  });

  it('모르는 region 은 그 칸만 버리고, 옛 글자로 되짚는다', () => {
    expect(WeatherRegions.normalizeSetting({ region: 'kr-atlantis', country: '대한민국', city: '부산' })).toEqual({
      region: 'kr-busan',
      country: '대한민국',
      city: '부산',
    });
    expect(WeatherRegions.normalizeSetting({ region: 42 })).toEqual({ region: null, country: null, city: null });
  });

  it('옛 글자만 있으면 region 을 채우되 글자는 그대로 둔다 — 못 되짚으면 region 은 null', () => {
    expect(WeatherRegions.normalizeSetting({ country: '大韓民国', city: '東京' })).toEqual({
      region: 'jp-tokyo',
      country: '大韓民国',
      city: '東京',
    });
    expect(WeatherRegions.normalizeSetting({ country: '대한민국', city: ' 속초 ' })).toEqual({
      region: null,
      country: '대한민국',
      city: '속초',
    });
  });

  it('localDate 는 그 지역 시간대의 달력 날짜다', () => {
    const at = new Date('2026-09-29T15:30:00Z');
    expect(WeatherRegions.localDate(WeatherRegions.byKey('kr-seoul')!, at)).toBe('2026-09-30');
    expect(WeatherRegions.localDate(WeatherRegions.byKey('jp-tokyo')!, at)).toBe('2026-09-30');
    expect(WeatherRegions.localDate(WeatherRegions.byKey('us-los-angeles')!, at)).toBe('2026-09-29');
    expect(WeatherRegions.localDate(WeatherRegions.byKey('us-honolulu')!, at)).toBe('2026-09-29');
  });

  it('byKey 는 앞뒤 공백을 무시하고, 모르는 키·문자열 아닌 값은 undefined', () => {
    expect(WeatherRegions.byKey(' kr-seoul ')?.key).toBe('kr-seoul');
    expect(WeatherRegions.byKey('KR-SEOUL')).toBeUndefined();
    expect(WeatherRegions.byKey(undefined)).toBeUndefined();
    expect(WeatherRegions.isKey('us-new-york')).toBe(true);
    expect(WeatherRegions.countryForLabel('アメリカ')).toBe('US');
    expect(WeatherRegions.countryForLabel('U.S.A.')).toBe('US');
    expect(WeatherRegions.countryForLabel('영국')).toBeNull();
  });
});
