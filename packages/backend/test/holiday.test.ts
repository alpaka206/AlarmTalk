import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeHolidays, HolidayInputError, type HolidayItem } from '../src/lib/holidays';
import {
  fetchKasiHolidays,
  parseKasiResponse,
  mergeKasiOverlay,
  normalizeKasiItems,
} from '../src/lib/holidays-kasi';
import type { Env } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeHolidays — KR (음력/양력)', () => {
  const kr = computeHolidays({ country: 'KR', from: '2026-01-01', to: '2026-12-31' });

  // KASI 키 없이도(date-holidays 단독) 설날/추석은 법정 3일 연휴(전날·당일·다음날)로 펼쳐져야 한다.
  // date-holidays 는 설날을 '당일'로, 추석을 '전날(음력 8/14)'로 주므로 후처리에서 둘 다 보정한다.
  // 검증 출처: #489 seed.
  const seollalDates = (h: HolidayItem[]) =>
    h.filter((x) => x.name.includes('설날')).map((x) => x.date).sort();
  const chuseokDates = (h: HolidayItem[]) =>
    h.filter((x) => x.name.includes('추석')).map((x) => x.date).sort();

  it('설날을 법정 3일 연휴 2026-02-16~18(당일 2/17)로 펼친다', () => {
    expect(seollalDates(kr)).toEqual(['2026-02-16', '2026-02-17', '2026-02-18']);
    for (const x of kr.filter((h) => h.name.includes('설날'))) {
      expect(x.type).toBe('public');
    }
  });

  it('추석을 법정 3일 연휴 2026-09-24~26(당일 9/25=가운데)으로 펼친다 (전날 보정)', () => {
    expect(chuseokDates(kr)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    for (const x of kr.filter((h) => h.name.includes('추석'))) {
      expect(x.type).toBe('public');
    }
  });

  it('어린이날(2026-05-05)을 type public 으로 포함한다', () => {
    const children = kr.find((h) => h.date === '2026-05-05');
    expect(children).toBeDefined();
    expect(children!.type).toBe('public');
  });

  it('모든 항목이 YYYY-MM-DD + source date-holidays 형식이다', () => {
    expect(kr.length).toBeGreaterThan(0);
    for (const h of kr) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.source).toBe('date-holidays');
      expect(h.date >= '2026-01-01' && h.date <= '2026-12-31').toBe(true);
    }
  });
});

describe('computeHolidays — KR 설날/추석 3일 윈도우 (#489 seed 다년)', () => {
  // 각 해의 정답 윈도우(전날·당일·다음날). 추석 당일은 항상 가운데.
  const cases: Array<{
    year: number;
    seollal: [string, string, string];
    chuseok: [string, string, string];
    buddha: string;
  }> = [
    {
      year: 2026,
      seollal: ['2026-02-16', '2026-02-17', '2026-02-18'],
      chuseok: ['2026-09-24', '2026-09-25', '2026-09-26'],
      buddha: '2026-05-24',
    },
    {
      year: 2027,
      seollal: ['2027-02-06', '2027-02-07', '2027-02-08'],
      chuseok: ['2027-09-14', '2027-09-15', '2027-09-16'],
      buddha: '2027-05-13',
    },
    {
      year: 2028,
      seollal: ['2028-01-26', '2028-01-27', '2028-01-28'],
      chuseok: ['2028-10-02', '2028-10-03', '2028-10-04'],
      buddha: '2028-05-02',
    },
    {
      year: 2029,
      seollal: ['2029-02-12', '2029-02-13', '2029-02-14'],
      chuseok: ['2029-09-21', '2029-09-22', '2029-09-23'],
      buddha: '2029-05-20',
    },
  ];

  for (const { year, seollal, chuseok, buddha } of cases) {
    const kr = computeHolidays({
      country: 'KR',
      from: `${year}-01-01`,
      to: `${year}-12-31`,
    });
    // 대체공휴일은 '윈도우 확장'이 아니라 별개 항목이므로 이 검증에서는 제외한다.
    // (date-holidays 3.34.0 부터 KR 대체공휴일을 자체적으로 내보낸다 — 그 전까지는
    //  KASI 오버레이만 채웠다.)
    const dates = (kw: string) =>
      kr
        .filter((x) => x.name.includes(kw) && !x.substitute)
        .map((x) => x.date)
        .sort();

    it(`${year} 설날 윈도우 = ${seollal.join('/')} (당일 가운데)`, () => {
      expect(dates('설날')).toEqual([...seollal].sort());
    });

    it(`${year} 추석 윈도우 = ${chuseok.join('/')} (당일=가운데, 전날 off-by-one 보정)`, () => {
      const got = dates('추석');
      expect(got).toEqual([...chuseok].sort());
      // 당일(가운데)이 윈도우 한가운데 날짜와 일치하는지 명시 검증.
      expect(got[1]).toBe(chuseok[1]);
    });

    it(`${year} 부처님오신날(석가탄신일)=${buddha} 단일 1일 (확장하지 않음)`, () => {
      // 설날/추석만 3일로 펼치고 다른 1일짜리 공휴일은 건드리지 않는지 회귀 검증.
      // 대체공휴일(주말 겹침 → 다음 평일)은 확장이 아니므로 여기서 세지 않는다.
      const buddhaDates = kr
        .filter((x) => (x.name.includes('석가') || x.name.includes('부처')) && !x.substitute)
        .map((x) => x.date);
      expect(buddhaDates).toEqual([buddha]);
    });
  }
});

