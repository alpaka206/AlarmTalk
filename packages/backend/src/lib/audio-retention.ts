/**
 * 음성 데이터 수명주기 관리.
 *
 * 1) pending_external_deletions 큐
 *    - DB 트랜잭션 안에서는 외부 API(ElevenLabs/R2)를 호출할 수 없으므로,
 *      행을 지우기 *전에* 외부 참조(클론 voice_id, R2 object key)를 큐에 적재한다.
 *    - cron 의 drainExternalDeletions 가 배치로 실제 삭제 후 큐에서 제거한다.
 *      실패 시 attempts 를 올리고 남겨 다음 주기에 재시도한다.
 *
 * 2) R2 TTL 정리 (cleanupExpiredAudio)
 *    - voice_uploads(클론 학습용 원본): 확정 목소리는 재생성·말투 분석 재시도용으로
 *      프로필 삭제까지 보관. 미확정 초안·프로필 미연결 원본만 7일 경과 시 삭제.
 *    - generated_audio_assets(TTS 캐시): 기기들이 로컬 캐싱하므로 서버 보관은
 *      전달용 버퍼다 → 30일 경과 시 삭제. 단 알람이 message_id 로 참조 중인
 *      오브젝트와 시스템/클론 프리셋 클립은 건너뛴다.
 *
 * Workers free plan 의 invocation 당 subrequest 상한(~50)을 고려해 배치 크기를
 * 보수적으로 제한한다 (cron 5분 주기라 누적 처리량은 충분).
 */
import type { Client, InStatement } from '@libsql/client/web';
import type { Env } from '../types';
import type { DbExecutor } from './transactions';
import { ElevenLabsClient } from './elevenlabs';
import { logStructured } from './logger';
import { audioUrlPointsAtUploadsOf } from './voice-revocation';

const VOICE_UPLOAD_TTL_DAYS = 7;
const GENERATED_TTS_TTL_DAYS = 30;
// 화자 분리 후보(draft) 보이스의 유예 시간. 다이얼로그 안에서 몇 분 내 선택/정리되는
// 임시물이라 1시간이면 충분히 넉넉하다 — 앱 강제종료 등으로 클라이언트 정리를 못 거친
// 고아만 걸린다.
const DRAFT_VOICE_TTL_HOURS = 1;

const DRAIN_BATCH_SIZE = 10;
const TTL_BATCH_SIZE = 10;

/**
 * 같은 `(kind, ref)` 예약이 이미 있으면 **id 를 새로 바꾼다** — 무시하지 않는다(Codex #840).
 *
 * 드레인은 예약을 읽고(참조 확인) → 한참 뒤 **그 id 로** 지운다(`drainExternalDeletions`). 그 사이 다른
 * 트랜잭션이 마지막 참조를 끊고 같은 키를 다시 넣으면, `INSERT OR IGNORE` 는 옛 예약이 있어 무시되고
 * 드레인은 **옛 판단**('아직 참조가 있다')대로 그 예약을 지운다 — 오브젝트는 참조도 예약도 없는 미아가 된다.
 * id 를 바꾸면 드레인의 `WHERE id = ?`(삭제·지우기 직전 재확인)가 빗나가 예약이 남고, 다음 회차가 새로 판단한다.
 * (두 프리셋이 한 오브젝트를 나눠 쓰는 클론 재렌더 교체에서 실제로 겹친다.)
 */
const REFRESH_RESERVATION_ON_CONFLICT = 'ON CONFLICT(kind, ref) DO UPDATE SET id = excluded.id';

export type ExternalDeletionKind = 'elevenlabs_voice' | 'r2_object';

/**
 * 큐 일괄 적재 — ref 하나당 INSERT 를 날리면 자산이 많은 목소리 삭제(사전렌더 21클립×언어
 * 재생성 이력 등)에서 Workers 서브리퀘스트 한도를 넘겨 요청 전체가 500 난다. 청크
 * multi-VALUES 로 묶어 자산 수와 무관하게 상수 수준의 호출로 유지한다.
 */
