/**
 * **아침 소식**(관심 기업 공시 + 정책브리핑 정책뉴스) 요청·응답 계약.
 *
 * 백엔드 `routes/briefing.ts` 가 이 스키마로 요청을 검증하고 응답을 만든다. 규칙 전문은
 * `docs/spec/morning-briefing.md`.
 *
 * ⚠ **주가·투자 판단은 싣지 않는다.** 공시는 원천(OpenDART)이 준 제목·접수일·원문 링크까지만이고,
 * 정책뉴스도 제목·짧은 요약·원문 링크까지다. 요약·전망·추천을 만들어 붙이는 필드를 더하지 말 것.
 */
import { z } from 'zod';

/** 한 사람이 고를 수 있는 관심 기업 수. */
export const BRIEFING_MAX_INTERESTS = 3;

/** 기업 검색어 길이 상한(정리한 뒤 센다). 기업명은 이보다 짧다 — 긴 값은 조회까지 흘리지 않는다. */
export const BRIEFING_SEARCH_QUERY_MAX = 30;

/** 기업 검색 결과 상한. */
export const BRIEFING_SEARCH_LIMIT_MAX = 20;

/** OpenDART 고유번호 — 숫자 8자리. 종목코드(6자리)와 다른 값이다. */
export const CorpCodeSchema = z.string().regex(/^\d{8}$/, 'corp_code 는 숫자 8자리다');

/**
 * 기업 검색 쿼리. 검색어는 앞뒤 공백을 걷어 낸 뒤 1~30자다. 제어·제로폭·양방향 제어문자는 서버가 먼저 걷어 낸다
 * (`routes/briefing.ts`). `limit` 은 거절하지 않고 1~20 으로 잘라 쓴다(목록 엔드포인트 규약).
 */
export const BriefingCompanySearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(BRIEFING_SEARCH_QUERY_MAX),
});

export const BriefingCompanySchema = z.object({
  corp_code: CorpCodeSchema,
  corp_name: z.string(),
  /** 상장 종목코드. 캐시에는 상장사만 담으므로 검색 결과에서는 늘 있다(`docs/spec/morning-briefing.md` §2). */
  stock_code: z.string().nullable(),
});
export type BriefingCompany = z.infer<typeof BriefingCompanySchema>;

export const BriefingCompanySearchResponseSchema = z.object({
  companies: z.array(BriefingCompanySchema),
});

/**
 * 관심 기업 목록 **통째 교체**. 순서는 의미가 없고, 같은 기업을 두 번 넣으면 거절한다.
 * 빈 목록은 '관심 기업 없음' 이다(기능을 끈 상태와 같다).
 */
export const BriefingInterestsPutSchema = z
  .object({
    corp_codes: z.array(CorpCodeSchema).max(BRIEFING_MAX_INTERESTS),
  })
  .refine((body) => new Set(body.corp_codes).size === body.corp_codes.length, {
    message: '같은 기업이 두 번 들어 있다',
    path: ['corp_codes'],
  });
export type BriefingInterestsPut = z.infer<typeof BriefingInterestsPutSchema>;

export const BriefingInterestSchema = z.object({
  corp_code: CorpCodeSchema,
  /** 기업 캐시에서 빠진 기업(상장 폐지 등)이면 null — 고른 기록은 남긴다. */
  corp_name: z.string().nullable(),
  stock_code: z.string().nullable(),
  created_at: z.string(),
});

export const BriefingInterestsResponseSchema = z.object({
  interests: z.array(BriefingInterestSchema).max(BRIEFING_MAX_INTERESTS),
});

/** 공시 비고(`rm`)를 풀어 쓴 것. 원문 글자는 `remarks` 에 그대로 둔다. */
export const BriefingDisclosureFlagsSchema = z.object({
  /** 보고서명이 `[기재정정]`·`[첨부정정]` 처럼 **이 보고서 자체가 정정본**이다. */
  amended_report: z.boolean(),
  /** 비고 `정` — 이 보고서를 낸 뒤 **정정 신고가 따로 있었다**. */
  corrected_later: z.boolean(),
  /** 비고 `철` — 이 보고서는 **철회됐다**. */
  withdrawn: z.boolean(),
  /** 비고 `연` — 연결 재무 부분을 포함한다. */
  consolidated: z.boolean(),
  /** 비고 `공` — 공정거래위원회 공시. */
  ftc: z.boolean(),
  /** 비고 `유`·`코`·`넥`·`채` — 소관 시장. 없으면 null. */
  market: z.enum(['kospi', 'kosdaq', 'konex', 'bond']).nullable(),
});
export type BriefingDisclosureFlags = z.infer<typeof BriefingDisclosureFlagsSchema>;

