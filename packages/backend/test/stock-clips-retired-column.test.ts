// **#110 배포 창에도 스톡 클립 매니페스트는 열려 있어야 한다** — 회귀 방지.
//
// 배포가 마이그레이션보다 먼저 도는 구조라(AGENTS.md), `messages.retired_at` 을 그대로
// 참조하면 그 사이 `GET /tts/stock-clips` 가 전부 500 이 된다 — 옛 클라까지 클립 목록을
// 못 받는다. 컬럼이 없다는 것은 **은퇴한 행이 하나도 없다**는 뜻이므로, 조건을 빼도
// 결과가 같다(추측이 아니라 사실이다).
//
// ⚠ **쓰기에는 이 관용을 쓰지 않는다.** 게시 트랜잭션에서 같은 조건을 빼면 그 한 번의
// 요청이 영구히 잘못된 행을 남긴다 — 거기서는 컬럼이 없으면 통째로 롤백되는 것이 맞다.
// `#106` 의 짝은 `voice-profile-marker-column.test.ts`.
import { describe, it, expect } from 'vitest';
import { messagesRetiredColumnReady } from '../src/lib/stock-clips';

function fakeDb(columns: string[]) {
  return {
    execute: async () => ({ rows: columns.map((name) => ({ name })), rowsAffected: 0 }),
  } as never;
}

describe('#110 은퇴 표식 컬럼 — 매니페스트 읽기', () => {
  it('마이그레이션 전에는 없다고 답한다 — 호출부가 조건을 뺀다', async () => {
    expect(await messagesRetiredColumnReady(fakeDb(['id', 'user_id', 'category']))).toBe(false);
  });

  it('컬럼이 있으면 그대로 쓴다', async () => {
    expect(await messagesRetiredColumnReady(fakeDb(['id', 'retired_at']))).toBe(true);
  });

  it('한 번 확인하면 다시 묻지 않는다 — 컬럼은 사라지지 않는다', async () => {
    // 위 케이스가 true 로 굳혀 두었으므로, 컬럼이 빠진 응답을 줘도 true 여야 한다.
    expect(await messagesRetiredColumnReady(fakeDb([]))).toBe(true);
  });
});