describe('computeHolidays — substitute(대체일) 플래그', () => {
  // date-holidays 의 KR.yaml 은 대체공휴일을 인코딩하지 않으므로(KR substitute 는 KASI 가 채움),
  // substitute 플래그 자체의 동작은 이를 인코딩한 GB 2021 로 검증한다.
  it('GB 2021 은 substitute:true 항목을 만든다 (주말 겹침→대체)', () => {
    const gb = computeHolidays({ country: 'GB', from: '2021-01-01', to: '2021-12-31' });
    const sub = gb.find((h) => h.substitute === true);
    expect(sub).toBeDefined();
    expect(sub!.substitute).toBe(true);
  });
});

describe('computeHolidays — 다국가', () => {
  it('JP 는 비어있지 않고 형식이 올바르다', () => {
    const jp = computeHolidays({ country: 'JP', from: '2026-01-01', to: '2026-12-31' });
    expect(jp.length).toBeGreaterThan(0);
    for (const h of jp) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof h.name).toBe('string');
      expect(h.name.length).toBeGreaterThan(0);
    }
  });

  it('US/GB(영어권)도 비어있지 않다', () => {
    const us = computeHolidays({ country: 'US', from: '2026-01-01', to: '2026-12-31' });
    const gb = computeHolidays({ country: 'GB', from: '2026-01-01', to: '2026-12-31' });
    expect(us.length).toBeGreaterThan(0);
    expect(gb.length).toBeGreaterThan(0);
  });

  it('여러 해를 걸친 윈도우는 각 연도를 순회한다 (음력 연도별 재계산)', () => {
    const kr = computeHolidays({ country: 'KR', from: '2026-01-01', to: '2027-12-31' });
    const years = new Set(kr.map((h) => h.date.slice(0, 4)));
    expect(years.has('2026')).toBe(true);
    expect(years.has('2027')).toBe(true);
  });

  it('미지원 country 는 HolidayInputError(UNKNOWN_COUNTRY) 를 던진다', () => {
    expect(() => computeHolidays({ country: 'ZZ', from: '2026-01-01', to: '2026-12-31' })).toThrow(
      HolidayInputError,
    );
    try {
      computeHolidays({ country: 'ZZ', from: '2026-01-01', to: '2026-12-31' });
    } catch (e) {
      expect((e as HolidayInputError).errorCode).toBe('UNKNOWN_COUNTRY');
    }
  });

  it('from > to 는 INVALID_DATE_RANGE 를 던진다', () => {
    try {
      computeHolidays({ country: 'KR', from: '2026-12-31', to: '2026-01-01' });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HolidayInputError);
      expect((e as HolidayInputError).errorCode).toBe('INVALID_DATE_RANGE');
    }
  });
});