export async function enqueueExternalDeletionsBatch(
  tx: DbExecutor,
  kind: ExternalDeletionKind,
  refs: Array<string | null | undefined>,
): Promise<void> {
  const unique = Array.from(
    new Set(refs.map((r) => r?.trim()).filter((r): r is string => Boolean(r))),
  );
  const CHUNK = 40;
  const statements: InStatement[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const values = chunk.map(() => '(?, ?, ?)').join(', ');
    statements.push({
      sql: `INSERT INTO pending_external_deletions (id, kind, ref) VALUES ${values}
            ${REFRESH_RESERVATION_ON_CONFLICT}`,
      args: chunk.flatMap((ref) => [crypto.randomUUID(), kind, ref]),
    });
  }
  if (statements.length === 0) return;
  // 청크가 여럿이어도 **왕복 한 번**이다 — 여러 사람을 묶어 지우는 보관 스윕
  // (`lib/personal-promo-end.ts`)은 파일이 수백 개라 청크마다 왕복하면 그것만으로 한도를 넘는다.
  if (statements.length === 1) await tx.execute(statements[0]!);
  else await tx.batch(statements);
}

/** 큐 적재 — 트랜잭션 내부에서 호출 가능. 동일 (kind, ref) 는 한 행으로 남고 id 만 새로 바뀐다(위 상수). */
export async function enqueueExternalDeletion(
  tx: DbExecutor,
  kind: ExternalDeletionKind,
  ref: string | null | undefined,
): Promise<void> {
  const stmt = externalDeletionStatement(kind, ref);
  if (stmt) await tx.execute(stmt);
}

/**
 * 큐 적재 한 건을 **문장으로** 돌려준다 — 여러 쓰기를 `batch` 하나로 묶는 호출부용.
 * 빈 참조는 `null`(적재할 것이 없다). `enqueueExternalDeletion` 도 이걸 쓴다.
 */
export function externalDeletionStatement(
  kind: ExternalDeletionKind,
  ref: string | null | undefined,
): InStatement | null {
  const trimmed = ref?.trim();
  if (!trimmed) return null;
  return {
    sql: `INSERT INTO pending_external_deletions (id, kind, ref)
          VALUES (?, ?, ?)
          ${REFRESH_RESERVATION_ON_CONFLICT}`,
    args: [crypto.randomUUID(), kind, trimmed],
  };
}

/**
 * **SELECT 가 고른 참조들**을 삭제 큐에 넣는 문장 하나 — 결과를 읽지 않으므로 호출부의 `batch` 에 넣을 수 있다.
 *
 * 행을 지우는 문장과 **같은 batch(= 한 트랜잭션)** 에 넣으려고 둔다. 미리 읽어 둔 키를 `VALUES` 로 넣으면
 * 읽은 뒤 바뀐 상태(그 사이 promote 된 원본 등)를 못 보지만, `INSERT … SELECT` 는 같은 트랜잭션 안에서
 * 바로 뒤의 DELETE 와 **같은 조건·같은 상태**를 본다 — 지우는 행과 예약하는 키가 어긋날 수 없다.
 *
 * `select` 는 `ref` 열 하나를 내야 한다. 빈 참조는 거른다(`externalDeletionStatement` 와 같은 규칙).
 * 같은 `(kind, ref)` 는 한 행이 되고 id 만 새로 바뀐다(`REFRESH_RESERVATION_ON_CONFLICT`).
 * (바깥 SELECT 의 `WHERE` 는 빼지 말 것 — SQLite 는 `INSERT … SELECT … ON CONFLICT` 에서 WHERE 가
 * 없으면 `ON` 을 조인 조건으로 읽는다.)
 */
export function externalDeletionsFromSelectStatement(
  kind: ExternalDeletionKind,
  select: { sql: string; args: ReadonlyArray<string | number | null> },
): InStatement {
  return {
    sql: `INSERT INTO pending_external_deletions (id, kind, ref)
          SELECT lower(hex(randomblob(16))), ?, ref
            FROM (${select.sql})
           WHERE ref IS NOT NULL AND ref <> ''
          ${REFRESH_RESERVATION_ON_CONFLICT}`,
    args: [kind, ...select.args],
  };
}

