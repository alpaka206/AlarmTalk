// 합성 사용량 장부·예산·다시 구울 목록·공급자 잔여(`docs/spec/tts-render-and-budget.md` §3~§5) — 실제 SQLite(메모리)에
// 마이그레이션을 전부 돌리고 확인한다. 공급자는 **가짜 fetch** 다(실제 ElevenLabs 를 부르지 않는다).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv, Env } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const holder: { db: Client | null } = { db: null };
vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import { kstDay, measureSynthesis, monthToDateCharacters, readTtsUsage, recordTtsUsage, speechCharacters } from '../src/lib/tts-usage';
import {
  checkDevBudget,
  parseBudgetNumber,
  planBulkRerender,
  readTtsBudgetConfig,
  runWithConcurrency,
} from '../src/lib/tts-budget';
import { listRerenderTargets, readRerenderBacklog } from '../src/lib/render-backlog';
import { currentRenderRevision } from '../src/lib/render-fingerprint';
import {
  checkProviderRemaining,
  fetchProviderCharacterQuota,
  isProviderQuotaCheckTick,
  ProviderQuotaUnavailableError,
} from '../src/lib/tts-provider-quota';
import adminRoutes from '../src/routes/admin';

let db: Client;
const NOW = new Date('2026-10-26T03:00:00.000Z'); // KST 12시
const FAKE_KEY = 'sk_fake_provider_key_do_not_print';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ELEVENLABS_API_KEY: FAKE_KEY,
    TURSO_DATABASE_URL: 'x',
    TURSO_AUTH_TOKEN: 'x',
    GOOGLE_CLIENT_ID: 'x',
    JWT_SECRET: 'x',
    PASSWORD_PEPPER: 'x',
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  // 이 파일은 원장·문구·목소리 행만 심는다(계정 행 없이) — 사람 표와의 FK 는 이 검사의 관심사가 아니다.
  await db.execute('PRAGMA foreign_keys = OFF');
  holder.db = db;
});

beforeEach(async () => {
  await db.execute('DELETE FROM tts_synthesis_usage');
  await db.execute('DELETE FROM generated_audio_assets');
  await db.execute('DELETE FROM messages');
  await db.execute('DELETE FROM voice_profiles');
});

describe('합성 사용량 장부(#139)', () => {
  it('종류 × 결과 × KST 날짜로 모은다 — 재시도·글자·지연까지', async () => {
    await recordTtsUsage(db, { kind: 'manual', outcome: 'success', characters: 10, latencyMs: 120 }, NOW);
    await recordTtsUsage(db, { kind: 'manual', outcome: 'success', characters: 5, latencyMs: 300, retry: true }, NOW);
    await recordTtsUsage(db, { kind: 'manual', outcome: 'failure', characters: 7, latencyMs: 50 }, NOW);
    await recordTtsUsage(db, { kind: 'clone_reregister', outcome: 'success', characters: 0, latencyMs: 4200 }, NOW);

    const rows = await readTtsUsage(db, kstDay(NOW));
    const success = rows.find((r) => r.kind === 'manual' && r.outcome === 'success');
    expect(success).toMatchObject({ requests: 2, retries: 1, characters: 15, latencyMsTotal: 420, latencyMsMax: 300 });
    expect(rows.find((r) => r.kind === 'manual' && r.outcome === 'failure')).toMatchObject({ requests: 1, characters: 7 });
    expect(rows.find((r) => r.kind === 'clone_reregister')).toMatchObject({ latencyMsMax: 4200, characters: 0 });
    // 이번 달 예산은 성공한 글자만 센다.
    expect(await monthToDateCharacters(db, NOW)).toBe(15);
  });

  it('장부를 못 써도 합성 결과는 그대로 돌려준다 — 실패한 합성은 실패로 적고 다시 던진다', async () => {
    const broken = { execute: async () => { throw new Error('no such table: tts_synthesis_usage'); } };
    await expect(measureSynthesis(broken, { kind: 'manual', text: 'abc' }, async () => 'ok')).resolves.toBe('ok');

    await expect(
      measureSynthesis(db, { kind: 'stock_prerender', text: '안녕' }, async () => {
        throw new Error('provider down');
      }),
    ).rejects.toThrow('provider down');
    const rows = await readTtsUsage(db, '2000-01-01');
    expect(rows.find((r) => r.kind === 'stock_prerender')).toMatchObject({ outcome: 'failure', characters: 2 });
  });

  it('글자는 코드 포인트로 센다(이모지 하나 = 1)', () => {
    expect(speechCharacters('일어나😀')).toBe(4);
  });
});

