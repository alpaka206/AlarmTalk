import type { DbExecutor } from './transactions';

/**
 * **합성 사용량 장부** — 요청 종류 × 결과(성공·실패) × KST 날짜로 센다(`docs/spec/tts-render-and-budget.md` §4, 표 #139).
 *
 * dev·prod 가 ElevenLabs 키 하나(한 계정의 한도)를 나눠 쓴다 — 키를 환경별로 나눠도 한 조직이면 한도는 하나다. 그래서
 * 어느 환경이 무엇에 얼마를 썼는지 **우리가 센다**. 사람을 가리키는 값은 적지 않는다(종류·날짜·숫자뿐).
 *
 * ⚠ **기록은 응답을 막지 않는다.** 이미 합성한 뒤라 공급자 비용은 나갔고, 기록이 실패했다고 요청을 실패시키면 사용자가
 *   다시 시도해 한 번 더 합성한다. 빠지는 것은 숫자 한 줄이고 잘못 남는 행은 없다(CLAUDE.md 「배포 / 환경」 의 fail-closed
 *   규칙은 행을 영구히 틀리게 남기는 쓰기에 대한 것이다). 대신 실패는 로그에 남긴다.
 */

export const TTS_USAGE_KINDS = [
  /** 직접 입력 — 새로 만들어 한 번을 셌다. */
  'manual',
  /** 직접 입력 — 이미 낸 결과를 서비스가 새 설정으로 다시 구웠다(세지 않는다). */
  'manual_rerender',
  /** 프리셋·동적 문구(`random`) — 횟수로 세지 않는 생성. */
  'dynamic',
  /** 등록 초안 미리듣기. */
  'draft_preview',
  /** 클론 사전렌더·기본 목소리 스톡(서버 `generateStockClip`). */
  'stock_prerender',
  /** LRU 로 반납된 클론의 재등록(글자 0 — 지연만 잰다). */
  'clone_reregister',
] as const;
export type TtsUsageKind = (typeof TTS_USAGE_KINDS)[number];
export type TtsUsageOutcome = 'success' | 'failure';

export interface TtsUsageEntry {
  kind: TtsUsageKind;
  outcome: TtsUsageOutcome;
  /** 제공자에게 보낸 글자 수(`speechCharacters`). 실패는 보냈다고 본 글자다 — 과금 여부는 제공자 기준이다. */
  characters: number;
  latencyMs: number;
  /** 같은 요청의 다시 보내기였는가(`request_id` 를 다시 잡았다·cron 재시도). */
  retry?: boolean;
}

/** 제공자가 세는 글자 수에 가까운 값 — 코드 포인트 수(서러게이트 쌍을 하나로 센다). */
export function speechCharacters(text: string): number {
  return Array.from(text).length;
}

/** KST 날짜(YYYY-MM-DD). 직접 입력 월 한도와 같은 달력이다. */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function recordTtsUsage(db: DbExecutor, entry: TtsUsageEntry, now: Date = new Date()): Promise<void> {
  const latency = Math.max(0, Math.round(entry.latencyMs));
  const characters = Math.max(0, Math.round(entry.characters));
  try {
    await db.execute({
      sql: `INSERT INTO tts_synthesis_usage
              (usage_day, request_kind, outcome, request_count, retry_count, character_count,
               latency_ms_total, latency_ms_max, updated_at)
            VALUES (?, ?, ?, 1, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(usage_day, request_kind, outcome) DO UPDATE SET
              request_count = request_count + 1,
              retry_count = retry_count + excluded.retry_count,
              character_count = character_count + excluded.character_count,
              latency_ms_total = latency_ms_total + excluded.latency_ms_total,
              latency_ms_max = MAX(latency_ms_max, excluded.latency_ms_max),
              updated_at = datetime('now')`,
      args: [kstDay(now), entry.kind, entry.outcome, entry.retry ? 1 : 0, characters, latency, latency],
    });
  } catch (err) {
    console.error('[tts-usage] record failed', { kind: entry.kind, outcome: entry.outcome, error: String(err) });
  }
}

/**
 * 합성 한 번을 재고 장부에 적는다 — 성공·실패 모두. 던진 오류는 그대로 다시 던진다.
 */
export async function measureSynthesis<T>(
  db: DbExecutor,
  meta: { kind: TtsUsageKind; text: string; retry?: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const characters = speechCharacters(meta.text);
  try {
    const result = await run();
    await recordTtsUsage(db, { kind: meta.kind, outcome: 'success', characters, latencyMs: Date.now() - started, retry: meta.retry });
    return result;
  } catch (err) {
    await recordTtsUsage(db, { kind: meta.kind, outcome: 'failure', characters, latencyMs: Date.now() - started, retry: meta.retry });
    throw err;
  }
}

export interface TtsUsageRow {
  day: string;
  kind: string;
  outcome: string;
  requests: number;
  retries: number;
  characters: number;
  latencyMsTotal: number;
  latencyMsMax: number;
}

/** `sinceDay`(포함)부터의 장부. 날짜·종류·결과 순. */
export async function readTtsUsage(db: DbExecutor, sinceDay: string): Promise<TtsUsageRow[]> {
  const res = await db.execute({
    sql: `SELECT usage_day, request_kind, outcome, request_count, retry_count, character_count,
                 latency_ms_total, latency_ms_max
            FROM tts_synthesis_usage
           WHERE usage_day >= ?
           ORDER BY usage_day, request_kind, outcome`,
    args: [sinceDay],
  });
  return res.rows.map((row) => ({
    day: String(row.usage_day),
    kind: String(row.request_kind),
    outcome: String(row.outcome),
    requests: Number(row.request_count ?? 0),
    retries: Number(row.retry_count ?? 0),
    characters: Number(row.character_count ?? 0),
    latencyMsTotal: Number(row.latency_ms_total ?? 0),
    latencyMsMax: Number(row.latency_ms_max ?? 0),
  }));
}

/**
 * 이번 KST 달에 **성공한** 합성의 글자 합. 실패는 넣지 않는다 — 제공자가 실패한 요청을 세지 않는다고 보고, 예산을
 * 실패로 태우지 않는다.
 */
export async function monthToDateCharacters(db: DbExecutor, now: Date = new Date()): Promise<number> {
  const month = kstDay(now).slice(0, 7);
  const res = await db.execute({
    sql: `SELECT COALESCE(SUM(character_count), 0) AS chars FROM tts_synthesis_usage
           WHERE outcome = 'success' AND usage_day >= ? AND usage_day < ?`,
    args: [`${month}-01`, `${month}-32`],
  });
  return Number(res.rows[0]?.chars ?? 0);
}
