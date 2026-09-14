/**
 * **에러 응답을 코드와 함께 내는 통로.**
 *
 * 예전에는 라우트마다 `c.json({ error, error_code: 'FOO' }, 400)` 을 손으로 썼고, 그래서
 * 같은 뜻에 코드가 둘씩 생겼다 — `NO_UPDATE_FIELDS` vs `NO_FIELDS_TO_UPDATE`,
 * `INVALID_JSON` vs `JSON_BODY_REQUIRED`. 리터럴이라 **오타를 내도 컴파일이 통과**했고,
 * 그 코드로 분기하던 앱만 조용히 폴백 문구로 떨어졌다.
 *
 * 여기 함수들의 `code` 는 `ErrorCode`(= `packages/shared` 의 목록)라, 목록에 없는 값은
 * 타입 에러다.
 *
 * ⚠ **기록은 여기서 하지 않는다.** 나가는 4xx/5xx 를 한 자리에서 세는 것은
 * `middleware/errorCode.ts` 의 일이다 — 라우트가 `c.json` 을 직접 쓰든 다른 미들웨어가
 * 내든 걸리게 하려면 기록 지점이 **응답 쪽**에 있어야 한다. 여기서도 로그를 남기면
 * 같은 실패가 두 줄이 되어 집계가 두 배로 보인다.
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode } from '@alarmtalk/shared';

/**
 * 에러 응답 하나. 본문은 언제나 `{ error, error_code }` 이고, `extra` 로 붙인 값이 함께 간다
 * (예: 한도 초과의 `manual_quota`).
 *
 * ⚠ **`message` 는 앱의 최종 문구가 아니다.** 앱은 `error_code` 로 자기 언어의 문구를 고르고
 * (`ApiErrorMessages.kt` / `APIErrorMessages.swift`), 모르는 코드일 때만 이 문장을 그대로
 * 보여 준다. 그러니 여기에는 **원인을 말하는 한 문장**을 쓴다 — 앱이 번역을 못 가진
 * 경우의 마지막 안전망이다.
 */
export function jsonError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Hono Context 는 Env 에 invariant 라 인증 전/후 컨텍스트를 모두 받으려면 any 가 필요하다(logRouteError 와 같은 이유).
  c: Context<any>,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return c.json({ error: message, error_code: code, ...(extra ?? {}) }, status);
}

/**
 * 에러 **본문만** 만든다(상태 코드는 부르는 쪽이 정한다).
 *
 * 상태를 갈래마다 다르게 주면서 본문 모양은 같아야 하는 자리 — `auth.ts` 처럼 400·401·
 * 404·500 이 뒤섞인 라우트 — 에서 쓴다. 값어치는 `code` 가 `ErrorCode` 라는 것 하나다:
 * 예전에는 `code: string` 이라 오타가 그대로 나갔다.
 */
export function errorBody(
  code: ErrorCode,
  message: string,
): { error: string; error_code: ErrorCode } {
  return { error: message, error_code: code };
}
