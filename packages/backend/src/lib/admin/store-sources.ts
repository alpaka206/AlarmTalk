/**
 * 스토어 다운로드 수의 **원천 두 곳**을 부른다 — Play 콘솔 통계 보고서(Cloud Storage)와 App Store Connect 분석 보고서 API.
 * `docs/spec/admin-console.md` 「스토어 다운로드」. 파일 해석은 `store-reports.ts`, 저장·화면 숫자는 `store-downloads.ts`.
 *
 * 둘 다 **하루 늦다.** Play 는 그 달 파일을 하루에 한 번쯤 다시 쓰고, App Store 는 하루치 보고서를 다음 날 낸다. 그래서
 * 크론은 하루 여러 번 같은 것을 다시 받고(덮어써도 같은 값), 화면은 '어느 날까지 받았는지' 를 함께 말한다.
 *
 * ⚠ 워커 실행 하나의 하위 요청은 ~50 개이고 다른 크론 작업과 나눠 쓴다. 모든 fetch 는 `SubrequestBudget` 을 거친다 —
 *   모자라면 그 자리에서 멈추고 다음 회차가 잇는다(받은 것만 적는다).
 * ⚠ 오류 메시지에 URL 을 넣지 않는다 — App Store 조각 주소는 서명이 붙은 임시 주소이고, 이 메시지는 DB·화면에 남는다.
 */
import type { Env } from '../../types';
import { getGoogleAccessToken, parseServiceAccountJson } from '../google-oauth';
import { pemToPkcs8 } from '../pem';
import {
  ASC_REPORT_METRICS,
  StoreReportError,
  ascReportKind,
  gunzipIfNeeded,
  mergeDaily,
  parseAscReport,
  parsePlayInstallsCsv,
  type AscReportKind,
  type DailyMetrics,
} from './store-reports';

export type StorePlatform = 'android' | 'ios';

/** 하위 요청 예산이 바닥났다 — 오류가 아니라 '다음 회차에 잇는다' 다. */
export class StoreBudgetExhausted extends Error {
  constructor() {
    super('store sync subrequest budget exhausted');
    this.name = 'StoreBudgetExhausted';
  }
}

export class SubrequestBudget {
  constructor(public left: number) {}
  take(n = 1): void {
    if (this.left < n) throw new StoreBudgetExhausted();
    this.left -= n;
  }
}

// ── 설정 ──────────────────────────────────────────────────────────────────────