describe('예산 — 정하지 않은 예산은 없는 예산이다', () => {
  it('양의 정수만 받는다', () => {
    expect(parseBudgetNumber('1000')).toBe(1000);
    for (const bad of [undefined, '', ' ', '0', '-5', '1.5', 'abc', '1e6']) expect(parseBudgetNumber(bad)).toBeNull();
  });

  it('운영에서는 dev 월 예산을 읽지 않는다', () => {
    const source = { TTS_DEV_MONTHLY_CHAR_BUDGET: '1000', TTS_RERENDER_BATCH_MAX_CHARS: '500' };
    expect(readTtsBudgetConfig(source, 'production').devMonthlyCharBudget).toBeNull();
    expect(readTtsBudgetConfig(source, 'development').devMonthlyCharBudget).toBe(1000);
    expect(readTtsBudgetConfig(source, 'production').rerenderBatchMaxChars).toBe(500);
  });

  it('대량 작업은 회차 상한·동시 수(dev 면 월 예산까지)가 다 있어야 돈다 — 아니면 dry-run', () => {
    const items = [{ characters: 40 }, { characters: 30 }, { characters: 50 }];
    const unset = planBulkRerender(items, { rerenderBatchMaxChars: null, rerenderConcurrency: null });
    expect(unset.mode).toBe('dry-run');
    expect(unset.missing).toEqual(['TTS_RERENDER_BATCH_MAX_CHARS', 'TTS_RERENDER_CONCURRENCY']);
    expect(unset.totalCharacters).toBe(120);

    const local = planBulkRerender(items, { rerenderBatchMaxChars: 75, rerenderConcurrency: 2 });
    expect(local.mode).toBe('execute');
    expect(local.selected).toEqual([{ characters: 40 }, { characters: 30 }]);
    expect(local).toMatchObject({ selectedCharacters: 70, deferred: 1, deferredCharacters: 50, concurrency: 2 });

    const devUnset = planBulkRerender(items, { rerenderBatchMaxChars: 75, rerenderConcurrency: 2 }, { budget: null, monthUsed: 0 });
    expect(devUnset.mode).toBe('dry-run');
    expect(devUnset.missing).toEqual(['TTS_DEV_MONTHLY_CHAR_BUDGET']);

    // 이번 달 남은 dev 예산(100 − 60 = 40)이 회차 상한보다 작으면 그게 상한이다.
    const devTight = planBulkRerender(items, { rerenderBatchMaxChars: 75, rerenderConcurrency: 2 }, { budget: 100, monthUsed: 60 });
    expect(devTight.selected).toEqual([{ characters: 40 }]);
  });

  it('dev 월 예산 — 정했으면 장부로 판정하고, 정하지 않았거나 운영이면 DB 를 보지 않는다', async () => {
    await recordTtsUsage(db, { kind: 'manual', outcome: 'success', characters: 90, latencyMs: 1 }, NOW);
    expect(await checkDevBudget(db, env({ TTS_DEV_MONTHLY_CHAR_BUDGET: '100' }), 10, NOW)).toMatchObject({ ok: true, used: 90 });
    expect(await checkDevBudget(db, env({ TTS_DEV_MONTHLY_CHAR_BUDGET: '100' }), 11, NOW)).toMatchObject({ ok: false, used: 90 });
    const untouched = { execute: async () => { throw new Error('must not query'); } };
    expect(await checkDevBudget(untouched, env(), 10_000, NOW)).toEqual({ ok: true, enforced: false });
    expect(
      await checkDevBudget(untouched, env({ ENVIRONMENT: 'production', TTS_DEV_MONTHLY_CHAR_BUDGET: '1' }), 10_000, NOW),
    ).toEqual({ ok: true, enforced: false });
  });

  it('동시 수만큼만 함께 돌리고, 하나가 실패해도 나머지를 마친다', async () => {
    let running = 0;
    let peak = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      if (n === 3) throw new Error('boom');
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  });
});

