import type { Client } from '@libsql/client';
import { withWriteTransaction, type DbExecutor } from './transactions';
import { enqueueExternalDeletion } from './audio-retention';

// F1: 전역(전 사용자 합산) 커스텀 클론 provider 보이스 상한. per-user 상한(voice-profile.ts의
// MAX_VOICE_PROFILES)과 의미가 완전히 다르다 — 이건 공급자(ElevenLabs, 향후 벤더) 계정 전체에서
// 살아있는 커스텀 클론 보이스의 최대 개수다. 이 숫자 하나만 바꾸면 전체에 적용된다(운영 50,
// 폰 테스트 시 2~3). 시스템 기본 목소리(is_system)는 이 카운트에서 제외한다.
export const MAX_PROVIDER_CLONE_VOICES = 50;

/**
 * F1(Codex #599 3차): 새 클론 1개를 받아들일 여지가 있는지 사전 판정한다.
 * 활성 커스텀 클론이 상한 미만이면 항상 true. 상한 이상이면 초과분(+새 보이스 1개)을 LRU 로
 * 비울 수 있는 비보호 후보(draft·공유 제외)가 충분할 때만 true. 활성 보이스가 전부 보호
 * 대상(예: 공유 official 50개)이면 false — 이때 신규 등록을 즉시 거부해, eviction 이 후보
 * 부족으로 짧게 끝나 상한 초과가 조용히 지속되는 상황을 막는다. 카운트 조건은
 * evictLruClonesIfOverCap 과 동일해야 한다.
 */
export async function hasCloneSlotCapacity(exec: DbExecutor): Promise<boolean> {
  const activeRow = (
    await exec.execute({
      sql: `SELECT COUNT(*) AS n FROM voice_profiles
            WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0
              AND elevenlabs_voice_id IS NOT NULL`,
    })
  ).rows[0];
  const activeCount = Number(activeRow?.n ?? 0);
  if (activeCount < MAX_PROVIDER_CLONE_VOICES) return true;
  const evictableRow = (
    await exec.execute({
      sql: `SELECT COUNT(*) AS n FROM voice_profiles
            WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0
              AND elevenlabs_voice_id IS NOT NULL
              AND COALESCE(is_draft, 0) = 0
              AND COALESCE(is_shared, 0) = 0`,
    })
  ).rows[0];
  const evictableCount = Number(evictableRow?.n ?? 0);
  return activeCount + 1 - MAX_PROVIDER_CLONE_VOICES <= evictableCount;
}

/**
 * F1: 전역 클론 슬롯 상한을 지키기 위해, 새 provider 보이스가 이미 만들어져 DB 에 반영된 뒤
 * 상한을 초과하면 LRU(가장 오래 안 쓰인) official 클론을 제거해 상한으로 맞춘다. 신규 클론
 * 등록(/clone)과 evict된 보이스 재클론(F3, voice-recover) 양쪽이 enroll·row 반영이 성공한
 * 직후에 이 함수를 호출한다. enroll '직전'이 아니라 '직후'에 제거하는 이유: enroll 이 실패하면
 * (일시적 ElevenLabs 오류 등) 대체 보이스가 안 생겼는데 애먼 사용자의 보이스만 evict 되기
 * 때문이다(Codex #599). ElevenLabs 는 상한을 강제하지 않아 잠깐 상한+1 이 돼도 안전하다.
 *  - 카운트 대상: deleted_at IS NULL AND is_system=0 AND elevenlabs_voice_id IS NOT NULL
 *    (커스텀 클론만, draft 포함 — draft 도 실제 공급자 슬롯을 점유하므로).
 *  - 제거 후보: 위 조건 + is_draft=0(official) + is_shared=0(가족 공유 제외) + 방금 만든 행 제외.
 *    LRU = last_used_at 오래된 순(미사용 NULL 이 최우선). draft 와 공유 보이스는 보호한다.
 *  - 제거 방식: elevenlabs_voice_id 를 NULL 로 비우고 evicted_at 을 찍되 deleted_at 은 NULL 유지 →
 *    TTL 스윕이 R2 원본을 계속 보존하고, 재요청 시 원본으로 자동 재클론(F3)한다.
 *  - 공급자 실삭제는 비동기 큐(pending_external_deletions)로 넘긴다. ElevenLabs 는 계정 보이스
 *    상한을 강제하지 않아 비동기로 충분하다. 하드 상한 벤더로 이관 시엔 enroll 전에 동기 삭제로
 *    바꿔야 그 벤더의 409(상한 초과)를 피한다.
 *  - 반환 shortfall(부족분) > 0 이면 후보가 전부 보호 대상이라 상한을 못 맞춘 것 — 호출자는
 *    새 등록/복원을 되돌려 초과 상태로 커밋하지 말아야 한다(Codex #599 4차: 동시 등록이
 *    사전 체크를 함께 통과해도, 등록 완료 트랜잭션 안에서 이 함수를 불러 직렬화하면 늦은
 *    쪽이 여기서 shortfall 을 보고 실패한다).
 */
export async function evictLruClonesIfOverCapTx(
  tx: DbExecutor,
  newProfileId: string,
): Promise<{ evicted: number; shortfall: number }> {
  const countRow = (
    await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM voice_profiles
            WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0
              AND elevenlabs_voice_id IS NOT NULL`,
    })
  ).rows[0];
  const activeCount = Number(countRow?.n ?? 0);
  // 새 보이스가 이미 카운트에 포함된 상태로 호출되므로, 상한 초과분만 제거해 정확히 상한으로 맞춘다.
  const toEvict = activeCount - MAX_PROVIDER_CLONE_VOICES;
  if (toEvict <= 0) return { evicted: 0, shortfall: 0 };
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
  const shortfall = toEvict - victims.rows.length;
  if (shortfall > 0) {
    console.warn(
      `[voice] clone cap eviction shortfall: needed ${toEvict}, evictable ${victims.rows.length} (rest protected)`,
    );
  }
  for (const victim of victims.rows) {
    const victimId = victim.id as string;
    const oldVoiceId = victim.elevenlabs_voice_id as string | null;
    // evicted_provider_voice_id: UPDATE 의 우변은 갱신 전 행 값으로 평가되므로(SQLite 의미론)
    // 같은 문장에서 기존 id 를 안전하게 보관한다 — evict 후에도 이 id 로 계산된 캐시 키의
    // 보관 오디오를 프로브해 재클론 없이 서빙할 수 있다(Codex #602).
    await tx.execute({
      sql: `UPDATE voice_profiles
            SET evicted_provider_voice_id = elevenlabs_voice_id,
                elevenlabs_voice_id = NULL, evicted_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?`,
      args: [victimId],
    });
    if (oldVoiceId) {
      await enqueueExternalDeletion(tx, 'elevenlabs_voice', oldVoiceId);
    }
  }
  return { evicted: victims.rows.length, shortfall };
}

/** 단독 트랜잭션 래퍼 — 이미 쓰기 트랜잭션 안이라면 evictLruClonesIfOverCapTx 를 직접 쓸 것. */
export async function evictLruClonesIfOverCap(
  db: Client,
  newProfileId: string,
): Promise<{ evicted: number; shortfall: number }> {
  return withWriteTransaction(db, (tx) => evictLruClonesIfOverCapTx(tx, newProfileId));
}