/** Play 쪽에 빠진 설정 이름(화면의 '필요한 설정'). 비어 있으면 연결된 것이다. */
export function playMissingSettings(env: Partial<Env>): string[] {
  const missing: string[] = [];
  if (!parseServiceAccountJson(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON)) missing.push('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (!env.ANDROID_PACKAGE_NAME?.trim()) missing.push('ANDROID_PACKAGE_NAME');
  if (!playReportsBucket(env)) missing.push('PLAY_REPORTS_BUCKET');
  return missing;
}

/** App Store 쪽에 빠진 설정 이름. 앱은 번들 ID 로 찾는다(로그인이 쓰는 `APPLE_BUNDLE_ID` 를 그대로 쓴다). */
export function ascMissingSettings(env: Partial<Env>): string[] {
  const missing: string[] = [];
  if (!env.ASC_API_ISSUER_ID?.trim()) missing.push('ASC_API_ISSUER_ID');
  if (!env.ASC_API_KEY_ID?.trim()) missing.push('ASC_API_KEY_ID');
  if (!env.ASC_API_PRIVATE_KEY?.trim()) missing.push('ASC_API_PRIVATE_KEY');
  if (!env.APPLE_BUNDLE_ID?.trim()) missing.push('APPLE_BUNDLE_ID');
  return missing;
}

/**
 * `PLAY_REPORTS_BUCKET` → 버킷 이름. `pubsite_prod_rev_0123…` 그대로도, Play 콘솔이 보여 주는 `gs://…/` 꼴도 받는다.
 * 버킷 이름 규칙을 벗어나면 없는 것으로 본다(경로에 그대로 붙이므로).
 */
export function playReportsBucket(env: Partial<Env>): string | null {
  // 첫 '/' 앞만 쓴다 — 정규식(`/\/.*$/`)으로 자르면 '/' 가 길게 이어진 값에서 느려진다(CodeQL js/polynomial-redos).
  const trimmed = (env.PLAY_REPORTS_BUCKET ?? '').trim();
  const raw = (trimmed.startsWith('gs://') ? trimmed.slice(5) : trimmed).split('/')[0] ?? '';
  return /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(raw) ? raw : null;
}

// ── Google Play ───────────────────────────────────────────────────────────────

export const DEVSTORAGE_READ_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

/** Play 통계 보고서의 객체 경로. 달은 보고서의 달(YYYYMM)이다. */
export function playInstallsObjectPath(packageName: string, yyyymm: string): string {
  return `stats/installs/installs_${packageName}_${yyyymm}_overview.csv`;
}

/**
 * 이번 달(UTC)과, 필요하면 지난달. Play 는 지난달 파일을 다음 달 초에도 고쳐 쓰고, 처음 연결한 날에는 30일을 채우려면
 * 지난달이 있어야 한다.
 */
export function playMonthsToFetch(now: Date, includePrevious: boolean): string[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const months = [fmt(new Date(Date.UTC(y, m, 1)))];
  if (includePrevious || now.getUTCDate() <= 5) months.unshift(fmt(new Date(Date.UTC(y, m - 1, 1))));
  return months;
}

/**
 * Play 통계 보고서를 받는다. 그 달 파일이 아직 없으면(404) 건너뛴다 — 오류가 아니다(달이 막 바뀐 날).
 * 서비스 계정에는 Play 콘솔 '사용자 및 권한' 에서 **앱 정보 보기 + 대량 보고서 다운로드** 권한이 있어야 한다(없으면 403).
 */
export async function fetchPlayInstalls(
  env: Partial<Env>,
  now: Date,
  includePrevious: boolean,
  budget: SubrequestBudget,
): Promise<DailyMetrics> {
  const account = parseServiceAccountJson(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  const bucket = playReportsBucket(env);
  const packageName = env.ANDROID_PACKAGE_NAME?.trim();
  if (!account || !bucket || !packageName) throw new StoreReportError('Play 설정이 빠졌어요');
  budget.take();
  let token: string;
  try {
    token = await getGoogleAccessToken(account, DEVSTORAGE_READ_SCOPE);
  } catch {
    // 구글 응답 본문은 적지 않는다 — 원인 갈래만.
    throw new StoreReportError('Google 서비스 계정 인증에 실패했어요');
  }
  const out: DailyMetrics = new Map();
  for (const month of playMonthsToFetch(now, includePrevious)) {
    budget.take();
    const object = encodeURIComponent(playInstallsObjectPath(packageName, month));
    const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${object}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) continue;
    if (!res.ok) {
      throw new StoreReportError(
        res.status === 403 || res.status === 401
          ? `Play 보고서 버킷을 읽을 권한이 없어요(HTTP ${res.status})`
          : `Play 보고서를 받지 못했어요(HTTP ${res.status})`,
      );
    }
    mergeDaily(out, parsePlayInstallsCsv(new Uint8Array(await res.arrayBuffer()), packageName));
  }
  return out;
}

// ── App Store Connect ─────────────────────────────────────────────────────────

const ASC_BASE = 'https://api.appstoreconnect.apple.com';

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * App Store Connect API 토큰(ES256). 규격: 머리 `alg=ES256, kid=<Key ID>, typ=JWT`, 본문 `iss=<Issuer ID>, iat, exp(20분 이하),
 * aud=appstoreconnect-v1`. App Store Server API 토큰(`apple-storekit.ts`)과 달리 `bid` 를 싣지 않는다.
 * 키는 결제 검증 키(`APPLE_PRIVATE_KEY`)와 **다른 키**다 — 이름을 갈라 둔다.
 */
export async function signAscJwt(
  config: { issuerId: string; keyId: string; privateKeyPem: string },
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
  const payload = { iss: config.issuerId, iat, exp: iat + 20 * 60, aud: 'appstoreconnect-v1' };
  const data = `${b64url(new TextEncoder().encode(JSON.stringify(header)))}.${b64url(
    new TextEncoder().encode(JSON.stringify(payload)),
  )}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(config.privateKeyPem) as BufferSource,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

interface AscResource {
  id: string;
  attributes?: Record<string, unknown>;
}

/** isolate 가 사는 동안의 앱·보고서 요청 id. 다음 회차의 하위 요청 두 개를 아낀다. */
const ascIds = new Map<string, { appId?: string; requestId?: string }>();

/** 테스트용 — isolate 캐시를 비운다. */
export function resetAscCache(): void {
  ascIds.clear();
}

async function ascCall(
  jwt: string,
  path: string,
  label: string,
  budget: SubrequestBudget,
  init?: { method: 'POST'; body: unknown },
): Promise<{ data?: AscResource[] | AscResource }> {
  budget.take();
  const res = await fetch(`${ASC_BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    throw new StoreReportError(
      res.status === 401
        ? 'App Store Connect 키가 맞지 않아요(HTTP 401)'
        : res.status === 403
          ? `App Store Connect 키에 ${label} 권한이 없어요(HTTP 403)`
          : `App Store Connect ${label} 요청이 실패했어요(HTTP ${res.status})`,
    );
  }
  return (await res.json()) as { data?: AscResource[] | AscResource };
}

const list = (body: { data?: AscResource[] | AscResource }): AscResource[] =>
  Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];

