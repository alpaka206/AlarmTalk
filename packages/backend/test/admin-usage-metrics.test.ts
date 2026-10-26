// 사용 기록 2판(#142) → 관리자 「사용 지표」(`docs/spec/admin-console.md`, `docs/spec/usage-events.md` §7).
// 실제 SQLite(메모리)에 마이그레이션을 전부 돌리고, 앱이 보내는 모양 그대로 `POST /events` 로 넣은 뒤 센다.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';
import { fakeAuthMiddleware } from './helpers';

const holder: { db: Client | null } = { db: null };
// 2판 칸은 처리방침 8판(아직 없음) 동의자부터라(`USAGE_EVENT_DETAIL_MIN_PRIVACY_VERSION`), 저장 경로를 보려면 그 경계를
// 1판 경계와 같게 둔다. 고지 전 갈래는 `detailGate.closed = true` 로 본다.
const detailGate = vi.hoisted(() => ({ closed: false }));
vi.mock('../src/lib/consent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/consent')>();
  return {
    ...actual,
    usageEventDetailConsentSince: (latest: Parameters<typeof actual.usageEventDetailConsentSince>[0]) =>
      detailGate.closed ? actual.usageEventDetailConsentSince(latest) : actual.usageEventConsentSince(latest),
  };
});

vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import eventsRoutes from '../src/routes/events';
import adminRoutes from '../src/routes/admin';
import { filterSql, loadUsageMetrics, parseUsageFilter, percentiles } from '../src/lib/admin/usage-metrics';
import { entitlementSourceFrom } from '../src/lib/usage-entitlement';

let db: Client;

async function run(sql: string, args: Array<string | number | null> = []) {
  await db.execute({ sql, args });
}

/** 지금보다 `minutesAgo` 분 앞의 ISO 시각. 동의(아래) 뒤여야 받힌다. */
const ago = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

async function post(userId: string, events: Array<Record<string, unknown>>, platform = 'android') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/events', eventsRoutes);
  const res = await app.request(
    new Request('http://localhost/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Platform': platform },
      body: JSON.stringify({ events }),
    }),
    undefined,
    {} as AppEnv['Bindings'],
  );
  expect(res.status).toBe(200);
  return res.json();
}

function ev(type: string, minutesAgo: number, extra: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), type, occurred_at: ago(minutesAgo), schema_version: 2, app_version: '41', ...extra };
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  holder.db = db;
  // 동의는 두 시간 전 — 아래 기록은 모두 그 뒤다.
  const consentAt = new Date(Date.now() - 120 * 60_000).toISOString().replace('T', ' ').replace('Z', '');
  for (const [id, plan] of [
    ['u-free', 'free'],
    ['u-paid', 'plus'],
    ['u-admin', 'free'],
  ] as const) {
    await run(`INSERT INTO users (id, email, name, plan) VALUES (?, ?, ?, ?)`, [id, `${id}@example.com`, id, plan]);
    for (const type of ['terms', 'privacy', 'age14']) {
      await run(
        `INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
        [crypto.randomUUID(), id, type, CURRENT_POLICY_VERSION, consentAt],
      );
    }
  }
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, expires_at) VALUES ('sub-1', 'u-paid', '70000000-0000-4000-8000-000000000002', 'active', '2099-01-01T00:00:00Z')`,
  );
  await run(
    `INSERT INTO plan_grants (id, user_id, starts_at, ends_at, reason, granted_by, request_key)
     VALUES ('g-1', 'u-admin', '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z', 'support', 'admin-console', 'k-1')`,
  );

  const prepAttempt = crypto.randomUUID();
  const unfinished = crypto.randomUUID();
  await post('u-free', [
    ev('sample_started', 60),
    ev('sample_completed', 59),
    ev('auth_result', 58, { props: { outcome: 'success', method: 'google' } }),
    ev('voice_preparation_started', 57, { attempt_id: prepAttempt, props: { scope: 'all_voices', cache_state: 'cold', target_count: 4 } }),
    ev('voice_preparation_ready', 56, {
      attempt_id: prepAttempt,
      props: { scope: 'all_voices', target_count: 4, completed_count: 4, bytes: 400_000, duration_ms: 3000 },
    }),
    ev('voice_preparation_started', 55, { attempt_id: unfinished, props: { scope: 'selected_voice', cache_state: 'partial' } }),
    ev('alarm_save_attempt', 54),
    ev('alarm_save_blocked', 54, { props: { reason: 'manual_text_missing' } }),
    ev('alarm_save_attempt', 53),
    ev('alarm_ready', 53),
    ev('generation_outcome', 52, { props: { outcome: 'success', charged_source: 'base', usage_month: '2026-10', char_count: 30 } }),
    ev('generation_outcome', 51, { props: { outcome: 'failure', charged_source: 'none', error_code: 'tts_failed' } }),
    ev('manual_result_reused', 50, { props: { reuse_location: 'local' } }),
    ev('reward_pending', 45, { attempt_id: crypto.randomUUID() }),
    ev('alarm_rang', 40),
    ev('alarm_dismissed', 39),
  ]);
  const ad = crypto.randomUUID();
  await post(
    'u-paid',
    [
      ev('sample_completed', 30),
      ev('paywall_viewed', 29, { props: { surface: 'editor' } }),
      ev('store_purchase_verified', 28, { props: { outcome: 'success', store_offer: 'free_trial', product_id: 'plus_monthly' } }),
      ev('entitlement_changed', 28, { props: { from_plan: 'free', to_plan: 'plus' } }),
      ev('reward_pending', 27, { attempt_id: ad }),
      ev('reward_granted', 26, { attempt_id: ad, props: { duration_ms: 4000 } }),
      ev('alarm_dismissed', 20),
    ],
    'ios',
  );
  await post('u-admin', [ev('sample_started', 10, { platform: 'android', app_version: '40' })]);
});