// data.go.kr getRestDeInfo 응답 픽스처: 대체공휴일 + 임시공휴일 + 일반 공휴일.
function kasiFixture(items: Record<string, unknown>[]) {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: {
        items: items.length === 1 ? { item: items[0] } : { item: items },
        numOfRows: 100,
        pageNo: 1,
        totalCount: items.length,
      },
    },
  };
}

describe('KASI 파싱/정규화', () => {
  it('parseKasiResponse: 대체공휴일은 substitute:true + source kasi 로 매핑', () => {
    const json = kasiFixture([
      { locdate: 20250506, dateName: '어린이날 대체공휴일', isHoliday: 'Y', dateKind: '01' },
      { locdate: 20251003, dateName: '개천절', isHoliday: 'Y', dateKind: '01' },
      { locdate: 20251231, dateName: '평일(테스트)', isHoliday: 'N', dateKind: '01' },
    ]);
    const out = parseKasiResponse(json)!;
    expect(out).not.toBeNull();
    const sub = out.find((h) => h.name.includes('대체'));
    expect(sub).toBeDefined();
    expect(sub!.substitute).toBe(true);
    expect(sub!.source).toBe('kasi');
    expect(sub!.date).toBe('2025-05-06');
    // isHoliday !== 'Y' 는 제외된다.
    expect(out.find((h) => h.name.includes('평일'))).toBeUndefined();
  });

  it('normalizeKasiItems: 단일 객체/배열/빈문자열 셋 다 처리', () => {
    expect(normalizeKasiItems({ items: { item: { locdate: 1 } } })).toHaveLength(1);
    expect(normalizeKasiItems({ items: { item: [{ locdate: 1 }, { locdate: 2 }] } })).toHaveLength(2);
    expect(normalizeKasiItems({ items: '' })).toHaveLength(0);
    expect(normalizeKasiItems(undefined)).toHaveLength(0);
  });

  it('parseKasiResponse: resultCode!=="00" 이면 null (soft-fail)', () => {
    const bad = {
      response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } },
    };
    expect(parseKasiResponse(bad)).toBeNull();
  });
});

describe('mergeKasiOverlay — KR 병합 (override + additive)', () => {
  const base: HolidayItem[] = [
    { date: '2025-05-05', name: 'Children\'s Day', type: 'public', source: 'date-holidays' },
    { date: '2025-10-03', name: 'National Foundation Day', type: 'public', source: 'date-holidays' },
  ];

  it('KASI 가 같은 날짜를 override 한다 (이름/source 가 KASI)', () => {
    const kasi: HolidayItem[] = [
      { date: '2025-05-05', name: '어린이날', type: 'public', source: 'kasi' },
    ];
    const merged = mergeKasiOverlay(base, kasi);
    const may5 = merged.filter((h) => h.date === '2025-05-05');
    expect(may5).toHaveLength(1);
    expect(may5[0]!.name).toBe('어린이날');
    expect(may5[0]!.source).toBe('kasi');
  });

  it('KASI 에만 있는 대체/임시공휴일을 추가(additive)한다', () => {
    const kasi: HolidayItem[] = [
      { date: '2025-05-06', name: '어린이날 대체공휴일', type: 'public', substitute: true, source: 'kasi' },
      { date: '2025-10-01', name: '임시공휴일', type: 'public', source: 'kasi' },
    ];
    const merged = mergeKasiOverlay(base, kasi);
    const sub = merged.find((h) => h.date === '2025-05-06');
    expect(sub).toBeDefined();
    expect(sub!.substitute).toBe(true);
    const adhoc = merged.find((h) => h.date === '2025-10-01' && h.name === '임시공휴일');
    expect(adhoc).toBeDefined();
    expect(adhoc!.source).toBe('kasi');
  });

  it('KASI 가 빠뜨린 base 날짜는 지우지 않는다', () => {
    const kasi: HolidayItem[] = [
      { date: '2025-05-05', name: '어린이날', type: 'public', source: 'kasi' },
    ];
    const merged = mergeKasiOverlay(base, kasi);
    expect(merged.find((h) => h.date === '2025-10-03')).toBeDefined();
  });
});

