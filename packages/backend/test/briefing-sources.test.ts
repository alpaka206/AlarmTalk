// 아침 소식 원천 어댑터 — 고정 응답(test/fixtures/briefing)만 쓴다. 네트워크를 부르지 않는다.
// 규칙: `docs/spec/morning-briefing.md`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { BriefingDisclosure, BriefingPolicyNews } from '@alarmtalk/shared';
import { extractZipEntry, looksLikeZip, ZipError } from '../src/lib/briefing/zip';
import {
  classifyDartStatus,
  corpCodesFromZip,
  dartRemarkFlags,
  downloadCorpCodes,
  fetchDartDisclosures,
  mapDartListItem,
  parseCorpCodeXml,
} from '../src/lib/briefing/opendart';
import {
  fetchPolicyNews,
  parsePolicyNewsDate,
  parsePolicyNewsXml,
  policyNewsSourceUrl,
} from '../src/lib/briefing/policy-news';
import { BriefingSourceError } from '../src/lib/briefing/source-error';
import { htmlToText, truncateText } from '../src/lib/briefing/xml';
import { composeBriefingSpeech, BRIEFING_SPEECH_MAX } from '../src/lib/briefing/speech';
import { makeZip } from './support/make-zip';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'briefing');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const CORPCODE_XML = fixture('corpcode-sample.xml');
const utf8 = (text: string) => new TextEncoder().encode(text);

/** 부른 URL 을 기록하고, 차례대로 준비한 응답을 돌려주는 fetch. */
function scriptedFetch(responses: Array<() => Response>) {
  const urls: URL[] = [];
  const impl = async (input: string | URL) => {
    urls.push(new URL(String(input)));
    const next = responses.shift();
    if (!next) throw new Error('예상보다 많이 불렀다');
    return next();
  };
  return { impl, urls };
}
const json = (body: string) => () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('ZIP 리더', () => {
  it('deflate 로 묶인 CORPCODE.xml 을 푼다', async () => {
    const zip = makeZip([{ name: 'CORPCODE.xml', data: utf8(CORPCODE_XML) }]);
    expect(looksLikeZip(zip)).toBe(true);
    const out = await extractZipEntry(zip, (n) => n === 'CORPCODE.xml', 1024 * 1024);
    expect(new TextDecoder().decode(out)).toBe(CORPCODE_XML);
  });

  it('저장(무압축) 항목과 데이터 기술자(로컬 헤더 크기 0)도 중앙 디렉터리 크기로 읽는다', async () => {
    const zip = makeZip([
      { name: 'readme.txt', data: utf8('다른 파일'), method: 0 },
      { name: 'CORPCODE.xml', data: utf8(CORPCODE_XML), dataDescriptor: true },
    ]);
    const out = await extractZipEntry(zip, (n) => n === 'CORPCODE.xml', 1024 * 1024);
    expect(new TextDecoder().decode(out)).toBe(CORPCODE_XML);
    const stored = await extractZipEntry(zip, (n) => n === 'readme.txt', 1024);
    expect(new TextDecoder().decode(stored)).toBe('다른 파일');
  });

  it('찾는 항목이 없거나, 풀린 크기가 상한을 넘거나, ZIP 이 아니면 거절한다', async () => {
    const zip = makeZip([{ name: 'other.xml', data: utf8('<a/>') }]);
    await expect(extractZipEntry(zip, (n) => n === 'CORPCODE.xml', 1024)).rejects.toBeInstanceOf(ZipError);
    const big = makeZip([{ name: 'CORPCODE.xml', data: new Uint8Array(4096) }]);
    await expect(extractZipEntry(big, () => true, 1024)).rejects.toThrow(/상한/);
    await expect(extractZipEntry(utf8('not a zip at all, definitely not'), () => true, 1024)).rejects.toBeInstanceOf(
      ZipError,
    );
    expect(looksLikeZip(utf8('<result>'))).toBe(false);
  });
});

