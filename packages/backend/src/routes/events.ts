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
import { inPlaceholders } from '../lib/caller-ids';
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
  'error_code', 'outcome', 'reason', 'method', 'step', 'pack_id', 'is_first', 'prepared', 'reuse_location',
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
                error_code, outcome, reason, method, step, pack_id, is_first, prepared, reuse_location,
                charged_source, usage_month, result_id, request_id, char_count, content_mode, surface, product_id,
                store_offer, from_plan, to_plan) VALUES `;
(function assertInsertColumns() {
  const literal = /\(([^)]*)\)/.exec(INSERT_PREFIX)![1]!.split(',').map((column) => column.trim());
  if (literal.join(',') !== INSERT_COLUMNS.join(',')) throw new Error('usage_events INSERT 열 목록이 PROP_COLUMNS 와 어긋났다');
})();
const ROW_PLACEHOLDERS = `(${INSERT_COLUMNS.map(() => '?').join(', ')})`;

const V1_TYPES: ReadonlySet<string> = new Set(USAGE_EVENT_V1_TYPES);

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
    detail: event.detail,
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
    detailSinceMs === null ? null : await loadEntitlementSource(db, c.env, userPk, new Date(receivedAtMs));
  const isDetailed = (event: UsageEvent) => detailSinceMs !== null && Date.parse(event.occurred_at) >= detailSinceMs;
  await withWriteTransaction(db, async (tx) => {
    // ⚠ **이미 들어 있는 사건은 아래 보관함 갱신에서 건너뛴다 — 재전송은 멱등이어야 한다.**
    // `INSERT OR IGNORE` 는 중복 사건을 버리지만 그 뒤의 사실 갱신까지 막지는 않는다.
    // 같은 id를 다른 내용으로 다시 보내더라도 그 사이의 반대 사실(붙임↔해제)을 되돌리지 않는다. 넣기와 갱신은 한
    // 트랜잭션이라, 이미 저장돼 있다 = 그때 갱신도 끝났다는 뜻이다.
    // ⚠ **조회는 INSERT 앞에 둔다** — 뒤에 두면 방금 넣은 것까지 '이미 있음' 이 되어
    //   아무 갱신도 돌지 않는다.
    // ⚠ **사용자 조건을 걸지 않는다** — 남의 id 와 겹치면 INSERT 도 무시되므로 갱신도
    //   함께 건너뛰는 것이 맞다.
    const messageEvents = list.filter((event: UsageEvent) => event.message_id);
    const alreadyStored = new Set<string>();
    const lookups: InStatement[] = [];
    for (let offset = 0; offset < messageEvents.length; offset += INSERT_CHUNK) {
      const chunk = messageEvents.slice(offset, offset + INSERT_CHUNK);
      lookups.push({
        sql: `SELECT id FROM usage_events WHERE id IN (${inPlaceholders(chunk)})`,
        args: chunk.map((event: UsageEvent) => event.id),
      });
    }
    if (lookups.length) {
      for (const found of await tx.batch(lookups)) {
        for (const row of found.rows) alreadyStored.add(String(row.id));
      }
    }

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

    // 문구의 '사용중/비사용중' 은 **폰이 판정한 사실**이다(그 오디오를 쓰는 알람이 폰에
    // 남아 있는가). 서버는 받아 적을 뿐이다 — 여기서 추측하면 기기마다 다른 사실을
    // 서로 덮어쓴다.
    //
    // ⚠ **이 값은 마지막으로 보고한 *한 기기의* 사실이다.** 두 기기가 같은 문구를 쓰면
    // 한쪽의 참조 카운트 0 이 계정 전체를 0 으로 만든다 — 아래 시각 비교는 순서만 정하지
    // 두 기기의 상태를 합치지 못한다. **`in_use = 0` 을 삭제의 근거로 단독으로 쓰지 말 것**
    // (`docs/spec/usage-events.md` §5).
    //
    // ⚠ **본인 보관함 행만 건드린다**(IDOR). `message_id` 는 클라가 준 값이라 소유권을
    // 조건으로 걸어야 한다 — 남의 문구를 비사용중으로 만들 수 있으면 그 오디오가
    // 정리 대상이 된다.
    for (const event of list) {
      // 이미 저장돼 있던 사건이다 — 그때 같은 트랜잭션에서 갱신까지 끝났다.
      if (alreadyStored.has(event.id)) continue;
      alreadyStored.add(event.id);
      if (!event.message_id) continue;
      // ⚠ **남기는 것은 도착 순서가 아니라 더 최근 사실이다 — 붙임·해제 양쪽 다.**
      //   오프라인 큐는 며칠 밀릴 수 있고, 같은 문구(=같은 `message_id`)를 두 기기가
      //   함께 쓸 수 있다(캐시 히트가 같은 id 를 돌려준다). 그래서 두 갈래 모두
      //   `in_use_updated_at` 을 비교해 **더 최근 사실만** 남긴다 — 한쪽만 막으면
      //   뒤늦게 도착한 '붙임' 이 최신 '해제' 를 되돌린다.
      if (event.type === 'manual_message_attached') {
        writes.push({
          sql: `UPDATE message_library
                   SET in_use = 1, in_use_updated_at = ?, last_used_at = ?
                 WHERE message_id = ? AND user_id = ?
                   AND (in_use_updated_at IS NULL OR in_use_updated_at <= ?)`,
          args: [event.occurred_at, event.occurred_at, event.message_id, userPk, event.occurred_at],
        });
      } else if (event.type === 'manual_message_released') {
        writes.push({
          sql: `UPDATE message_library
                   SET in_use = 0, in_use_updated_at = ?
                 WHERE message_id = ? AND user_id = ?
                   AND (in_use_updated_at IS NULL OR in_use_updated_at <= ?)`,
          args: [event.occurred_at, event.message_id, userPk, event.occurred_at],
        });
      }
    }
    await tx.batch(writes);
  });

  return c.json({ accepted: list.length });
});

export default events;
