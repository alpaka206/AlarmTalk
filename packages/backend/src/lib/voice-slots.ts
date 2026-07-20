import type { Client } from '@libsql/client';
import { withWriteTransaction } from './transactions';
import { enqueueExternalDeletion } from './audio-retention';

// F1: 전역(전 사용자 합산) 커스텀 클론 provider 보이스 상한. per-user 상한(voice-profile.ts의
// MAX_VOICE_PROFILES)과 의미가 완전히 다르다 — 이건 공급자(ElevenLabs, 향후 벤더) 계정 전체에서
// 살아있는 커스텀 클론 보이스의 최대 개수다. 이 숫자 하나만 바꾸면 전체에 적용된다(운영 50,
// 폰 테스트 시 2~3). 시스템 기본 목소리(is_system)는 이 카운트에서 제외한다.
export const MAX_PROVIDER_CLONE_VOICES = 50;

/**
 * F1: 전역 클론 슬롯 상한을 지키기 위해, 새 provider 보이스를 만들기 직전에 상한을 초과하면
 * LRU(가장 오래 안 쓰인) official 클론을 제거해 슬롯을 비운다. 신규 클론 등록(/clone)과
 * evict된 보이스 재클론(F3, voice-recover) 양쪽이 enroll 직전에 이 함수를 호출해 상한을 지킨다.
 *  - 카운트 대상: deleted_at IS NULL AND is_system=0 AND elevenlabs_voice_id IS NOT NULL
 *    (커스텀 클론만, draft 포함 — draft 도 실제 공급자 슬롯을 점유하므로).
 *  - 제거 후보: 위 조건 + is_draft=0(official) + is_shared=0(가족 공유 제외) + 방금 만든 행 제외.
 *    LRU = last_used_at 오래된 순(미사용 NULL 이 최우선). draft 와 공유 보이스는 보호한다.
 *  - 제거 방식: elevenlabs_voice_id 를 NULL 로 비우고 evicted_at 을 찍되 deleted_at 은 NULL 유지 →
 *    TTL 스윕이 R2 원본을 계속 보존하고, 재요청 시 원본으로 자동 재클론(F3)한다.
 *  - 공급자 실삭제는 비동기 큐(pending_external_deletions)로 넘긴다. ElevenLabs 는 계정 보이스
 *    상한을 강제하지 않아 비동기로 충분하다. 하드 상한 벤더로 이관 시엔 enroll 전에 동기 삭제로
 *    바꿔야 그 벤더의 409(상한 초과)를 피한다.
 */
export async function evictLruClonesIfOverCap(
  db: Client,
  newProfileId: string,
): Promise<number> {
  return withWriteTransaction(db, async (tx) => {
    const countRow = (
      await tx.execute({
        sql: `SELECT COUNT(*) AS n FROM voice_profiles
              WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0
                AND elevenlabs_voice_id IS NOT NULL`,
      })
    ).rows[0];
    const activeCount = Number(countRow?.n ?? 0);
    // 새로 만들 보이스 1개가 들어갈 자리까지 확보 → 상한 - 1 이하로 낮춘다.
    const toEvict = activeCount - MAX_PROVIDER_CLONE_VOICES + 1;
    if (toEvict <= 0) return 0;
    const victims = await tx.execute({
      sql: `SELECT id, elevenlabs_voice_id FROM voice_profiles
            WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0
              AND elevenlabs_voice_id IS NOT NULL
              AND COALESCE(is_draft, 0) = 0
              AND COALESCE(is_shared, 0) = 0
              AND id != ?
            ORDER BY (last_used_at IS NULL) DESC, last_used_at ASC, created_at ASC
            LIMIT ?`,
      args: [newProfileId, toEvict],
    });
    for (const victim of victims.rows) {
      const victimId = victim.id as string;
      const oldVoiceId = victim.elevenlabs_voice_id as string | null;
      await tx.execute({
        sql: `UPDATE voice_profiles
              SET elevenlabs_voice_id = NULL, evicted_at = datetime('now'), updated_at = datetime('now')
              WHERE id = ?`,
        args: [victimId],
      });
      if (oldVoiceId) {
        await enqueueExternalDeletion(tx, 'elevenlabs_voice', oldVoiceId);
      }
    }
    return victims.rows.length;
  });
}
