/**
 * 스토어 다운로드 수 — **하루 여러 번 받아 적고**(크론), 개요 화면이 읽는다. `docs/spec/admin-console.md` 「스토어 다운로드」.
 *
 * 표(마이그레이션 #138)
 *  - `store_download_daily`: 플랫폼 × 날짜 × 지표 → 값. 같은 칸을 다시 받으면 덮는다(멱등). 날짜는 **스토어 보고서의
 *    날짜**다 — 스토어가 하루로 묶어 준 숫자라 한국 시각으로 다시 자를 수 없다.
 *  - `store_download_sync`: 플랫폼마다 마지막 시도·성공 시각, 마지막 오류, 안내 한 줄.
 *  - `store_report_instances`: 이미 받은 App Store 보고서 인스턴스 — 같은 하루치를 다시 받지 않게(하위 요청을 아낀다).
 * 어느 표에도 사람을 가리키는 값이 없다(스토어가 모아 준 숫자뿐이다).
 */
import type { Client } from '@libsql/client/web';
import type { Env } from '../../types';
import { logStructured } from '../logger';
import { StoreReportError, type DailyMetrics } from './store-reports';
import {
  ASC_LOOKBACK_DAYS,
  StoreBudgetExhausted,
  SubrequestBudget,
  ascMissingSettings,
  fetchAscDownloads,
  fetchPlayInstalls,
  playMissingSettings,
  type StorePlatform,
} from './store-sources';

// ── 언제 도는가 ────────────────────────────────────────────────────────────────

/**
 * 한국 시각 0·3·9·12·15·18시의 35~39분 틱(5분 크론이면 하루 여섯 번). 숫자는 하루 한 번 바뀌므로 매 틱 부를 까닭이 없다.
 * 한국·일본 날씨 슬롯(21시·6시)은 피했다 — 그 틱들은 날씨가 하위 요청을 많이 쓴다.
 */
export const STORE_SYNC_KST_HOURS: readonly number[] = [0, 3, 9, 12, 15, 18];

export function isStoreSyncTick(now: Date): boolean {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const minute = kst.getUTCMinutes();
  return STORE_SYNC_KST_HOURS.includes(kst.getUTCHours()) && minute >= 35 && minute < 40;
}

/**
 * 한 회차의 하위 요청(fetch + DB) 상한. 실행 하나의 ~50 을 다른 크론 작업과 나눠 쓴다. Play 는 4~5 개, App Store 는 기본 6~7 개 +
 * 하루치 하나당 2 개다 — 처음 연결한 날 App Store 의 지난 하루치는 몇 회차에 나눠 채워진다.
 */
export const STORE_SYNC_SUBREQUEST_BUDGET = 24;

// ── 받아 적기 ──────────────────────────────────────────────────────────────────

export interface StoreSyncOutcome {
  platform: StorePlatform;
  status: 'unconfigured' | 'ok' | 'deferred' | 'failed';
  stored: number;
}

type Stmt = { sql: string; args: Array<string | number | null> };

const UPSERT_SQL = `INSERT INTO store_download_daily (platform, day, metric, value, fetched_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT (platform, day, metric) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`;

function upserts(platform: StorePlatform, daily: DailyMetrics, fetchedAt: string): Stmt[] {
  const out: Stmt[] = [];
  for (const [day, metrics] of daily) {
    for (const [metric, value] of Object.entries(metrics)) {
      out.push({ sql: UPSERT_SQL, args: [platform, day, metric, value, fetchedAt] });
    }
  }
  return out;
}

function syncOk(platform: StorePlatform, at: string, note: string | null): Stmt {
  return {
    sql: `INSERT INTO store_download_sync (platform, last_attempt_at, last_success_at, last_error, note) VALUES (?, ?, ?, NULL, ?)
          ON CONFLICT (platform) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
            last_success_at = excluded.last_success_at, last_error = NULL, note = excluded.note`,
    args: [platform, at, at, note],
  };
}

function syncFailed(platform: StorePlatform, at: string, message: string): Stmt {
  return {
    sql: `INSERT INTO store_download_sync (platform, last_attempt_at, last_success_at, last_error, note) VALUES (?, ?, NULL, ?, NULL)
          ON CONFLICT (platform) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`,
    args: [platform, at, message],
  };
}

/** 화면·DB 에 남기는 오류 한 줄. 우리가 만든 메시지만 싣는다 — 바깥 응답 본문·주소에는 키·서명이 섞일 수 있다. */
function publicMessage(err: unknown): string {
  return err instanceof StoreReportError ? err.message : '예상하지 못한 오류로 받지 못했어요(워커 로그 참고)';
}

