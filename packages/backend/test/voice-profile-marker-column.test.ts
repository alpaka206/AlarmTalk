// **#106 배포 창에도 목소리 목록은 열려 있어야 한다** — 회귀 방지.
//
// 배포가 마이그레이션보다 먼저 도는 구조라(AGENTS.md), 새 컬럼을 그대로 SELECT 하면 그 사이
// `GET /voice`·`GET /voice/family` 가 전부 500 이 된다 — 목소리 탭도 편집기의 목소리 목록도
// 그 1분 동안 열리지 않는다.
//
// ⚠ **쓰기에는 이 관용을 쓰지 않는다.** 쓰기가 새 컬럼만 빼고 진행하면 그 한 번의 요청이
// 영구히 잘못된 행을 남긴다(교체 트랜잭션은 컬럼이 없으면 통째로 실패한다). 읽기가 안전한
// 이유는 그 창에는 **교체 자체가 커밋될 수 없어** 표식이 비어 있는 것이 사실이기 때문이다.
import { describe, it, expect } from 'vitest';
import { customAudioMarkerSelect } from '../src/routes/voice-profile';

function fakeDb(columns: string[]) {
  return {
    execute: async () => ({ rows: columns.map((name) => ({ name })), rowsAffected: 0 }),
  } as never;
}

describe('#106 교체 표식 컬럼 — 목록 읽기', () => {
  it('마이그레이션 전에는 NULL 로 읽어 목록이 열린다', async () => {
    const select = await customAudioMarkerSelect(fakeDb(['id', 'user_id', 'name']));
    expect(select).toBe('NULL AS custom_audio_invalidated_at');
  });

  it('컬럼이 있으면 그대로 읽는다', async () => {
    const select = await customAudioMarkerSelect(
      fakeDb(['id', 'user_id', 'custom_audio_invalidated_at']),
    );
    expect(select).toBe('custom_audio_invalidated_at');
  });
});