/**
 * **이 사람들의 업로드 원본을 가리키는 문구의 키**를 삭제 큐에 옮기는 문장 하나.
 *
 * 받은 사람 소유의 `family-voice` 문구는 보낸 사람의 업로드 키를 그대로 담는다. 가족 녹음 원본은
 * 프로필에 안 묶여 7일 TTL 이 업로드 행을 먼저 지우므로(`cleanupExpiredAudio`), 업로드 행에서 읽는
 * `enqueueUserVoiceArtifacts` 만으로는 그 키를 못 찾는다. 그래서 문구를 지우거나 키를 비우는 경로는
 * (탈퇴 파기·음성 동의 철회·보관 만료) **그 전에** 이 문장을 돌린다.
 *
 * TTL 은 이제 행 삭제와 큐 적재를 한 트랜잭션으로 묶지만(2026-10-01), 그 전에는 **따로** 커밋해 그 사이가
 * 끊긴 녹음은 R2 파일의 키를 아는 곳이 이 문구뿐이다 — 그 잔재를 거두려고 이 문장은 그대로 둔다.
 * 이미 예약된 키를 다시 넣어도 한 행이고 id 만 바뀐다.
 */
export function enqueueUploadKeysReferencedByMessagesStatement(
  ownerUserIds: readonly string[],
): InStatement {
  const uploads = audioUrlPointsAtUploadsOf('audio_url', ownerUserIds);
  return externalDeletionsFromSelectStatement('r2_object', {
    sql: `SELECT audio_url AS ref FROM messages
           WHERE audio_url IS NOT NULL AND ${uploads.sql}`,
    args: uploads.args,
  });
}

/**
 * 사용자의 음성 외부 자원(클론 voice + R2 오브젝트) 전부를 큐에 적재한다.
 * purgeUserAccount / deletePaidVoiceDataForUser 가 행을 지우기 전에 호출해야 한다.
 * 대상은 본인 소유 자원뿐이다 — 클론 voice, 클론 학습용 업로드 원본(voice_uploads),
 * 본인 메시지/보이스로 생성된 TTS 오브젝트(generated_audio_assets).
 */
export async function enqueueUserVoiceArtifacts(
  tx: DbExecutor,
  ownerIds: string[],
): Promise<void> {
  if (ownerIds.length === 0) return;
  const ph = ownerIds.map(() => '?').join(',');

  const voices = await tx.execute({
    sql: `SELECT elevenlabs_voice_id FROM voice_profiles
          WHERE user_id IN (${ph}) AND elevenlabs_voice_id IS NOT NULL`,
    args: ownerIds,
  });
  await enqueueExternalDeletionsBatch(
    tx,
    'elevenlabs_voice',
    voices.rows.map((row) => row.elevenlabs_voice_id as string),
  );

  const uploads = await tx.execute({
    sql: `SELECT object_key FROM voice_uploads WHERE user_id IN (${ph})`,
    args: ownerIds,
  });
  await enqueueExternalDeletionsBatch(
    tx,
    'r2_object',
    uploads.rows.map((row) => row.object_key as string),
  );

  const generated = await tx.execute({
    sql: `SELECT audio_object_key FROM generated_audio_assets
          WHERE audio_object_key IS NOT NULL
            AND (user_id IN (${ph})
                 OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph})))`,
    args: [...ownerIds, ...ownerIds],
  });
  await enqueueExternalDeletionsBatch(
    tx,
    'r2_object',
    generated.rows.map((row) => row.audio_object_key as string),
  );

}

/** 큐를 배치로 비운다 — cron 전용. 외부 API 호출이 있으므로 트랜잭션 밖에서 실행. */
/**
 * R2 오브젝트 삭제 유예. **오브젝트가 올라온 지** 이만큼 지난 것만 실제로 지운다.
 *
 * 키가 결정론적이라 '내가 올린 것' 과 '남이 올린 같은 내용' 을 구분할 수 없다. 렌더 한
 * 회차는 길어야 수십 초이므로, 마지막 업로드 이후 이 시간을 넘겼는데도 아무도 참조하지
 * 않으면 미아가 맞다. 파기(목소리 삭제·동의 철회)에도 같은 유예가 걸리지만 약속 단위가
 * 일(日)이라 영향이 없다.
 */
const R2_DELETE_GRACE_MS = 30 * 60 * 1000;