/**
 * 한 회차 — 설정된 스토어마다 받아 적는다. 설정이 하나도 없으면 DB 도 부르지 않는다.
 * 플랫폼 하나가 실패해도 다른 쪽은 간다. 실패는 `onError` 로 올리고(크론의 `captureCron`), 상태 표에 한 줄 남긴다.
 */
export async function runStoreDownloadSync(
  db: Client,
  env: Partial<Env>,
  now: Date,
  hooks: { onError?: (platform: StorePlatform, err: unknown) => void } = {},
): Promise<StoreSyncOutcome[]> {
  const playReady = playMissingSettings(env).length === 0;
  const ascReady = ascMissingSettings(env).length === 0;
  const outcomes: StoreSyncOutcome[] = [];
  if (!playReady) outcomes.push({ platform: 'android', status: 'unconfigured', stored: 0 });
  if (!ascReady) outcomes.push({ platform: 'ios', status: 'unconfigured', stored: 0 });
  if (!playReady && !ascReady) return outcomes;

  const budget = new SubrequestBudget(STORE_SYNC_SUBREQUEST_BUDGET);
  const at = now.toISOString();
  budget.take();
  const latest = await db.execute(`SELECT platform, MAX(day) AS latest FROM store_download_daily GROUP BY platform`);
  const hasData = new Set(latest.rows.map((r) => String(r.platform)));

  const fail = async (platform: StorePlatform, err: unknown) => {
    if (err instanceof StoreBudgetExhausted) {
      outcomes.push({ platform, status: 'deferred', stored: 0 });
      return;
    }
    outcomes.push({ platform, status: 'failed', stored: 0 });
    hooks.onError?.(platform, err);
    try {
      await db.execute(syncFailed(platform, at, publicMessage(err)));
    } catch {
      // 상태 한 줄을 못 적어도 잃는 것은 화면의 안내뿐이다 — 원래 오류는 위에서 올렸다.
    }
  };

  if (playReady) {
    try {
      const daily = await fetchPlayInstalls(env, now, !hasData.has('android'), budget);
      budget.take();
      const stmts = upserts('android', daily, at);
      await db.batch([...stmts, syncOk('android', at, daily.size === 0 ? '이번 달 보고서가 아직 없어요' : null)], 'write');
      outcomes.push({ platform: 'android', status: 'ok', stored: stmts.length });
    } catch (err) {
      await fail('android', err);
    }
  }

  if (ascReady) {
    try {
      const result = await fetchAscDownloads(env, now, budget, async (ids) => {
        if (ids.length === 0) return new Set();
        const res = await db.execute({
          sql: `SELECT instance_id FROM store_report_instances WHERE instance_id IN (${ids.map(() => '?').join(', ')})`,
          args: ids,
        });
        return new Set(res.rows.map((r) => String(r.instance_id)));
      });
      const stmts = upserts('ios', result.daily, at);
      // 숫자 줄이 하나도 없던 하루치는 0 을 채우되 **이미 있는 값은 덮지 않는다** — 처리일과 보고서 날짜가 어긋나도
      // 받은 숫자를 0 으로 지우지 않게.
      for (const z of result.zeroFill) {
        for (const metric of z.metrics) {
          stmts.push({
            sql: `INSERT OR IGNORE INTO store_download_daily (platform, day, metric, value, fetched_at) VALUES ('ios', ?, ?, 0, ?)`,
            args: [z.day, metric, at],
          });
        }
      }
      for (const inst of result.ingested) {
        stmts.push({
          sql: `INSERT OR IGNORE INTO store_report_instances (instance_id, report, processing_date, ingested_at) VALUES (?, ?, ?, ?)`,
          args: [inst.id, inst.kind, inst.processingDate, at],
        });
      }
      // 목록 창(35일)을 한참 지난 기록은 다시 나열될 일이 없다.
      stmts.push({
        sql: `DELETE FROM store_report_instances WHERE processing_date < ?`,
        args: [new Date(now.getTime() - (ASC_LOOKBACK_DAYS + 30) * 86_400_000).toISOString().slice(0, 10)],
      });
      const note = result.requestCreated
        ? 'App Store 에 분석 보고서를 요청했어요. 첫 보고서까지 하루 이틀 걸려요.'
        : result.deferred > 0
          ? `받을 하루치가 ${result.deferred}개 남았어요. 다음 회차에 이어 받아요.`
          : null;
      // 마지막 쓰기는 `fetchAscDownloads` 가 남겨 둔 몫이라 예산에서 다시 빼지 않는다(받은 것을 버리지 않게).
      await db.batch([...stmts, syncOk('ios', at, note)], 'write');
      outcomes.push({ platform: 'ios', status: result.deferred > 0 ? 'deferred' : 'ok', stored: result.ingested.length });
    } catch (err) {
      await fail('ios', err);
    }
  }

  logStructured('info', { at: 'scheduled.store_downloads', outcomes, budgetLeft: budget.left });
  return outcomes;
}

