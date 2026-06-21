// KASI(한국천문연구원) 특일정보 오버레이 — KR 공휴일의 "정답" 보정.
//
// 왜 필요한가: date-holidays 의 KR.yaml 은 (1) 대체공휴일(공휴일이 주말과 겹칠 때 다음 평일로
// 이월)을 인코딩하지 않고, (2) 임시공휴일(국무회의로 그때그때 지정되는 일회성 공휴일, 예: 선거일·
// 특별휴일)은 어떤 알고리즘 라이브러리도 알 수 없다. 이 둘은 KASI getRestDeInfo 에만 ordinary
// item(dateKind '01', isHoliday 'Y')으로 등장한다. 그래서 KR 은 KASI 오버레이로 보정해야 정확하다.
//
// "지금은 동작, 키는 나중에 연결" 보장: KASI_SERVICE_KEY 미설정 시 fetchHolidays 는 null 을 돌려주고
// 라우트는 date-holidays 결과만으로 정상 응답한다(soft-fail). resultCode!=='00'(키 미승인/쿼터 초과/
// XML 에러 봉투)이나 네트워크 오류도 모두 null 로 degrade — KASI 실패가 라우트를 절대 500 내지 않는다.
//
// 엔드포인트는 HTTP(data.go.kr 특일정보는 역사적으로 평문 HTTP). Workers fetch 는 http 를 허용한다.
import type { Env } from '../types';
import type { HolidayItem } from './holidays';
import { dedupeByDateName, sortByDate } from './holidays';
import { logStructured } from './logger';

const KASI_ENDPOINT =
  'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

// data.go.kr 응답 한 페이지 최대 행수. 한 해 공휴일은 ~30건 안쪽이라 100 이면 페이징이 거의 안 난다.
const NUM_OF_ROWS = 100;

interface KasiItem {
  locdate?: number | string; // YYYYMMDD
  dateName?: string;
  isHoliday?: string; // 'Y' | 'N'
  dateKind?: string; // '01'
  seq?: number;
}

interface KasiBody {
  items?: { item?: KasiItem | KasiItem[] } | '' | null;
  numOfRows?: number;
  pageNo?: number;
  totalCount?: number;
}

interface KasiResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: KasiBody;
  };
}

/**
 * data.go.kr 응답에서 item 을 항상 배열로 정규화한다.
 * - totalCount===1 일 때 item 은 단일 OBJECT
 * - 그 외엔 ARRAY
 * - 0건일 땐 items 가 '' (빈 문자열) 또는 null
 * 셋 다 처리하지 않으면 map 에서 throw 난다.
 */
