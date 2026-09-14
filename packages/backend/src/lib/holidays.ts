// 공휴일 계산 코어 — date-holidays(전 세계 ~206개국, ISC/CC-BY) 위에 올린 순수 함수.
// 환경(Env)·fetch 의존이 전혀 없어 단위 테스트가 쉽다. KR KASI 오버레이(holidays-kasi.ts)와
// 라우트(routes/holiday.ts)에서 이 함수를 호출한다.
//
// 번들링 메모: date-holidays 는 ESM `module`/`exports.import` 진입점이 정적
// `import { data } from './data.js'` 라서 런타임 fs/readFileSync 가 없다 → wrangler esbuild 가
// 깔끔히 번들한다. 반드시 default import(`import Holidays from 'date-holidays'`)를 써서
// esbuild 가 CJS(lib/index.cjs) 대신 번들 친화적 ESM 진입점을 고르게 한다.
import Holidays from 'date-holidays';

type HolidayType = 'public' | 'bank' | 'school' | 'optional' | 'observance';

export interface HolidayItem {
  /** 'YYYY-MM-DD' — 해당 국가 현지 민간 날짜(시각 없음). */
  date: string;
  name: string;
  type: HolidayType;
  /** 대체공휴일 여부. false 일 땐 생략한다. */
  substitute?: boolean;
  /** 이 항목의 출처. KASI 오버레이가 적용됐는지 QA 가 구분하는 용도. */
  source?: 'date-holidays' | 'kasi';
}

