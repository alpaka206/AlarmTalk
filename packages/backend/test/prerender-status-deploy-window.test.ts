// **진행 조회는 배포 창에도 열려 있어야 한다.**
//
// 배포는 마이그레이션보다 먼저 돈다(CLAUDE.md). 그 ~1분 동안 `messages.retired_at`(#110)
// 이나 `voice_prerender_queue.refresh_existing`(#101)을 그냥 참조하면 조회가 통째로 500 이
// 되는데, iOS 폴링은 그 실패를 '준비 중 아님' 으로 읽고 **루프를 빠져나온다** — 화면을 다시
// 열기 전까지 진행률도 소유자 주도 전진도 멈춘다(2026-09-08 코덱스 지적).
//
// ⚠ 두 컬럼을 **같이** 봐야 한다. 하나만 가드하면 다른 하나에서 똑같이 죽는다.
import { describe, it, expect } from 'vitest';

import { prerenderRefreshColumnReady, retiredIsNullClause } from '../src/lib/stock-clips';

type Row = Record<string, unknown>;

/** 컬럼 목록만 흉내 내는 최소 실행기. `PRAGMA table_info` 외에는 불리지 않는다. */
function dbWithColumns(messages: string[], queue: string[]) {
  const asked: string[] = [];
  return {
    asked,
    execute: async ({ sql }: { sql: string }) => {
      asked.push(sql);
      const names = sql.includes("'messages'") ? messages : queue;
      return { rows: names.map((name) => ({ name })) as Row[] };
    },
  };
}

// ⚠ **순서를 바꾸지 말 것.** 두 판정은 "한 번 있다고 확인되면 다시 묻지 않는다"(모듈 수준
// 플래그)라, '컬럼 없음' 케이스가 **먼저** 와야 한다. 뒤로 옮기면 앞 케이스가 캐시한 true 를
// 물고 실패한다 — 캐시는 의도된 동작이다(마이그레이션이 끝나면 컬럼은 사라지지 않는다).
describe('진행 조회의 배포 창 가드', () => {
  it('컬럼이 없으면 조건을 뺀다 — 500 이 아니라 답이 나와야 한다', async () => {
    const db = dbWithColumns(['id', 'audio_url'], ['voice_profile_id']);
    expect(await retiredIsNullClause(db as never)).toBe('');
    expect(await prerenderRefreshColumnReady(db as never)).toBe(false);
  });

  it('컬럼이 있으면 조건을 건다', async () => {
    const db = dbWithColumns(['id', 'retired_at'], ['voice_profile_id', 'refresh_existing']);
    expect(await retiredIsNullClause(db as never)).toBe('AND m.retired_at IS NULL');
    expect(await prerenderRefreshColumnReady(db as never)).toBe(true);
  });

  it('별칭을 받는다 — 조각을 손으로 베껴 쓰지 않게 한다', async () => {
    const db = dbWithColumns(['retired_at'], []);
    expect(await retiredIsNullClause(db as never, 'msg')).toBe('AND msg.retired_at IS NULL');
  });
});
