import { describe, expect, it } from 'vitest';

import {
  checkBannedPromises,
  checkCandidateId,
  checkKoreanRegister,
  checkLanguage,
  checkMaxLength,
  checkNoMarkup,
  checkNonEmpty,
  checkNumbersPreserved,
  checkRecentExcluded,
  checkRequiredPhrases,
  extractNumbers,
  hasTypedLaughter,
  koreanEndings,
  maxLengthFor,
  MANUAL_TEXT_MAX_LENGTH,
  runRules,
  spokenText,
} from '../../text-quality/rules.ts';
import type { EvalItem } from '../../text-quality/types.ts';

describe('spokenText', () => {
  it('태그를 벗기고 공백을 접는다', () => {
    expect(spokenText('[laughs]  일어나   [whispers] 지금')).toBe('일어나 지금');
  });
});

describe('checkNonEmpty', () => {
  it('출력이 없거나 낭독할 글자가 없으면 실패', () => {
    expect(checkNonEmpty(null).status).toBe('fail');
    expect(checkNonEmpty('').status).toBe('fail');
    expect(checkNonEmpty('   ').status).toBe('fail');
    expect(checkNonEmpty('!!…').status).toBe('fail');
    expect(checkNonEmpty('[laughs]').status).toBe('fail');
  });
  it('글자나 숫자가 있으면 통과', () => {
    expect(checkNonEmpty('일어나').status).toBe('pass');
    expect(checkNonEmpty('7:30').status).toBe('pass');
  });
});

describe('checkMaxLength', () => {
  it('직접 입력 상한은 200자다', () => {
    expect(MANUAL_TEXT_MAX_LENGTH).toBe(200);
    expect(maxLengthFor('manual')).toBe(200);
    expect(maxLengthFor('generated')).toBe(200);
  });
  it('프리셋은 면제(skip)', () => {
    expect(maxLengthFor('preset')).toBeNull();
    expect(checkMaxLength('가'.repeat(300), null).status).toBe('skip');
  });
  it('경계 — 200 통과, 201 실패', () => {
    expect(checkMaxLength('가'.repeat(200), 200).status).toBe('pass');
    expect(checkMaxLength('가'.repeat(201), 200).status).toBe('fail');
  });
  it('태그는 길이에 세지 않는다', () => {
    expect(checkMaxLength(`[laughs] ${'가'.repeat(200)}`, 200).status).toBe('pass');
  });
});

describe('hasTypedLaughter', () => {
  it.each([
    'ㅋㅋ 일어나',
    '좋아ㅎㅎ',
    'haha wake up',
    'skip leg day lol',
    'www',
    'がんばろう（笑）',
  ])('%s 은 웃음', (t) => {
    expect(hasTypedLaughter(t)).toBe(true);
  });
  it.each(['ㅇㅋ 알겠어', '일어나', 'hello'])('%s 은 웃음 아님', (t) => {
    expect(hasTypedLaughter(t)).toBe(false);
  });
});

describe('checkNoMarkup', () => {
  it('SSML·HTML 태그', () => {
    const r = checkNoMarkup('<speak>일어나<break time="1s"/></speak>', '일어나');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('SSML');
  });
  it('마크다운', () => {
    expect(checkNoMarkup('**일어나**', '일어나').status).toBe('fail');
    expect(checkNoMarkup('# 알람', '알람').status).toBe('fail');
  });
  it('입력에 없던 대괄호 태그와 지문 괄호', () => {
    expect(checkNoMarkup('[cheerfully] 일어나', '일어나').status).toBe('fail');
    expect(checkNoMarkup('(웃으며) 일어나', '일어나').status).toBe('fail');
  });
  it('입력에 있던 대괄호·괄호는 사용자의 글이라 허용', () => {
    expect(checkNoMarkup('[whispers] 일어날 시간이야', '[whispers] 일어날 시간이야').status).toBe(
      'pass',
    );
    expect(
      checkNoMarkup('경비실 들르기 (오후 6시 전까지)', '경비실 들르기 (오후 6시 전까지)').status,
    ).toBe('pass');
  });
  it('글자 웃음이 있던 입력은 [laughs] 를 허용', () => {
    expect(checkNoMarkup('[laughs] 아직도 자?', 'ㅋㅋ 아직도 자?').status).toBe('pass');
    expect(checkNoMarkup('[laughs] 아직도 자?', '아직도 자?').status).toBe('fail');
  });
  it('입력에 없던 이모지', () => {
    expect(checkNoMarkup('일어나 😊', '일어나').status).toBe('fail');
    expect(checkNoMarkup('선물 사기 🎁', '선물 사기 🎁').status).toBe('pass');
  });
  it('출력이 없으면 skip', () => {
    expect(checkNoMarkup(null, '일어나').status).toBe('skip');
  });
});