export async function drainExternalDeletions(
  db: Client,
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const pending = await db.execute({
    sql: `WITH
            retry AS (
              SELECT id, kind, ref, attempts, created_at
              FROM pending_external_deletions
              WHERE attempts > 0
              ORDER BY attempts ASC, created_at ASC
              LIMIT ?
            ),
            fresh AS (
              SELECT id, kind, ref, attempts, created_at
              FROM pending_external_deletions
              WHERE attempts = 0
              ORDER BY created_at ASC
              LIMIT ?
            )
          SELECT id, kind, ref, attempts, created_at FROM retry
          UNION ALL
          SELECT id, kind, ref, attempts, created_at FROM fresh`,
    args: [Math.floor(DRAIN_BATCH_SIZE / 2), Math.ceil(DRAIN_BATCH_SIZE / 2)],
  });
  if (pending.rows.length === 0) return;

  const bucket = env.VOICE_BUCKET;
  const elevenLabs = env.ELEVENLABS_API_KEY ? new ElevenLabsClient(env.ELEVENLABS_API_KEY) : null;
  let succeeded = 0;

  for (const row of pending.rows) {
    const id = String(row.id);
    const kind = String(row.kind) as ExternalDeletionKind;
    const ref = String(row.ref);
    try {
      if (kind === 'elevenlabs_voice') {
        if (!elevenLabs) throw new Error('ELEVENLABS_API_KEY unset');
        try {
          await elevenLabs.deleteVoice(ref);
        } catch (err) {
          // 이미 삭제된 voice 는 성공으로 취급.
          if (!String(err).includes('404')) throw err;
        }
      } else {
        if (!bucket) throw new Error('VOICE_BUCKET unset');
        // ⚠ **결정론적 키라 '내 것' 을 확신할 수 없다**(2026-09-03 리뷰 10·11·12차).
        //   R2 키는 cacheKey 에서 나오므로(`generated-tts/<user>/<cacheKey>.mp3`) 같은
        //   목소리·같은 문구를 만든 다른 렌더가 **같은 키**를 올린다. 그 렌더가 아직 행을
        //   커밋하지 않은 사이에 지우면, 곧 게시될 알람이 없는 음원을 가리킨다.
        //
        //   ⚠ **유예는 큐 나이가 아니라 오브젝트의 업로드 시각에 건다**(리뷰 12차).
        //   큐 행의 `created_at` 은 **처음 정리를 시도한 때**를 말할 뿐이다 — 삭제가 실패해
        //   `attempts` 만 오르고 `created_at` 은 그대로인 행이 30분을 넘긴 뒤, **그때 새
        //   렌더가 같은 키를 올리면** 그 회차가 유예를 통과해 방금 올라온 오브젝트를 지운다.
        //   R2 오브젝트의 업로드 시각은 다시 올릴 때마다 갱신되므로, 그걸 보면 유예가
        //   **경쟁 업로드에 정확히 연동**된다.
        const head = typeof bucket.head === 'function' ? await bucket.head(ref) : null;
        if (head) {
          const uploadedAt = head.uploaded instanceof Date ? head.uploaded.getTime() : NaN;
          if (Number.isFinite(uploadedAt) && now.getTime() - uploadedAt < R2_DELETE_GRACE_MS) {
            continue; // 방금 올라왔다 — attempts 를 태우지 않고 다음 회차로 넘긴다.
          }
          // ⚠ 판정은 **`messages.audio_url` 만** 본다. `generated_audio_assets` 까지 보면
          //   제자리 교체가 남긴 **옛 원장 행**이 '살아 있다' 로 읽혀 교체된 옛 음원을
          //   영영 못 지운다 — 프리셋은 TTL 스윕에서도 면제라 회수 경로가 사라진다.
          //   목소리 파기·동의 철회는 `messages` 행까지 같은 트랜잭션에서 지우므로
          //   (`paid-voice-cleanup`·`account-deletion`) 이 확인에 걸리지 않는다.
          const stillReferenced = await db.execute({
            sql: 'SELECT 1 FROM messages WHERE audio_url = ? LIMIT 1',
            args: [`r2://${ref}`],
          });
          if (stillReferenced.rows.length === 0) {
            // ⚠ **지우기 직전에 예약이 아직 있는지 다시 본다**(2026-09-03 리뷰 13차).
            //   렌더는 **게시에 성공한 그 트랜잭션에서** 자기 키의 예약을 지운다
            //   (`generateStockClip` 의 `claimKeyFromDeletionQueue`). 그래서 여기서 예약이
            //   사라졌다는 것은 **방금 누군가 이 키로 게시를 마쳤다**는 뜻이다.
            //   (14차 정정: 예전에는 렌더가 **올리기 전에** 지웠는데, 그러면 계정 삭제·
            //    동의 철회가 넣어 둔 남의 예약을 소비하고 업로드가 실패하면 되살릴 곳이
            //    없었다. 이제 게시와 원자적으로 묶여 있어 실패하면 예약이 그대로 남는다.)
            //
            //   ⚠ **이것으로도 완전히 닫히지는 않는다.** 이 확인과 R2 삭제 사이는 DB 밖이라
            //   원자적일 수 없다 — 그 찰나에 올라온 오브젝트는 여전히 지워질 수 있다.
            //   완전한 해법은 회차마다 다른 키에 올리고 게시할 때 승격하는 것인데,
            //   `generated_audio_assets.request_hash` 가 UNIQUE 라 그러면 같은 내용의
            //   두 번째 행이 `INSERT OR IGNORE` 로 무시되고, 그때 `messages.audio_url` 과
            //   `ga.audio_object_key` 가 어긋나 `findMissingStockTargets` 가 그 클립을
            //   **영영 미완성으로 읽는다.** 키 체계를 바꾸려면 그 제약부터 손봐야 한다.
            //   남은 창은 렌더 한 회차(수 초)가 아니라 **DB 왕복 한 번**이다.
            const stillQueued = await db.execute({
              sql: 'SELECT 1 FROM pending_external_deletions WHERE id = ? LIMIT 1',
              args: [id],
            });
            if (stillQueued.rows.length === 0) continue;
            await bucket.delete(ref);
          }
        }
        // head 가 null 이면 오브젝트가 이미 없다 — 지울 것이 없으니 큐에서 내린다.
      }
      // ⚠ **살아 있는 참조를 만난 예약도 여기서 내린다 — 남겨 두지 말 것.**
      //   `messages.audio_url` 이 이 키를 가리킨다 = 그 오브젝트는 **지금 누가 쓰는 것**이고,
      //   결정론적 키라 그건 이 예약이 겨냥한 파일이 아니라 그 뒤에 올라온 새 렌더다.
      //   남겨 두면 `attempts` 는 오류에서만 오르므로(아래 catch) 그 행이 영원히
      //   `attempts = 0` 파티션의 맨 앞(`created_at ASC`)에 앉아, 회차당 몇 칸뿐인 그 자리를
      //   막는다 — **계정 삭제·동의 철회가 넣은 예약이 드레인되지 못한다.** 미아 하나보다
      //   나쁘다.
      //   그리고 그 참조가 사라지는 경로는 스스로 다시 넣는다: TTL 스윕은 `audio_url` 을
      //   비우기 **전에** 넣고(`cleanupExpiredAudio`), 파기는 `messages` 행과 같은
      //   트랜잭션에서 넣는다(`voice-profile` 의 DELETE·`paid-voice-cleanup`).
      //   제자리 교체(스톡 게시 `replaceStockClipInPlace`·클론 재렌더 `generateStockClip`)도 밀려난 키를 같은
      //   트랜잭션에서 다시 넣는다 — 그 재적재가 이 회차의 판단과 겹쳐도 id 가 바뀌어 아래 DELETE 가 빗나간다
      //   (`REFRESH_RESERVATION_ON_CONFLICT`, Codex #840).
      await db.execute({
        sql: 'DELETE FROM pending_external_deletions WHERE id = ?',
        args: [id],
      });
      succeeded += 1;
    } catch (err) {
      await db.execute({
        sql: `UPDATE pending_external_deletions
              SET attempts = attempts + 1, last_error = ?
              WHERE id = ?`,
        args: [String(err).slice(0, 300), id],
      });
    }
  }

  logStructured('info', {
    at: 'audio-retention.drain',
    processed: pending.rows.length,
    succeeded,
  });
}

