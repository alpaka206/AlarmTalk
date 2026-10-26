/**
 * 대한민국 정책브리핑 **정책뉴스** 어댑터 — 공공데이터포털(data.go.kr) 「문화체육관광부_정책브리핑_정책뉴스」 OpenAPI.
 *
 * - 주소: `apis.data.go.kr/1371000/policyNewsService/policyNewsList`, 인자 `serviceKey`·`startDate`·`endDate`(YYYYMMDD).
 *   기간은 짧게 묻는다(오늘·어제 이틀) — 가이드가 기간 상한을 둔다(3일로 알려져 있다 — 실제 응답으로 확인 필요).
 * - 키는 `KOREA_POLICY_NEWS_API_KEY` — data.go.kr **일반 인증키(Decoding)**. `URLSearchParams` 로 한 번만 인코딩하므로
 *   Encoding 키를 넣으면 이중 인코딩되어 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(30)가 난다(`weather-kma.ts` 와 같은 규약).
 *   ⚠ 요청 URL 에 키가 실린다 — URL 을 로그·오류에 싣지 않는다.
 * - 응답은 XML 이다. ⚠ **RSS 는 쓰지 않는다** — 정책브리핑 RSS 는 2026-07-01 에 제공이 끝났다.
 * - ⚠ **이미지를 다시 싣지 않는다.** 응답의 썸네일·원본 이미지 주소는 읽지도 저장하지도 않는다(개별 사진에 제3자 권리가
 *   있을 수 있다). 본문 HTML 은 글자로만 바꿔 짧은 요약에만 쓴다.
 *
 * ⚠ **필드 이름은 공개 문서·기존 연동 사례로만 맞췄다 — 키를 받아 실제 응답으로 확인해야 한다.** 이름을 고칠 곳은
 * `mapPolicyNewsFields` 하나다. 확인 순서는 `docs/spec/morning-briefing.md` §7.
 */
import { assertNoDoctype, cleanText, htmlToText, tagBlocks, tagText, truncateText } from './xml';
import {
  BRIEFING_FETCH_TIMEOUT_MS,
  BriefingSourceError,
  fetchWithTimeout,
  type BriefingSourceErrorKind,
  type FetchLike,
} from './source-error';

export const POLICY_NEWS_URL = 'https://apis.data.go.kr/1371000/policyNewsService/policyNewsList';

/** 요약 상한(글자). 공공누리 제1유형이라도 기사 전문을 옮기지 않는다 — 제목과 짧은 요약, 원문 링크까지만. */
export const POLICY_NEWS_SUMMARY_MAX = 120;
const POLICY_NEWS_TITLE_MAX = 200;

/** 응답 한 항목의 **원천 필드 그대로**(글자 정리 전). */
export type PolicyNewsRawFields = {
  id: string;
  /** I(등록)·U(수정)·D(삭제). D 면 우리 캐시에서도 지운다. */
  status: string;
  title: string;
  subtitle: string;
  bodyHtml: string;
  approveDate: string;
  organization: string;
  originalUrl: string;
};

/**
 * ⚠⚠ **실제 응답으로 확인 필요** — 필드 이름을 이 함수 한 곳에만 둔다.
 *
 * 지금 이름은 공개된 연동 사례의 `<NewsItem>` 모양을 따른다:
 * `NewsItemId`·`ContentsStatus`·`Title`·`SubTitle1`·`DataContents`(HTML, CDATA)·`ApproveDate`·`MinisterCode`·`OriginalUrl`.
 * 이미지 필드(`ThumbnailUrl`·`OriginalImgUrl`)는 **일부러 읽지 않는다**(머리말).
 * 키를 받으면 실제 응답 한 건을 `test/fixtures/briefing/policy-news-list.xml` 로 바꿔 넣고 이 표를 맞춘다.
 */
export function mapPolicyNewsFields(block: string): PolicyNewsRawFields {
  return {
    id: tagText(block, 'NewsItemId'),
    status: tagText(block, 'ContentsStatus'),
    title: tagText(block, 'Title'),
    subtitle: tagText(block, 'SubTitle1'),
    bodyHtml: tagText(block, 'DataContents'),
    approveDate: tagText(block, 'ApproveDate'),
    organization: tagText(block, 'MinisterCode'),
    originalUrl: tagText(block, 'OriginalUrl'),
  };
}

/** 응답 항목을 감싸는 태그. 이것도 실제 응답으로 확인 필요. */
const POLICY_NEWS_ITEM_TAG = 'NewsItem';

export type PolicyNewsItem = {
  id: string;
  title: string;
  summary: string;
  organization: string | null;
  /** `YYYY-MM-DD`(한국 날짜). */
  publishedDate: string;
  /** 원천이 시각까지 줬을 때만 `YYYY-MM-DDTHH:mm:ss+09:00`. */
  publishedAt: string | null;
  url: string;
};

export type PolicyNewsResult = { items: PolicyNewsItem[]; deletedIds: string[] };

/**
 * 원천 날짜 글자 → 한국 날짜(+있으면 시각). 알려진 모양 몇 가지만 받는다 — 모르는 모양은 null(그 항목을 버린다).
 * 받는 모양: `MM/DD/YYYY HH:mm:ss`, `YYYY-MM-DD HH:mm:ss`(또는 `T`), `YYYYMMDDHHmmss`, `YYYY-MM-DD`, `YYYYMMDD`.
 * 원천 시각은 한국 시각으로 본다.
 */