/** 받을 후보 — 아직 적지 않은 하루치 보고서 인스턴스. */
export interface AscInstance {
  id: string;
  kind: AscReportKind;
  processingDate: string;
}

export interface AscFetchResult {
  /** 이번에 처음 보고서 요청을 만들었다 — 보고서가 생기기까지 하루 이틀 걸린다. */
  requestCreated: boolean;
  /** 이번에 다 받은 인스턴스(적고 나면 다시 받지 않는다). */
  ingested: AscInstance[];
  /**
   * 받은 숫자. 숫자 줄이 하나도 없던 인스턴스는 아무것도 채우지 않는다 — 처리일은 보고서가 덮는 날짜가 아니고, 설치 수는
   * 다섯 명 미만이면 애플이 빼고 낸다. 빈 인스턴스로는 그날이 0 인지 알 수 없다.
   */
  daily: DailyMetrics;
  /** 날짜·지표(`day|metric`)마다 그 숫자를 낸 인스턴스의 처리일 — 겹치면 더 늦은 처리일이 이긴다(DB 에도 같이 적는다). */
  sourceDates: Map<string, string>;
  /** 예산이 모자라 남긴 인스턴스 수 — 다음 회차가 잇는다. */
  deferred: number;
}

/** 오늘(UTC)부터 거슬러 n 일의 날짜 — 인스턴스 목록을 그 처리일로 거른다. */
export function recentDates(now: Date, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return out;
}

export const ASC_LOOKBACK_DAYS = 35;

/**
 * App Store 분석 보고서를 받는다.
 *
 * 1. 번들 ID 로 앱을 찾는다.
 * 2. 앱의 **지속(ONGOING) 보고서 요청**을 찾고, 없으면(또는 애플이 오래 안 받아 멈췄으면) 하나 만든다 — 만든 회차는 여기서
 *    끝난다(보고서가 아직 없다). 요청을 만들려면 키 역할이 **Admin** 이어야 한다.
 * 3. 요청의 보고서 중 'App Downloads Standard'·'App Store Installation and Deletion Standard' 를 고르고, 최근 35일의
 *    **하루치(DAILY)** 인스턴스를 나열한다.
 * 4. `alreadyIngested` 에 없는 인스턴스를 최신부터, 예산 안에서 조각(gzip)을 받아 해석한다. 인스턴스 하나의 조각을 다 받지
 *    못하면 그 인스턴스는 남긴다(일부만 적으면 그날 숫자가 작아진다).
 */
