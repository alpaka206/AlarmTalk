/**
 * 스토어 보고서 파일 읽기 — Play 콘솔 통계 CSV 와 App Store Connect 분석 보고서(gzip TSV).
 * `docs/spec/admin-console.md` 「스토어 다운로드」.
 *
 * 네트워크를 부르지 않는다(바이트 → 날짜별 숫자). 받아 오는 쪽은 `store-play.ts`·`store-asc.ts`.
 *
 * 두 스토어 다 머리줄 이름을 예고 없이 바꿔 왔다(Play 의 'Current Device Installs' → 'Active Device Installs' 등). 그래서
 * 머리줄은 대소문자·공백·기호를 지운 뒤 비교하고, **아는 숫자 칸이 하나도 없으면 던진다** — 조용히 0 을 쌓으면 화면이
 * 거짓 숫자를 보여 준다.
 */

/** 보고서 파일이 예상한 모양이 아니다. 메시지는 화면·기록에 그대로 실리므로 URL·키를 넣지 않는다. */
export class StoreReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreReportError';
  }
}

/** 날짜 → 지표 → 값. 날짜는 스토어 보고서의 날짜(YYYY-MM-DD)다. */
export type DailyMetrics = Map<string, Record<string, number>>;

/**
 * 바이트 → 글자. Play 통계 CSV 는 **UTF-16LE(BOM 포함)** 이고, App Store 보고서는 UTF-8 이다.
 * BOM 이 없는 UTF-16LE 도 받는다(ASCII 글자 뒤에 0 바이트가 붙는 모양으로 알아본다).
 */
export function decodeReportText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16BE — 워커의 TextDecoder 가 utf-16be 를 받는다는 보장이 없어 바이트를 뒤집어 LE 로 읽는다.
    const body = bytes.subarray(2);
    const swapped = new Uint8Array(body.length - (body.length % 2));
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1]!;
      swapped[i + 1] = body[i]!;
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 4 && bytes[0] !== 0 && bytes[1] === 0 && bytes[2] !== 0 && bytes[3] === 0) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** gzip 이면 푼다(머리 바이트 1f 8b). 아니면 그대로 — 받는 쪽이 이미 풀어 준 경우. */
export async function gunzipIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * 구분자 글(CSV·TSV) → 줄 목록. 첫 줄에 탭이 있으면 탭, 아니면 쉼표로 가른다.
 * 따옴표 칸(안의 쉼표·줄바꿈·`""`)을 받는다. 빈 줄은 버린다.
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** 머리줄 비교용 — 'Daily User Installs' · 'daily_user_installs' · ' DAILY USER INSTALLS ' 가 같은 값이 된다. */
export function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 보고서의 날짜 → YYYY-MM-DD. `2026-10-01` · `20261001` · `10/01/2026`(미국식) 을 받는다. 못 읽으면 null. */
export function normalizeDay(raw: string): string | null {
  const v = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return null;
}

