// 제공자 어댑터 — 평가 대상 모델을 한 모양(`EvalProvider`)으로 감싼다.
//
// ⚠ 운영 요청 경로(백엔드 라우트·크론)에서 이 파일을 부르지 말 것. 비교·평가 전용이다.
// ⚠ 실제 API 를 부르는 어댑터는 키가 없으면 **부르기 전에** 'not_configured' 로 서 있어야 한다 — 러너가
//   그걸 보고 fixture 검사로 물러나며 보고서에 '실제 API 평가 미실행' 을 적는다.

import type { EvalItem, ProviderOutput } from './types.ts';

export type ProviderStatus = 'ready' | 'not_configured';

export interface EvalProvider {
  readonly id: string;
  /** 실제 외부 API 를 부르는가. fixture·로컬 사본은 false. */
  readonly live: boolean;
  readonly status: ProviderStatus;
  /** not_configured 일 때 이유(보고서에 그대로 실린다). */
  readonly statusReason: string | null;
  generate(item: EvalItem): Promise<ProviderOutput>;
}

// ---------------------------------------------------------------- current

/**
 * 운영 파이프라인이 낸 출력을 담은 fixture. 키는 문항 id.
 * `_meta.source` 에 **어디서 받은 출력인지** 적는다 — 손으로 쓴 견본인지, 실제로 받아 둔 것인지.
 */
export type CurrentOutputsFixture = {
  _meta: { source: string; capturedAt: string | null; note?: string };
  outputs: Record<
    string,
    {
      text?: string | null;
      selectedId?: string | null;
      costUsd?: number | null;
      latencyMs?: number | null;
    }
  >;
};

/**
 * 운영 경로 가운데 **네트워크 없이 그대로 재현되는 것**: 같은 언어 직접 입력과 프리셋은 Gemini 를 부르지 않고
 * 원문을 그대로 합성한다(`prepareAlarmTextWithVertex` 의 번역 없는 갈래 — 2026-09-30, 프리셋은 `systemStockTexts`).
 * 그 갈래의 앞뒤 공백 정리만 옮겼다. 글자 웃음(ㅋㅋ) → `[laughs]` 변환은 옮기지 않았다 — 규칙 검사는 그 태그를
 * 허용하므로 판정은 같다.
 */
export function currentLocalPassthrough(item: EvalItem): string | null {
  const sameLanguage = item.set === item.targetLanguage;
  if ((item.kind === 'manual' && sameLanguage) || item.kind === 'preset') return item.input.trim();
  return null;
}

export function createCurrentProvider(fixture: CurrentOutputsFixture | null): EvalProvider {
  return {
    id: 'current',
    live: false,
    status: 'ready',
    statusReason: null,
    async generate(item) {
      const local = currentLocalPassthrough(item);
      if (local != null) {
        return {
          text: local,
          selectedId: null,
          costUsd: null,
          latencyMs: null,
          error: null,
          source: 'local-passthrough',
        };
      }
      const entry = fixture?.outputs[item.id];
      if (!entry) {
        return {
          text: null,
          selectedId: null,
          costUsd: null,
          latencyMs: null,
          error: 'fixture 에 이 문항의 출력이 없다',
          source: 'fixture',
        };
      }
      const selectedId = entry.selectedId ?? null;
      // 선택 문항은 고른 후보의 글이 곧 출력이다(fixture 에 글을 따로 적지 않아도 된다).
      const text = entry.text ?? item.candidates?.find((c) => c.id === selectedId)?.text ?? null;
      return {
        text,
        selectedId,
        costUsd: entry.costUsd ?? null,
        latencyMs: entry.latencyMs ?? null,
        error: null,
        source: 'fixture',
      };
    },
  };
}

// ---------------------------------------------------------------- jev

/**
 * Jev(TypeSafe) — **스텁**이다. 공식 JS SDK 의 패키지 이름·버전·API 모양을 확인하지 못해서
 * (2026-10-26: 이 맥에서 npm 레지스트리 조회가 사내 TLS 검사로 막혔다) 의존성을 넣지 않았다.
 * 무엇이 있어야 실제 어댑터가 되는지는 `text-quality/README.md` 「jev 어댑터」.
 *
 * 키(`JEV_API_KEY`)가 있어도 SDK 가 연결되지 않았으므로 not_configured 다 — 키만 넣으면 돌아가는 것처럼
 * 보이게 하지 않는다.
 */
export const JEV_NOT_CONFIGURED = 'API key/SDK 미설정';

export function createJevProvider(env: Record<string, string | undefined>): EvalProvider {
  const hasKey = Boolean(env.JEV_API_KEY?.trim());
  return {
    id: 'jev',
    live: true,
    status: 'not_configured',
    statusReason: hasKey
      ? `${JEV_NOT_CONFIGURED} — 키는 있으나 SDK 어댑터가 없다`
      : JEV_NOT_CONFIGURED,
    async generate() {
      throw new Error(JEV_NOT_CONFIGURED);
    },
  };
}

// ---------------------------------------------------------------- 그 밖의 후보(설정만)

/**
 * 비교 후보 목록. 어댑터가 없는 것은 **설정 자리만** 있다 — GPU 서버를 띄우거나 가중치를 받지 않는다.
 * 고르면 러너가 not_configured 로 보고 fixture 검사만 돈다.
 */
export const PROVIDER_CATALOG: Record<
  string,
  { kind: 'text' | 'tts'; adapter: 'implemented' | 'stub' | 'config-only'; note: string }
> = {
  current: {
    kind: 'text',
    adapter: 'implemented',
    note: '운영 파이프라인 출력(fixture + 로컬 그대로 갈래)',
  },
  jev: { kind: 'text', adapter: 'stub', note: 'TypeSafe/Jev — SDK 미확인, 스텁' },
  qwen: {
    kind: 'text',
    adapter: 'config-only',
    note: 'Qwen 계열 텍스트 모델 — 호스팅 API 를 정하면 어댑터를 붙인다',
  },
  chatterbox: {
    kind: 'tts',
    adapter: 'config-only',
    note: 'Chatterbox — 음성 합성 모델이라 문구를 만들지 않는다. 음성 비교를 붙일 때의 자리만 둔다',
  },
};

export function createProvider(
  id: string,
  options: { env: Record<string, string | undefined>; fixture: CurrentOutputsFixture | null },
): EvalProvider {
  if (id === 'current') return createCurrentProvider(options.fixture);
  if (id === 'jev') return createJevProvider(options.env);
  const entry = PROVIDER_CATALOG[id];
  if (!entry)
    throw new Error(`모르는 제공자 ${id} (가능: ${Object.keys(PROVIDER_CATALOG).join(', ')})`);
  return {
    id,
    live: true,
    status: 'not_configured',
    statusReason: `어댑터 없음(설정 항목만) — ${entry.note}`,
    async generate() {
      throw new Error(`${id} 어댑터 없음`);
    },
  };
}
