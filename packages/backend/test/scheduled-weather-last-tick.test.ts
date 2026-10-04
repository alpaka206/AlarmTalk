// **날씨 슬롯의 마지막 틱이면 날씨 작업을 5분 틱의 맨 앞에서 돈다**(코덱스 #846, 스펙 5-1 「실패」).
//
// 마지막 틱(현지 분 ≥ 55) 뒤에는 그 슬롯의 틱이 없어 판정·경보(`slot_failed`)가 거기서만 나간다. 그런데 경보의
// Sentry 전송도 subrequest 하나다 — 앞선 cron 작업이 실행의 한도(무료 50)를 다 쓴 뒤라면 판정을 해도 **언제나**
// 닿지 않는다. 그래서 그 틱에는 날씨를 맨 앞에서 돌린다. 그 밖의 틱은 원래 자리(계정 파기 뒤, 클론 드레인 앞)다.
//
// 실행 하나의 subrequest 를 세는 작은 모형을 둔다 — 각 작업·DB 호출·Sentry 전송이 같은 한도에서 꺼내 쓰고, 모자라면
// 워커처럼 'Too many subrequests' 로 던진다(Sentry 전송은 실패를 삼킨다 — Toucan 의 전송도 그렇다).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    /** 작업이 시작된 순서. */
    order: [] as string[],
    /** 이 실행에 남은 subrequest. */
    left: 50,
    /** 오디오 정리가 쓰는 subrequest — 붐비는 틱이면 크다. */
    heavy: 0,
    lastTick: false,
    /** Sentry 에 닿은 이벤트 / 한도에 걸려 사라진 이벤트(메시지). */
    delivered: [] as string[],
    lost: [] as string[],
  };
  /** 실행 하나의 subrequest 한도에서 n 개를 꺼낸다. 모자라면 남은 것을 다 쓰고 워커처럼 던진다. */
  const spend = (n: number) => {
    if (state.left < n) {
      state.left = 0;
      throw new Error('Too many subrequests.');
    }
    state.left -= n;
  };
  /** Toucan 의 전송 — fetch 하나다. 실패는 삼킨다(캡처한 쪽은 모른다). */
  const send = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    try {
      spend(1);
      state.delivered.push(message);
    } catch {
      state.lost.push(message);
    }
  };
  return { state, spend, send };
});

vi.mock('toucan-js', () => ({
  Toucan: class {
    captureException = (err: unknown) => h.send(err);
    withScope = (fn: (scope: { setTags: () => void; captureException: (err: unknown) => void }) => void) =>
      fn({ setTags: () => undefined, captureException: (err: unknown) => h.send(err) });
  },
}));
vi.mock('../src/lib/audio-retention', () => ({
  cleanupExpiredAudio: vi.fn(async () => {
    h.state.order.push('audio_retention');
    h.spend(h.state.heavy);
  }),
  cleanupStaleDraftVoices: vi.fn().mockResolvedValue(undefined),
  drainExternalDeletions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/billing-cancel', () => ({
  processSubscriptionExpiry: vi.fn(async () => {
    h.state.order.push('subscription_expiry');
  }),
}));
vi.mock('../src/lib/pending-plan-notifications', () => ({
  runPlanNotificationDrainTurn: vi.fn().mockResolvedValue(false),
  isPlanNotificationDrainMinute: () => false,
  prunePendingPlanNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/personal-promo-end', () => ({
  runPersonalPromoEnd: vi.fn(async () => {
    h.state.order.push('personal_promo_end');
    return { transitioned: [], sweep: null };
  }),
  isPromoEndAlertSlot: () => false,
}));
vi.mock('../src/lib/account-deletion', () => ({
  purgeUserAccount: vi.fn(),
  pseudonymizeBillingForRetention: vi.fn(),
}));
vi.mock('../src/lib/transactions', () => ({ withWriteTransaction: vi.fn() }));
vi.mock('../src/lib/fcm', () => ({
  sendAlarmPush: vi.fn().mockResolvedValue(undefined),
  notifyDowngradedAlarms: vi.fn().mockResolvedValue(undefined),
}));
// 라우트가 상수(`CLONE_CLIP_SEEDS` …)를 정적으로 가져가므로 드레인만 바꾼다.
vi.mock('../src/lib/stock-clips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/stock-clips')>()),
  runPrerenderBatch: vi.fn(async () => {
    h.state.order.push('stock_clips');
    return { rendered: 0, claimed: 0 };
  }),
}));
// 날씨 작업은 한 틱의 최대(조회 1 + fetch 10 + 쓰기 1)를 쓰고, 마지막 틱이면 판정에서 경보 하나를 낸다.
vi.mock('../src/lib/weather-region-daily', () => ({
  hasOpenWeatherSlot: () => true,
  hasWeatherSlotLastTick: () => h.state.lastTick,
  refreshWeatherRegionDaily: vi.fn(
    async (_db: unknown, _now: Date, options: { onAlert?: (alert: Record<string, unknown>) => void }) => {
      h.state.order.push('weather');
      h.spend(12);
      const alert = { country: 'JP', slot: 'evening', source: 'jma', reason: 'http_503', done: 0, total: 47 };
      if (h.state.lastTick) options.onAlert?.(alert);
      return {
        open: 47,
        due: 47,
        attempted: 8,
        stored: 0,
        failures: [],
        deferred: 39,
        budgetExhausted: false,
        missingTable: false,
        alerts: h.state.lastTick ? [alert] : [],
      };
    },
  ),
}));
vi.mock('../src/lib/db', () => ({
  getDB: () => ({
    execute: vi.fn(async (arg: { sql?: string } | string) => {
      const sql = typeof arg === 'string' ? arg : (arg.sql ?? '');
      if (sql.includes("deletion_status = 'pending_deletion'")) h.state.order.push('account_purge');
      h.spend(1);
      return { rows: [] };
    }),
  }),
  initDB: vi.fn(),
}));