export function parsePolicyNewsDate(text: string): { date: string; at: string | null } | null {
  const s = text.trim();
  let y: string | undefined, mo: string | undefined, d: string | undefined;
  let h: string | undefined, mi: string | undefined, se: string | undefined;
  let m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) [, mo, d, y, h, mi, se] = m;
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) [, y, mo, d, h, mi, se] = m;
  else if ((m = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/.exec(s))) [, y, mo, d, h, mi, se] = m;
  else return null;
  if (!y || !mo || !d) return null;
  const date = `${y}-${mo}-${d}`;
  const probe = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) return null;
  if (h === undefined || mi === undefined) return { date, at: null };
  if (Number(h) > 23 || Number(mi) > 59 || Number(se ?? '0') > 59) return { date, at: null };
  return { date, at: `${date}T${h}:${mi}:${se ?? '00'}+09:00` };
}

/** 원문 주소는 정책브리핑(korea.kr)의 http(s) 주소만 받는다 — http 는 https 로 올린다. 아니면 null. */
export function policyNewsSourceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'korea.kr' && !url.hostname.endsWith('.korea.kr')) return null;
  url.protocol = 'https:';
  return url.toString();
}

/** 원천 필드 → 보여 줄 항목. 제목·날짜·원문 링크가 없으면 null(보여 주지 않는다). */
export function normalizePolicyNews(raw: PolicyNewsRawFields): PolicyNewsItem | null {
  const id = cleanText(raw.id);
  const title = truncateText(cleanText(raw.title), POLICY_NEWS_TITLE_MAX);
  const date = parsePolicyNewsDate(raw.approveDate);
  const url = policyNewsSourceUrl(raw.originalUrl);
  if (!id || id.length > 64 || !title || !date || !url) return null;
  const subtitle = cleanText(raw.subtitle);
  const summary = truncateText(subtitle || htmlToText(raw.bodyHtml), POLICY_NEWS_SUMMARY_MAX);
  const organization = cleanText(raw.organization);
  return {
    id,
    title,
    summary,
    organization: organization ? truncateText(organization, 60) : null,
    publishedDate: date.date,
    publishedAt: date.at,
    url,
  };
}

/** data.go.kr 결과 코드 → 우리 갈래(`weather-kma.ts` 와 같은 표). 03(NODATA)은 빈 목록이다. */
export function classifyDataGoKrCode(
  code: string,
): { ok: true; empty: boolean } | { ok: false; kind: Exclude<BriefingSourceErrorKind, 'not_configured'>; detail: string } {
  const c = code.trim();
  if (/^0+$/.test(c)) return { ok: true, empty: false };
  if (c === '03') return { ok: true, empty: true };
  if (c === '22') return { ok: false, kind: 'rate_limited', detail: 'rate_limited' };
  if (['20', '30', '31', '32', '33'].includes(c)) return { ok: false, kind: 'key_invalid', detail: `datagokr_${c}` };
  return { ok: false, kind: 'failed', detail: `datagokr_${c || 'unknown'}` };
}

/** 응답 XML 하나 → 항목. 실패 봉투면 `BriefingSourceError` 를 던진다. 테스트가 네트워크 없이 부른다. */
export function parsePolicyNewsXml(xml: string): PolicyNewsResult {
  try {
    assertNoDoctype(xml);
  } catch {
    throw new BriefingSourceError('failed', 'parse');
  }
  // 게이트웨이 봉투(키·한도 오류): `<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode>…`.
  const gatewayCode = tagText(xml, 'returnReasonCode');
  if (gatewayCode) {
    const outcome = classifyDataGoKrCode(gatewayCode);
    if (!outcome.ok) throw new BriefingSourceError(outcome.kind, outcome.detail, gatewayCode.trim());
  }
  const resultCode = tagText(xml, 'resultCode');
  if (!resultCode && !gatewayCode) throw new BriefingSourceError('failed', 'parse');
  if (resultCode) {
    const outcome = classifyDataGoKrCode(resultCode);
    if (!outcome.ok) throw new BriefingSourceError(outcome.kind, outcome.detail, resultCode.trim());
    if (outcome.empty) return { items: [], deletedIds: [] };
  }
  const items: PolicyNewsItem[] = [];
  const deletedIds: string[] = [];
  const seen = new Set<string>();
  for (const block of tagBlocks(xml, POLICY_NEWS_ITEM_TAG)) {
    const raw = mapPolicyNewsFields(block);
    if (raw.status.trim().toUpperCase() === 'D') {
      const id = cleanText(raw.id);
      if (id) deletedIds.push(id);
      continue;
    }
    const item = normalizePolicyNews(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { items, deletedIds };
}

/** 기간(`startDate`~`endDate`, YYYYMMDD) 의 정책뉴스. */
export async function fetchPolicyNews(params: {
  serviceKey: string;
  startDate: string;
  endDate: string;
  fetchImpl?: FetchLike;
}): Promise<PolicyNewsResult> {
  const url = new URL(POLICY_NEWS_URL);
  url.search = new URLSearchParams({
    serviceKey: params.serviceKey,
    startDate: params.startDate,
    endDate: params.endDate,
  }).toString();
  const res = await fetchWithTimeout(params.fetchImpl ?? fetch, url, BRIEFING_FETCH_TIMEOUT_MS);
  // data.go.kr 는 키 오류도 200 + 오류 봉투로 줄 때가 많다 — 본문을 먼저 본다. 본문이 봉투가 아니면 HTTP 상태로.
  const text = await res.text().catch(() => '');
  if (!res.ok && !/<returnReasonCode>|<resultCode>/.test(text)) {
    throw new BriefingSourceError(res.status === 429 ? 'rate_limited' : 'failed', 'http', String(res.status));
  }
  return parsePolicyNewsXml(text);
}
