/**
 * Open-Meteo 호출 한 곳 — 타임아웃·엣지 캐시·관측 로그를 세 fetch(지오코딩·예보·미세먼지)가
 * 똑같이 받게 한다. 호출부는 `lib/weather-signal.ts` 의 `resolveWeatherLocation` /
 * `loadWeatherSignalInput` / `loadDustSignal` 셋과, 지역을 50곳씩 묶어 부르는 cron 미리 계산
 * (`lib/weather-region-daily.ts` 의 `fetchLocationList`)이다.
 *
 * 앞의 세 호출은 `GET /api/tts/prerender-variant` 안에서 **순차로** 돈다 — 미리 계산한 행이 없거나
 * 오래됐을 때만(목록 지역은 지오코딩 없이 둘, 옛 글자는 셋). 앱은 날씨 테마 알람을
 * 저장하기 전에 그 응답을 동기로 기다린다(Android `MainViewModelAlarmActions.withResolvedWeatherVariant`,
 * iOS `AlarmEditorSheet.applyWeatherVariant`). 그래서 여기서 느려지면 저장 버튼이 그만큼 붙잡힌다.
 *
 * **상업 키(선택)** — `OPEN_METEO_API_KEY` 가 있으면 같은 요청을 상업 호스트(`customer-` 접두)로
 * 보내고 `apikey` 를 붙인다. 없으면 지금처럼 무료 호스트다. 호스트를 고르고 키를 붙이는 곳은
 * `openMeteoRequestUrl` 하나뿐이다 — 호출부는 언제나 무료 호스트로 URL 을 만들고 키만 넘긴다.
 */
import { logStructured } from './logger';

/**
 * 무료 호스트 → 상업 호스트. Open-Meteo 문서: "The server URL requires the prefix customer-"
 * (예보·대기질·지오코딩 문서의 `apikey` 항목, 2026-09-30 확인). 세 상업 호스트는 실재한다 —
 * 키 없이 부르면 예보·대기질은 401 `API key required` 로 답한다(같은 날 실측).
 *
 * ⚠ 여기 없는 호스트에는 **키를 붙이지 않는다** — 키가 남의 서버로 새지 않게 하는 마지막 문이다.
 */
const OPEN_METEO_COMMERCIAL_HOSTS: Readonly<Record<string, string>> = {
  'api.open-meteo.com': 'customer-api.open-meteo.com',
  'air-quality-api.open-meteo.com': 'customer-air-quality-api.open-meteo.com',
  'geocoding-api.open-meteo.com': 'customer-geocoding-api.open-meteo.com',
};

/**
 * 워커 환경에서 상업 키를 꺼낸다. 없거나 공백뿐이면 `undefined`(= 무료 호스트).
 * 규칙: `docs/ops/environments.md` 「Open-Meteo 상업 키」.
 */