async function seedLedger() {
  const current = await currentRenderRevision();
  await db.execute(`INSERT INTO voice_profiles (id, user_id, name, status, is_system, elevenlabs_voice_id)
                    VALUES ('sys', 'system', '미나', 'ready', 1, 'el-sys'), ('clone', 'u1', '엄마', 'ready', 0, 'el-clone')`);
  const rows: Array<[string, string, string, number, string, string | null, string | null]> = [
    // [message id, voice, category, is_preset, text, render_revision, logical_key]
    ['m-sys-stale', 'sys', 'medication', 1, '약 먹을 시간이에요', 'rv1-old', null],
    ['m-sys-current', 'sys', 'medication', 1, '지금 세대', current, null],
    ['m-sys-legacy', 'sys', 'weather', 1, '맑아요', null, null],
    ['m-clone-stale', 'clone', 'greeting', 1, '좋은 아침이야', 'rv1-old', null],
    ['m-manual-stale', 'clone', 'custom', 0, '일어나', 'rv1-old', 'lk1-x'],
    ['m-manual-legacy', 'clone', 'custom', 0, '일어나자', null, null],
  ];
  for (const [id, voice, category, preset, text, revision, logical] of rows) {
    await db.execute({
      sql: `INSERT INTO messages (id, user_id, voice_profile_id, text, category, is_preset, audio_url)
            VALUES (?, 'u1', ?, ?, ?, ?, ?)`,
      args: [id, voice, text, category, preset, `r2://k/${id}`],
    });
    await db.execute({
      sql: `INSERT INTO generated_audio_assets
              (id, user_id, voice_profile_id, message_id, provider, provider_voice_id, model_id, language,
               request_hash, text, audio_url, audio_object_key, audio_format, render_revision, logical_key)
            VALUES (?, 'u1', ?, ?, 'elevenlabs', 'el', 'eleven_v4_turbo', 'ko', ?, ?, ?, ?, 'mp3', ?, ?)`,
      args: [`ga-${id}`, voice, id, `h-${id}`, text, `r2://k/${id}`, `k/${id}`, revision, logical],
    });
  }
  // 제자리 교체로 밀려난 옛 원장 행 — 문구 행이 다른 오브젝트를 가리킨다. 다시 구울 대상이 아니다.
  await db.execute({
    sql: `INSERT INTO generated_audio_assets
            (id, user_id, voice_profile_id, message_id, provider, provider_voice_id, model_id, language,
             request_hash, text, audio_url, audio_object_key, audio_format, render_revision)
          VALUES ('ga-replaced', 'u1', 'sys', 'm-sys-stale', 'elevenlabs', 'el', 'eleven_v3', 'ko', 'h-replaced',
                  '옛 소리', 'r2://k/replaced', 'k/replaced', 'mp3', 'rv1-ancient')`,
    args: [],
  });
  return current;
}

describe('다시 구울 목록', () => {
  it('지금 게시 중인 렌더 중 세대가 다른 것만, 종류·상태별 개수와 글자로 센다', async () => {
    const current = await seedLedger();
    const summary = await readRerenderBacklog(db, current);
    const find = (kind: string, state: string) => summary.find((r) => r.kind === kind && r.state === state);
    expect(find('system_stock', 'stale')).toMatchObject({ clips: 1, characters: '약 먹을 시간이에요'.length, action: 'publish_stock' });
    expect(find('system_stock', 'legacy')).toMatchObject({ clips: 1 });
    expect(find('clone_prerender', 'stale')).toMatchObject({ clips: 1, action: 'prerender_queue' });
    expect(find('manual', 'stale')).toMatchObject({ clips: 1, action: 'lazy_no_charge' });
    expect(find('manual', 'legacy')).toMatchObject({ clips: 1 }); // 논리 키가 없어도 category custom 이면 직접 입력이다
    // 지금 세대·밀려난 옛 행은 세지 않는다.
    expect(summary.reduce((n, r) => n + r.clips, 0)).toBe(5);
  });

  it('한 종류의 대상 목록 — 지문 이전은 고를 때만, 쪽은 100 을 넘지 않는다', async () => {
    const current = await seedLedger();
    const stale = await listRerenderTargets(db, current, { kind: 'system_stock', includeLegacy: false, limit: 1000, offset: -3 });
    expect(stale.map((t) => t.messageId)).toEqual(['m-sys-stale']);
    const withLegacy = await listRerenderTargets(db, current, { kind: 'system_stock', includeLegacy: true, limit: 50, offset: 0 });
    expect(withLegacy.map((t) => t.messageId).sort()).toEqual(['m-sys-legacy', 'm-sys-stale']);
  });
});

