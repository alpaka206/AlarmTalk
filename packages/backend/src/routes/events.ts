/**
 * 사용 기록 수집 — 앱이 쌓아 둔 이벤트를 **모아서** 보낸다.
 *
 * 왜 배치인가: 앱은 오프라인에서도 알람을 만들고 울린다. 그동안의 사건은 기기에 쌓였다가
 * 연결될 때 한꺼번에 올라온다 — 요청마다 한 건씩 보내면 재연결 순간에 수십 번을 왕복한다.
 *
 * ⚠ **울릴 때 이 API 를 부르지 않는다.** 알람 경로는 로컬·오프라인이 원칙이라(CLAUDE.md
 * 「Real alarm」) 울림은 기기에 적기만 하고, 전송은 그 뒤 아무 때나 한다.
 */
import { Hono } from 'hono';
import type { InStatement } from '@libsql/client';
import {
  USAGE_EVENT_V1_TYPES,
  UsageEventBatchSchema,
  type UsageEvent,
  type UsageEventProps,
} from '@alarmtalk/shared';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { withWriteTransaction } from '../lib/transactions';
import { loadLatestConsents, usageEventConsentSince, usageEventDetailConsentSince } from '../lib/consent';
import { loadEntitlementSource } from '../lib/usage-entitlement';
import { parseAppPlatformHeader } from '../middleware/appPresence';

const events = new Hono<AppEnv>();

/** 한 번의 INSERT 에 묶을 이벤트 수. Workers 의 요청당 서브리퀘스트 상한을 고려한 값이다. */
const INSERT_CHUNK = 25;

/**
 * 2판의 정해진 칸(`UsageEventPropsSchema`) → `usage_events` 열(#142). **칸 이름이 곧 열 이름**이다 — 열을 사용자
 * 입력에서 파생하지 않도록 목록을 여기 고정해 둔다(CLAUDE.md 「SQL은 항상 ?-바인딩」의 화이트리스트 조각).
 */
const PROP_COLUMNS = [
  'scope', 'language', 'revision', 'cache_state', 'target_count', 'completed_count', 'bytes', 'duration_ms',
  'error_code', 'outcome', 'reason', 'method', 'step', 'is_first', 'prepared', 'reuse_location',
  'charged_source', 'usage_month', 'result_id', 'request_id', 'char_count', 'content_mode', 'surface', 'product_id',
  'store_offer', 'from_plan', 'to_plan',
] as const satisfies ReadonlyArray<keyof UsageEventProps>;

const BASE_COLUMNS = [
  'id', 'user_id', 'type', 'occurred_at', 'alarm_id', 'voice_profile_id', 'message_id', 'detail',
  'schema_version', 'platform', 'app_version', 'feature_version', 'attempt_id', 'entitlement_source',
] as const;

const INSERT_COLUMNS = [...BASE_COLUMNS, ...PROP_COLUMNS];
/** 열 목록은 글자 그대로 둔다 — `scripts/check-insert-not-null.py` 가 NOT NULL 열 누락을 읽는다. */
const INSERT_PREFIX = `INSERT OR IGNORE INTO usage_events (id, user_id, type, occurred_at, alarm_id, voice_profile_id, message_id, detail,
                schema_version, platform, app_version, feature_version, attempt_id, entitlement_source,
                scope, language, revision, cache_state, target_count, completed_count, bytes, duration_ms,
                error_code, outcome, reason, method, step, is_first, prepared, reuse_location,
                charged_source, usage_month, result_id, request_id, char_count, content_mode, surface, product_id,
                store_offer, from_plan, to_plan) VALUES `;
(function assertInsertColumns() {
  const literal = /\(([^)]*)\)/.exec(INSERT_PREFIX)![1]!.split(',').map((column) => column.trim());
  if (literal.join(',') !== INSERT_COLUMNS.join(',')) throw new Error('usage_events INSERT 열 목록이 PROP_COLUMNS 와 어긋났다');
})();
const ROW_PLACEHOLDERS = `(${INSERT_COLUMNS.map(() => '?').join(', ')})`;

const V1_TYPES: ReadonlySet<string> = new Set(USAGE_EVENT_V1_TYPES);

