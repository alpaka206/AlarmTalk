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
import { UsageEventBatchSchema, type UsageEvent } from '@alarmtalk/shared';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { withWriteTransaction } from '../lib/transactions';

const events = new Hono<AppEnv>();

/** 한 번의 INSERT 에 묶을 이벤트 수. Workers 의 요청당 서브리퀘스트 상한을 고려한 값이다. */
const INSERT_CHUNK = 25;

/**
 * 이벤트 배치 수집.
 *
 * 멱등: `id` 는 클라가 만든 UUID 이고 PK 라, 같은 배치를 다시 보내면
 * `INSERT OR IGNORE` 가 조용히 무시한다. 그래서 앱은 **응답을 못 받은 배치**를 마음 놓고
 * 재전송할 수 있다(그게 오프라인 큐의 정상 동작이다).
 */
events.post('/', async (c) => {
  const userPk = c.get('userIdPK') || c.get('userId');
  const db = getDB(c.env);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body', error_code: 'INVALID_JSON' }, 400);
  }

  const parsed = UsageEventBatchSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: parsed.error.issues[0]?.message ?? 'Invalid events payload',
        error_code: 'INVALID_USAGE_EVENTS',
      },
      400,
    );
  }

  const list = parsed.data.events;
  await withWriteTransaction(db, async (tx) => {
    for (let i = 0; i < list.length; i += INSERT_CHUNK) {
      const chunk = list.slice(i, i + INSERT_CHUNK);
      const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      await tx.execute({
        sql: `INSERT OR IGNORE INTO usage_events
                (id, user_id, type, occurred_at, alarm_id, voice_profile_id, message_id, detail)
              VALUES ${values}`,
        args: chunk.flatMap((event: UsageEvent) => [
          event.id,
          userPk,
          event.type,
          event.occurred_at,
          event.alarm_id ?? null,
          event.voice_profile_id ?? null,
          event.message_id ?? null,
          event.detail ?? null,
        ]),
      });
    }

    // 문구의 '사용중/비사용중' 은 **폰이 판정한 사실**이다(그 오디오를 쓰는 알람이 폰에
    // 남아 있는가). 서버는 받아 적을 뿐이다 — 여기서 추측하면 기기마다 다른 사실을
    // 서로 덮어쓴다.
    //
    // ⚠ **본인 보관함 행만 건드린다**(IDOR). `message_id` 는 클라가 준 값이라 소유권을
    // 조건으로 걸어야 한다 — 남의 문구를 비사용중으로 만들 수 있으면 그 오디오가
    // 정리 대상이 된다.
    for (const event of list) {
      if (!event.message_id) continue;
      if (event.type === 'manual_message_attached') {
        await tx.execute({
          sql: `UPDATE message_library
                   SET in_use = 1, in_use_updated_at = ?, last_used_at = ?
                 WHERE message_id = ? AND user_id = ?`,
          args: [event.occurred_at, event.occurred_at, event.message_id, userPk],
        });
      } else if (event.type === 'manual_message_released') {
        // ⚠ **뒤늦게 도착한 '해제' 가 최신 '사용중' 을 덮지 않게 한다.** 오프라인 큐는
        //   며칠 밀릴 수 있고, 그 사이 다른 기기에서 같은 문구를 다시 붙였을 수 있다.
        //   시각을 비교해 **더 최근 사실만** 남긴다.
        await tx.execute({
          sql: `UPDATE message_library
                   SET in_use = 0, in_use_updated_at = ?
                 WHERE message_id = ? AND user_id = ?
                   AND (in_use_updated_at IS NULL OR in_use_updated_at <= ?)`,
          args: [event.occurred_at, event.message_id, userPk, event.occurred_at],
        });
      }
    }
  });

  return c.json({ accepted: list.length });
});

export default events;