describe('공급자 잔여 — 가짜 fetch', () => {
  function fakeFetch(body: unknown, status = 200) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('문턱을 정하지 않았으면 조회하지 않는다', async () => {
    const { impl, calls } = fakeFetch({});
    expect(await checkProviderRemaining(env(), impl)).toEqual({ status: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('남은 글자가 문턱 밑이면 low — 키는 헤더에만 싣는다', async () => {
    const { impl, calls } = fakeFetch({ character_count: 950_000, character_limit: 1_000_000, next_character_count_reset_unix: 1_790_000_000 });
    const check = await checkProviderRemaining(env({ TTS_PROVIDER_REMAINING_ALERT_CHARS: '100000' }), impl);
    expect(check).toMatchObject({ status: 'low', threshold: 100_000, quota: { remaining: 50_000 } });
    expect(calls[0]!.url).not.toContain(FAKE_KEY);
    expect((calls[0]!.init?.headers as Record<string, string>)['xi-api-key']).toBe(FAKE_KEY);
    expect(JSON.stringify(check)).not.toContain(FAKE_KEY);
  });

  it('실패·모양이 다른 응답은 던지고, 오류 문구에 키도 응답 본문도 싣지 않는다', async () => {
    const failing = fakeFetch({ detail: `bad key ${FAKE_KEY}` }, 401);
    const err = await fetchProviderCharacterQuota(FAKE_KEY, failing.impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderQuotaUnavailableError);
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
    expect(String((err as Error).message)).toContain('401');

    const shapeless = fakeFetch({ tier: 'creator' });
    await expect(fetchProviderCharacterQuota(FAKE_KEY, shapeless.impl)).rejects.toBeInstanceOf(ProviderQuotaUnavailableError);
  });

  it('cron 은 한 시간에 한 번(정시 첫 틱)만 조회한다', () => {
    expect(isProviderQuotaCheckTick(new Date('2026-10-26T03:00:00Z'))).toBe(true);
    expect(isProviderQuotaCheckTick(new Date('2026-10-26T03:05:00Z'))).toBe(false);
  });
});

describe('관리자 JSON — 읽기만 한다', () => {
  const SECRET = 'admin-secret-value';
  const AUTH = 'Basic ' + Buffer.from('x:' + SECRET).toString('base64');
  function request(path: string, extra: Partial<Env> = {}) {
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    return a.request(`http://localhost${path}`, { headers: { Authorization: AUTH } }, {
      ...env(extra),
      ADMIN_SECRET: SECRET,
    } as unknown as AppEnv['Bindings']);
  }

  it('다시 구울 목록과 예상 글자, 예산을 안 정했으면 dry-run 과 빠진 설정 이름을 싣는다', async () => {
    await seedLedger();
    const res = await request('/admin/tts/render-backlog');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.render_revision).toBe(await currentRenderRevision());
    // 미리 굽는 종류(기본 목소리·클론)의 '다른 세대' 만 — 지문 이전·직접 입력은 넣지 않는다.
    expect(body.needed.clips).toBe(2);
    expect(body.plan.mode).toBe('dry-run');
    expect(body.plan.missing_settings).toEqual([
      'TTS_RERENDER_BATCH_MAX_CHARS',
      'TTS_RERENDER_CONCURRENCY',
      'TTS_DEV_MONTHLY_CHAR_BUDGET',
    ]);
    const listed = await (await request('/admin/tts/render-backlog?kind=clone_prerender')).json();
    expect(listed.targets.map((t: { message_id: string }) => t.message_id)).toEqual(['m-clone-stale']);
    expect(JSON.stringify(listed)).not.toContain('좋은 아침이야'); // 문구 원문은 싣지 않는다
    expect((await request('/admin/tts/render-backlog?kind=bogus')).status).toBe(400);
  });

  it('사용량·예산·클론 슬롯을 싣고, 키는 어디에도 없다', async () => {
    await recordTtsUsage(db, { kind: 'manual', outcome: 'success', characters: 12, latencyMs: 200 }, new Date());
    await db.execute(`INSERT INTO voice_profiles (id, user_id, name, status, is_system, elevenlabs_voice_id, evicted_at)
                      VALUES ('c1', 'u1', 'a', 'ready', 0, 'el-1', NULL), ('c2', 'u2', 'b', 'ready', 0, NULL, datetime('now'))`);
    const res = await request('/admin/tts/usage?days=7', { TTS_RERENDER_BATCH_MAX_CHARS: '5000' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE_KEY);
    const body = JSON.parse(text);
    expect(body.usage.find((u: { kind: string }) => u.kind === 'manual')).toMatchObject({ characters: 12, latency_ms_avg: 200 });
    expect(body.budget).toMatchObject({ rerender_batch_max_chars: 5000, dev_monthly_char_budget: null });
    expect(body.clone_slots).toMatchObject({ active: 1, evicted: 1 });
    expect(body.provider).toBeNull(); // ?provider=1 이 아니면 조회하지 않는다
  });
});