/**
 * TTL 이 지난 고아 draft 보이스를 정리한다 — cron 전용.
 *
 * draft(화자 분리 후보)는 목소리 만들기 다이얼로그가 닫힐 때 클라이언트가 지우는
 * 임시물이지만, 앱 강제종료/크래시로 정리를 못 거치면 영구 고아가 된다: 일반 목록은
 * is_draft=0 만 노출해 사용자가 지울 방법이 없고, draft 쿼터(MAX_DRAFT_VOICE_PROFILES)와
 * ElevenLabs 슬롯을 무기한 점유해 이후 draft 생성이 VOICE_LIMIT_REACHED 로 막힌다.
 * → TTL 경과 draft 를 소프트 삭제하고 클론 voice 는 외부 삭제 큐로 회수한다.
 *
 * created_at 은 datetime('now')(공백 구분) 포맷이고 cutoff 는 ISO(T 구분)라, 원시 텍스트
 * 비교는 같은 날짜에서 항상 참이 되어 방금 만든 draft 까지 쓸어버린다 — 반드시
 * datetime() 으로 양쪽을 정규화해 비교한다.
 */
export async function cleanupStaleDraftVoices(db: Client, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - DRAFT_VOICE_TTL_HOURS * 60 * 60 * 1000).toISOString();
  // 고르는 조건과 쓰는 조건은 **같은 조각**이다 — 쓰기 문장이 다시 본다(아래).
  const staleDraft = {
    sql: `COALESCE(is_draft, 0) = 1
          AND deleted_at IS NULL
          AND datetime(created_at) <= datetime(?)`,
    args: [cutoff],
  };
  const stale = await db.execute({
    sql: `SELECT id FROM voice_profiles
          WHERE ${staleDraft.sql}
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [...staleDraft.args, TTL_BATCH_SIZE],
  });
  const ids = stale.rows.map((row) => String(row.id));
  if (ids.length === 0) return;
  const ph = ids.map(() => '?').join(', ');
  // ⚠ **클론 삭제 예약과 소프트 삭제는 한 batch(= 한 트랜잭션)다**(`cleanupExpiredAudio` 의 같은 주석).
  //   예전에는 행마다 소프트 삭제를 커밋한 뒤 예약을 **따로** 넣어, 그 사이가 끊기면 draft 는 사라지고
  //   ElevenLabs 클론은 예약 없이 슬롯을 영구히 점유했다.
  //   두 문장 모두 조건을 **다시 본다** — 고른 뒤 promote(is_draft=0)된 정식 보이스의 클론을 파기하는
  //   TOCTOU 를 막는다. 예약이 **먼저** 와야 한다: 소프트 삭제 뒤에는 조건이 거짓이 되어 아무것도 못 고른다.
  const [, claimed] = await db.batch(
    [
      externalDeletionsFromSelectStatement('elevenlabs_voice', {
        sql: `SELECT trim(elevenlabs_voice_id) AS ref FROM voice_profiles
               WHERE id IN (${ph}) AND ${staleDraft.sql}`,
        args: [...ids, ...staleDraft.args],
      }),
      {
        sql: `UPDATE voice_profiles
              SET deleted_at = datetime('now'), updated_at = datetime('now')
              WHERE id IN (${ph}) AND ${staleDraft.sql}`,
        args: [...ids, ...staleDraft.args],
      },
    ],
    'write',
  );
  const expired = claimed?.rowsAffected ?? 0;
  if (expired > 0) {
    logStructured('info', {
      at: 'audio-retention.stale_drafts',
      expired,
    });
  }
}

/**
 * TTL 경과 오디오를 큐에 적재하고 DB 행을 정리한다 — cron 전용.
 * 실제 R2 삭제는 다음 drain 주기가 처리한다 (큐 적재만 하므로 가볍다).
 */
export async function cleanupExpiredAudio(db: Client, now: Date): Promise<void> {
  const uploadCutoff = new Date(
    now.getTime() - VOICE_UPLOAD_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const generatedCutoff = new Date(
    now.getTime() - GENERATED_TTS_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // ⚠ **행을 지우는 것과 삭제를 예약하는 것은 한 batch(= 한 트랜잭션)다**(2026-10-01,
  //   `docs/spec/voice-and-message.md` §11). 예전에는 행마다 DELETE 를 커밋하고 그 뒤에 큐 적재를 **따로**
  //   커밋했다 — 그 사이가 끊기면(워커 subrequest 한도·네트워크) R2 파일이 참조도 삭제 예약도 없이 영구히
  //   남는다. `pending_external_deletions` 는 outbox 다: DB 쪽 변화와 '외부를 지워라' 는 기록이 같이
  //   커밋되거나 같이 없어야 하고, 외부 I/O(R2 삭제)는 트랜잭션 밖의 드레인이 한다.
  //
  //   한 단계는 **고르기(SELECT) 한 번 + 쓰기 batch 한 번** 이다. 쓰기 문장은 고른 id 로 범위를 묶되
  //   **고를 때와 같은 조건을 다시 건다** — 고른 뒤 바뀐 행(promote 된 원본, 새로 알람이 붙은 음원)은
  //   예약도 삭제도 하지 않는다. `INSERT … SELECT`(예약)를 DELETE **앞에** 두므로 둘은 같은 상태를 본다.
  //   예전처럼 행마다 왕복하면 회차당 최대 1 + 10×2(원본) + 1 + 10×3(음원) = 52 subrequest 로 그것만으로
  //   워커 한도(~50)를 넘을 수 있었다 — 지금은 4 다.
  //
  //   **독약 행**(한 행 때문에 batch 가 매번 실패해 같은 자리에서 영원히 막히는 것)은 따져 봤다:
  //   쓰기는 전부 집합 단위라 행 값에 따라 터질 자리가 없다 — 큐 충돌은 `ON CONFLICT` 가 흡수하고, 빈
  //   키는 예약에서 거르고(`externalDeletionsFromSelectStatement`), kind 는 상수이며, 지우는 두 표를
  //   참조하는 FK 도 없다(`voice_speakers` 는 #79 에서 DROP). 남는 실패는 네트워크·스키마 창처럼
  //   **batch 전체에 똑같이** 걸리는 것뿐이라, 통째로 롤백하고 다음 회차(5분)가 다시 하는 것이 맞다.
  //   행마다 따로 커밋하던 예전에도 한 행의 DELETE 가 던지면 그 회차 전체가 멈췄다 — 나빠진 것은 없다.

  // 1) 클론 학습용 업로드 원본.
  //    최종 확정(promote)된 목소리의 원본은 보관한다 — 나중에 프로바이더/API 키가 바뀌어도
  //    이 원본으로 클론을 재생성할 수 있어야 하기 때문(voice_profile_id 로 연결·live·non-draft).
  //    그 외(미승격 draft, 프로필과 무관한 raw 업로드, 삭제된 프로필의 잔여분)만 7일 후 정리한다.
  //    확정 목소리를 명시적으로 삭제하면 DELETE /voice/:id 가 원본을 함께 cascade 삭제한다.
  const expiredUpload = {
    sql: `voice_uploads.created_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM voice_profiles vp
            WHERE vp.id = voice_uploads.voice_profile_id
              AND vp.deleted_at IS NULL
              AND COALESCE(vp.is_draft, 0) = 0
          )`,
    args: [uploadCutoff],
  };
  const uploads = await db.execute({
    sql: `SELECT id FROM voice_uploads
          WHERE ${expiredUpload.sql}
          ORDER BY created_at ASC
          LIMIT ?`,
    args: [...expiredUpload.args, TTL_BATCH_SIZE],
  });
  let expiredUploads = 0;
  const uploadIds = uploads.rows.map((row) => String(row.id));
  if (uploadIds.length > 0) {
    const ph = uploadIds.map(() => '?').join(', ');
    const [, deleted] = await db.batch(
      [
        externalDeletionsFromSelectStatement('r2_object', {
          sql: `SELECT trim(object_key) AS ref FROM voice_uploads
                 WHERE id IN (${ph}) AND ${expiredUpload.sql}`,
          args: [...uploadIds, ...expiredUpload.args],
        }),
        {
          sql: `DELETE FROM voice_uploads WHERE id IN (${ph}) AND ${expiredUpload.sql}`,
          args: [...uploadIds, ...expiredUpload.args],
        },
      ],
      'write',
    );
    expiredUploads = deleted?.rowsAffected ?? 0;
  }

  // 2) TTS 캐시 — 알람이 message_id → messages.audio_url 로 참조 중인 오브젝트는
  //    보존한다. 이 가드가 없으면 활성 알람이 쓰는 TTS 오브젝트가 TTL 후 삭제되어
  //    알람이 무음이 된다.
  //
  //    ⚠ **받은(가족) 알람은 이 보존 대상이 아니다.** 수신 확인이 끝나면 서버 행이
  //    지워지므로(`POST /alarm/:id/received`) 이 EXISTS 에 걸리지 않고, 그 음원은 TTL
  //    대로 정리된다. 그래도 되는 이유는 **수신자 기기가 이미 음원을 로컬에 갖고 있기
  //    때문**이다 — ack 는 다운로드가 끝난 뒤에만 나간다. 뒤집어 말하면 클라가 음원
  //    확보 전에 ack 하면 이 정리가 그 알람의 음원을 지워도 아무도 막지 못한다.
  //    (전달 전 알람은 행이 남아 있으므로 여기서 정상적으로 보존된다.)
  //
  //    시스템 스톡(프리셋) 클립은 무료 버킷 회전·미리듣기용으로 의도적으로 보관한다.
  //    다수 variant 가 alarm.message_id 로 직접 참조되지 않으므로 TTL 정리에서 제외한다
  //    (제외 안 하면 30일 후 audio_url 이 비워져 /tts/stock-clips 가 끊기고 재시드 전까지
  //    무료 음성이 무음이 된다).
  const expiredGenerated = {
    sql: `g.created_at <= ?
          AND g.audio_object_key IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM alarms a
            JOIN messages m ON m.id = a.message_id
            WHERE m.audio_url = 'r2://' || g.audio_object_key
          )
          AND NOT EXISTS (
            SELECT 1 FROM messages mp
            WHERE mp.id = g.message_id AND COALESCE(mp.is_preset, 0) = 1
          )`,
    args: [generatedCutoff],
  };
  const generated = await db.execute({
    sql: `SELECT g.id FROM generated_audio_assets g
          WHERE ${expiredGenerated.sql}
          ORDER BY g.created_at ASC
          LIMIT ?`,
    args: [...expiredGenerated.args, TTL_BATCH_SIZE],
  });
  let expiredGeneratedCount = 0;
  const generatedIds = generated.rows.map((row) => String(row.id));
  if (generatedIds.length > 0) {
    const ph = generatedIds.map(() => '?').join(', ');
    // 고른 id 중 **지금도** 만료 조건에 맞는 원장 행. 세 문장이 같은 조각을 쓴다 — 포인터를 비워도
    // 조건의 참·거짓은 바뀌지 않는다(알람 가드는 '그 키를 쓰는 알람이 없다' 이고, 비우면 더 없어질 뿐이다).
    const stillExpired = {
      sql: `SELECT g.id, g.audio_object_key FROM generated_audio_assets g
             WHERE g.id IN (${ph}) AND ${expiredGenerated.sql}`,
      args: [...generatedIds, ...expiredGenerated.args],
    };
    const [, , deleted] = await db.batch(
      [
        externalDeletionsFromSelectStatement('r2_object', {
          sql: `SELECT trim(audio_object_key) AS ref FROM (${stillExpired.sql})`,
          args: stillExpired.args,
        }),
        // 라이브러리 메시지가 가리키던 포인터를 비워, 오브젝트 삭제 후 깨진 r2:// 참조
        // (재생 시 404)가 라이브러리에 남지 않도록 한다.
        {
          sql: `UPDATE messages SET audio_url = NULL
                WHERE audio_url IN (SELECT 'r2://' || audio_object_key FROM (${stillExpired.sql}))`,
          args: stillExpired.args,
        },
        {
          sql: `DELETE FROM generated_audio_assets
                WHERE id IN (SELECT id FROM (${stillExpired.sql}))`,
          args: stillExpired.args,
        },
      ],
      'write',
    );
    expiredGeneratedCount = deleted?.rowsAffected ?? 0;
  }

  if (expiredUploads > 0 || expiredGeneratedCount > 0) {
    logStructured('info', {
      at: 'audio-retention.ttl',
      expired_uploads: expiredUploads,
      expired_generated: expiredGeneratedCount,
    });
  }
}
