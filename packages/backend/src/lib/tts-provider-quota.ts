import type { Env } from '../types';
import { ttsBudgetConfigFromEnv } from './tts-budget';

/**
 * **공급자 계정의 남은 글자** — ElevenLabs `GET /v1/user/subscription`(`docs/spec/tts-render-and-budget.md` §3).
 *
 * dev·prod 워커가 같은 키를 쓰므로 둘이 보는 숫자는 **같은 계정 하나의 한도**다. 키를 환경별로 나눠도 한 조직(워크스페이스)
 * 이면 한도가 갈리지 않을 수 있다 — 그래서 환경별 사용량은 우리 장부(`tts-usage.ts`)로 세고, 이 조회는 계정 전체의 바닥만
 * 본다. 글자를 쓰는 호출이 아니다(합성하지 않는다).
 *
 * ⚠ 키는 요청 헤더에만 싣는다. 결과·오류·로그에 키를 넣지 않는다 — 오류 문구도 상태 코드만 남긴다(응답 본문은 버린다:
 *   공급자가 요청 정보를 되비출 수 있다).
 * ⚠ 응답 모양(`character_count`·`character_limit`·`next_character_count_reset_unix`)은 공개 문서 기준이고 **실제 계정에서는
 *   아직 확인하지 않았다**(2026-10-26 — 운영 연결 대기). 숫자가 아니면 던진다(잘못 읽은 0 으로 경보를 끄지 않는다).
 */

const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';

export interface ProviderCharacterQuota {
  used: number;
  limit: number;
  remaining: number;
  /** 다음 초기화(ISO) — 없으면 null. */
  resetsAt: string | null;
  /** 보이스 슬롯(있으면) — 클론 상한(`MAX_PROVIDER_CLONE_VOICES`)과 맞대 보는 값. */
  voiceSlotsUsed: number | null;
  voiceLimit: number | null;
}

export class ProviderQuotaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderQuotaUnavailableError';
  }
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchProviderCharacterQuota(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderCharacterQuota> {
  const res = await fetchImpl(SUBSCRIPTION_URL, {
    method: 'GET',
    headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new ProviderQuotaUnavailableError(`provider subscription lookup failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const used = optionalNumber(body.character_count);
  const limit = optionalNumber(body.character_limit);
  if (used === null || limit === null) {
    throw new ProviderQuotaUnavailableError('provider subscription response has no character counts');
  }
  const reset = optionalNumber(body.next_character_count_reset_unix);
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: reset === null ? null : new Date(reset * 1000).toISOString(),
    voiceSlotsUsed: optionalNumber(body.voice_slots_used),
    voiceLimit: optionalNumber(body.voice_limit),
  };
}

export type ProviderRemainingCheck =
  | { status: 'not_configured' }
  | { status: 'no_api_key' }
  | { status: 'ok' | 'low'; threshold: number; quota: ProviderCharacterQuota };

/**
 * 남은 글자가 `TTS_PROVIDER_REMAINING_ALERT_CHARS` 밑인가. 문턱을 정하지 않았으면 **조회하지 않는다**. 조회가 실패하면
 * 던진다 — 부른 쪽(cron)이 경보로 올린다.
 */
export async function checkProviderRemaining(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderRemainingCheck> {
  const threshold = ttsBudgetConfigFromEnv(env).providerRemainingAlertChars;
  if (threshold === null) return { status: 'not_configured' };
  if (!env.ELEVENLABS_API_KEY) return { status: 'no_api_key' };
  const quota = await fetchProviderCharacterQuota(env.ELEVENLABS_API_KEY, fetchImpl);
  return { status: quota.remaining < threshold ? 'low' : 'ok', threshold, quota };
}

/** cron 이 이 틱에 공급자를 조회하는가 — 한 시간에 한 번(정시 첫 5분 틱). */
export function isProviderQuotaCheckTick(now: Date): boolean {
  return now.getUTCMinutes() < 5;
}

export class ProviderRemainingLowError extends Error {
  constructor(remaining: number, threshold: number) {
    super(`TTS provider remaining characters ${remaining} is below ${threshold}`);
    this.name = 'ProviderRemainingLowError';
  }
}
