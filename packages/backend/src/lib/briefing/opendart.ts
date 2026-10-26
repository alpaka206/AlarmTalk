/**
 * OpenDART(금융감독원 전자공시) 어댑터 — 기업 고유번호 목록(`corpCode.xml`)과 공시 검색(`list.json`).
 *
 * 출처: OpenDART 개발가이드 「공시정보 → 고유번호」(DS001 `corpCode.xml`), 「공시검색」(DS001 `list.json`).
 * 키는 `OPENDART_API_KEY`(인증키 40자, `crtfc_key`). ⚠ 요청 URL 에 키가 실린다 — URL 을 로그·오류에 싣지 않는다.
 *
 * ## 상태 코드(가이드의 「메시지 설명」)
 *
 * | status | 뜻 | 우리 갈래 |
 * | --- | --- | --- |
 * | 000 | 정상 | 성공 |
 * | 013 | 조회된 데이터가 없음 | **성공 — 빈 목록**(실패가 아니다) |
 * | 020 | 요청 제한 초과(보통 하루 20,000건) | `rate_limited` |
 * | 010 / 011 / 012 / 901 | 등록되지 않은 키 / 사용할 수 없는 키 / 접근할 수 없는 IP / 계정 보유기간 만료 | `key_invalid` |
 * | 800 | 시스템 점검 | `maintenance` |
 * | 900 | 정의되지 않은 오류 | `failed` |
 * | 014 / 021 / 100 / 101 | 파일 없음 / 회사 수 초과 / 부적절한 값 / 부적절한 접근 | `failed`(우리 요청이 틀린 것) |
 *
 * 규칙 전문은 `docs/spec/morning-briefing.md`.
 */
import type { BriefingDisclosureFlags } from '@alarmtalk/shared';
import { assertNoDoctype, cleanText, tagBlocks, tagText, truncateText } from './xml';
import { extractZipEntry, looksLikeZip, ZipError } from './zip';
import {
  BRIEFING_FETCH_TIMEOUT_MS,
  BriefingSourceError,
  fetchWithTimeout,
  type BriefingSourceErrorKind,
  type FetchLike,
} from './source-error';

export const OPENDART_CORP_CODE_URL = 'https://opendart.fss.or.kr/api/corpCode.xml';
export const OPENDART_LIST_URL = 'https://opendart.fss.or.kr/api/list.json';
/** DART 원문 보기. 접수번호만 붙이면 열린다. */
export const DART_VIEWER_URL = 'https://dart.fss.or.kr/dsaf001/main.do';

/** `CORPCODE.xml` 이 풀린 크기 상한. 실제는 수십 MB 이고, 이보다 크면 거절한다(압축 폭탄·메모리 128MB). */
export const CORP_CODE_XML_MAX_BYTES = 64 * 1024 * 1024;
/** 고유번호 ZIP 을 받는 시간 제한. 파일이 커서 공시 검색보다 길게 둔다. */
const CORP_CODE_FETCH_TIMEOUT_MS = 30_000;
/** `list.json` 한 페이지 행 수 — 가이드 상한 100. */
export const DART_LIST_PAGE_COUNT = 100;
/** 기업 하나의 창(7일)에서 넘길 최대 페이지. 넘으면 잘린 것(`complete: false`)이다. */
export const DART_LIST_MAX_PAGES = 3;

export function dartViewerUrl(rceptNo: string): string {
  return `${DART_VIEWER_URL}?rcpNo=${encodeURIComponent(rceptNo)}`;
}

export type DartStatusOutcome =
  | { ok: true; empty: boolean }
  | { ok: false; kind: Exclude<BriefingSourceErrorKind, 'not_configured'>; detail: string };

/** OpenDART `status` → 우리 갈래. 표는 머리말. */
export function classifyDartStatus(status: string): DartStatusOutcome {
  switch (status) {
    case '000':
      return { ok: true, empty: false };
    case '013':
      return { ok: true, empty: true };
    case '020':
      return { ok: false, kind: 'rate_limited', detail: 'rate_limited' };
    case '010':
      return { ok: false, kind: 'key_invalid', detail: 'key_unregistered' };
    case '011':
      return { ok: false, kind: 'key_invalid', detail: 'key_unusable' };
    case '012':
      return { ok: false, kind: 'key_invalid', detail: 'ip_denied' };
    case '901':
      return { ok: false, kind: 'key_invalid', detail: 'account_expired' };
    case '800':
      return { ok: false, kind: 'maintenance', detail: 'maintenance' };
    case '900':
      return { ok: false, kind: 'failed', detail: 'undefined_error' };
    case '014':
    case '021':
    case '100':
    case '101':
      return { ok: false, kind: 'failed', detail: 'bad_request' };
    default:
      return { ok: false, kind: 'failed', detail: 'unknown_status' };
  }
}

function throwForStatus(status: string): never {
  const outcome = classifyDartStatus(status);
  if (outcome.ok) throw new BriefingSourceError('failed', 'unexpected_ok', status);
  throw new BriefingSourceError(outcome.kind, outcome.detail, status);
}