/** 날짜만(`YYYY-MM-DD`, 한국 시각). */
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const BriefingDisclosureSchema = z.object({
  source: z.literal('opendart'),
  /** 접수번호(`rcept_no`, 14자리) — 원천이 정한 안정 id. */
  id: z.string().regex(/^\d{14}$/),
  corp_code: CorpCodeSchema,
  corp_name: z.string(),
  report_name: z.string(),
  /**
   * 접수 **날짜**(`rcept_dt`). ⚠ 시각은 원천이 주지 않는다 — 시각을 지어 붙이지 말 것.
   */
  receipt_date: IsoDateSchema,
  remarks: z.string(),
  flags: BriefingDisclosureFlagsSchema,
  /** DART 원문 보기(`dart.fss.or.kr/dsaf001/main.do?rcpNo=`). */
  url: z.string().url(),
  /** 이 내용으로 처음 받아 둔 시각(ISO). */
  fetched_at: z.string(),
});
export type BriefingDisclosure = z.infer<typeof BriefingDisclosureSchema>;

export const BriefingPolicyNewsSchema = z.object({
  source: z.literal('policy_news'),
  id: z.string(),
  title: z.string(),
  /** 본문에서 뽑은 짧은 **글자** 요약(HTML 없음). 화면은 글자로만 그린다. */
  summary: z.string(),
  /** 담당 부처. 원천이 주지 않으면 null. */
  organization: z.string().nullable(),
  /** 게시 날짜(한국 시각). */
  published_date: IsoDateSchema,
  /** 원천이 시각까지 줬을 때만 ISO(+09:00). 없으면 null — 지어 붙이지 않는다. */
  published_at: z.string().nullable(),
  url: z.string().url(),
  fetched_at: z.string(),
});
export type BriefingPolicyNews = z.infer<typeof BriefingPolicyNewsSchema>;

export const BRIEFING_SOURCES = ['opendart', 'policy_news'] as const;
export type BriefingSource = (typeof BRIEFING_SOURCES)[number];

/**
 * 원천 하나(또는 공시의 기업 하나)를 이번에 확인하지 못한 이유. `code` 는 에러 코드 목록의 값이다
 * (`BRIEFING_SOURCE_*`) — 앱은 이 코드로 "확인하지 못했어요" 류의 문구를 고른다.
 */
export const BriefingSourceErrorSchema = z.object({
  source: z.enum(BRIEFING_SOURCES),
  code: z.string(),
  corp_code: CorpCodeSchema.optional(),
  retry_after_seconds: z.number().int().positive().optional(),
});
export type BriefingSourceError = z.infer<typeof BriefingSourceErrorSchema>;

/**
 * 관심 기업마다 이번 응답의 상태.
 *  - `ok`: 15분 안에 원천에 물어 성공했다 — 공시가 없으면 **정말 없는 것**이다.
 *  - `stale`: 이번에 확인하지 못해 전에 받아 둔 것을 보여 준다(`fetched_at` 이 그때).
 *  - `unavailable`: 한 번도 확인하지 못했다 — "공시가 없다" 로 읽으면 안 된다.
 */
export const BriefingCompanyStatusSchema = z.object({
  corp_code: CorpCodeSchema,
  corp_name: z.string().nullable(),
  status: z.enum(['ok', 'stale', 'unavailable']),
  fetched_at: z.string().nullable(),
});

export const BriefingTodayResponseSchema = z.object({
  /** 공시를 찾은 범위(한국 날짜, 양끝 포함). */
  window: z.object({ from: IsoDateSchema, to: IsoDateSchema }),
  companies: z.array(BriefingCompanyStatusSchema),
  disclosures: z.array(BriefingDisclosureSchema),
  policy_news: z.array(BriefingPolicyNewsSchema),
  /** 보여 주는 것 가운데 **가장 오래된** 확인 시각. 아무것도 확인한 적 없으면 null. */
  fetched_at: z.string().nullable(),
  /** 하나라도 이번에 확인하지 못해 전에 받아 둔 것을 보여 주고 있다. */
  stale: z.boolean(),
  /** 모든 원천·기업을 이번 창(15분) 안에 확인했고 잘린 것도 없다. false 면 "새 공시 없음" 이라고 말하지 않는다. */
  complete: z.boolean(),
  errors: z.array(BriefingSourceErrorSchema),
});
export type BriefingTodayResponse = z.infer<typeof BriefingTodayResponseSchema>;
