import type { Env } from '../types';
import type { DbExecutor } from './transactions';
import { kstDay, monthToDateCharacters } from './tts-usage';

/**
 * **합성 예산** — 운영자가 정한 숫자로만 움직인다(`docs/spec/tts-render-and-budget.md` §3). 값은 워커 변수(또는 스크립트의
 * 환경 변수·옵션)에서 읽고, 코드에 기본값을 두지 않는다 — 정하지 않은 예산은 **없는 예산**이다:
 *
 * | 이름 | 뜻 | 비어 있으면 |
 * | --- | --- | --- |
 * | `TTS_DEV_MONTHLY_CHAR_BUDGET` | dev(운영이 아닌 환경)의 KST 월 합성 글자 상한 | dev 대량 작업은 dry-run, 요청 경로는 막지 않는다 |
 * | `TTS_RERENDER_BATCH_MAX_CHARS` | 대량 작업 한 회차의 글자 상한 | 대량 작업은 dry-run |
 * | `TTS_RERENDER_CONCURRENCY` | 대량 작업이 동시에 부르는 합성 수 | 대량 작업은 dry-run |
 * | `TTS_PROVIDER_REMAINING_ALERT_CHARS` | 공급자 계정의 남은 글자가 이 밑이면 경보 | 공급자를 조회하지 않는다 |
 *
 * ⚠ 운영(prod)에서는 dev 월 예산을 읽지 않는다 — 운영 요청을 우리 숫자로 막지 않는다(사용자 한도는 따로 있다).
 */
export interface TtsBudgetConfig {
  devMonthlyCharBudget: number | null;
  rerenderBatchMaxChars: number | null;
  rerenderConcurrency: number | null;
  providerRemainingAlertChars: number | null;
}

export const TTS_BUDGET_KEYS = [
  'TTS_DEV_MONTHLY_CHAR_BUDGET',
  'TTS_RERENDER_BATCH_MAX_CHARS',
  'TTS_RERENDER_CONCURRENCY',
  'TTS_PROVIDER_REMAINING_ALERT_CHARS',
] as const;

/** 양의 정수만 받는다. 빈 값·0·음수·소수·숫자 아님은 '정하지 않음'(null)이다. */
export function parseBudgetNumber(value: string | undefined | null): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^[1-9][0-9]{0,11}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function isProductionEnvironment(environment: string | undefined | null): boolean {
  return environment === 'production';
}

export function readTtsBudgetConfig(
  source: Partial<Record<(typeof TTS_BUDGET_KEYS)[number], string | undefined>>,
  environment: string | undefined | null,
): TtsBudgetConfig {
  return {
    devMonthlyCharBudget: isProductionEnvironment(environment)
      ? null
      : parseBudgetNumber(source.TTS_DEV_MONTHLY_CHAR_BUDGET),
    rerenderBatchMaxChars: parseBudgetNumber(source.TTS_RERENDER_BATCH_MAX_CHARS),
    rerenderConcurrency: parseBudgetNumber(source.TTS_RERENDER_CONCURRENCY),
    providerRemainingAlertChars: parseBudgetNumber(source.TTS_PROVIDER_REMAINING_ALERT_CHARS),
  };
}

export function ttsBudgetConfigFromEnv(env: Env): TtsBudgetConfig {
  return readTtsBudgetConfig(env, env.ENVIRONMENT);
}

export type DevBudgetCheck =
  | { ok: true; enforced: false }
  | { ok: true; enforced: true; used: number; budget: number }
  | { ok: false; enforced: true; used: number; budget: number };

/**
 * dev 월 예산 — 이 합성(`characters` 글자)을 해도 상한 안인가. 운영이거나 예산을 정하지 않았으면 DB 를 부르지 않고 통과.
 * 장부를 못 읽으면 던진다(정한 예산을 확인하지 못한 채 쓰지 않는다 — fail-closed).
 */
export async function checkDevBudget(
  db: DbExecutor,
  env: Env,
  characters: number,
  now: Date = new Date(),
): Promise<DevBudgetCheck> {
  const budget = ttsBudgetConfigFromEnv(env).devMonthlyCharBudget;
  if (budget === null) return { ok: true, enforced: false };
  const used = await monthToDateCharacters(db, now);
  if (used + characters > budget) return { ok: false, enforced: true, used, budget };
  return { ok: true, enforced: true, used, budget };
}

/** 잡아 둔 몫이 이만큼 지나면 셈에서 빠진다 — 놓기 전에 워커가 죽어도 dev 예산이 영영 줄어든 채로 남지 않게. */
export const DEV_BUDGET_HOLD_TTL_MS = 5 * 60_000;

export type DevBudgetHold =
  | { ok: true; holdId: string | null }
  | { ok: false; used: number; budget: number };

/**
 * dev 월 예산에서 이 합성의 몫(`characters`)을 **먼저 잡는다**(코덱스 #954). 읽기만 하는 확인은 겹치는 요청이 같은 남은 몫을
 * 함께 쓰게 했다 — 장부는 합성이 끝난 뒤에야 적히기 때문이다. '이번 달 쓴 글자 + 잡아 둔 몫 + 이번 몫 ≤ 예산' 일 때만 한
 * 문장(INSERT … SELECT … WHERE)으로 잡으므로 둘이 동시에 와도 하나만 들어간다. 합성이 끝나면(성공·실패 모두) `releaseDevBudget`
 * 으로 놓는다 — 놓기 전 잠깐은 장부와 잡은 몫이 겹쳐 더 엄하게 센다(넘치게 쓰지 않는 쪽).
 * 운영이거나 예산을 정하지 않았으면 DB 를 부르지 않고 `{ ok: true, holdId: null }`.
 */