export function normalizeKasiItems(body: KasiBody | undefined): KasiItem[] {
  const items = body?.items;
  if (!items || typeof items !== 'object') return [];
  const item = items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/** locdate(YYYYMMDD int/string) → 'YYYY-MM-DD'. 형식이 깨졌으면 null. */
function locdateToIso(locdate: number | string | undefined): string | null {
  if (locdate == null) return null;
  const s = String(locdate).trim();
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** KASI item 1건 → HolidayItem. 공휴일이 아니거나 날짜가 깨졌으면 null. */
export function mapKasiItem(item: KasiItem): HolidayItem | null {
  if (item.isHoliday !== 'Y') return null;
  const date = locdateToIso(item.locdate);
  if (!date) return null;
  const name = (item.dateName ?? '').trim();
  if (!name) return null;
  const result: HolidayItem = { date, name, type: 'public', source: 'kasi' };
  if (name.includes('대체')) result.substitute = true;
  return result;
}

/** 순수 매핑: KASI 응답(JSON) → HolidayItem[] | null(resultCode!=='00' 등 soft-fail). */
export function parseKasiResponse(json: KasiResponse): HolidayItem[] | null {
  const resultCode = json.response?.header?.resultCode;
  // resultCode 가 없으면(XML 에러 봉투를 JSON 으로 못 받은 경우 등) 신뢰할 수 없으니 soft-fail.
  if (resultCode !== '00') {
    return null;
  }
  const items = normalizeKasiItems(json.response?.body);
  const mapped: HolidayItem[] = [];
  for (const it of items) {
    const m = mapKasiItem(it);
    if (m) mapped.push(m);
  }
  return mapped;
}

/**
 * KASI getRestDeInfo 로 해당 연도(solYear)의 국경일+공휴일(대체/임시 포함)을 가져온다.
 * - KASI_SERVICE_KEY 미설정 → null (호출자가 오버레이 생략, 라우트는 date-holidays 로 정상 동작).
 * - solMonth 를 생략하면 한 해 전체를 돌려준다. totalCount > 받은 행수면 페이지를 추가로 받는다.
 * - 네트워크/파싱 오류, resultCode!=='00' 은 전부 catch → null 로 degrade (라우트 500 방지).
 */
export async function fetchKasiHolidays(env: Env, year: number): Promise<HolidayItem[] | null> {
  if (!env.KASI_SERVICE_KEY) return null;

  try {
    const collected: HolidayItem[] = [];
    let pageNo = 1;
    let totalCount = Infinity;
    let fetched = 0;
    // 한 해 전체를 한 번에(보통 1리퀘스트) 받고, totalCount 가 더 크면 다음 페이지를 받는다.
    // 안전 상한: 10페이지(= 1000행)면 어떤 해든 충분.
    while (fetched < totalCount && pageNo <= 10) {
      // serviceKey 는 Decoding 키를 받아 URLSearchParams 로 정확히 한 번만 인코딩한다.
      // (이중 인코딩이 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 의 1순위 원인.)
      const params = new URLSearchParams({
        serviceKey: env.KASI_SERVICE_KEY,
        solYear: String(year),
        numOfRows: String(NUM_OF_ROWS),
        pageNo: String(pageNo),
        _type: 'json',
      });
      const res = await fetch(`${KASI_ENDPOINT}?${params.toString()}`);
      if (!res.ok) {
        logStructured('warn', { at: 'holidays.kasi.fetch', year, status: res.status });
        return null;
      }
      // _type=json 이어도 키 미승인 시 XML 에러 봉투가 올 수 있어 JSON 파싱 실패도 soft-fail.
      const json = (await res.json().catch(() => null)) as KasiResponse | null;
      if (!json) {
        logStructured('warn', { at: 'holidays.kasi.parse', year, reason: 'non-json' });
        return null;
      }
      const page = parseKasiResponse(json);
      if (page === null) {
        logStructured('warn', {
          at: 'holidays.kasi.resultcode',
          year,
          resultCode: json.response?.header?.resultCode,
          resultMsg: json.response?.header?.resultMsg,
        });
        return null;
      }
      collected.push(...page);

      const tc = json.response?.body?.totalCount;
      totalCount = typeof tc === 'number' && tc >= 0 ? tc : page.length;
      // 정규화 전 원시 행수로 진행도를 잰다(공휴일 아님으로 걸러진 행도 totalCount 에 포함되므로
      // 페이지의 매핑 결과 길이가 아니라 받은 페이지 크기를 기준으로 한다).
      const rawCount = normalizeKasiItems(json.response?.body).length;
      fetched += rawCount;
      if (rawCount === 0) break; // 빈 페이지면 더 받을 게 없다.
      pageNo++;
    }
    return collected;
  } catch (err) {
    logStructured('error', { at: 'holidays.kasi', year, error: String(err) });
    return null;
  }
}

/**
 * KR 윈도우 병합: date-holidays KR 결과 위에 KASI 를 덮어쓴다(date 기준 upsert).
 * - KASI 가 이름/substitute 에서 승리(KASI 가 정답).
 * - KASI 에만 있는 날짜(임시공휴일 등 라이브러리가 모르는 것)는 **추가**한다(additive).
 * - date-holidays 에는 있는데 KASI 에 없는 날짜는 **지우지 않는다**: KASI 는 부분연도/명칭 체계가
 *   달라(예: '설날' vs "Korean New Year/Seollal") 잘못 지우면 정상 공휴일을 떨굴 위험이 크다.
 *   trade-off: KASI 가 빠뜨린 항목이 base 에 남을 수 있으나, 누락보다 안전하다.
 *
 * dedupe 는 name 이 아니라 DATE 로 한다(KASI '설날' vs date-holidays 영문명이 달라 이름 키로는
 * 같은 날이 두 번 나올 수 있음). 단, 한 날짜에 서로 다른 공휴일이 여럿일 수 있으니
 * 같은 날짜 안에서는 KASI 항목으로 base 를 대체하되 base 의 추가 항목은 보존한다.
 */
export function mergeKasiOverlay(base: HolidayItem[], kasi: HolidayItem[]): HolidayItem[] {
  // 날짜별로 묶는다.
  const byDate = new Map<string, HolidayItem[]>();
  for (const item of base) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }

  for (const k of kasi) {
    const existing = byDate.get(k.date);
    if (!existing || existing.length === 0) {
      // KASI 에만 있는 날짜(임시/대체공휴일) → 추가.
      byDate.set(k.date, [k]);
      continue;
    }
    // 같은 날짜가 base 에 있으면 KASI 가 정답이므로 그 날짜 전체를 KASI 항목으로 대체한다.
    // (같은 날 여러 공휴일이 KASI 에 여러 건 오면 아래 루프에서 누적된다.)
    if (existing.every((e) => e.source !== 'kasi')) {
      byDate.set(k.date, [k]);
    } else {
      existing.push(k);
    }
  }

  const merged: HolidayItem[] = [];
  for (const list of byDate.values()) merged.push(...list);
  return dedupeByDateName(merged).sort(sortByDate);
}