// ── 고유번호(corpCode.xml) ──────────────────────────────────────────────────────────

export type CorpCodeRow = {
  corp_code: string;
  corp_name: string;
  /** 비상장이면 원천이 공백(`' '`)을 준다 → null. */
  stock_code: string | null;
  /** `YYYYMMDD`. */
  modify_date: string;
};

/** 종목코드 — 6자리. 2024년부터 영문이 섞인 단축코드가 있어 숫자만으로 묶지 않는다. */
const STOCK_CODE_RE = /^[0-9A-Z]{6}$/;
/** 기업명 상한(정리한 뒤). 원천의 가장 긴 이름보다 넉넉하다 — 그 이상은 깨진 행으로 본다. */
const CORP_NAME_MAX = 120;

/**
 * `CORPCODE.xml` 본문 → 행. 형식이 틀린 행은 건너뛴다(`skipped`).
 * 모양: `<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name>
 * <corp_eng_name>…</corp_eng_name><stock_code>005930</stock_code><modify_date>20250102</modify_date></list>…</result>`.
 */
export function parseCorpCodeXml(xml: string): { rows: CorpCodeRow[]; skipped: number } {
  assertNoDoctype(xml);
  const rows: CorpCodeRow[] = [];
  let skipped = 0;
  for (const block of tagBlocks(xml, 'list')) {
    const corpCode = cleanText(tagText(block, 'corp_code'));
    const corpName = cleanText(tagText(block, 'corp_name'));
    const stockRaw = cleanText(tagText(block, 'stock_code'));
    const modifyDate = cleanText(tagText(block, 'modify_date'));
    if (!/^\d{8}$/.test(corpCode) || !corpName || corpName.length > CORP_NAME_MAX || !/^\d{8}$/.test(modifyDate)) {
      skipped++;
      continue;
    }
    rows.push({
      corp_code: corpCode,
      corp_name: corpName,
      stock_code: STOCK_CODE_RE.test(stockRaw) ? stockRaw : null,
      modify_date: modifyDate,
    });
  }
  return { rows, skipped };
}

/**
 * 원천이 ZIP 대신 준 오류 본문(XML 또는 JSON)에서 `status` 를 꺼낸다. 못 찾으면 null.
 * 예: `<result><status>010</status><message>등록되지 않은 키입니다.</message></result>`.
 */
export function dartErrorStatusFromBody(text: string): string | null {
  const xml = /<status>\s*(\d{3})\s*<\/status>/.exec(text);
  if (xml) return xml[1] ?? null;
  try {
    const parsed = JSON.parse(text) as { status?: unknown };
    return typeof parsed.status === 'string' && /^\d{3}$/.test(parsed.status) ? parsed.status : null;
  } catch {
    return null;
  }
}

/** ZIP 바이트 → 행. 테스트가 네트워크 없이 부른다. */
export async function corpCodesFromZip(bytes: Uint8Array): Promise<{ rows: CorpCodeRow[]; skipped: number }> {
  let xmlBytes: Uint8Array;
  try {
    xmlBytes = await extractZipEntry(bytes, (name) => /(^|\/)corpcode\.xml$/i.test(name), CORP_CODE_XML_MAX_BYTES);
  } catch (err) {
    if (err instanceof ZipError) throw new BriefingSourceError('failed', 'parse');
    throw err;
  }
  return parseCorpCodeXml(new TextDecoder('utf-8').decode(xmlBytes));
}

/** `corpCode.xml` 을 받아 행으로. 하루 한 번 이하로만 부른다(`store.ts` 의 잠금). */
export async function downloadCorpCodes(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ rows: CorpCodeRow[]; skipped: number }> {
  const url = new URL(OPENDART_CORP_CODE_URL);
  url.search = new URLSearchParams({ crtfc_key: apiKey }).toString();
  const res = await fetchWithTimeout(fetchImpl, url, CORP_CODE_FETCH_TIMEOUT_MS);
  if (!res.ok) throw new BriefingSourceError('failed', 'http', String(res.status));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!looksLikeZip(bytes)) {
    const status = dartErrorStatusFromBody(new TextDecoder().decode(bytes.subarray(0, 4096)));
    if (status) throwForStatus(status);
    throw new BriefingSourceError('failed', 'parse');
  }
  return corpCodesFromZip(bytes);
}

// ── 공시 검색(list.json) ───────────────────────────────────────────────────────────

export type DartDisclosure = {
  rceptNo: string;
  corpCode: string;
  corpName: string;
  reportName: string;
  /** `YYYY-MM-DD` — 접수 **날짜만**. 원천이 시각을 주지 않는다. */
  receiptDate: string;
  remarks: string;
  flags: BriefingDisclosureFlags;
  url: string;
};

