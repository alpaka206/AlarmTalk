/**
 * **에러 응답을 하나도 빠짐없이 기록한다.**
 *
 * 예전에는 흔적이 남는 실패가 **던져진 예외뿐**이었다(`logRouteError`). 우리가 의도해서
 * 낸 4xx — 한도 초과, 게이트, 형식 오류 — 는 응답만 나가고 로그에 아무것도 없었다.
 * 그래서 "이번 달 직접 입력 한도에서 몇 명이 막혔나" 같은 질문에 답할 수가 없었고,
 * 한도를 조정할 근거도 없었다.
 *
 * ⚠ **여기가 유일한 기록 지점이다.** 라우트마다 로그를 손으로 심으면 새 라우트가 빠지고,
 * 빠진 줄도 모른다. 미들웨어는 **나가는 응답**을 보므로 라우트가 어떻게 만들었든 걸린다 —
 * `jsonError` 를 쓰든, `c.json` 을 직접 쓰든, 다른 미들웨어(bodyLimit·rateLimit)가 내든.
 *
 * 경보(Sentry)는 **골라서** 보낸다:
 * - 4xx: `ALERTING_ERROR_CODES` 에 있는 것만. 오타·형식 오류까지 보내면 진짜 사고가 묻힌다.
 * - 5xx: 전부. 단 라우트가 이미 `logRouteError` 로 보고했으면 건너뛴다(중복 방지) —
 *   그쪽이 스택까지 갖고 있어 언제나 더 낫다.
 */
import type { Context, Next } from 'hono';
import { ALERTING_ERROR_CODES } from '@alarmtalk/shared';
import type { SentryClient } from '../types';

const ALERTING: ReadonlySet<string> = new Set(ALERTING_ERROR_CODES);

/** 본문을 읽어 볼 상한. 에러 JSON 은 작다 — 큰 응답이면 코드 없이 상태만 남긴다. */
const MAX_INSPECT_BYTES = 8 * 1024;

export async function errorCodeMiddleware(c: Context, next: Next) {
  await next();

  const status = c.res?.status ?? 0;
  if (status < 400) return;

  const code = await readErrorCode(c.res);

  const entry: Record<string, unknown> = {
    level: status >= 500 ? 'error' : 'warn',
    at: 'api_error',
    status,
    method: c.req.method,
    path: c.req.path,
  };
  if (code) entry.code = code;
  const uid = c.get('userId') as string | undefined;
  if (uid) entry.uid = uid;

  const line = JSON.stringify(entry);
  if (status >= 500) console.error(line);
  else console.warn(line);

  const alerting = status >= 500 ? !c.get('errorReported') : !!code && ALERTING.has(code);
  if (!alerting) return;

  const sentry = c.get('sentry') as SentryClient | undefined;
  if (!sentry) return;
  sentry.setTags?.({
    route: c.req.path,
    method: c.req.method,
    status,
    ...(code ? { error_code: code } : {}),
  });
  if (uid) sentry.setTag?.('uid', uid);
  // 던져진 예외가 아니라 **우리가 낸 판단**이다. Sentry 가 코드별로 묶도록 코드를 제목에 둔다.
  sentry.captureException(new Error(`[${code ?? `HTTP_${status}`}] ${c.req.method} ${c.req.path}`));
}

/**
 * 응답 본문에서 `error_code` 를 꺼낸다.
 *
 * ⚠ **원본을 소비하지 않는다** — `clone()` 을 읽는다. 본문을 그냥 읽으면 클라이언트에게
 * 갈 스트림이 비어 응답이 통째로 사라진다.
 */
async function readErrorCode(res: Response | undefined): Promise<string | undefined> {
  if (!res || !res.body) return undefined;
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return undefined;
  const length = Number(res.headers.get('content-length') || '0');
  if (length > MAX_INSPECT_BYTES) return undefined;
  try {
    const text = await res.clone().text();
    if (text.length > MAX_INSPECT_BYTES) return undefined;
    const parsed = JSON.parse(text) as { error_code?: unknown };
    return typeof parsed.error_code === 'string' ? parsed.error_code : undefined;
  } catch {
    // 본문이 JSON 이 아니거나 읽지 못했다 — 기록은 상태 코드만으로도 값이 있다.
    return undefined;
  }
}
