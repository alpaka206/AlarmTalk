import type { DbExecutor } from './transactions';

/**
 * **다시 구울 목록 — 무엇이 지금 세대가 아닌가, 몇 글자인가**(`docs/spec/tts-render-and-budget.md` §5).
 *
 * 원장(`generated_audio_assets`)의 렌더 세대(`render_revision`)를 지금 코드의 세대(`currentRenderRevision`)와 맞대 본다.
 * **지금 실제로 게시 중인 렌더만** 센다 — 문구 행이 그 오브젝트를 가리키고(`m.audio_url = ga.audio_url`) 은퇴하지 않은
 * 것. 제자리 교체로 밀려난 옛 원장 행은 다시 구울 대상이 아니다.
 *
 * 세대가 NULL 인 행은 지문을 들이기 전(#139 전)에 만든 것이라 설정을 모른다 — `legacy` 로 따로 센다. 대부분 지금
 * 설정으로 만들어졌으므로(마지막 설정 변경은 2026-10-08 음량) 기본으로는 다시 구울 대상에 넣지 않는다.
 *
 * 무엇을 어떻게 다시 굽는가는 종류가 정한다(`action`):
 *  - `system_stock` — 기본 목소리 게시본. 사람이 들어 본 시청본을 게시한다(`preview:stock` → `publish:stock` 교체 갈래).
 *  - `clone_prerender` — 클론 사전렌더. 다시 굽기 큐(cron 이 틱당 몇 개씩)로 굽는다.
 *  - `manual` — 직접 입력. **미리 굽지 않는다** — 사용자가 다시 받을 때 세지 않고 굽는다(§2). 기기에 받아 둔 파일은
 *    그대로 울린다. 숫자는 '전부 다시 받으면' 의 최대치다.
 *  - `other` — 동적 문구·등록 미리듣기. 다시 굽지 않는다(요청마다 새로 만든다).
 */

export const RERENDER_KINDS = ['system_stock', 'clone_prerender', 'manual', 'other'] as const;
export type RerenderKind = (typeof RERENDER_KINDS)[number];

export const RERENDER_ACTION: Record<RerenderKind, 'publish_stock' | 'prerender_queue' | 'lazy_no_charge' | 'none'> = {
  system_stock: 'publish_stock',
  clone_prerender: 'prerender_queue',
  manual: 'lazy_no_charge',
  other: 'none',
};

/** 미리 다시 구워야 하는 종류 — 나머지는 요청 때 굽거나 굽지 않는다. */
export const PROACTIVE_RERENDER_KINDS: readonly RerenderKind[] = ['system_stock', 'clone_prerender'];

export function isRerenderKind(value: unknown): value is RerenderKind {
  return typeof value === 'string' && (RERENDER_KINDS as readonly string[]).includes(value);
}

// 개발자 고정 조각 — 사용자 값이 들어가지 않는다(값은 전부 `?` 로 바인딩한다).
const KIND_SQL = `CASE
  WHEN COALESCE(m.is_preset, 0) = 1 AND COALESCE(vp.is_system, 0) = 1 THEN 'system_stock'
  WHEN COALESCE(m.is_preset, 0) = 1 THEN 'clone_prerender'
  WHEN ga.logical_key IS NOT NULL OR m.category = 'custom' THEN 'manual'
  ELSE 'other'
END`;

const PUBLISHED_FROM_SQL = `FROM generated_audio_assets ga
  JOIN messages m ON m.id = ga.message_id AND m.audio_url = ga.audio_url
  LEFT JOIN voice_profiles vp ON vp.id = ga.voice_profile_id
  WHERE m.retired_at IS NULL
    AND (ga.render_revision IS NULL OR ga.render_revision <> ?)`;

export interface RerenderBacklogRow {
  kind: RerenderKind;
  /** `legacy` = 지문 이전(설정 미상), `stale` = 다른 세대. */
  state: 'legacy' | 'stale';
  clips: number;
  characters: number;
  action: (typeof RERENDER_ACTION)[RerenderKind];
}

export async function readRerenderBacklog(db: DbExecutor, currentRevision: string): Promise<RerenderBacklogRow[]> {
  const res = await db.execute({
    sql: `SELECT kind, state, COUNT(*) AS clips, COALESCE(SUM(chars), 0) AS characters FROM (
            SELECT ${KIND_SQL} AS kind,
                   CASE WHEN ga.render_revision IS NULL THEN 'legacy' ELSE 'stale' END AS state,
                   LENGTH(ga.text) AS chars
            ${PUBLISHED_FROM_SQL}
          )
          GROUP BY kind, state
          ORDER BY kind, state`,
    args: [currentRevision],
  });
  return res.rows
    .filter((row) => isRerenderKind(row.kind))
    .map((row) => {
      const kind = row.kind as RerenderKind;
      return {
        kind,
        state: String(row.state) === 'legacy' ? 'legacy' : 'stale',
        clips: Number(row.clips ?? 0),
        characters: Number(row.characters ?? 0),
        action: RERENDER_ACTION[kind],
      };
    });
}

export interface RerenderTarget {
  messageId: string;
  voiceProfileId: string;
  language: string;
  characters: number;
  renderRevision: string | null;
  createdAt: string | null;
}

/**
 * 한 종류의 다시 구울 대상(오래된 것부터). `limit` 은 1~100, `offset` 은 0 이상으로 자른다. 문구 원문은 싣지 않는다
 * (식별자와 글자 수만).
 */
export async function listRerenderTargets(
  db: DbExecutor,
  currentRevision: string,
  options: { kind: RerenderKind; includeLegacy: boolean; limit: number; offset: number },
): Promise<RerenderTarget[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit) || 0, 1), 100);
  const offset = Math.max(Math.trunc(options.offset) || 0, 0);
  const res = await db.execute({
    sql: `SELECT message_id, voice_profile_id, language, chars, render_revision, created_at FROM (
            SELECT ${KIND_SQL} AS kind, ga.message_id, ga.voice_profile_id, ga.language,
                   LENGTH(ga.text) AS chars, ga.render_revision, ga.created_at
            ${PUBLISHED_FROM_SQL}
          )
          WHERE kind = ? AND (? = 1 OR render_revision IS NOT NULL)
          ORDER BY created_at ASC, message_id ASC
          LIMIT ? OFFSET ?`,
    args: [currentRevision, options.kind, options.includeLegacy ? 1 : 0, limit, offset],
  });
  return res.rows.map((row) => ({
    messageId: String(row.message_id),
    voiceProfileId: String(row.voice_profile_id),
    language: String(row.language),
    characters: Number(row.chars ?? 0),
    renderRevision: row.render_revision == null ? null : String(row.render_revision),
    createdAt: row.created_at == null ? null : String(row.created_at),
  }));
}
