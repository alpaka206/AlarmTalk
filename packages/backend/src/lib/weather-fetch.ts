/**
 * 날씨 원천 호출 한 곳 — 기상청(KMA)·気象庁(JMA)·미국 국립기상청(NWS) 세 원천이 타임아웃·엣지 캐시·관측
 * 로그를 똑같이 받게 한다. 호출부는 각 원천의 어댑터(`lib/weather-kma.ts`·`weather-jma.ts`·`weather-nws.ts`)다.
 *
 * 규칙 전문은 `docs/spec/voice-and-message.md` 5-1 「서버가 미리 계산해 둔다」.
 *
 * - 여기서는 **받기만** 한다(상태·본문·걸린 시간). 본문이 정상인지(KMA `resultCode`, 개수, 발표 시각)는
 *   어댑터가 읽고, 읽은 결과를 `logWeatherFetch` 로 **한 줄** 남긴다 — 그래야 `resultCode`·`items` 까지 한 줄에
 *   실린다. 네트워크에서 실패하면(타임아웃·불통) 여기서 그 한 줄을 남기고 다시 던진다.
 * - ⚠ **URL·본문은 로그에 싣지 않는다.** KMA 의 URL 에는 서비스 키가 들어 있다(`serviceKey=`). 오류 메시지도
 *   URL 을 담을 수 있어 이름만 남긴다.
 */
import { logStructured } from './logger';

/**
 * fetch **하나**의 상한.
 *
 * 5초인 이유: 저장 버튼이 `GET /tts/prerender-variant` 를 **동기로** 기다리는데(앱 상한 8초 — 스펙 5-1 「대기
 * 상한」), 미리 계산한 행이 없을 때 그 라우트는 원천을 **한 번** 부른다. 실패의 대가는 작다 — 서버는
 * `variant_index: null` 을 돌려주고 앱은 미해결로 저장한 뒤 뒤에서 다시 받는다(Android
 * `DynamicVoiceRefreshWorker`, iOS `WeatherVariantRefreshService.refreshDue`). 오래 기다려 얻을 게 없다.
 * ⚠ 한 번의 원천 호출이 fetch 를 둘 할 수 있다(KMA 의 한 회차 물러서기·다음 페이지). 그래서 읽기 경로는 이 값과
 * 따로 **호출 전체의 마감**(`deadlineAt` ← `WEATHER_READ_DEADLINE_MS`)을 건다 — fetch 마다 5초를 새로 주면 10초다.
 */
export const WEATHER_FETCH_TIMEOUT_MS = 5_000;

/**
 * 즉석 계산(읽기 경로)의 엣지 캐시 TTL — JMA·NWS 만. 같은 지역의 같은 응답을 짧은 사이에 여러 사람이
 * 물으면 원천에 한 번만 닿게 한다. 원천의 발표 주기(JMA 하루 3회, NWS 수 시간)보다 훨씬 짧다.
 *
 * ⚠ **KMA 는 캐시하지 않는다**: 200 본문에 `NODATA`(03) 같은 오류가 실려 올 수 있어 그 응답이 캐시에 박히면
 *   TTL 동안 독이 되고, URL(= 캐시 키)에 서비스 키가 들어 있다.
 * ⚠ **cron 은 캐시를 쓰지 않는다** — 미리 계산의 목적이 새 발표다.
 */
export const WEATHER_SOURCE_CACHE_TTL_SECONDS = 600;

export type WeatherSourceKind = 'kma' | 'jma' | 'nws';

export type WeatherFetchResult = {
  status: number;
  body: string;
  /** 응답의 `content-type`(소문자). HTML 오류 봉투를 가를 때 쓴다. */
  contentType: string;
  ms: number;
};

/**
 * 원천 하나를 타임아웃·(선택) 엣지 캐시를 걸어 부르고 본문까지 읽는다.
 *
 * - 타임아웃: `AbortSignal.timeout` 이 만료되면 `fetch`(또는 본문 읽기)가 거부된다. **여기서 잡지 않고
 *   다시 던진다** — 어댑터가 '일시 실패' 로 분류한다.
 * - 엣지 캐시: `cacheTtlSeconds` 가 있으면 `cf.cacheTtl` + `cacheEverything`. Cloudflare 기본 규칙상 실패
 *   응답(429·5xx)은 캐시되지 않는다. 한계: 캐시는 데이터센터 단위다.
 * - 마감: `deadlineAt`(epoch ms)이 있으면 타임아웃은 min(5초, 남은 시간)이다. 남은 시간이 없으면 **부르지 않고**
 *   `TimeoutError` 로 거부한다 — 어댑터가 타임아웃(일시 실패)으로 분류한다.
 */
export async function fetchWeatherSource(
  source: WeatherSourceKind,
  kind: string,
  url: URL,
  options: { headers?: Record<string, string>; cacheTtlSeconds?: number | null; deadlineAt?: number | null } = {},
): Promise<WeatherFetchResult> {
  const startedAt = Date.now();
  const ttl = options.cacheTtlSeconds ?? null;
  const deadlineAt = options.deadlineAt ?? null;
  const timeoutMs =
    deadlineAt === null ? WEATHER_FETCH_TIMEOUT_MS : Math.min(WEATHER_FETCH_TIMEOUT_MS, deadlineAt - startedAt);
  if (timeoutMs <= 0) throw new DOMException('weather source deadline passed', 'TimeoutError');
  try {
    const response = await fetch(url.toString(), {
      headers: options.headers ?? { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      ...(ttl === null ? {} : { cf: { cacheTtl: ttl, cacheEverything: true } }),
    });
    const body = await response.text();
    return {
      status: response.status,
      body,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      ms: Date.now() - startedAt,
    };
  } catch (err) {
    const timedOut = isTimeoutError(err);
    logWeatherFetch('warn', {
      source,
      kind,
      status: null,
      resultCode: null,
      ms: Date.now() - startedAt,
      timedOut,
      items: null,
      // 타임아웃이 아닌 실패(DNS·연결 거부·subrequest 한도)만 이름을 남긴다 — 메시지는 URL(키)을 담을 수 있다.
      ...(timedOut ? {} : { error: errorName(err) }),
    });
    throw err;
  }
}

/**
 * `at: "weather.fetch"` 한 줄. 실리는 칸은 정해져 있다 — {source, kind, status, resultCode, ms, timedOut, items}
 * (+ 네트워크 실패면 `error` 이름). ⚠ URL·본문·지역 키·좌표를 더하지 말 것.
 */
export function logWeatherFetch(
  level: 'info' | 'warn',
  fields: {
    source: WeatherSourceKind;
    kind: string;
    status: number | null;
    resultCode: string | null;
    ms: number;
    timedOut: boolean;
    items: number | null;
    error?: string;
  },
): void {
  logStructured(level, { at: 'weather.fetch', ...fields });
}

/**
 * `AbortSignal.timeout` 만료로 거부된 fetch 인가. 표준은 `TimeoutError` DOMException 이지만,
 * 런타임에 따라 `AbortError` 로도 오므로 둘 다 타임아웃으로 센다.
 */
export function isTimeoutError(err: unknown): boolean {
  const name = errorName(err);
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * 워커 실행 하나의 subrequest 한도에 걸렸는가(`Too many subrequests`). 실패가 아니라 **예산 소진**이다 —
 * 그 틱의 날씨 작업을 멈추고 다음 틱이 잇는다(`lib/stock-clips.ts` 의 드레인과 같은 판정).
 */
export function isSubrequestLimitError(err: unknown): boolean {
  return /too many subrequests/i.test(err instanceof Error ? err.message : String(err));
}

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return typeof err;
}