// ── 화면 숫자 ──────────────────────────────────────────────────────────────────

export interface StorePlatformView {
  platform: StorePlatform;
  /** 빠진 설정 이름 — 비어 있으면 연결됐다. */
  missing: string[];
  /** 막대로 그리는 지표(없으면 받은 숫자가 없다). */
  primaryMetric: string | null;
  /** 받은 마지막 날까지의 30일. 받지 못한 날은 null(0 으로 그리지 않는다). */
  points: Array<{ day: string; value: number | null }>;
  latestDay: string | null;
  /** 30일 창 안의 지표별 합. */
  totals: Record<string, number>;
  /** 마지막 날의 지표 값(누적 사용자 설치·활성 기기처럼 합이 뜻이 없는 것). */
  latestValues: Record<string, number>;
  lastFetchedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  note: string | null;
}

export type StoreDownloads = Record<StorePlatform, StorePlatformView>;

/** 플랫폼마다 막대로 그릴 지표 — 앞에 있는 것부터, 창 안에 값이 있는 첫 지표. */
export const PRIMARY_METRICS: Record<StorePlatform, readonly string[]> = {
  android: ['daily_user_installs', 'daily_device_installs'],
  ios: ['first_time_downloads'],
};

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export async function loadStoreDownloads(db: Client, env: Partial<Env>): Promise<StoreDownloads> {
  const r = await db.batch(
    [
      {
        sql: `SELECT platform, MAX(day) AS latest, MAX(fetched_at) AS fetched FROM store_download_daily GROUP BY platform`,
        args: [],
      },
      { sql: `SELECT platform, last_attempt_at, last_error, note FROM store_download_sync`, args: [] },
      {
        // 플랫폼마다 **받은 마지막 날까지의 30일** — 오늘까지로 자르면 아직 안 나온 날이 0 처럼 보인다.
        sql: `SELECT d.platform, d.day, d.metric, d.value FROM store_download_daily d
              JOIN (SELECT platform, MAX(day) AS latest FROM store_download_daily GROUP BY platform) l ON l.platform = d.platform
              WHERE d.day > date(l.latest, '-30 days')`,
        args: [],
      },
    ],
    'read',
  );
  const agg = new Map(r[0]!.rows.map((x) => [String(x.platform), x]));
  const sync = new Map(r[1]!.rows.map((x) => [String(x.platform), x]));
  const view = (platform: StorePlatform): StorePlatformView => {
    const a = agg.get(platform);
    const s = sync.get(platform);
    const latestDay = a?.latest == null ? null : String(a.latest);
    const byDay = new Map<string, Record<string, number>>();
    for (const x of r[2]!.rows) {
      if (String(x.platform) !== platform) continue;
      const day = String(x.day);
      const entry = byDay.get(day) ?? {};
      entry[String(x.metric)] = Number(x.value ?? 0);
      byDay.set(day, entry);
    }
    const totals: Record<string, number> = {};
    for (const metrics of byDay.values()) for (const [m, v] of Object.entries(metrics)) totals[m] = (totals[m] ?? 0) + v;
    const primaryMetric = PRIMARY_METRICS[platform].find((m) => m in totals) ?? null;
    const points: StorePlatformView['points'] = [];
    if (latestDay && primaryMetric) {
      for (let i = 29; i >= 0; i--) {
        const day = addDays(latestDay, -i);
        const v = byDay.get(day)?.[primaryMetric];
        points.push({ day, value: v === undefined ? null : v });
      }
    }
    return {
      platform,
      missing: platform === 'android' ? playMissingSettings(env) : ascMissingSettings(env),
      primaryMetric,
      points,
      latestDay,
      totals,
      latestValues: (latestDay && byDay.get(latestDay)) || {},
      lastFetchedAt: a?.fetched == null ? null : String(a.fetched),
      lastAttemptAt: s?.last_attempt_at == null ? null : String(s.last_attempt_at),
      lastError: s?.last_error == null ? null : String(s.last_error),
      note: s?.note == null ? null : String(s.note),
    };
  };
  return { android: view('android'), ios: view('ios') };
}
