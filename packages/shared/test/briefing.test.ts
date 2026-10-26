import { describe, it, expect } from 'vitest';
import {
  BRIEFING_MAX_INTERESTS,
  BriefingCompanySearchQuerySchema,
  BriefingInterestsPutSchema,
  CorpCodeSchema,
} from '../src/index';

describe('아침 소식 계약', () => {
  it('관심 기업은 최대 3개, 서로 달라야 한다', () => {
    expect(BRIEFING_MAX_INTERESTS).toBe(3);
    expect(BriefingInterestsPutSchema.safeParse({ corp_codes: [] }).success).toBe(true);
    expect(BriefingInterestsPutSchema.safeParse({ corp_codes: ['00126380', '00164779', '01980000'] }).success).toBe(true);
    expect(
      BriefingInterestsPutSchema.safeParse({ corp_codes: ['00126380', '00164779', '01980000', '00000001'] }).success,
    ).toBe(false);
    expect(BriefingInterestsPutSchema.safeParse({ corp_codes: ['00126380', '00126380'] }).success).toBe(false);
  });

  it('고유번호는 숫자 8자리(종목코드 6자리와 다르다)', () => {
    expect(CorpCodeSchema.safeParse('00126380').success).toBe(true);
    expect(CorpCodeSchema.safeParse('005930').success).toBe(false);
    expect(CorpCodeSchema.safeParse('0012638a').success).toBe(false);
  });

  it('검색어는 공백을 걷은 뒤 1~30자', () => {
    expect(BriefingCompanySearchQuerySchema.safeParse({ q: '  삼성 ' }).data).toEqual({ q: '삼성' });
    expect(BriefingCompanySearchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(BriefingCompanySearchQuerySchema.safeParse({ q: 'a'.repeat(31) }).success).toBe(false);
  });
});