/** 잘못된 입력(미지원 country 등) — 라우트가 400 으로 매핑한다. */
export class HolidayInputError extends Error {
  readonly errorCode: string;
  constructor(message: string, errorCode: string) {
    super(message);
    this.name = 'HolidayInputError';
    this.errorCode = errorCode;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** country 기본 언어. date-holidays 는 ISO 639-1 코드를 쓴다. */
function defaultLanguageFor(country: string): string {
  switch (country.toUpperCase()) {
    case 'KR':
      return 'ko';
    case 'JP':
      return 'ja';
    default:
      return 'en';
  }
}

/**
 * from/to(둘 다 'YYYY-MM-DD', inclusive) 윈도우의 공휴일을 계산한다.
 * 윈도우가 걸친 모든 달력 연도를 순회한다(음력/대체공휴일은 라이브러리가 연도별로 계산하므로
 * 한 해만 구해서 옮겨 쓰면 안 된다 — 연도마다 음력→양력 매핑이 다르다). 그 뒤 윈도우로 필터한다.
 *
 * 주의(KR): date-holidays 의 KR.yaml 은 한국의 대체공휴일(공휴일이 주말과 겹칠 때 다음 평일로
 * 이월) 규칙을 인코딩하지 않는다. 따라서 KR 의 substitute 플래그는 대부분 비어 있다. KR 의
 * 대체/임시공휴일 정답은 KASI 오버레이(holidays-kasi.ts)가 채운다 — 이 함수의 KR 결과만 믿지 말 것.
 */
export function computeHolidays(opts: {
  country: string;
  region?: string;
  from: string;
  to: string;
  language?: string;
}): HolidayItem[] {
  const country = opts.country.trim().toUpperCase();
  if (!country) {
    throw new HolidayInputError('country is required', 'COUNTRY_REQUIRED');
  }
  if (!DATE_RE.test(opts.from) || !DATE_RE.test(opts.to)) {
    throw new HolidayInputError('from/to must be YYYY-MM-DD', 'INVALID_DATE_RANGE');
  }
  if (opts.from > opts.to) {
    throw new HolidayInputError('from must be <= to', 'INVALID_DATE_RANGE');
  }

  // country 유효성 검사 (지원 목록 대조).
  const probe = new Holidays();
  const countries = probe.getCountries();
  if (!countries[country]) {
    throw new HolidayInputError(`Unknown country: ${country}`, 'UNKNOWN_COUNTRY');
  }

  const region = opts.region?.trim();
  const language = opts.language?.trim() || defaultLanguageFor(country);

  // 생성자 시그니처: (country, state?, region?, opts?). region 은 라이브러리상 state 슬롯에 해당하는
  // 행정구역 코드로 받는다(없으면 country 만).
  const hd = region ? new Holidays(country, region) : new Holidays(country);
  // setLanguages 는 잘못된 코드여도 throw 하지 않고 폴백하지만, 안전하게 try 로 감싼다.
  try {
    hd.setLanguages(language);
  } catch {
    // 언어 설정 실패는 무시 — 라이브러리 폴백 언어를 쓴다.
  }

  const fromYear = Number(opts.from.slice(0, 4));
  const toYear = Number(opts.to.slice(0, 4));

  const isKR = country === 'KR';

  const out: HolidayItem[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const raw = hd.getHolidays(year, language) || [];
    for (const h of raw) {
      // 라이브러리의 문자열 `date`('YYYY-MM-DD HH:mm:ss')의 날짜 부분을 쓴다. `start`(Date)를 쓰면
      // 워커의 UTC 시계가 민간 날짜를 하루 밀 수 있다 — 문자열은 이미 국가별 현지화돼 있다.
      const date = h.date.slice(0, 10);
      if (!DATE_RE.test(date)) continue;

      // KR 설날/추석은 법정 3일 연휴인데 date-holidays 의 KR.yaml 은 하루만 준다.
      // 게다가 추석은 라이브러리 날짜가 '당일'이 아니라 '추석 전날(음력 8/14)'이라 하루 어긋난다.
      // → KR 전용 후처리로 올바른 3일 양력 윈도우(전날·당일·다음날)를 펼친다. 이 보정은
      //   KASI 키 유무와 무관하게 항상 적용된다(KASI 오버레이는 그 위에서 대체/임시만 정제).
      // 대체공휴일은 법정 1일이라 3일 확장 대상이 아니다. date-holidays 3.34.0 부터 KR
      // 대체공휴일을 자체적으로 내보내는데(그 전엔 KASI 오버레이만 채웠다), 이름에 '설날'/
      // '추석'이 들어 있어 그대로 두면 확장 로직이 대체공휴일까지 3일로 펼친다 —
      // 예: 2027 설날 대체공휴일(02-09)이 02-08/09/10 이 되어 평일이 공휴일로 잡히고,
      // '공휴일엔 알람 끄기'가 엉뚱한 날 알람을 끈다.
      if (isKR && !h.substitute) {
        const expanded = expandKRSeollalChuseok(date, h.name, h.type as HolidayType);
        if (expanded) {
          for (const e of expanded) {
            if (e.date < opts.from || e.date > opts.to) continue;
            out.push(e);
          }
          continue;
        }
      }

      if (date < opts.from || date > opts.to) continue;
      const item: HolidayItem = {
        date,
        name: h.name,
        type: h.type as HolidayType,
        source: 'date-holidays',
      };
      if (h.substitute === true) item.substitute = true;
      out.push(item);
    }
  }

  return dedupeByDateName(out).sort(sortByDate);
}

/** 'YYYY-MM-DD' 에 일(day) 단위 오프셋을 더한 'YYYY-MM-DD'. UTC 로 계산해 DST/타임존 영향이 없다. */
function shiftIsoDate(iso: string, deltaDays: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * KR 설날/추석을 법정 3일 양력 연휴로 펼친다(아니면 null).
 * - 설날: date-holidays 가 주는 날짜가 '설날 당일'이라 윈도우 = [당일-1, 당일, 당일+1].
 * - 추석: date-holidays 가 주는 날짜는 '추석 전날(음력 8/14)'이라 윈도우 = [전날, 다음날(=당일), 그 다음날]
 *         → 라이브러리 날짜에 +0/+1/+2 를 더해 당일이 '가운데'에 오게 만든다.
 * 모든 항목 이름은 동일하게 '설날'/'추석'으로 유지하고 source 는 date-holidays.
 * (홀수 연도에 KASI 오버레이가 켜져 있으면 같은 날짜를 KASI 항목으로 대체/정제한다.)
 */
function expandKRSeollalChuseok(
  libDate: string,
  name: string,
  type: HolidayType,
): HolidayItem[] | null {
  let offsets: [number, number, number] | null = null;
  if (name.includes('설날')) {
    offsets = [-1, 0, 1]; // 라이브러리 날짜 = 당일
  } else if (name.includes('추석')) {
    offsets = [0, 1, 2]; // 라이브러리 날짜 = 추석 전날 → 당일은 +1(가운데)
  }
  if (!offsets) return null;
  return offsets.map((delta) => ({
    date: shiftIsoDate(libDate, delta),
    name,
    type,
    source: 'date-holidays' as const,
  }));
}

/** date+name 으로 중복 제거(대체일과 원래 공휴일이 같은 날짜에 겹칠 수 있음). */
export function dedupeByDateName(items: HolidayItem[]): HolidayItem[] {
  const seen = new Map<string, HolidayItem>();
  for (const item of items) {
    const key = `${item.date} ${item.name}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

export function sortByDate(a: HolidayItem, b: HolidayItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
