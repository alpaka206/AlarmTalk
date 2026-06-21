import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { computeHolidays, HolidayInputError, sortByDate, type HolidayItem } from '../lib/holidays';
import { fetchKasiHolidays, mergeKasiOverlay } from '../lib/holidays-kasi';

// GET /api/holiday?country=&region=&from=&to=&lang= (인증 불필요, 다국가).
//
// date-holidays(전 세계 ~206개국) 기반으로 임의 국가의 공휴일을 돌려준다. KR 은 KASI_SERVICE_KEY
// 가 설정돼 있으면 KASI 특일정보로 대체/임시공휴일을 보정한다(없으면 date-holidays 결과만).
//
// 응답: { holidays: [{ date, name, type, substitute?, source? }] } (date 오름차순).
// type 은 public|bank|school|optional|observance 그대로 통과 — 실제 쉬는 날만 원하면
// 호출자가 type==='public' 으로 필터한다. (KASI 항목은 항상 type='public'.)

const holiday = new Hono<AppEnv>();

// 윈도우 최대 폭(년). KASI 는 연도당 1서브리퀘스트라, Workers free plan 의 invocation 당
// 서브리퀘스트 상한(~50)을 넘지 않게 윈도우를 제한한다.
const MAX_YEARS_SPAN = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

holiday.get('/', async (c) => {
  const countryRaw = c.req.query('country');
  const country = typeof countryRaw === 'string' ? countryRaw.trim().toUpperCase() : '';
  if (!country) {
    return c.json({ error: 'country is required', error_code: 'COUNTRY_REQUIRED' }, 400);
  }

  // from/to 기본값: 현재 연도 1/1 ~ 12/31 (new Date() 기준).
  // 주의: 기본 연도는 워커의 UTC 시계로 계산하므로 1월 1일 전후 KST 사용자는 연도가 어긋날 수
  // 있다(경미). 정확히 원하면 from/to 를 명시할 것.
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const from = (c.req.query('from') || `${currentYear}-01-01`).trim();
  const to = (c.req.query('to') || `${currentYear}-12-31`).trim();

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return c.json({ error: 'from/to must be YYYY-MM-DD', error_code: 'INVALID_DATE' }, 400);
  }
  if (from > to) {
    return c.json({ error: 'from must be <= to', error_code: 'INVALID_RANGE' }, 400);
  }

  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  if (toYear - fromYear + 1 > MAX_YEARS_SPAN) {
    return c.json(
      {
        error: `Date range too large (max ${MAX_YEARS_SPAN} years)`,
        error_code: 'RANGE_TOO_LARGE',
      },
      400,
    );
  }

  const region = c.req.query('region')?.trim() || undefined;
  const lang = c.req.query('lang')?.trim() || undefined;

  let holidays: HolidayItem[];
  try {
    holidays = computeHolidays({ country, region, from, to, language: lang });
  } catch (err) {
    if (err instanceof HolidayInputError) {
      return c.json({ error: err.message, error_code: err.errorCode }, 400);
    }
    throw err; // app.onError 로 버블링.
  }

  // KR 보정: KASI_SERVICE_KEY 가 있으면 윈도우의 각 연도에 대해 KASI 를 받아 병합한다.
  // null(키 미설정/soft-fail)이면 건너뛰고 date-holidays 결과를 그대로 제공한다.
  if (country === 'KR' && c.env.KASI_SERVICE_KEY) {
    const kasiAll: HolidayItem[] = [];
    let anyOverlay = false;
    for (let year = fromYear; year <= toYear; year++) {
      const kasi = await fetchKasiHolidays(c.env, year);
      if (kasi) {
        anyOverlay = true;
        for (const k of kasi) {
          if (k.date >= from && k.date <= to) kasiAll.push(k);
        }
      }
    }
    if (anyOverlay) {
      holidays = mergeKasiOverlay(holidays, kasiAll).filter((h) => h.date >= from && h.date <= to);
    }
  }

  holidays.sort(sortByDate);

  return c.json({
    holidays: holidays.map((h) => ({
      date: h.date,
      name: h.name,
      type: h.type,
      ...(h.substitute ? { substitute: true } : {}),
      ...(h.source ? { source: h.source } : {}),
    })),
  });
});

export default holiday;