describe('권한 출처', () => {
  it('결제 > 관리자 지급 > 기간 한정 > 무료 — 한 기록에 하나', () => {
    expect(entitlementSourceFrom({ rawPlan: 'plus', hasSubscription: true, hasGrant: true, promoActive: true })).toBe('paid');
    expect(entitlementSourceFrom({ rawPlan: 'free', hasSubscription: false, hasGrant: true, promoActive: true })).toBe('admin');
    expect(entitlementSourceFrom({ rawPlan: 'free', hasSubscription: false, hasGrant: false, promoActive: true })).toBe('promo');
    expect(entitlementSourceFrom({ rawPlan: 'free', hasSubscription: false, hasGrant: false, promoActive: false })).toBe('free');
  });

  it('받는 순간 계정 상태로 찍는다', async () => {
    const rows = await db.execute(`SELECT user_id, entitlement_source FROM usage_events GROUP BY user_id`);
    const map = Object.fromEntries(rows.rows.map((r) => [String(r.user_id), String(r.entitlement_source)]));
    expect(map).toEqual({ 'u-free': 'free', 'u-paid': 'paid', 'u-admin': 'admin' });
  });
});

describe('사용 지표', () => {
  it('퍼널은 사람 수와 앞 단계 기준 전환을 낸다', async () => {
    const m = await loadUsageMetrics(db, parseUsageFilter(() => undefined));
    const step = (key: string) => m.funnel.find((s) => s.key === key)!;
    expect(step('sample_started').users).toBe(2); // u-free, u-admin
    expect(step('sample_completed')).toMatchObject({ users: 2, fromPrevious: 1, previousUsers: 2 });
    expect(step('auth_success')).toMatchObject({ users: 1, fromPrevious: 1, previousUsers: 2 });
    expect(step('alarm_ready')).toMatchObject({ users: 1, fromPrevious: 1, previousUsers: 1 });
  });

  it('준비는 범위별 시작·완료·바이트·시간을, 끝나지 않은 시작은 실패와 따로 센다', async () => {
    const m = await loadUsageMetrics(db, parseUsageFilter(() => undefined));
    const all = m.preparation.find((p) => p.scope === 'all_voices')!;
    expect(all).toMatchObject({ started: 1, ready: 1, failed: 0, avgBytes: 400_000 });
    expect(all.duration).toEqual({ count: 1, p50: 3000, p90: 3000 });
    expect(m.preparation.find((p) => p.scope === 'selected_voice')).toMatchObject({ started: 1, failed: 0 });
    expect(m.preparationUnfinished).toBe(1);
  });

  it('저장·막힘·준비 완료와 막힌 사유', async () => {
    const m = await loadUsageMetrics(db, parseUsageFilter(() => undefined));
    expect(m.save).toEqual({ attempts: 2, blocked: 1, ready: 1 });
    expect(m.saveBlockReasons).toEqual([{ reason: 'manual_text_missing', count: 1 }]);
  });

  it('직접 입력의 새 제작·실패·재사용·평균 글자·정산', async () => {
    const m = await loadUsageMetrics(db, parseUsageFilter(() => undefined));
    expect(m.manual).toMatchObject({ created: 1, failed: 1, reusedLocal: 1, reusedServer: 0, avgChars: 30 });
    expect(m.manual.charged).toEqual([{ source: 'base', count: 1 }]);
  });

  it('광고 지급 지연과 30분 넘은 누락', async () => {
    const m = await loadUsageMetrics(db, parseUsageFilter(() => undefined));
    expect(m.ads).toMatchObject({ pending: 2, granted: 1, missing: 1 });
    expect(m.ads.grantDelay.p50).toBe(4000);
  });

  it('결제는 체험과 정가를 가르고, 권한 출처별 사람은 겹치지 않는다', async () => {
    const m = await loadUsageMetrics(db, parseUsageFilter(() => undefined));
    expect(m.billing.purchases).toEqual([{ offer: 'free_trial', outcome: 'success', count: 1, users: 1 }]);
    expect(m.billing.changes).toEqual([{ from: 'free', to: 'plus', count: 1 }]);
    const total = m.usersBySource.reduce((sum, s) => sum + s.users, 0);
    expect(total).toBe(3);
  });

  it('플랫폼·버전·권한 출처로 거른다 — 1판 기록의 플랫폼은 헤더로 채워졌다', async () => {
    const ios = await loadUsageMetrics(db, parseUsageFilter((k) => ({ platform: 'ios' })[k as 'platform']));
    expect(ios.funnel.find((s) => s.key === 'sample_completed')!.users).toBe(1);
    const v40 = await loadUsageMetrics(db, parseUsageFilter((k) => ({ version: '40' })[k as 'version']));
    expect(v40.funnel.find((s) => s.key === 'sample_started')!.users).toBe(1);
    const admin = await loadUsageMetrics(db, parseUsageFilter((k) => ({ source: 'admin' })[k as 'source']));
    expect(admin.usersBySource).toEqual([{ source: 'admin', users: 1 }]);
  });

  it('모르는 거르기 값은 버리고, 조각은 값을 바인딩으로만 넣는다', () => {
    const f = parseUsageFilter((k) => ({ platform: 'web', version: "1' OR 1=1", source: 'vip', range: '999' })[k as 'platform']);
    expect(f).toEqual({ range: 30, platform: null, appVersion: null, source: null });
    const sql = filterSql({ range: 7, platform: 'ios', appVersion: '41', source: 'free' });
    expect(sql.args).toEqual([7, 'ios', '41', 'free']);
    expect(sql.sql).not.toMatch(/ios|41|free/);
  });

  it('백분위는 최근접 순위', () => {
    expect(percentiles([])).toEqual({ count: 0, p50: null, p90: null });
    expect(percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ count: 10, p50: 5, p90: 9 });
  });

  it('화면이 그려진다 — 줄표 없음, iOS 울림은 0 이 아니라 관측 없음', async () => {
    const SECRET = 'admin-secret-value';
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    const res = await a.request(
      'http://localhost/admin/usage?range=7',
      { headers: { Authorization: 'Basic ' + Buffer.from('x:' + SECRET).toString('base64') } },
      { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings'],
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>사용 지표</h1>');
    expect(html).toContain('관측 없음');
    expect(html).toContain('해제는 기상 성공이 아니에요');
    expect(html).not.toContain('—');
  });
});