import worker from '../src/index';

const ENV = {
  TURSO_DATABASE_URL: 'mock',
  TURSO_AUTH_TOKEN: 'mock',
  PASSWORD_PEPPER: 'pep',
  SENTRY_DSN: 'https://public@o0.ingest.sentry.io/0',
} as never;
const CTX = { waitUntil: () => undefined, passThroughOnException: () => undefined } as never;
const SLOT_ALERT = 'weather slot failed: JP evening jma http_503';

function tick(iso: string, options: { lastTick: boolean; heavy?: number }) {
  h.state.order = [];
  h.state.left = 50;
  h.state.heavy = options.heavy ?? 0;
  h.state.lastTick = options.lastTick;
  h.state.delivered = [];
  h.state.lost = [];
  return worker.scheduled({ scheduledTime: Date.parse(iso), cron: '*/5 * * * *' } as never, ENV, CTX);
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('scheduled() — 날씨 슬롯의 마지막 틱', () => {
  it('마지막 틱이면 날씨가 5분 틱의 맨 앞이다 — 그 밖의 틱은 계정 파기 뒤·클론 드레인 앞(한 번만 돈다)', async () => {
    await tick('2026-10-01T12:55:00Z', { lastTick: true });
    expect(h.state.order[0]).toBe('weather');
    expect(h.state.order.filter((job) => job === 'weather')).toHaveLength(1);
    // 나머지 작업도 그대로 돈다(남은 예산으로).
    expect(h.state.order).toEqual(expect.arrayContaining(['audio_retention', 'account_purge', 'stock_clips']));

    await tick('2026-10-01T12:50:00Z', { lastTick: false });
    const order = h.state.order;
    expect(order[0]).toBe('audio_retention');
    expect(order.filter((job) => job === 'weather')).toHaveLength(1);
    expect(order.indexOf('weather')).toBeGreaterThan(order.indexOf('account_purge'));
    expect(order.indexOf('weather')).toBeLessThan(order.indexOf('stock_clips'));
  });

  it('앞 작업이 한도를 거의 다 쓰는 붐비는 틱이어도 마지막 틱의 slot_failed 는 Sentry 에 닿는다', async () => {
    // 오디오 정리가 45 를 쓰는 틱 — 날씨가 뒤에 있으면 그 fetch·경보가 한도에 걸린다.
    await tick('2026-10-01T12:55:00Z', { lastTick: true, heavy: 45 });
    expect(h.state.delivered).toContain(SLOT_ALERT);
    expect(h.state.lost).not.toContain(SLOT_ALERT);
    // 날씨 뒤로 밀린 작업은 남은 예산으로 돌고, 한도에 걸리면 다음 틱이 잇는다(그쪽은 다음 틱이 있다).
    expect(h.state.order).toEqual(expect.arrayContaining(['audio_retention', 'stock_clips']));
  });
});