/**
 * 비고(`rm`) → 깃발. 가이드의 비고 설명:
 *  - `유` 유가증권시장본부 소관 · `코` 코스닥시장본부 소관 · `넥` 코넥스시장 소관 · `채` 채권상장법인 공시
 *  - `공` 공정거래위원회 공시 · `연` 연결부분 포함
 *  - `정` 본 보고서 제출 후 **정정신고가 있음** · `철` 본 보고서는 **철회(간주)됨**
 * 보고서명 앞의 `[기재정정]`·`[첨부정정]`·`[정정명령부과]`·`[정정제출요구]` 는 **이 보고서 자체가 정정 관련**이라는 뜻이다
 * (`amended_report`). 모르는 글자는 무시하고 원문(`remarks`)에 그대로 남긴다.
 */
export function dartRemarkFlags(rm: string, reportName: string): BriefingDisclosureFlags {
  const market = rm.includes('유')
    ? 'kospi'
    : rm.includes('코')
      ? 'kosdaq'
      : rm.includes('넥')
        ? 'konex'
        : rm.includes('채')
          ? 'bond'
          : null;
  return {
    amended_report: /^\s*\[[^\]]*정정[^\]]*\]/.test(reportName),
    corrected_later: rm.includes('정'),
    withdrawn: rm.includes('철'),
    consolidated: rm.includes('연'),
    ftc: rm.includes('공'),
    market,
  };
}

/** 보고서명 상한(정리한 뒤). 원천 이름은 이보다 훨씬 짧다. */
const REPORT_NAME_MAX = 200;

/** `list.json` 의 `list[]` 한 행 → 공시. 형식이 틀리면 null(그 행만 버린다). */
export function mapDartListItem(raw: unknown): DartDisclosure | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const rceptNo = str(r.rcept_no).trim();
  const corpCode = str(r.corp_code).trim();
  const rceptDt = str(r.rcept_dt).trim();
  const corpName = cleanText(str(r.corp_name));
  const reportName = truncateText(cleanText(str(r.report_nm)), REPORT_NAME_MAX);
  const remarks = cleanText(str(r.rm));
  if (!/^\d{14}$/.test(rceptNo) || !/^\d{8}$/.test(corpCode) || !/^\d{8}$/.test(rceptDt)) return null;
  if (!corpName || !reportName) return null;
  const receiptDate = `${rceptDt.slice(0, 4)}-${rceptDt.slice(4, 6)}-${rceptDt.slice(6, 8)}`;
  if (Number.isNaN(Date.parse(`${receiptDate}T00:00:00Z`))) return null;
  return {
    rceptNo,
    corpCode,
    corpName,
    reportName,
    receiptDate,
    remarks,
    flags: dartRemarkFlags(remarks, reportName),
    url: dartViewerUrl(rceptNo),
  };
}

export type DartListResult = {
  items: DartDisclosure[];
  /** 모든 페이지를 다 읽었다. false 면 잘렸다 — "더 없다" 고 말하면 안 된다. */
  complete: boolean;
};

/**
 * 기업 하나의 공시를 기간(`bgnDe`~`endDe`, `YYYYMMDD`, 양끝 포함)으로. 페이지를 넘기며 최대 `maxPages` 쪽.
 * `013` 은 빈 목록(성공)이고, 나머지 실패는 `BriefingSourceError` 로 던진다.
 */
export async function fetchDartDisclosures(params: {
  apiKey: string;
  corpCode: string;
  bgnDe: string;
  endDe: string;
  fetchImpl?: FetchLike;
  maxPages?: number;
  pageCount?: number;
}): Promise<DartListResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const maxPages = params.maxPages ?? DART_LIST_MAX_PAGES;
  const pageCount = params.pageCount ?? DART_LIST_PAGE_COUNT;
  const items: DartDisclosure[] = [];
  const seen = new Set<string>();
  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    const url = new URL(OPENDART_LIST_URL);
    url.search = new URLSearchParams({
      crtfc_key: params.apiKey,
      corp_code: params.corpCode,
      bgn_de: params.bgnDe,
      end_de: params.endDe,
      page_no: String(pageNo),
      page_count: String(pageCount),
    }).toString();
    const res = await fetchWithTimeout(fetchImpl, url, BRIEFING_FETCH_TIMEOUT_MS);
    if (!res.ok) throw new BriefingSourceError(res.status === 429 ? 'rate_limited' : 'failed', 'http', String(res.status));
    let body: Record<string, unknown>;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new BriefingSourceError('failed', 'parse');
    }
    const status = typeof body.status === 'string' ? body.status : '';
    const outcome = classifyDartStatus(status);
    if (!outcome.ok) throw new BriefingSourceError(outcome.kind, outcome.detail, status);
    if (outcome.empty) return { items, complete: true };
    if (!Array.isArray(body.list)) throw new BriefingSourceError('failed', 'parse', status);
    for (const raw of body.list) {
      const item = mapDartListItem(raw);
      // ⚠ 다른 기업의 행은 버린다 — 원천이 corp_code 를 무시했다면 남의 공시를 이 기업 것으로 보여 주게 된다.
      if (!item || item.corpCode !== params.corpCode || seen.has(item.rceptNo)) continue;
      seen.add(item.rceptNo);
      items.push(item);
    }
    const totalPage = Number(body.total_page);
    if (!Number.isFinite(totalPage) || totalPage <= pageNo) return { items, complete: true };
  }
  return { items, complete: false };
}
