import type { Client } from '@libsql/client';
import type { Env } from '../types';
import { R2VoiceStorage } from './r2-storage';
import { getSharedInMemoryVoiceStorage } from '@alarmtalk/voice';
import { createEnrollmentAttempts, UnsupportedVoiceProviderError } from './voice-provider';
import { evictLruClonesIfOverCap } from './voice-slots';

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

  // Uint8Array 뷰 → 정확한 구간만 ArrayBuffer 로 복사(오프셋 있는 버퍼 안전).
  const audioBuffer = stored.bytes.buffer.slice(
    stored.bytes.byteOffset,
    stored.bytes.byteOffset + stored.bytes.byteLength,
  ) as ArrayBuffer;

  // F3 재클론도 새 provider 보이스를 만드므로, /clone 과 동일하게 enroll 직전 전역 슬롯 상한을
  // 재적용한다(Codex #599). 이 프로필은 evict 상태라 elevenlabs_voice_id NULL → 카운트/후보에서
  // 자동 제외되고, 이미 상한이면 다른 LRU 1건을 비운 뒤 이 프로필을 복원한다(상한 유지).
  await evictLruClonesIfOverCap(db, profileId);

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

  await db.execute({
    sql: `UPDATE voice_profiles
          SET elevenlabs_voice_id = ?, evicted_at = NULL, status = 'ready',
              last_used_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?`,
    args: [newVoiceId, profileId],
  });
  return newVoiceId;
}
