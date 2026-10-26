// 알람 문구 오프라인 평가 도구의 자료 모양. 운영 요청 경로와 이어지지 않는다 — 비교·평가 전용이다.

/** 평가 세트를 가르는 축 — 입력이 어느 언어로 쓰였는가. */
export type EvalSetId = 'ko' | 'en' | 'ja';

/**
 * 문항 종류.
 * - manual: 사용자가 직접 친 문구(상한 200자, 같은 언어면 운영은 Gemini 를 부르지 않는다)
 * - generated: 시드·상황에서 새로 만든 한 줄(사전렌더·동적 문구, 상한 200자)
 * - preset: 우리가 확정한 프리셋 문구(상한 면제 — `routes/tts.ts`)
 * - selection: 후보 중 하나를 고르는 변형 선택(최근 N개 제외 규칙)
 */
export type EvalItemKind = 'manual' | 'generated' | 'preset' | 'selection';

export type KoreanRegister = 'polite' | 'banmal' | 'consistent';

export type EvalCandidate = { id: string; text: string };

export type EvalExpectation = {
  /** 한국어 어체. 없으면 'consistent'(한 줄 안에서 섞이지만 않으면 된다). */
  register?: KoreanRegister;
  /** 출력에 그대로 남아야 하는 구절(공백은 접어서 비교). */
  mustContain?: string[];
  /** 입력의 숫자(시각·분·개수)가 출력에 남아야 하는가. 기본 true. */
  preserveNumbers?: boolean;
  /** 허용 언어. 기본 [targetLanguage]. */
  allowedLanguages?: string[];
  /** 언어 판정에서 빼는 고유명사(영어 문장 속 '민지' 같은 호칭). */
  allowedForeignTerms?: string[];
};

export type EvalItem = {
  id: string;
  /** 입력 언어. 세트를 고르는 기준이다. */
  set: EvalSetId;
  kind: EvalItemKind;
  /** 사용자가 친 글 / 생성 시드 / 프리셋 원문 / (선택 문항은 상황 설명). */
  input: string;
  targetLanguage: string;
  candidates?: EvalCandidate[];
  /** 최근에 쓴 후보 id — **최신이 앞**이다. */
  recent?: string[];
  /** 최근 몇 개를 제외하는가(N). */
  recentWindow?: number;
  expect?: EvalExpectation;
  note?: string;
};

export type EvalSetFile = {
  _meta: { version: number; note: string };
  items: EvalItem[];
};

/** 제공자 한 번 호출의 결과. 재지 않은 값은 null 이다(0 으로 채우지 않는다). */
export type ProviderOutput = {
  text: string | null;
  selectedId: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
  /** 이 출력이 어디서 왔는가(fixture·로컬 사본·실제 API). */
  source: string;
};

export type RuleId =
  | 'non_empty'
  | 'max_length'
  | 'no_markup'
  | 'numbers_preserved'
  | 'required_phrases'
  | 'language'
  | 'candidate_id'
  | 'recent_excluded'
  | 'korean_register'
  | 'banned_promise';

export type RuleStatus = 'pass' | 'fail' | 'skip';

export type RuleResult = { rule: RuleId; status: RuleStatus; detail: string | null };