describe('fetchKasiHolidays — soft-fail 보장', () => {
  it('KASI_SERVICE_KEY 미설정이면 null (라우트는 date-holidays 로 정상)', async () => {
    const env = {} as Env;
    expect(await fetchKasiHolidays(env, 2026)).toBeNull();
  });

  it('resultCode!=="00" 이면 null (degrade to date-holidays)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            response: { header: { resultCode: '30', resultMsg: 'KEY_NOT_REGISTERED' } },
          }),
          { status: 200 },
        ),
      ),
    );
    const env = { KASI_SERVICE_KEY: 'decoded-key' } as Env;
    expect(await fetchKasiHolidays(env, 2026)).toBeNull();
  });

  it('정상 응답이면 매핑된 HolidayItem[] 을 돌려준다', async () => {
    const json = kasiFixture([
      { locdate: 20260217, dateName: '설날', isHoliday: 'Y', dateKind: '01' },
      { locdate: 20260218, dateName: '설날', isHoliday: 'Y', dateKind: '01' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })),
    );
    const env = { KASI_SERVICE_KEY: 'decoded-key' } as Env;
    const out = await fetchKasiHolidays(env, 2026);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(2);
    expect(out![0]!.source).toBe('kasi');
  });

  it('serviceKey 는 정확히 한 번만 인코딩한다 (이중 인코딩 방지)', async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify(kasiFixture([])), { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const env = { KASI_SERVICE_KEY: 'a+b/c==' } as Env;
    await fetchKasiHolidays(env, 2026);
    const url = String(spy.mock.calls[0]![0]);
    // '+' 와 '/' 와 '=' 가 한 번 인코딩됐는지(이중 인코딩 %25 가 없는지) 확인.
    expect(url).toContain('serviceKey=');
    expect(url).not.toContain('%25'); // %25 = 이중 인코딩된 '%'
    expect(decodeURIComponent(new URL(url).searchParams.get('serviceKey')!)).toBe('a+b/c==');
  });

  it('네트워크 오류(throw)도 null 로 degrade', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));
    const env = { KASI_SERVICE_KEY: 'decoded-key' } as Env;
    expect(await fetchKasiHolidays(env, 2026)).toBeNull();
  });
});

// 회귀 가드 — 대체공휴일을 3일로 펼치지 않는다 (2026-07-28).
//
// date-holidays 3.34.0 부터 KR 대체공휴일을 자체적으로 내보낸다(그 전엔 KASI 오버레이만 채웠다).
// 이름에 '설날'/'추석'이 들어 있어 KR 3일 확장 로직이 그대로 집어삼키면, 하루짜리 대체공휴일이
// 3일이 된다 — 예: 2027 설날 대체공휴일(02-09) -> 02-08/09/10. 그러면 평일이 공휴일로 잡혀
// '공휴일엔 알람 끄기'가 엉뚱한 날 알람을 끈다.
describe('computeHolidays — KR 대체공휴일은 확장하지 않는다', () => {
  const cases = [
    { year: 2027, keyword: '설날', substituteDate: '2027-02-09', window: ['2027-02-06', '2027-02-07', '2027-02-08'] },
    { year: 2028, keyword: '추석', substituteDate: '2028-10-05', window: ['2028-10-02', '2028-10-03', '2028-10-04'] },
  ];

  for (const { year, keyword, substituteDate, window } of cases) {
    it(`${year} ${keyword} 대체공휴일은 ${substituteDate} 하루뿐`, () => {
      const kr = computeHolidays({ country: 'KR', from: `${year}-01-01`, to: `${year}-12-31` });
      const named = kr.filter((x) => x.name.includes(keyword));
      // 확장된 본 연휴는 3일 그대로.
      expect(named.filter((x) => !x.substitute).map((x) => x.date).sort()).toEqual([...window].sort());
      // 대체공휴일은 정확히 하루.
      expect(named.filter((x) => x.substitute).map((x) => x.date)).toEqual([substituteDate]);
      // 확장 잔재로 같은 날짜가 두 번 들어가지 않는다.
      const dates = named.map((x) => x.date);
      expect(new Set(dates).size).toBe(dates.length);
    });
  }
});