export async function holdDevBudget(
  db: DbExecutor,
  env: Env,
  characters: number,
  now: Date = new Date(),
): Promise<DevBudgetHold> {
  const budget = ttsBudgetConfigFromEnv(env).devMonthlyCharBudget;
  if (budget === null) return { ok: true, holdId: null };
  const month = kstDay(now).slice(0, 7);
  const holdId = crypto.randomUUID();
  const freshSince = new Date(now.getTime() - DEV_BUDGET_HOLD_TTL_MS).toISOString();
  const res = await db.execute({
    sql: `INSERT INTO tts_dev_budget_holds (id, usage_month, characters, created_at)
          SELECT ?, ?, ?, ?
          WHERE (SELECT COALESCE(SUM(character_count), 0) FROM tts_synthesis_usage
                  WHERE outcome = 'success' AND usage_day >= ? AND usage_day < ?)
              + (SELECT COALESCE(SUM(characters), 0) FROM tts_dev_budget_holds
                  WHERE usage_month = ? AND created_at >= ?)
              + ? <= ?`,
    args: [holdId, month, characters, now.toISOString(), `${month}-01`, `${month}-32`, month, freshSince, characters, budget],
  });
  if (res.rowsAffected === 0) return { ok: false, used: await monthToDateCharacters(db, now), budget };
  return { ok: true, holdId };
}

/** 잡아 둔 몫을 놓는다(없으면 아무것도 안 한다). 지난 몫도 함께 치운다. 실패해도 던지지 않는다 — 몫은 시간이 지나면 빠진다. */
export async function releaseDevBudget(db: DbExecutor, holdId: string | null, now: Date = new Date()): Promise<void> {
  if (!holdId) return;
  try {
    await db.execute({
      sql: `DELETE FROM tts_dev_budget_holds WHERE id = ? OR created_at < ?`,
      args: [holdId, new Date(now.getTime() - DEV_BUDGET_HOLD_TTL_MS).toISOString()],
    });
  } catch {
    // 놓지 못한 몫은 DEV_BUDGET_HOLD_TTL_MS 뒤 셈에서 빠진다.
  }
}

export interface BulkItem {
  characters: number;
}

export interface BulkPlan<T extends BulkItem> {
  mode: 'dry-run' | 'execute';
  /** dry-run 인 이유 — 비어 있지 않은 설정 이름들(값은 싣지 않는다). */
  missing: string[];
  selected: T[];
  selectedCharacters: number;
  deferred: number;
  deferredCharacters: number;
  totalCharacters: number;
  concurrency: number;
}

/**
 * **대량 작업(다시 굽기·시청본 굽기)의 한 회차를 고른다.** 앞에서부터 회차 상한과(dev 면) 이번 달 남은 예산 안에 드는
 * 것만 담는다. 하나라도 정하지 않았으면 **dry-run** 이다 — 고른 목록과 예상 글자만 보여 주고 합성하지 않는다.
 *
 * @param dev 워커 dev 환경처럼 월 예산을 따지는 자리에서만 넘긴다(`budget` 이 null 이면 dry-run). 로컬 스크립트는 장부를
 *   못 읽으므로 넘기지 않는다 — 회차 상한만 본다.
 */
export function planBulkRerender<T extends BulkItem>(
  items: readonly T[],
  config: Pick<TtsBudgetConfig, 'rerenderBatchMaxChars' | 'rerenderConcurrency'>,
  dev?: { budget: number | null; monthUsed: number },
): BulkPlan<T> {
  const missing: string[] = [];
  if (config.rerenderBatchMaxChars === null) missing.push('TTS_RERENDER_BATCH_MAX_CHARS');
  if (config.rerenderConcurrency === null) missing.push('TTS_RERENDER_CONCURRENCY');
  if (dev && dev.budget === null) missing.push('TTS_DEV_MONTHLY_CHAR_BUDGET');

  const batchCap = config.rerenderBatchMaxChars ?? Number.POSITIVE_INFINITY;
  const monthCap = dev && dev.budget !== null ? Math.max(0, dev.budget - dev.monthUsed) : Number.POSITIVE_INFINITY;
  const cap = Math.min(batchCap, monthCap);

  const selected: T[] = [];
  let selectedCharacters = 0;
  let totalCharacters = 0;
  for (const item of items) {
    totalCharacters += item.characters;
    if (selectedCharacters + item.characters <= cap) {
      selected.push(item);
      selectedCharacters += item.characters;
    }
  }
  return {
    mode: missing.length === 0 ? 'execute' : 'dry-run',
    missing,
    selected,
    selectedCharacters,
    deferred: items.length - selected.length,
    deferredCharacters: totalCharacters - selectedCharacters,
    totalCharacters,
    concurrency: config.rerenderConcurrency ?? 1,
  };
}

/** 고른 일을 `concurrency` 개씩 돌린다. 하나가 실패해도 나머지는 계속한다 — 결과는 순서대로. */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        try {
          results[index] = { status: 'fulfilled', value: await run(items[index]!, index) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}
