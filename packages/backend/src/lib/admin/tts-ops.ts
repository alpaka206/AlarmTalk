import type { Env } from '../../types';
import type { DbExecutor } from '../transactions';
import { currentRenderRevision } from '../render-fingerprint';
import {
  listRerenderTargets,
  PROACTIVE_RERENDER_KINDS,
  readRerenderBacklog,
  type RerenderKind,
} from '../render-backlog';
import { isProductionEnvironment, planBulkRerender, ttsBudgetConfigFromEnv } from '../tts-budget';
import { kstDay, monthToDateCharacters, readTtsUsage } from '../tts-usage';
import { MAX_PROVIDER_CLONE_VOICES } from '../voice-slots';
import { checkProviderRemaining } from '../tts-provider-quota';

/**
 * 관리자 콘솔의 **합성 운영 보기**(JSON — `GET /admin/tts/render-backlog`·`GET /admin/tts/usage`,
 * `docs/spec/tts-render-and-budget.md` §5·§4). 읽기만 한다 — 합성·게시·큐 적재를 하지 않는다.
 *
 * ⚠ 설정값은 **정했는가(true/false)와 숫자**만 싣는다. 키·비밀값은 싣지 않는다.
 */

export async function loadRenderBacklog(
  db: DbExecutor,
  env: Env,
  options: { kind: RerenderKind | null; includeLegacy: boolean; limit: number; offset: number },
  now: Date = new Date(),
) {
  const revision = await currentRenderRevision();
  const summary = await readRerenderBacklog(db, revision);
  const needed = summary.filter(
    (row) => PROACTIVE_RERENDER_KINDS.includes(row.kind) && (options.includeLegacy || row.state === 'stale'),
  );
  const config = ttsBudgetConfigFromEnv(env);
  const production = isProductionEnvironment(env.ENVIRONMENT);
  const monthUsed = production ? 0 : await monthToDateCharacters(db, now);
  // 한 회차 계획 — **클립 하나하나로** 세운다(코덱스 #954). 종류·상태 합을 한 덩어리로 넣으면, 한 회차 상한보다 큰 합은 통째로
  //   미뤄져 '이번 회차 0' 으로 보였다(열 개는 들어가는데도). 종류를 골랐으면 그 목록 한 쪽, 아니면 미리 굽는 종류마다 첫 쪽을
  //   모아 세운다. 미룬 글자는 그 쪽 밖의 몫까지 포함해 전체 필요량에서 뺀다.
  const kinds = options.kind ? [options.kind] : [...new Set(needed.map((row) => row.kind))];
  const pages = await Promise.all(
    kinds.map((kind) =>
      listRerenderTargets(db, revision, {
        kind,
        includeLegacy: options.includeLegacy,
        limit: options.limit,
        offset: options.kind ? options.offset : 0,
      }),
    ),
  );
  const planItems = pages.flat();
  const targets = options.kind ? planItems : [];
  const plan = planBulkRerender(
    planItems,
    config,
    production ? undefined : { budget: config.devMonthlyCharBudget, monthUsed },
  );
  const neededCharacters = needed.reduce((sum, row) => sum + row.characters, 0);
  const totalCharacters = options.kind ? plan.totalCharacters : Math.max(neededCharacters, plan.totalCharacters);
  return {
    render_revision: revision,
    summary,
    needed: {
      clips: needed.reduce((sum, row) => sum + row.clips, 0),
      characters: needed.reduce((sum, row) => sum + row.characters, 0),
    },
    targets: options.kind
      ? targets.map((t) => ({
          message_id: t.messageId,
          voice_profile_id: t.voiceProfileId,
          language: t.language,
          characters: t.characters,
          render_revision: t.renderRevision,
          created_at: t.createdAt,
        }))
      : null,
    plan: {
      mode: plan.mode,
      missing_settings: plan.missing,
      selected_characters: plan.selectedCharacters,
      deferred_characters: totalCharacters - plan.selectedCharacters,
      total_characters: totalCharacters,
      concurrency: plan.concurrency,
    },
  };
}

export async function loadTtsUsage(
  db: DbExecutor,
  env: Env,
  options: { days: number; provider: boolean; fetchImpl?: typeof fetch },
  now: Date = new Date(),
) {
  const days = Math.min(Math.max(Math.trunc(options.days) || 0, 1), 100);
  const since = kstDay(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  const usage = await readTtsUsage(db, since);
  const config = ttsBudgetConfigFromEnv(env);
  const production = isProductionEnvironment(env.ENVIRONMENT);
  const slotRows = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN elevenlabs_voice_id IS NOT NULL THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN elevenlabs_voice_id IS NULL AND evicted_at IS NOT NULL THEN 1 ELSE 0 END) AS evicted
          FROM voice_profiles
          WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0`,
    args: [],
  });
  let provider: unknown = null;
  if (options.provider) {
    try {
      const check = await checkProviderRemaining(env, options.fetchImpl);
      provider = check.status === 'ok' || check.status === 'low'
        ? { status: check.status, threshold: check.threshold, ...check.quota }
        : { status: check.status };
    } catch (err) {
      provider = { status: 'error', error: err instanceof Error ? err.name : 'Error' };
    }
  }
  return {
    environment: production ? 'production' : 'non-production',
    since_day: since,
    usage: usage.map((row) => ({
      day: row.day,
      kind: row.kind,
      outcome: row.outcome,
      requests: row.requests,
      retries: row.retries,
      characters: row.characters,
      latency_ms_avg: row.requests > 0 ? Math.round(row.latencyMsTotal / row.requests) : 0,
      latency_ms_max: row.latencyMsMax,
    })),
    budget: {
      dev_monthly_char_budget: config.devMonthlyCharBudget,
      dev_month_to_date_characters: production ? null : await monthToDateCharacters(db, now),
      rerender_batch_max_chars: config.rerenderBatchMaxChars,
      rerender_concurrency: config.rerenderConcurrency,
      provider_remaining_alert_chars: config.providerRemainingAlertChars,
    },
    clone_slots: {
      cap: MAX_PROVIDER_CLONE_VOICES,
      active: Number(slotRows.rows[0]?.active ?? 0),
      evicted: Number(slotRows.rows[0]?.evicted ?? 0),
    },
    provider,
  };
}