export function openMeteoApiKey(env: { OPEN_METEO_API_KEY?: string } | undefined): string | undefined {
  const key = env?.OPEN_METEO_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * 실제로 부를 URL. 키가 없으면 **받은 URL 그대로**(무료 호스트 — 예전과 같다). 키가 있으면 호스트를
 * `customer-` 로 바꾸고 `apikey` 를 붙인 **사본**을 만든다(호출부의 URL 은 건드리지 않는다).
 *
 * ⚠ 이 URL 은 키를 담는다 — 로그·에러 메시지에 싣지 말 것(`fetchOpenMeteo` 는 `kind` 로만 남긴다).
 */
export function openMeteoRequestUrl(url: URL, apiKey: string | undefined): URL {
  if (!apiKey) return url;
  const commercialHost = OPEN_METEO_COMMERCIAL_HOSTS[url.hostname];
  if (!commercialHost) return url;
  const target = new URL(url.toString());
  target.hostname = commercialHost;
  target.searchParams.set('apikey', apiKey);
  return target;
}

/** 로그·진단 출력용 — `apikey` 값을 가린다. URL 을 남겨야 할 일이 생기면 반드시 이걸 거친다. */
export function redactOpenMeteoUrl(url: URL | string): string {
  const copy = new URL(String(url));
  if (copy.searchParams.has('apikey')) copy.searchParams.set('apikey', 'REDACTED');
  return copy.toString();
}

/**
 * Open-Meteo 한 번 호출의 상한. 세 번 순차라 최악 15초지만, 정상 응답은 수백 ms 다.
 *
 * 5초인 이유: 저장 버튼이 이 응답을 **동기로** 기다리는데, 실패의 대가는 작다 — 서버는
 * `variant_index: null` 을 돌려주고(`routes/tts.ts` 의 `/prerender-variant`), 앱은 기존 값을
 * 유지한 채 저장하고 뒤에서 다시 받는다(Android `DynamicVoiceRefreshWorker` +
 * `DynamicVoiceRefreshScheduler.scheduleRetryUntilFire`, iOS `WeatherVariantRefreshService.refreshDue`).
 * 즉 오래 기다려 얻을 게 없다. 반대로 상한이 없으면 Open-Meteo 가 멈춘 동안 저장이 통째로
 * 멈춘다 — "인터넷이 느려도 괜찮도록" 의 서버 쪽 몫이 이 숫자다.
 */
export const WEATHER_FETCH_TIMEOUT_MS = 5_000;

/**
 * 지오코딩(도시명 → 좌표) 엣지 캐시 TTL. 도시의 좌표는 바뀌지 않으므로 길게 둔다.
 * 캐시 키는 URL 이고 URL 이 도시명·언어를 담으므로 별도 키가 필요 없다.
 */
export const WEATHER_GEOCODE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * 예보·미세먼지 엣지 캐시 TTL.
 *
 * 6시간인 이유: 앱은 "발사 24시간 이내에 받은 값" 만 이 발사분의 조건으로 인정한다
 * (Android `AlarmRepository.kt` 의 `WEATHER_RESOLVE_VALID_WINDOW_MILLIS`, iOS
 * `BucketVariantResolver.resolveValidWindowMillis`). 캐시 TTL 이 그 창에 가까우면 앱이
 * "24시간 안에 받았다" 고 믿는 값이 실은 그보다 오래된 예보가 된다. 6시간이면 최악에도
 * 발사 30시간 전 예보이고, 같은 도시·같은 날짜의 요청이 하루 네 번만 Open-Meteo 에 닿는다.
 * URL 이 좌표·날짜·타임존을 담고 있어 그대로 캐시 키가 된다 — 다른 날짜의 예보끼리 섞이지 않는다.
 */
export const WEATHER_FORECAST_CACHE_TTL_SECONDS = 6 * 60 * 60;

export type WeatherFetchKind = 'geocode' | 'forecast' | 'air';

/**
 * Open-Meteo 를 타임아웃·엣지 캐시를 걸어 부르고, 결과를 구조화 로그 한 줄로 남긴다.
 *
 * - 타임아웃: `AbortSignal.timeout` 이 만료되면 `fetch` 가 거부된다(`lib/perso.ts` ·
 *   `lib/elevenlabs.ts` 와 같은 방식). **여기서 잡지 않고 다시 던진다** — 세 호출부가 각자
 *   try/catch 로 '못 받음'(null)을 돌려주고, 그걸 폴백할지는 `lib/weather-signal.ts` 의
 *   `WeatherFetchFailurePolicy` 한 곳이 정한다(사전렌더 인덱스는 미해결, 라이브 문장은 폴백).
 *   삼키면 그 규약이 두 겹이 된다.
 * - 엣지 캐시: `cf.cacheTtl` 은 오리진의 캐시 헤더와 무관하게 응답을 TTL 만큼 캐시하고,
 *   `cacheEverything` 은 확장자 없는 JSON 응답도 캐시 대상에 넣는다(둘 다 workers-types 의
 *   `RequestInitCfProperties` 주석). Workers 의 `fetch` 는 남의 오리진이라도 자기 존의 캐시를
 *   거친다 — 이 워커는 `api(-dev).alarm-talk.com` 커스텀 도메인에 붙어 있다(`wrangler.toml` 의
 *   `routes`). 캐시 대상 상태코드는 Cloudflare 기본 규칙(200/206/301/302/303/404/410)이고
 *   `cacheTtl` 은 그 집합을 넓히지 않으므로 **실패 응답(400·429·5xx)은 캐시되지 않는다.**
 *   ⚠ 캐시 키는 URL 이다 — 날짜가 URL 에 없는 호출은 캐시하지 않는다(`cacheTtlSeconds: null`).
 *   한계: 캐시는 요청을 처리한 **데이터센터 단위**다 — 다른 PoP 로 들어온 첫 요청은 MISS 다.
 *   (출처: developers.cloudflare.com/workers/reference/how-the-cache-works,
 *   developers.cloudflare.com/cache/how-to/configure-cache-status-code)
 * - 로그: `cf-cache-status`(HIT/MISS/EXPIRED…)와 소요 ms 를 남겨 배포 뒤 `wrangler tail` 로
 *   히트율을 잴 수 있게 한다. ⚠ 도시명·좌표 같은 사용자 값은 넣지 않는다 — `kind` 로만 가른다.
 *   ⚠ URL 도 넣지 않는다 — 상업 키를 쓰면 URL 에 `apikey` 가 있다. 어느 쪽으로 불렀는지는 `commercial` 로.
 */
export async function fetchOpenMeteo(
  kind: WeatherFetchKind,
  url: URL,
  /**
   * 엣지 캐시 TTL. **`null` 이면 캐시를 걸지 않는다** — URL 에 날짜가 없는 호출(라이브 생성
   * `/generate` 의 `forecast_days=1`)이 그렇다. 그 URL 은 "오늘" 을 담지 않아 자정을 넘긴
   * 어제 응답이 TTL 동안 오늘 것으로 나간다. 날짜가 URL 에 있을 때만(`start_date=end_date=`)
   * 다른 날짜끼리 섞이지 않는다.
   */
  cacheTtlSeconds: number | null,
  /**
   * 상업 키(`openMeteoApiKey(env)`). 없으면 무료 호스트 — 예전과 똑같다. 있으면 `openMeteoRequestUrl`
   * 이 상업 호스트 + `apikey` 로 바꾼다. 엣지 캐시 키도 그 URL 이라 무료·상업 응답이 섞이지 않는다.
   */
  apiKey?: string,
): Promise<Response> {
  const startedAt = Date.now();
  // 어느 쪽으로 불렀는지만 남긴다(키 자체·URL 은 남기지 않는다).
  const commercial = Boolean(apiKey);
  try {
    const response = await fetch(openMeteoRequestUrl(url, apiKey).toString(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(WEATHER_FETCH_TIMEOUT_MS),
      ...(cacheTtlSeconds === null ? {} : { cf: { cacheTtl: cacheTtlSeconds, cacheEverything: true } }),
    });
    // 실패 상태는 warn — 상업 키가 틀리면 예보·대기질이 400(`The supplied API key is invalid.`,
    // 2026-09-30 실측)으로 답해 **모든 날씨가 미해결**이 되는데, info 에 섞이면 `wrangler tail` 에서 못 본다.
    logStructured(response.ok ? 'info' : 'warn', {
      at: 'weather.fetch',
      kind,
      commercial,
      status: response.status,
      cacheStatus: response.headers.get('cf-cache-status'),
      ms: Date.now() - startedAt,
      timedOut: false,
    });
    return response;
  } catch (err) {
    const timedOut = isTimeoutError(err);
    logStructured('warn', {
      at: 'weather.fetch',
      kind,
      commercial,
      status: null,
      cacheStatus: null,
      ms: Date.now() - startedAt,
      timedOut,
      // 타임아웃이 아닌 실패(DNS·연결 거부 등)만 이름을 남긴다. 메시지는 URL(=좌표·도시, 상업 키를
      // 쓰면 `apikey` 까지)을 담을 수 있어 뺀다.
      ...(timedOut ? {} : { error: errorName(err) }),
    });
    throw err;
  }
}

/**
 * `AbortSignal.timeout` 만료로 거부된 fetch 인가. 표준은 `TimeoutError` DOMException 이지만,
 * 런타임에 따라 `AbortError` 로도 오므로 둘 다 타임아웃으로 센다.
 */
function isTimeoutError(err: unknown): boolean {
  const name = errorName(err);
  return name === 'TimeoutError' || name === 'AbortError';
}

function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return typeof err;
}