/** 숫자 칸 → 정수. 빈 칸·못 읽는 값은 null(0 으로 치지 않는다). 천 단위 쉼표를 받는다. */
function parseCount(raw: string | undefined): number | null {
  if (raw == null) return null;
  const v = raw.trim().replace(/[,\s]/g, '');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function add(out: DailyMetrics, day: string, metric: string, value: number): void {
  const entry = out.get(day) ?? {};
  entry[metric] = (entry[metric] ?? 0) + value;
  out.set(day, entry);
}

// ── Google Play ───────────────────────────────────────────────────────────────

/**
 * Play 통계 보고서 `installs_<패키지>_<YYYYMM>_overview.csv` 의 칸 → 저장 지표 이름.
 * 옛 이름('Current Device Installs')도 같은 지표로 받는다.
 */
const PLAY_COLUMNS: Record<string, string> = {
  dailydeviceinstalls: 'daily_device_installs',
  dailydeviceuninstalls: 'daily_device_uninstalls',
  dailydeviceupgrades: 'daily_device_upgrades',
  dailyuserinstalls: 'daily_user_installs',
  dailyuseruninstalls: 'daily_user_uninstalls',
  totaluserinstalls: 'total_user_installs',
  activedeviceinstalls: 'active_device_installs',
  currentdeviceinstalls: 'active_device_installs',
  installevents: 'install_events',
  updateevents: 'update_events',
  uninstallevents: 'uninstall_events',
};

/**
 * Play 통계 CSV(바이트) → 날짜별 지표. 한 줄이 하루다(그 달의 처리된 날까지 0 을 포함해 다 있다).
 * `packageName` 을 주면 다른 패키지 줄은 버린다(overview 파일은 원래 한 패키지뿐이다).
 */
export function parsePlayInstallsCsv(bytes: Uint8Array, packageName?: string): DailyMetrics {
  const rows = parseDelimited(decodeReportText(bytes));
  const header = (rows[0] ?? []).map(normalizeHeader);
  const dateAt = header.indexOf('date');
  const packageAt = header.indexOf('packagename');
  const columns = header
    .map((h, i) => ({ i, metric: PLAY_COLUMNS[h] }))
    .filter((c): c is { i: number; metric: string } => c.metric !== undefined);
  if (dateAt < 0 || columns.length === 0) {
    throw new StoreReportError('Play 통계 보고서 형식이 달라요(날짜·설치 칸을 찾지 못했어요)');
  }
  const out: DailyMetrics = new Map();
  for (const row of rows.slice(1)) {
    const day = normalizeDay(row[dateAt] ?? '');
    if (!day) continue;
    if (packageName && packageAt >= 0 && (row[packageAt] ?? '').trim() !== packageName) continue;
    for (const { i, metric } of columns) {
      const value = parseCount(row[i]);
      if (value != null) add(out, day, metric, value);
    }
  }
  return out;
}

// ── App Store ─────────────────────────────────────────────────────────────────

export type AscReportKind = 'downloads' | 'installs';

/** 보고서 종류별로 우리가 적는 지표 — 숫자가 없는 날을 0 으로 채울 때도 이 목록을 쓴다. */
export const ASC_REPORT_METRICS: Record<AscReportKind, readonly string[]> = {
  downloads: ['first_time_downloads', 'redownloads'],
  installs: ['installs', 'deletions'],
};

/**
 * 분석 보고서 이름 → 종류. 'App Downloads Standard'(COMMERCE) · 'App Store Installation and Deletion Standard'(APP_USAGE).
 * Detailed 판은 쓰지 않는다(개인정보 보호 임계로 작은 숫자가 빠진다).
 */
export function ascReportKind(name: string): AscReportKind | null {
  const n = normalizeHeader(name);
  if (n === 'appdownloadsstandard') return 'downloads';
  if (n === 'appstoreinstallationanddeletionstandard' || n === 'appinstallationanddeletionstandard') return 'installs';
  return null;
}

/**
 * 분석 보고서 조각(바이트, gzip 이면 푼 뒤) → 날짜별 지표.
 *  - downloads: 'Download Type' 이 'First-time download' → first_time_downloads, 'Redownload' → redownloads.
 *    업데이트·복원은 다운로드로 세지 않는다.
 *  - installs: 'Event' 가 'Install' → installs, 'Delete' → deletions.
 * 값은 'Counts' 칸의 합이다(같은 날이 나라·기기·출처별로 여러 줄이다).
 */
export function parseAscReport(bytes: Uint8Array, kind: AscReportKind): DailyMetrics {
  const rows = parseDelimited(decodeReportText(bytes));
  const header = (rows[0] ?? []).map(normalizeHeader);
  const dateAt = header.indexOf('date');
  const countAt = header.indexOf('counts');
  const typeAt = header.indexOf(kind === 'downloads' ? 'downloadtype' : 'event');
  if (dateAt < 0 || countAt < 0 || typeAt < 0) {
    throw new StoreReportError(
      `App Store 보고서 형식이 달라요(${kind === 'downloads' ? '다운로드' : '설치·삭제'} 보고서의 날짜·종류·수 칸을 찾지 못했어요)`,
    );
  }
  const out: DailyMetrics = new Map();
  for (const row of rows.slice(1)) {
    const day = normalizeDay(row[dateAt] ?? '');
    const value = parseCount(row[countAt]);
    if (!day || value == null) continue;
    const type = normalizeHeader(row[typeAt] ?? '');
    const metric =
      kind === 'downloads'
        ? type === 'firsttimedownload'
          ? 'first_time_downloads'
          : type === 'redownload'
            ? 'redownloads'
            : null
        : type === 'install'
          ? 'installs'
          : type === 'delete'
            ? 'deletions'
            : null;
    if (metric) add(out, day, metric, value);
  }
  return out;
}

/** 여러 조각의 결과를 더한다(한 보고서 인스턴스가 조각 여럿으로 나뉠 수 있다). */
export function mergeDaily(into: DailyMetrics, from: DailyMetrics): DailyMetrics {
  for (const [day, metrics] of from) for (const [metric, value] of Object.entries(metrics)) add(into, day, metric, value);
  return into;
}
