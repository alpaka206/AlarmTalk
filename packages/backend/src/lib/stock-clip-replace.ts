import type { Client } from '@libsql/client/web';

/**
 * **게시된 스톡 클립의 소리를 같은 message_id 에서 갈아 끼운다** — `scripts/publish-stock-clips.ts` 의 교체 갈래.
 *
 * 합성 모델을 바꾸면(2026-09-30 eleven_v3 → eleven_v4_turbo) 화면 문구는 그대로인데 소리만 다시 구워야 한다.
 * 예전 방식(#110 — 옛 행 은퇴 → 새 id 로 게시)은 모든 앱이 새 id 로 다시 묶을 때까지 **차단 화면**을 띄우고
 * 알람 행을 다시 쓴다. 여기서는 행을 두고 `audio_url` 만 바꾼다 — 알람은 message_id 를 그대로 물고 있고, 앱은
 * 매니페스트의 `audio_url` 이 바뀐 것을 보고 다시 받는다(받기 전까지는 옛 파일로 울린다 — 무음 없음).
 *
 * 한 트랜잭션에서:
 *  0. **같은 `request_hash` 의 원장 행이 다른 오브젝트를 가리키면 멈춘다**(`'hash-taken'`, Codex #840). 해시는
 *     주인을 담지 않고(보이스·모델·문구) 오브젝트 키는 주인을 담는다 — 배포 뒤 게시 전에 누군가 같은 기본 목소리로
 *     같은 문장을 만들면(프리셋 라이브 폴백·직접 입력) 그 사람의 행이 해시를 먼저 차지한다. 그대로 교체하면 원장
 *     INSERT 가 무시된 채 메시지만 새 오브젝트를 가리켜, 원장·완료 확인이 영영 어긋난다. 멈추면 그 자리는 옛
 *     소리로 계속 울리고(무음 없음), 그 행이 보관 기한으로 지워진 뒤 다시 돌리면 된다.
 *  1. **비교 후 교체**(`audio_url IS <지금 값>`) — 그 사이 다른 게시가 바꿨으면 0행이고 아무것도 안 한다.
 *  2. 원장(`generated_audio_assets`)에 새 렌더를 남긴다 — R2 키의 유일한 출처라, 없으면 파기 경로가 못 찾는다.
 *     같은 해시·같은 오브젝트의 행이 이미 있으면(같은 문장을 나눠 쓰는 다른 프리셋) 그 행을 그대로 쓴다.
 *  3. 새 키의 삭제 예약을 지운다(서버 `generateStockClip` 의 `claimKeyFromDeletionQueue` 와 같은 이유 — 결정론적 키).
 *  4. 옛 키를 삭제 큐에 넣는다. 실제로 지울지는 드레인이 정한다(`drainExternalDeletions` — 업로드 시각 유예와
 *     `messages.audio_url` 참조를 본다). 여기서 R2 를 직접 지우지 않는다 — 롤백되면 되살릴 수 없다.
 *
 * ⚠ R2 업로드는 **호출 전에** 끝나 있어야 한다. 행이 없는 오브젝트를 가리키는 순간이 없게 한다.
 */
export interface StockClipReplacement {
  messageId: string;
  /** 지금 행이 가리키는 소리 — 비교 후 교체의 기준이다(옛 키의 삭제 예약도 여기서 나온다). */
  previousAudioUrl: string | null;
  ownerUserId: string;
  voiceProfileId: string;
  provider: string;
  providerVoiceId: string;
  modelId: string;
  language: string;
  cacheKey: string;
  objectKey: string;
  outputFormat: string;
  displayText: string;
  synthesisText: string;
  deliveryTagsJson: string;
}

export async function replaceStockClipInPlace(
  db: Pick<Client, 'transaction'>,
  r: StockClipReplacement,
): Promise<'replaced' | 'conflict' | 'hash-taken'> {
  const audioUrl = `r2://${r.objectKey}`;
  const tx = await db.transaction('write');
  try {
    const ledgerUrl = await ledgerAudioUrlFor(tx, r.cacheKey);
    if (ledgerUrl !== null && ledgerUrl !== audioUrl) {
      await tx.rollback();
      return 'hash-taken';
    }
    const swapped = await tx.execute({
      sql: `UPDATE messages
               SET text = ?, synthesis_text = ?, delivery_tags_json = ?, audio_url = ?
             WHERE id = ? AND audio_url IS ?
               AND COALESCE(is_preset, 0) = 1 AND retired_at IS NULL`,
      args: [r.displayText, r.synthesisText, r.deliveryTagsJson, audioUrl, r.messageId, r.previousAudioUrl],
    });
    if ((swapped.rowsAffected ?? 0) === 0) {
      await tx.rollback();
      return 'conflict';
    }
    // 같은 해시·같은 오브젝트의 원장 행이 이미 있으면(같은 문구를 나눠 쓰는 프리셋) 그 행을 그대로 쓴다 —
    // `findMissingStockTargets` 는 보이스 + audio_url 로도 원장을 찾는다. 없으면 반드시 남긴다(무시되지 않는다 —
    // 다른 오브젝트의 행은 위에서 걸렀다).
    if (ledgerUrl === null) {
      await tx.execute({
        sql: `INSERT INTO generated_audio_assets
                (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                 model_id, language, request_hash, text,
                 audio_url, audio_object_key, audio_format, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
        args: [
          crypto.randomUUID(), r.ownerUserId, r.voiceProfileId, r.messageId, r.provider, r.providerVoiceId,
          r.modelId, r.language, r.cacheKey, r.synthesisText, audioUrl, r.objectKey, r.outputFormat,
        ],
      });
    }
    await tx.execute({
      sql: `DELETE FROM pending_external_deletions WHERE kind = 'r2_object' AND ref = ?`,
      args: [r.objectKey],
    });
    const previousKey = r.previousAudioUrl?.startsWith('r2://') ? r.previousAudioUrl.slice('r2://'.length) : '';
    if (previousKey && previousKey !== r.objectKey) {
      await tx.execute({
        sql: `INSERT OR IGNORE INTO pending_external_deletions (id, kind, ref) VALUES (?, 'r2_object', ?)`,
        args: [crypto.randomUUID(), previousKey],
      });
    }
    await tx.commit();
    return 'replaced';
  } catch (error) {
    await tx.rollback().catch(() => {});
    throw error;
  }
}

/**
 * 이 `request_hash` 의 원장 행이 가리키는 오브젝트(`r2://…`), 행이 없으면 null.
 * 게시 스크립트가 업로드 **전에** 같은 판정을 한다 — 막힐 자리에 미아 오브젝트를 올리지 않으려고.
 */
export async function ledgerAudioUrlFor(
  db: Pick<Client, 'execute'>,
  requestHash: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT audio_url FROM generated_audio_assets WHERE request_hash = ? LIMIT 1',
    args: [requestHash],
  });
  const row = res.rows[0];
  return row ? String(row.audio_url ?? '') : null;
}