describe('OpenDART 고유번호', () => {
  it('행을 읽는다 — 비상장의 공백 종목코드는 null, 엔티티는 풀고, 형식이 틀린 행은 건너뛴다', () => {
    const { rows, skipped } = parseCorpCodeXml(CORPCODE_XML);
    expect(skipped).toBe(1);
    expect(rows).toEqual([
      { corp_code: '00126380', corp_name: '삼성전자', stock_code: '005930', modify_date: '20250102' },
      { corp_code: '00164779', corp_name: 'SK하이닉스', stock_code: '000660', modify_date: '20241231' },
      { corp_code: '00434003', corp_name: '다코', stock_code: null, modify_date: '20170630' },
      // 영문이 섞인 새 단축코드도 종목코드다.
      { corp_code: '01980000', corp_name: '에이&비 100%_테크', stock_code: '0010V0', modify_date: '20260115' },
    ]);
  });

  it('DOCTYPE·ENTITY 가 있는 문서는 읽지 않는다(외부 엔티티를 풀지 않는다)', () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><result><list><corp_code>00000001</corp_code><corp_name>&x;</corp_name><stock_code>000001</stock_code><modify_date>20260101</modify_date></list></result>`;
    expect(() => parseCorpCodeXml(evil)).toThrow(/DOCTYPE/);
  });

  it('ZIP 을 받아 행으로 — 키 오류면 ZIP 대신 온 본문의 status 로 갈래를 정한다', async () => {
    const zip = makeZip([{ name: 'CORPCODE.xml', data: utf8(CORPCODE_XML) }]);
    expect((await corpCodesFromZip(zip)).rows).toHaveLength(4);

    const ok = scriptedFetch([() => new Response(zip, { status: 200 })]);
    const result = await downloadCorpCodes('test-key', ok.impl);
    expect(result.rows).toHaveLength(4);
    expect(ok.urls[0]!.pathname).toBe('/api/corpCode.xml');
    expect(ok.urls[0]!.searchParams.get('crtfc_key')).toBe('test-key');

    const bad = scriptedFetch([() => new Response(fixture('dart-corpcode-010.xml'), { status: 200 })]);
    const err = await downloadCorpCodes('wrong', bad.impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BriefingSourceError);
    expect((err as BriefingSourceError).kind).toBe('key_invalid');
    expect((err as BriefingSourceError).detail).toBe('key_unregistered');
    // ⚠ 오류 메시지에 키가 실리지 않는다.
    expect(String((err as Error).message)).not.toContain('wrong');
  });
});

describe('OpenDART 상태 코드', () => {
  it.each([
    ['000', { ok: true, empty: false }],
    ['013', { ok: true, empty: true }],
    ['020', { ok: false, kind: 'rate_limited', detail: 'rate_limited' }],
    ['010', { ok: false, kind: 'key_invalid', detail: 'key_unregistered' }],
    ['011', { ok: false, kind: 'key_invalid', detail: 'key_unusable' }],
    ['012', { ok: false, kind: 'key_invalid', detail: 'ip_denied' }],
    ['901', { ok: false, kind: 'key_invalid', detail: 'account_expired' }],
    ['800', { ok: false, kind: 'maintenance', detail: 'maintenance' }],
    ['900', { ok: false, kind: 'failed', detail: 'undefined_error' }],
    ['100', { ok: false, kind: 'failed', detail: 'bad_request' }],
    ['777', { ok: false, kind: 'failed', detail: 'unknown_status' }],
  ])('%s', (status, expected) => {
    expect(classifyDartStatus(status)).toEqual(expected);
  });
});

describe('OpenDART 공시 검색', () => {
  const base = { apiKey: 'k', corpCode: '00126380', bgnDe: '20261020', endDe: '20261026' };

  it('페이지를 넘겨 모으고, 남의 기업·형식이 틀린 행은 버린다', async () => {
    const f = scriptedFetch([json(fixture('dart-list-page1.json')), json(fixture('dart-list-page2.json'))]);
    const result = await fetchDartDisclosures({ ...base, fetchImpl: f.impl });
    expect(result.complete).toBe(true);
    expect(result.items.map((i) => i.rceptNo)).toEqual(['20261026000123', '20261023000456', '20261021000789']);
    expect(f.urls.map((u) => u.searchParams.get('page_no'))).toEqual(['1', '2']);
    expect(f.urls[0]!.searchParams.get('page_count')).toBe('100');
    expect(f.urls[0]!.searchParams.get('bgn_de')).toBe('20261020');
    expect(f.urls[0]!.searchParams.get('end_de')).toBe('20261026');
    expect(f.urls[0]!.searchParams.get('corp_code')).toBe('00126380');
  });

  it('쪽 상한에 닿으면 잘린 것으로 말한다(complete: false)', async () => {
    const f = scriptedFetch([json(fixture('dart-list-page1.json'))]);
    const result = await fetchDartDisclosures({ ...base, fetchImpl: f.impl, maxPages: 1 });
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(2);
  });

  it('013 은 실패가 아니라 빈 목록이다', async () => {
    const f = scriptedFetch([json(fixture('dart-list-013.json'))]);
    expect(await fetchDartDisclosures({ ...base, fetchImpl: f.impl })).toEqual({ items: [], complete: true });
  });

  it('020 은 요청 한도, 전송 실패는 failed/transport 로 던진다 — 빈 목록으로 바꾸지 않는다', async () => {
    const limited = scriptedFetch([json(fixture('dart-list-020.json'))]);
    await expect(fetchDartDisclosures({ ...base, fetchImpl: limited.impl })).rejects.toMatchObject({
      kind: 'rate_limited',
      sourceStatus: '020',
    });
    const broken = async () => {
      throw new TypeError('network down');
    };
    await expect(fetchDartDisclosures({ ...base, fetchImpl: broken })).rejects.toMatchObject({
      kind: 'failed',
      detail: 'transport',
    });
    const html = scriptedFetch([() => new Response('<html>점검</html>', { status: 200 })]);
    await expect(fetchDartDisclosures({ ...base, fetchImpl: html.impl })).rejects.toMatchObject({ detail: 'parse' });
  });

  it('행 → 공시: 접수 날짜만(시각을 지어내지 않는다), 원문 링크는 접수번호로', () => {
    const item = mapDartListItem({
      corp_code: '00126380',
      corp_name: '삼성전자',
      report_nm: '[기재정정]사업보고서 (2025.12)',
      rcept_no: '20261026000123',
      rcept_dt: '20261026',
      rm: '유정',
    });
    expect(item).toMatchObject({
      receiptDate: '2026-10-26',
      url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261026000123',
    });
    expect(Object.keys(item!)).not.toContain('receiptAt');
    expect(mapDartListItem({ ...item, rcept_dt: '20261332' })).toBeNull();
  });

  it('비고(rm)와 보고서명의 정정 표시를 깃발로 푼다', () => {
    expect(dartRemarkFlags('유정', '[기재정정]사업보고서')).toEqual({
      amended_report: true,
      corrected_later: true,
      withdrawn: false,
      consolidated: false,
      ftc: false,
      market: 'kospi',
    });
    expect(dartRemarkFlags('코연', '분기보고서')).toMatchObject({ market: 'kosdaq', consolidated: true, amended_report: false });
    expect(dartRemarkFlags('철', '[첨부정정]주요사항보고서')).toMatchObject({ withdrawn: true, amended_report: true, market: null });
    expect(dartRemarkFlags('넥공', '대규모기업집단현황공시')).toMatchObject({ market: 'konex', ftc: true });
    expect(dartRemarkFlags('', '증권신고서')).toMatchObject({ market: null, corrected_later: false });
  });
});

describe('정책브리핑 정책뉴스', () => {
  it('항목을 읽는다 — 삭제(D)는 따로, 정책브리핑이 아닌 원문 주소는 버리고, http 는 https 로', () => {
    const { items, deletedIds } = parsePolicyNewsXml(fixture('policy-news-list.xml'));
    expect(deletedIds).toEqual(['148940000']);
    expect(items.map((i) => i.id)).toEqual(['148950001', '148950002']);
    const first = items[0]!;
    expect(first).toMatchObject({
      title: '청년 주거 지원 & 전세 대출 기준 완화',
      organization: '국토교통부',
      publishedDate: '2026-10-26',
      publishedAt: '2026-10-26T09:00:00+09:00',
      url: 'https://www.korea.kr/news/policyNewsView.do?newsId=148950001',
    });
    // 부제가 있으면 부제가 요약이다.
    expect(items[1]!.summary).toBe('오는 11월 말까지 온라인으로 신청');
  });

  it('본문 HTML 은 글자로만 — 스크립트·이미지·태그가 남지 않고 요약은 짧다', () => {
    const { items } = parsePolicyNewsXml(fixture('policy-news-list.xml'));
    const summary = items[0]!.summary;
    expect(summary).not.toMatch(/[<>]/);
    expect(summary).not.toContain('alert');
    expect(summary).not.toContain('photo.jpg');
    expect(summary.startsWith('국토교통부는 26일 청년 전세 대출의 소득 기준을 완화한다고 밝혔다.')).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(120);
    // 이미지 주소는 항목 어디에도 실리지 않는다(다시 싣지 않는다).
    expect(JSON.stringify(items)).not.toMatch(/\.jpg/);
  });

  it('게이트웨이 오류 봉투를 갈래로 — 30 은 키, 22 는 한도', () => {
    expect(() => parsePolicyNewsXml(fixture('policy-news-key-error.xml'))).toThrow(
      expect.objectContaining({ kind: 'key_invalid', sourceStatus: '30' }),
    );
    expect(() => parsePolicyNewsXml(fixture('policy-news-limit.xml'))).toThrow(
      expect.objectContaining({ kind: 'rate_limited', sourceStatus: '22' }),
    );
    expect(() => parsePolicyNewsXml('<html>오류</html>')).toThrow(expect.objectContaining({ detail: 'parse' }));
    expect(() => parsePolicyNewsXml('<!DOCTYPE x><response/>')).toThrow(expect.objectContaining({ detail: 'parse' }));
  });

  it('NODATA(03)는 빈 목록이다', () => {
    const xml = '<response><header><resultCode>03</resultCode><resultMsg>NODATA_ERROR</resultMsg></header></response>';
    expect(parsePolicyNewsXml(xml)).toEqual({ items: [], deletedIds: [] });
  });

  it('요청 인자 — 키와 기간(YYYYMMDD). RSS 주소를 부르지 않는다', async () => {
    const f = scriptedFetch([() => new Response(fixture('policy-news-list.xml'), { status: 200 })]);
    await fetchPolicyNews({ serviceKey: 'svc', startDate: '20261025', endDate: '20261026', fetchImpl: f.impl });
    const url = f.urls[0]!;
    expect(url.hostname).toBe('apis.data.go.kr');
    expect(url.pathname).toBe('/1371000/policyNewsService/policyNewsList');
    expect(url.searchParams.get('serviceKey')).toBe('svc');
    expect(url.searchParams.get('startDate')).toBe('20261025');
    expect(url.searchParams.get('endDate')).toBe('20261026');
    expect(url.toString()).not.toMatch(/rss/i);
  });

  it('날짜 모양 몇 가지만 받고, 시각이 없으면 지어내지 않는다', () => {
    expect(parsePolicyNewsDate('10/26/2026 09:00:00')).toEqual({ date: '2026-10-26', at: '2026-10-26T09:00:00+09:00' });
    expect(parsePolicyNewsDate('2026-10-26 18:05')).toEqual({ date: '2026-10-26', at: '2026-10-26T18:05:00+09:00' });
    expect(parsePolicyNewsDate('20261026')).toEqual({ date: '2026-10-26', at: null });
    expect(parsePolicyNewsDate('2026-02-30')).toBeNull();
    expect(parsePolicyNewsDate('어제')).toBeNull();
  });

  it('원문 주소는 korea.kr 만', () => {
    expect(policyNewsSourceUrl('https://www.korea.kr/news/x')).toBe('https://www.korea.kr/news/x');
    expect(policyNewsSourceUrl('https://korea.kr.evil.com/x')).toBeNull();
    expect(policyNewsSourceUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('글자 도구', () => {
  it('HTML → 글자, 자르기는 서러게이트 쌍을 가르지 않는다', () => {
    expect(htmlToText('<p>a&amp;b</p><style>x{}</style><b>c</b>&#x1F600;')).toBe('a&b c😀');
    const cut = truncateText(`${'가'.repeat(8)}😀😀`, 10);
    expect(cut.length).toBeLessThanOrEqual(10);
    expect(cut).toBe(`${'가'.repeat(8)}…`);
  });
});

describe('낭독 문단', () => {
  const disclosure: BriefingDisclosure = {
    source: 'opendart',
    id: '20261026000123',
    corp_code: '00126380',
    corp_name: '삼성전자',
    report_name: '[기재정정]사업보고서 (2025.12)',
    receipt_date: '2026-10-26',
    remarks: '유정',
    flags: dartRemarkFlags('유정', '[기재정정]사업보고서 (2025.12)'),
    url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261026000123',
    fetched_at: '2026-10-26T00:00:00.000Z',
  };
  const news: BriefingPolicyNews = {
    source: 'policy_news',
    id: '148950001',
    title: '청년 주거 지원 & 전세 대출 기준 완화',
    summary: '',
    organization: '국토교통부',
    published_date: '2026-10-26',
    published_at: null,
    url: 'https://www.korea.kr/news/policyNewsView.do?newsId=148950001',
    fetched_at: '2026-10-26T00:00:00.000Z',
  };

  it('공시: 확인한 날짜·기업·보고서명·원문 안내', () => {
    expect(composeBriefingSpeech(disclosure, '2026-10-26')).toBe(
      '10월 26일 확인한 삼성전자의 공시입니다. 보고서명은 기재정정 사업보고서 (2025.12)입니다. 자세한 내용은 원문에서 확인해주세요.',
    );
    // Date 는 한국 날짜로 읽는다 — UTC 10/25 15:30 은 한국 10/26 00:30.
    expect(composeBriefingSpeech(disclosure, new Date('2026-10-25T15:30:00Z'))).toMatch(/^10월 26일 /);
  });

  it('철회된 공시는 철회됐다고 말한다', () => {
    const withdrawn = { ...disclosure, flags: { ...disclosure.flags, withdrawn: true } };
    expect(composeBriefingSpeech(withdrawn, '2026-10-26')).toContain('이 공시는 철회되었습니다.');
  });

  it('정책뉴스: 제목만, 원문 안내', () => {
    expect(composeBriefingSpeech(news, '2026-10-26')).toBe(
      '10월 26일 확인한 정책브리핑 정책뉴스입니다. 제목은 청년 주거 지원 & 전세 대출 기준 완화입니다. 자세한 내용은 원문에서 확인해주세요.',
    );
  });

  it('언제나 200자 이하 — 긴 이름은 잘라 내되 끝맺음 문장은 지킨다. 전망·단정의 말은 넣지 않는다', () => {
    const long = { ...disclosure, corp_name: '가'.repeat(80), report_name: '나'.repeat(300) };
    const longNews = { ...news, title: `${'다'.repeat(250)}😀` };
    for (const text of [composeBriefingSpeech(long, '2026-10-26'), composeBriefingSpeech(longNews, '2026-10-26')]) {
      expect(text.length).toBeLessThanOrEqual(BRIEFING_SPEECH_MAX);
      expect(text.endsWith('자세한 내용은 원문에서 확인해주세요.')).toBe(true);
      expect(text).not.toMatch(/최신|새로운|전망|예상|추천|매수|매도|주가/);
      // 서러게이트 쌍의 반쪽이 남지 않는다.
      expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});