describe('extractNumbers / checkNumbersPreserved', () => {
  it('앞자리 0 과 전각 숫자를 정규화한다', () => {
    expect(extractNumbers('07:05 ７時')).toEqual(['7', '5', '7']);
  });
  it("'7시 30분' 이 남으면 통과(번역 '7:30' 도 같다)", () => {
    expect(checkNumbersPreserved('7시 30분이야', '7시 30분이야').status).toBe('pass');
    expect(checkNumbersPreserved("It's 7:30.", '7시 30분이야').status).toBe('pass');
  });
  it('숫자가 빠지거나 바뀌면 실패', () => {
    const r = checkNumbersPreserved('7시야', '7시 30분이야');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('30');
    expect(checkNumbersPreserved('8시 30분', '7시 30분').status).toBe('fail');
  });
  it('개수까지 본다', () => {
    expect(checkNumbersPreserved('2알', '1알, 2알').status).toBe('fail');
  });
  it('출력에만 있는 숫자는 detail 에만', () => {
    const r = checkNumbersPreserved('7시 30분, 2개', '7시 30분');
    expect(r.status).toBe('pass');
    expect(r.detail).toContain('2');
  });
  it('입력에 숫자가 없거나 끈 문항은 skip', () => {
    expect(checkNumbersPreserved('일어나', '일어나').status).toBe('skip');
    expect(checkNumbersPreserved('일어나', '7시', false).status).toBe('skip');
  });
});

describe('checkRequiredPhrases', () => {
  it('공백을 접어 비교한다', () => {
    expect(checkRequiredPhrases('7시  30분이야', ['7시 30분']).status).toBe('pass');
    expect(checkRequiredPhrases('7시 반이야', ['7시 30분']).status).toBe('fail');
    expect(checkRequiredPhrases('아무거나', undefined).status).toBe('skip');
  });
});

describe('checkLanguage', () => {
  it('허용 언어로 판정되면 통과', () => {
    expect(checkLanguage('일어나', ['ko']).status).toBe('pass');
    expect(checkLanguage('Wake up', ['en']).status).toBe('pass');
    expect(checkLanguage('起きてね', ['ja']).status).toBe('pass');
  });
  it('다른 언어로 판정되면 실패', () => {
    expect(checkLanguage('Wake up', ['ko']).status).toBe('fail');
    expect(checkLanguage('일어나', ['en']).status).toBe('fail');
  });
  it('한국어 줄에 가나가 섞이면 실패', () => {
    expect(checkLanguage('일어나 おはよう', ['ko']).status).toBe('fail');
  });
  it('영어 줄의 호칭은 빼고 판정할 수 있다', () => {
    expect(checkLanguage('Wake up, 민지!', ['en']).status).toBe('fail');
    expect(checkLanguage('Wake up, 민지!', ['en'], ['민지']).status).toBe('pass');
  });
});

describe('checkCandidateId', () => {
  const candidates = [
    { id: 'ko-weather-01', text: 'a' },
    { id: 'ko-weather-02', text: 'b' },
  ];
  it('후보 안의 id 는 통과', () => {
    expect(checkCandidateId('ko-weather-02', candidates).status).toBe('pass');
  });
  it('없는 id·null 은 실패', () => {
    expect(checkCandidateId('ko-weather-09', candidates).status).toBe('fail');
    expect(checkCandidateId(null, candidates).status).toBe('fail');
  });
  it('후보 목록 자체의 중복·형식 오류도 실패', () => {
    expect(
      checkCandidateId('a', [
        { id: 'a', text: '' },
        { id: 'a', text: '' },
      ]).detail,
    ).toContain('중복');
    expect(checkCandidateId('a b', [{ id: 'a b', text: '' }]).detail).toContain('형식');
  });
  it('선택 문항이 아니면 skip', () => {
    expect(checkCandidateId(null, undefined).status).toBe('skip');
  });
});