/**
 * 1판 종류인데 `detail` 이 **8판이 고지한 값**인 것 — 알람 저장의 문구 종류(2026-10-29, 서버 알람 사본 삭제와 함께 실었다).
 * 7판 본문은 "사건 시각과 식별자만" 이라, 그 전 동의자의 기록에서는 이 값을 비운다. 해제 사유처럼 1판부터 있던 `detail` 은
 * 그대로 둔다.
 */
const V2_DETAIL_TYPES: ReadonlySet<string> = new Set(['alarm_created', 'alarm_updated']);

/**
 * 고지 전(처리방침 2판 범위 미동의) 기록을 **1판 모양으로** 줄인다 — 2판 칸을 비우고, 2판에만 있는 종류는 버린다(null).
 * `docs/spec/usage-events.md` §7.5.
 */
function toV1(event: UsageEvent): UsageEvent | null {
  if (!V1_TYPES.has(event.type)) return null;
  return {
    id: event.id,
    type: event.type,
    occurred_at: event.occurred_at,
    alarm_id: event.alarm_id,
    voice_profile_id: event.voice_profile_id,
    message_id: event.message_id,
    detail: V2_DETAIL_TYPES.has(event.type) ? null : event.detail,
  };
}

function propValue(props: UsageEventProps | null | undefined, column: (typeof PROP_COLUMNS)[number]) {
  const value = props?.[column];
  if (value === undefined || value === null) return null;
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * 이벤트 배치 수집.
 *
 * 멱등: `id` 는 클라가 만든 UUID 이고 PK 라, 같은 배치를 다시 보내면
 * `INSERT OR IGNORE` 가 조용히 무시한다. 그래서 앱은 **응답을 못 받은 배치**를 마음 놓고
 * 재전송할 수 있다(그게 오프라인 큐의 정상 동작이다).
 */
events.post('/', async (c) => {
  const receivedAtMs = Date.now();
  const userPk = c.get('userIdPK') || c.get('userId');
  const db = getDB(c.env);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return jsonError(c, 400, 'INVALID_JSON', 'Invalid JSON body');
  }

  // ⚠ **고지 없이 받지 않는다**(코덱스 #731). 사용 기록 수집은 처리방침 버전 5 에서
  //   처음 고지됐다. 그 아래 버전으로 동의한 사용자는 본 적이 없으므로 받지 않는다.
  //   ⚠ **오류로 돌려주지 말 것.** 앱은 성공한 배치만 큐에서 지우므로(usage-events 스펙),
  //   4xx 를 주면 같은 배치를 **영원히 재전송**한다. 받아들인 것처럼 200 으로 답하고
  //   버린다 — 큐가 비고, 동의가 올라온 뒤부터 정상 수집된다.
  // ⚠ 쿼리를 여기서 다시 짜지 말 것 — 동의 판정은 `lib/consent` 가 단일 출처다
  //   (같은 초 토글의 rowid 보조 정렬, 이상한 버전 문자열 처리까지 거기 있다).
  // ⚠ **이 라우트는 동의 미들웨어를 거치지 않는다**(`middleware/consent.ts` 의 면제 — 2026-10-16, 코덱스). 미들웨어가
  //   403 으로 막으면 앱은 배치를 지우지 않고 들고 있다가 재동의가 끝난 뒤 다시 보내, **고지 전에 쌓인 기록**이
  //   그대로 저장된다. 그래서 여기서 직접 본다: 필수 동의가 모자라거나 처리방침이 고지 버전 미만이면 200 으로 받고 버린다.
  const latestConsents = await loadLatestConsents(db, userPk);
  const consentSinceMs = usageEventConsentSince(latestConsents);
  if (consentSinceMs === null) {
    return c.json({ success: true, accepted: 0, skipped_reason: 'consent_below_disclosure' });
  }

  // 은퇴한 종류·칸(추가 음성팩의 것)은 스키마가 받고 버린다(`usage-event.ts`) — 400 이면 그 기기의 큐가 영구히 막힌다.
  const parsed = UsageEventBatchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(
      c,
      400,
      'INVALID_USAGE_EVENTS',
      parsed.error.issues[0]?.message ?? 'Invalid events payload',
    );
  }

  // 원본 시각으로 동의 경계와 요청 도착 시각을 먼저 검사한다. 미래 시각을 도착 시각으로 바꾸면
  // 동의 전에 쌓인 기록도 동의 후 사건으로 둔갑한다. 불확실한 기록은 저장·보관함 갱신에서 제외하고
  // 200으로 답해 큐를 비운다. 정상 기록은 시각을 유지하며 UTC 표기만 맞춘다.
  // 2판 칸은 그 범위를 고지한 처리방침에 동의한 **뒤**의 사건만(§7.5). 그 전 사건은 1판 모양으로 줄이거나 버린다 —
  // 줄인 행은 `schema_version` 1 이라 집계에서 2판과 섞이지 않는다.
  const detailSinceMs = usageEventDetailConsentSince(latestConsents);
  const list: UsageEvent[] = parsed.data.events
    .filter((event: UsageEvent) => {
      const occurredAtMs = Date.parse(event.occurred_at);
      return Number.isFinite(occurredAtMs) && occurredAtMs >= consentSinceMs && occurredAtMs <= receivedAtMs;
    })
    .map((event: UsageEvent) =>
      detailSinceMs !== null && Date.parse(event.occurred_at) >= detailSinceMs ? event : toV1(event),
    )
    .filter((event): event is UsageEvent => event !== null)
    .map((event: UsageEvent) => ({ ...event, occurred_at: new Date(event.occurred_at).toISOString() }));
  if (list.length === 0) return c.json({ accepted: 0 });
  const headerPlatform = parseAppPlatformHeader(c.req.header('X-App-Platform'));
  // 권한 출처는 **받는 순간** 한 번 — 2판을 받는 사람에게만, 배치의 2판 사건에 같은 값을 찍는다(`lib/usage-entitlement.ts`).
  const entitlementSource =
    detailSinceMs === null ? null : await loadEntitlementSource(db, userPk);
  const isDetailed = (event: UsageEvent) => detailSinceMs !== null && Date.parse(event.occurred_at) >= detailSinceMs;
  // 재전송은 멱등이다 — 같은 id 는 `INSERT OR IGNORE` 가 버린다. 문구의 사용중/비사용중(`manual_message_attached`·
  // `released`)도 이 기록으로만 남는다(2026-11-23 — 그 사실을 따로 적던 `message_library.in_use` 는 읽는 곳이 없어 #152 에서
  // 지웠다. `docs/spec/usage-events.md` §5).
  await withWriteTransaction(db, async (tx) => {
    const writes: InStatement[] = [];
    for (let offset = 0; offset < list.length; offset += INSERT_CHUNK) {
      const chunk = list.slice(offset, offset + INSERT_CHUNK);
      const values = chunk.map(() => ROW_PLACEHOLDERS).join(', ');
      // ⚠ 2판 열(#142)을 **언제나** 넣는다 — 배포 직후 마이그레이션 전이면 INSERT 가 던져 500 이고, 앱은 큐를 지우지 않고
      //   다시 보낸다(fail-closed). 열이 없을 때 옛 열만 넣는 갈래를 두면 그 배치의 2판 칸이 영구히 비어 남는다.
      writes.push({
        // 열 순서는 [INSERT_COLUMNS] 와 같아야 하고, 모듈이 읽힐 때 [assertInsertColumns] 가 확인한다.
        sql: `${INSERT_PREFIX}${values}`,
        args: chunk.flatMap((event: UsageEvent) => [
          event.id,
          userPk,
          event.type,
          event.occurred_at,
          event.alarm_id ?? null,
          event.voice_profile_id ?? null,
          event.message_id ?? null,
          event.detail ?? null,
          isDetailed(event) ? (event.schema_version ?? 1) : 1,
          // 플랫폼은 같은 기기라 큐를 건너도 바뀌지 않는다 — 1판 기록은 요청 헤더로 채운다. 앱 버전은 채우지 않는다
          // (업데이트를 건너 남은 큐의 사건은 보내는 앱의 버전에서 일어나지 않았다).
          isDetailed(event) ? (event.platform ?? headerPlatform) : null,
          event.app_version ?? null,
          event.feature_version ?? null,
          event.attempt_id ?? null,
          isDetailed(event) ? entitlementSource : null,
          ...PROP_COLUMNS.map((column) => propValue(event.props, column)),
        ]),
      });
    }

    await tx.batch(writes);
  });

  return c.json({ accepted: list.length });
});

export default events;