export async function fetchAscDownloads(
  env: Partial<Env>,
  now: Date,
  budget: SubrequestBudget,
  alreadyIngested: (ids: string[]) => Promise<Set<string>>,
): Promise<AscFetchResult> {
  const issuerId = env.ASC_API_ISSUER_ID?.trim();
  const keyId = env.ASC_API_KEY_ID?.trim();
  const privateKeyPem = env.ASC_API_PRIVATE_KEY;
  const bundleId = env.APPLE_BUNDLE_ID?.trim();
  if (!issuerId || !keyId || !privateKeyPem?.trim() || !bundleId) throw new StoreReportError('App Store Connect 설정이 빠졌어요');
  let jwt: string;
  try {
    jwt = await signAscJwt({ issuerId, keyId, privateKeyPem }, now.getTime());
  } catch {
    throw new StoreReportError('ASC_API_PRIVATE_KEY 를 읽지 못했어요(.p8 내용 전체인지 확인해 주세요)');
  }
  const result: AscFetchResult = { requestCreated: false, ingested: [], daily: new Map(), sourceDates: new Map(), deferred: 0 };
  const cacheKey = `${issuerId}:${keyId}:${bundleId}`;
  const ids = ascIds.get(cacheKey) ?? {};
  ascIds.set(cacheKey, ids);

  if (!ids.appId) {
    const apps = list(
      await ascCall(jwt, `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId&limit=1`, '앱 조회', budget),
    );
    if (!apps[0]) throw new StoreReportError('App Store Connect 에서 APPLE_BUNDLE_ID 의 앱을 찾지 못했어요');
    ids.appId = apps[0].id;
  }

  if (!ids.requestId) {
    const requests = list(
      await ascCall(
        jwt,
        `/v1/apps/${encodeURIComponent(ids.appId)}/analyticsReportRequests?filter[accessType]=ONGOING&limit=10`,
        '분석 보고서 요청 조회',
        budget,
      ),
    ).filter((r) => r.attributes?.stoppedDueToInactivity !== true);
    if (requests[0]) ids.requestId = requests[0].id;
    else {
      const created = list(
        await ascCall(jwt, '/v1/analyticsReportRequests', '분석 보고서 요청 만들기', budget, {
          method: 'POST',
          body: {
            data: {
              type: 'analyticsReportRequests',
              attributes: { accessType: 'ONGOING' },
              relationships: { app: { data: { type: 'apps', id: ids.appId } } },
            },
          },
        }),
      );
      if (created[0]) ids.requestId = created[0].id;
      result.requestCreated = true;
      return result;
    }
  }

  const reports = list(
    await ascCall(
      jwt,
      `/v1/analyticsReportRequests/${encodeURIComponent(ids.requestId)}/reports?fields[analyticsReports]=name&limit=200`,
      '분석 보고서 목록',
      budget,
    ),
  )
    .map((r) => ({ id: r.id, kind: ascReportKind(String(r.attributes?.name ?? '')) }))
    .filter((r): r is { id: string; kind: AscReportKind } => r.kind !== null);
  if (reports.length === 0) return result; // 요청을 만든 지 얼마 안 됐다 — 보고서가 아직 없다.

  const dates = recentDates(now, ASC_LOOKBACK_DAYS).join(',');
  const candidates: AscInstance[] = [];
  for (const report of reports) {
    const instances = list(
      await ascCall(
        jwt,
        `/v1/analyticsReports/${encodeURIComponent(report.id)}/instances?filter[granularity]=DAILY&filter[processingDate]=${dates}&limit=200`,
        '보고서 인스턴스 목록',
        budget,
      ),
    );
    for (const inst of instances) {
      const processingDate = String(inst.attributes?.processingDate ?? '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(processingDate)) candidates.push({ id: inst.id, kind: report.kind, processingDate });
    }
  }
  if (candidates.length === 0) return result;

  // 이미 적은 인스턴스를 거르는 조회도 하위 요청 하나(DB)다.
  budget.take();
  const done = await alreadyIngested(candidates.map((c) => c.id));
  const todo = candidates
    .filter((c) => !done.has(c.id))
    .sort((a, b) => (a.processingDate === b.processingDate ? a.kind.localeCompare(b.kind) : b.processingDate.localeCompare(a.processingDate)));

  for (let index = 0; index < todo.length; index++) {
    const inst = todo[index]!;
    // 조각 목록 1 + 조각 1 이상 + 마지막 쓰기 1 을 남겨 둔다.
    if (budget.left < 3) {
      result.deferred = todo.length - index;
      break;
    }
    const segments = list(
      await ascCall(jwt, `/v1/analyticsReportInstances/${encodeURIComponent(inst.id)}/segments?limit=50`, '보고서 조각 목록', budget),
    );
    if (segments.length + 1 > budget.left) {
      result.deferred = todo.length - index;
      break;
    }
    const daily: DailyMetrics = new Map();
    for (const segment of segments) {
      const url = String(segment.attributes?.url ?? '');
      if (!/^https:\/\//.test(url)) throw new StoreReportError('App Store 보고서 조각 주소가 없어요');
      budget.take();
      // 서명이 붙은 임시 주소라 인증 머리를 싣지 않는다.
      const res = await fetch(url);
      if (!res.ok) throw new StoreReportError(`App Store 보고서 조각을 받지 못했어요(HTTP ${res.status})`);
      const bytes = await gunzipIfNeeded(new Uint8Array(await res.arrayBuffer()));
      mergeDaily(daily, parseAscReport(bytes, inst.kind));
    }
    // 그 보고서가 내는 지표 중 그날 줄이 없던 것은 0 이다(예: 재다운로드가 없던 날) — 그날 줄이 하나라도 있어 보고서가 그 날짜를
    // 덮는다는 것이 확인된 경우만이다.
    for (const metrics of daily.values()) for (const m of ASC_REPORT_METRICS[inst.kind]) metrics[m] ??= 0;
    // 인스턴스끼리는 더하지 않고 덮는다 — 같은 날의 인스턴스를 애플이 다시 내면 더하는 순간 두 배가 된다. 덮는 쪽은 **처리일이
    // 더 늦은** 인스턴스다(애플이 고친 숫자를 낸 쪽). 새 것부터 받으므로 뒤에 오는 옛 인스턴스가 고친 숫자를 되돌리면 안 된다.
    for (const [day, metrics] of daily) {
      const merged = { ...(result.daily.get(day) ?? {}) };
      for (const [metric, value] of Object.entries(metrics)) {
        const key = `${day}|${metric}`;
        const seen = result.sourceDates.get(key);
        if (seen !== undefined && seen > inst.processingDate) continue;
        merged[metric] = value;
        result.sourceDates.set(key, inst.processingDate);
      }
      result.daily.set(day, merged);
    }
    result.ingested.push(inst);
  }
  return result;
}