describe('checkRecentExcluded', () => {
  const c = ['c1', 'c2', 'c3', 'c4'].map((id) => ({ id, text: id }));
  it('최근 N개(최신이 앞) 안을 고르면 실패', () => {
    expect(checkRecentExcluded('c2', c, ['c3', 'c2', 'c1'], 2).status).toBe('fail');
  });
  it('N 밖은 통과 — 더 오래된 것은 다시 골라도 된다', () => {
    expect(checkRecentExcluded('c1', c, ['c3', 'c2', 'c1'], 2).status).toBe('pass');
    expect(checkRecentExcluded('c4', c, ['c3', 'c2', 'c1'], 2).status).toBe('pass');
  });
  it('후보가 전부 최근 N개 안이면 skip', () => {
    expect(checkRecentExcluded('c1', c.slice(0, 2), ['c1', 'c2'], 2).status).toBe('skip');
  });
  it('기록·창이 없으면 skip, 고른 것이 없으면 실패', () => {
    expect(checkRecentExcluded('c1', c, [], 2).status).toBe('skip');
    expect(checkRecentExcluded('c1', c, ['c1'], 0).status).toBe('skip');
    expect(checkRecentExcluded(null, c, ['c1'], 1).status).toBe('fail');
  });
});

describe('koreanEndings / checkKoreanRegister', () => {
  it('문장 끝 어체를 읽는다', () => {
    expect(koreanEndings('일어나요. 늦겠어!').map((e) => e.kind)).toEqual(['polite', 'banmal']);
    expect(koreanEndings('출근 시간입니다.').map((e) => e.kind)).toEqual(['polite']);
  });
  it('한 낱말 부름말과 조사로 끝난 마디는 건너뛴다', () => {
    expect(koreanEndings('민지야! 일어나요.').map((e) => e.kind)).toEqual(['polite']);
    expect(koreanEndings('들르기 (오후 6시 전까지)')).toEqual([]);
  });
  it('장식(이모지·ㅋㅋ·물결)을 걷고 읽는다', () => {
    expect(koreanEndings('일어나요😊').map((e) => e.kind)).toEqual(['polite']);
    expect(koreanEndings('일어나자~ㅋㅋ').map((e) => e.kind)).toEqual(['banmal']);
  });
  it('섞이면 실패', () => {
    const r = checkKoreanRegister('비 온대요. 우산 챙겨.', 'ko');
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('섞임');
  });
  it('기대 어체와 다르면 실패', () => {
    expect(checkKoreanRegister('약 먹을 시간이야.', 'ko', 'polite').status).toBe('fail');
    expect(checkKoreanRegister('약 드실 시간이에요.', 'ko', 'banmal').status).toBe('fail');
    expect(checkKoreanRegister('약 드실 시간이에요.', 'ko', 'polite').status).toBe('pass');
  });
  it('어미를 못 읽으면 통과(판정 보류), 한국어가 아니면 skip', () => {
    expect(checkKoreanRegister('9시 20분 병원 예약', 'ko').status).toBe('pass');
    expect(checkKoreanRegister('Wake up', 'en').status).toBe('skip');
  });
});

describe('checkBannedPromises', () => {
  it('건강·운세·수익 약속을 잡는다', () => {
    expect(checkBannedPromises('이 약 먹으면 완치될 거예요', '약 먹을 시간').detail).toContain(
      'health',
    );
    expect(checkBannedPromises('오늘 로또 당첨될 거야', '재물운 좋음').status).toBe('fail');
    expect(checkBannedPromises('You will win the lottery today', 'fortune').detail).toContain(
      'fortune',
    );
    expect(checkBannedPromises('今日は必ず儲かるよ', '金運').detail).toContain('revenue');
  });
  it('입력에 이미 있던 말은 사용자의 글이라 보지 않는다', () => {
    expect(checkBannedPromises('로또 사러 가자', '로또 사러 가자').status).toBe('pass');
  });
  it("라틴 낱말은 낱말 경계로 본다('secure' 는 'cure' 가 아니다)", () => {
    expect(checkBannedPromises('Keep your bag secure.', 'bag').status).toBe('pass');
  });
});

describe('runRules', () => {
  it('규칙 열 개를 언제나 같은 순서로 돌려준다', () => {
    const item: EvalItem = {
      id: 'x',
      set: 'ko',
      kind: 'manual',
      targetLanguage: 'ko',
      input: '7시야',
    };
    const rules = runRules(item, { text: '7시야', selectedId: null }).map((r) => r.rule);
    expect(rules).toEqual([
      'non_empty',
      'max_length',
      'no_markup',
      'numbers_preserved',
      'required_phrases',
      'language',
      'candidate_id',
      'recent_excluded',
      'korean_register',
      'banned_promise',
    ]);
  });
});
