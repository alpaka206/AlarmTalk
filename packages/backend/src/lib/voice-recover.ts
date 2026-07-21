import type { Client } from '@libsql/client';
import type { Env } from '../types';
import { R2VoiceStorage } from './r2-storage';
import { getSharedInMemoryVoiceStorage } from '@alarmtalk/voice';
import { createEnrollmentAttempts, UnsupportedVoiceProviderError } from './voice-provider';
import { evictLruClonesIfOverCap, hasCloneSlotCapacity } from './voice-slots';
import { enqueueExternalDeletion } from './audio-retention';

/**
 * F3: 슬롯 상한(F1)으로 evict된 클론 프로필을 보관된 원본 오디오로 자동 재클론해 복구한다.
 *
 * evict된 프로필은 elevenlabs_voice_id=NULL, evicted_at 세팅 상태지만 deleted_at 은 NULL 이라
 * TTL 스윕이 R2 원본(voice_uploads.voice_profile_id 연결)을 계속 보존한다. 재요청 시 그 원본을
 * 다시 클론 등록해 새 provider voice id 를 기존 row 에 in-place 로 채우고 evicted_at 을 지운다.
 *
 * - 성공: 새 provider voice id 반환. row 는 status='ready', last_used_at 갱신, evicted_at=NULL.
 * - 원본 없음(마이그레이션 이전 등록분/TTL 정리 등): null 반환 — 호출자는 NO_VOICE_ID 로 폴백해
 *   클라에 재등록을 유도한다.
 * - 재클론은 '복구'이므로 월간 목소리변경/‑draft attempt 쿼터를 소모하지 않는다(별도 경로).
 *
 * 주의(호출자 계약): 이 함수는 원본을 외부 공급자(ElevenLabs)로 다시 보낸다. 호출부(tts.ts)는
 * 합성 진입 전 소유자(=비공유 클론이라 caller 본인)의 민감 동의(voice_biometric·overseas_transfer)를
 * 이미 검증한 뒤에 호출해야 한다(현재 게이트가 그렇게 동작).
 */
export async function recloneEvictedVoiceProfile(
  env: Env,
  db: Client,
  profileId: string,
  name: string,
): Promise<string | null> {
  // 전사 소스와 동일: 이 프로필에 연결된 원본 업로드만 쓴다(가족알람용 무관 녹음 오사용 방지).
  const uploadRes = await db.execute({
    sql: `SELECT object_key, mime_type, original_name FROM voice_uploads
          WHERE voice_profile_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [profileId],
  });
  const upload = uploadRes.rows[0];
  if (!upload) return null;

  const storage = env.VOICE_BUCKET
    ? new R2VoiceStorage(env.VOICE_BUCKET)
    : getSharedInMemoryVoiceStorage();
  const stored = await storage.get(String(upload.object_key));
  if (!stored) return null;

  // F1(Codex #599 3차): 슬롯이 꽉 찼는데 evict 후보가 전부 보호 대상이면 재클론해도 상한 초과가
  // 지속된다 → enroll 전에 포기하고 null 반환(호출자는 NO_VOICE_ID 폴백). 이 프로필 자신은
  // voice_id 가 NULL(evicted)이라 활성 카운트에 안 들어가 있어 별도 제외가 필요 없다.
  if (!(await hasCloneSlotCapacity(db))) return null;

  // Uint8Array 뷰 → 정확한 구간만 ArrayBuffer 로 복사(오프셋 있는 버퍼 안전).
  const audioBuffer = stored.bytes.buffer.slice(
    stored.bytes.byteOffset,
    stored.bytes.byteOffset + stored.bytes.byteLength,
  ) as ArrayBuffer;

  const attempts = createEnrollmentAttempts({
    env,
    audioData: audioBuffer,
    name: name || '목소리',
    audioMimeType: (upload.mime_type as string | null) ?? stored.meta.mimeType,
    audioFileName: (upload.original_name as string | null) ?? stored.meta.originalName ?? undefined,
  });
  let newVoiceId = '';
  let lastError: unknown = new Error('No voice provider is configured.');
  for (const attempt of attempts) {
    try {
      const result = await attempt.enroll();
      newVoiceId = result.providerVoiceId;
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof UnsupportedVoiceProviderError) continue;
      if (attempt !== attempts[attempts.length - 1]) continue;
    }
  }
  if (!newVoiceId) throw lastError;

  // 동시성/삭제 가드(Codex #599): '살아있고 아직 evicted 인' 행일 때만 in-place 복원한다.
  // 동시 재클론 레이스에서 진 쪽이거나 재클론 중 프로필이 삭제됐으면 rowsAffected=0 →
  // 방금 만든 provider 보이스를 삭제 큐에 넣어 누수를 막고, 승자의 voice_id(있으면)를 되돌린다.
  const restored = await db.execute({
    sql: `UPDATE voice_profiles
          SET elevenlabs_voice_id = ?, evicted_at = NULL, status = 'ready',
              last_used_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ? AND deleted_at IS NULL AND elevenlabs_voice_id IS NULL`,
    args: [newVoiceId, profileId],
  });
  if ((restored.rowsAffected ?? 0) === 0) {
    await enqueueExternalDeletion(db, 'elevenlabs_voice', newVoiceId);
    const current = await db.execute({
      sql: `SELECT elevenlabs_voice_id FROM voice_profiles WHERE id = ? AND deleted_at IS NULL`,
      args: [profileId],
    });
    return (current.rows[0]?.elevenlabs_voice_id as string | null) ?? null;
  }

  // F1(Codex #599): 복원된 보이스가 이제 카운트에 포함된다 — enroll·복원 성공 후에 상한 초과분을
  // 제거해 상한으로 맞춘다(성공 후 제거라 실패 시 애먼 보이스가 날아가지 않음). eviction 실패는
  // 복구를 막지 않는다(상한 미강제 — 다음 등록/cron 에서 재정리).
  try {
    await evictLruClonesIfOverCap(db, profileId);
  } catch {
    // 로깅 컨텍스트(c)가 없는 lib 경로라 조용히 무시 — 상한은 다음 기회에 수렴한다.
  }
  return newVoiceId;
}
