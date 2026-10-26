/**
 * 아침 소식 원천(OpenDART·정책브리핑)의 실패를 한 모양으로.
 *
 * 원천마다 상태 코드가 다르지만 앱이 알아야 하는 것은 다섯 갈래뿐이다(`kind`). 원천의 원래 코드·세부 갈래는
 * `detail`·`sourceStatus` 로 남겨 로그에서 되짚는다. ⚠ 메시지·로그에 **요청 URL 을 싣지 말 것** — 키가 실려 있다.
 */
import type { ErrorCode } from '@alarmtalk/shared';

export type BriefingSourceErrorKind = 'not_configured' | 'rate_limited' | 'key_invalid' | 'maintenance' | 'failed';

/** 요청 한도에 걸리면 이만큼 그 원천에 다시 묻지 않는다(초). 원천이 기다릴 시간을 알려 주지 않아 우리가 정한다. */
export const BRIEFING_RATE_LIMIT_COOLDOWN_SECONDS = 15 * 60;

export class BriefingSourceError extends Error {
  readonly kind: BriefingSourceErrorKind;
  /** 세부 갈래(예: `key_unregistered`·`ip_denied`·`transport`·`parse`). 로그용. */
  readonly detail: string;
  /** 원천이 준 상태 코드(있으면). */
  readonly sourceStatus: string | null;

  constructor(kind: BriefingSourceErrorKind, detail: string, sourceStatus: string | null = null) {
    super(`briefing source ${kind}/${detail}${sourceStatus ? ` (${sourceStatus})` : ''}`);
    this.name = 'BriefingSourceError';
    this.kind = kind;
    this.detail = detail;
    this.sourceStatus = sourceStatus;
  }
}

/** 던져진 무엇이든 `BriefingSourceError` 로. 모르는 예외는 `failed/transport`. */
export function asBriefingSourceError(err: unknown): BriefingSourceError {
  if (err instanceof BriefingSourceError) return err;
  return new BriefingSourceError('failed', 'transport');
}

/** 응답 본문 `errors[].code` 로 나가는 값. */
export function briefingSourceErrorCode(kind: BriefingSourceErrorKind): ErrorCode {
  switch (kind) {
    case 'not_configured':
      return 'BRIEFING_SOURCE_NOT_CONFIGURED';
    case 'rate_limited':
      return 'BRIEFING_SOURCE_RATE_LIMITED';
    case 'key_invalid':
      return 'BRIEFING_SOURCE_KEY_INVALID';
    case 'maintenance':
      return 'BRIEFING_SOURCE_MAINTENANCE';
    case 'failed':
      return 'BRIEFING_SOURCE_FAILED';
  }
}

/** 저장해 둔 코드 문자열 → kind. 모르는 값은 `failed`. */
export function briefingSourceErrorKindOf(code: string | null | undefined): BriefingSourceErrorKind {
  switch (code) {
    case 'BRIEFING_SOURCE_NOT_CONFIGURED':
      return 'not_configured';
    case 'BRIEFING_SOURCE_RATE_LIMITED':
      return 'rate_limited';
    case 'BRIEFING_SOURCE_KEY_INVALID':
      return 'key_invalid';
    case 'BRIEFING_SOURCE_MAINTENANCE':
      return 'maintenance';
    default:
      return 'failed';
  }
}

/** 원천 하나를 부를 때 기다리는 최대 시간(ms). 한 요청이 원천 셋·넷을 함께 부르므로 짧게 둔다. */
export const BRIEFING_FETCH_TIMEOUT_MS = 8_000;

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** 시간 제한을 걸어 부른다. 전송 실패·시간 초과는 `failed/transport`. ⚠ URL 을 오류에 싣지 않는다. */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: URL,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: '*/*' } });
  } catch {
    throw new BriefingSourceError('failed', 'transport');
  }
}
