import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from '../types';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';
import { R2VoiceStorage, MAX_VOICE_UPLOAD_BYTES } from '../lib/r2-storage';
import { createEnrollmentAttempts, UnsupportedVoiceProviderError } from '../lib/voice-provider';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import { isPaidVoicePlan } from './billing-helpers';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from '../lib/consent';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { enqueuePrerender, CLONE_CLIP_SEEDS } from '../lib/stock-clips';
import { enqueueExternalDeletion } from '../lib/audio-retention';
import { analyzeSpeechStyleWithVertex } from '../lib/vertex-translate';
import { getSharedInMemoryVoiceStorage } from '@alarmtalk/voice';
import { VoicePreviewTextUpdateSchema } from '@alarmtalk/shared';

const voiceProfile = new Hono<AppEnv>();
const MAX_VOICE_PROFILES = 1;
// F1: 전역(전 사용자 합산) 커스텀 클론 provider 보이스 상한. per-user MAX_VOICE_PROFILES 와
// 의미가 완전히 다르다 — 이건 공급자(ElevenLabs, 향후 벤더) 계정 전체에서 살아있는 커스텀
// 클론 보이스의 최대 개수다. 이 숫자 하나만 바꾸면 전체에 적용된다(운영 50, 폰 테스트 시 2~3).
// 시스템 기본 목소리(is_system)는 이 카운트에서 제외한다.
const MAX_PROVIDER_CLONE_VOICES = 50;
// draft(미승격) 보이스 상한. draft 도 생성 즉시 실제 ElevenLabs 보이스를 만들므로
// (유한·계정 공유 슬롯) 무제한 생성 시 전역 슬롯이 고갈된다. 재시도 여유를 두되
// 사용자당 개수를 제한해 전역 DoS 를 막는다.
const MAX_DRAFT_VOICE_PROFILES = 1;
const MAX_DRAFT_ATTEMPTS_PER_MONTH = 3;
const MIN_CLONE_DURATION_MS = 60_000;
// 프리뷰(draft) 클론은 짧은 클립이라 60초를 못 채우는 경우가 많다.
// "5초 한마디"는 배제하되, 세그먼트를 이어붙일 때 프레임 경계로 몇백 ms
// 짧아져도 의미 있는 길이면 프리뷰가 거부되지 않도록 여유를 둔다.
const MIN_DRAFT_CLONE_DURATION_MS = 12_000;
const MAX_CLONE_DURATION_MS = 120_000;
const CLONE_DURATION_TOLERANCE_MS = 5_000;
const MAX_RELATIONSHIP_LABEL_LENGTH = 30;
const MAX_LISTENER_TITLE_LENGTH = 30;
const OFFICIAL_VOICE_CHANGE_TYPE = 'official_voice';

/**
 * F1: 전역 클론 슬롯 상한을 지키기 위해, 새 provider 보이스를 만들기 직전에 상한을 초과하면
 * LRU(가장 오래 안 쓰인) official 클론을 제거해 슬롯을 비운다.
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
async function evictLruClonesIfOverCap(
  db: ReturnType<typeof getDB>,
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

function monthlyVoiceChangeLimitResponse(c: Context<AppEnv>) {
  return c.json(
    {
      error: '목소리는 한 달에 1번만 변경할 수 있습니다.',
      error_code: 'VOICE_MONTHLY_CHANGE_LIMIT_REACHED',
    },
    429,
  );
}

function currentKstMonthSql(): string {
  return "strftime('%Y-%m', 'now', '+9 hours')";
}

async function reserveMonthlyOfficialVoiceChange(
  db: DbExecutor,
  ownerUserId: string,
  profileId: string,
): Promise<string | null> {
  const ledgerId = crypto.randomUUID();
  const reserved = await db.execute({
    sql: `INSERT OR IGNORE INTO voice_profile_change_ledger
            (id, owner_user_id, voice_profile_id, change_month, change_type, status)
          VALUES (?, ?, ?, ${currentKstMonthSql()}, ?, 'reserved')`,
    args: [ledgerId, ownerUserId, profileId, OFFICIAL_VOICE_CHANGE_TYPE],
  });
  return (reserved.rowsAffected ?? 0) > 0 ? ledgerId : null;
}

async function markMonthlyOfficialVoiceChange(
  db: DbExecutor,
  ledgerId: string | null,
  status: 'succeeded' | 'failed',
): Promise<void> {
  if (!ledgerId) return;
  await db.execute({
    sql: `UPDATE voice_profile_change_ledger
          SET status = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'reserved'`,
    args: [status, ledgerId],
  });
}

async function reserveMonthlyDraftAttempt(
  db: DbExecutor,
  ownerUserId: string,
): Promise<string | null> {
  const monthParts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const attemptMonth = `${monthParts.find((part) => part.type === 'year')!.value}-${monthParts.find((part) => part.type === 'month')!.value}`;
  const result = await db.execute({
    sql: `INSERT INTO voice_draft_attempt_usage
            (owner_user_id, attempt_month, used_count)
          VALUES (?, ?, 1)
          ON CONFLICT(owner_user_id, attempt_month) DO UPDATE SET
            used_count = used_count + 1,
            updated_at = datetime('now')
          WHERE used_count < ?`,
    args: [ownerUserId, attemptMonth, MAX_DRAFT_ATTEMPTS_PER_MONTH],
  });
  return (result.rowsAffected ?? 0) > 0 ? attemptMonth : null;
}

async function refundMonthlyDraftAttempt(
  db: DbExecutor,
  ownerUserId: string,
  attemptMonth: string,
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_draft_attempt_usage
          SET used_count = MAX(used_count - 1, 0), updated_at = datetime('now')
          WHERE owner_user_id = ? AND attempt_month = ?`,
    args: [ownerUserId, attemptMonth],
  });
}

async function activeOfficialVoiceProfileCount(
  db: DbExecutor,
  ids: string[],
  excludeId?: string,
): Promise<number> {
  const ph = ids.map(() => '?').join(',');
  const excludeClause = excludeId ? 'AND id != ?' : '';
  const count = await db.execute({
    sql: `SELECT COUNT(*) as count FROM voice_profiles
          WHERE user_id IN (${ph}) AND deleted_at IS NULL AND status != 'failed'
            AND COALESCE(is_draft, 0) = 0 ${excludeClause}`,
    args: excludeId ? [...ids, excludeId] : ids,
  });
  return Number(count.rows[0]?.count ?? 0);
}

function normalizeRelationshipLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  return String(value).trim();
}

function validateLabelLength(label: string | undefined, max: number): boolean {
  return label === undefined || label.length <= max;
}

async function canUseSharedVoiceProfile(
  db: ReturnType<typeof getDB>,
  userPk: string,
  voiceProfileId: string,
): Promise<boolean> {
  const shared = await db.execute({
    sql: `SELECT vp.user_id, u.id AS owner_pk
          FROM voice_profiles vp
          LEFT JOIN users u ON u.google_id = vp.user_id OR u.id = vp.user_id
          WHERE vp.id = ? AND COALESCE(vp.is_shared, 0) = 1
            AND COALESCE(vp.is_draft, 0) = 0
            AND vp.deleted_at IS NULL
          LIMIT 1`,
    args: [voiceProfileId],
  });
  if (shared.rows.length === 0) return false;
  const row = typedRow<{ owner_pk?: string | null; user_id?: string }>(shared.rows[0]!);
  const ownerPk = row.owner_pk || row.user_id || null;
  if (!ownerPk || ownerPk === userPk) return false;
  return assertSameGroup(db, userPk, ownerPk);
}

/**
 * 소유권 검증용 user_id 후보 목록. 일부 라우트는 `user_id` 컬럼에 google sub
 * (= userId)을 저장하고, 다른 라우트는 users.id (= userIdPK)를 저장하기 때문에
 * 둘 다 매칭해야 owner check 가 일관되게 동작한다.
 */
function ownerIds(c: { get: (k: 'userId' | 'userIdPK') => string | undefined }): string[] {
  const sub = c.get('userId') as string;
  const pk = c.get('userIdPK') as string | undefined;
  return Array.from(new Set([sub, pk].filter((v): v is string => Boolean(v))));
}

/**
 * 유료 클론이 사전렌더할 총 클립 수 — CLONE_CLIP_SEEDS 시드 개수의 합(단일 언어 렌더).
 * 시드가 늘면 자동으로 따라간다(하드코딩 금지). 현재 21 = greeting1+weather9+fortune5+love3+medication3.
 */
const CLONE_PRERENDER_TOTAL = CLONE_CLIP_SEEDS.reduce((sum, group) => sum + group.seeds.length, 0);

/** speech_style_status 기록. NULL=대상 아님, pending=진행중, done=완료, failed=실패(재시도 가능). */
async function setSpeechStyleStatus(
  db: DbExecutor,
  profileId: string,
  status: 'pending' | 'done' | 'failed',
): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_profiles SET speech_style_status = ?, updated_at = datetime('now')
          WHERE id = ? AND deleted_at IS NULL`,
    args: [status, profileId],
  });
}

/**
 * 등록 녹음 전사(ElevenLabs Scribe) → Vertex 말투 분석 → speech_style 저장.
 * 결과와 무관하게 speech_style_status 를 반드시 기록한다('done' | 'failed') — 실패를 조용히
 * 삼키면 클라가 알 길이 없다. 클론 등록의 waitUntil 경로와 재시도 엔드포인트(동기)가 공유한다.
 * 시작 시·저장 직전에 민감 동의(음성/국외이전)를 재확인한다 — 진행 중 철회되면 외부 전사/
 * 저장을 중단한다(stock-clips generateStockClip 의 assertCloneAuthorization 패턴).
 */
async function runSpeechStyleAnalysis(
  env: Env,
  profileId: string,
  audioData: ArrayBuffer,
  options: {
    mimeType?: string | null;
    fileName?: string | null;
    language: string;
    ownerPk: string;
  },
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const db = getDB(env);
  try {
    // 동의 철회 경쟁(H): 시작 시 재확인 — 철회됐으면 원본을 외부 전사(ElevenLabs)로 보내지 않는다.
    const missingAtStart = await missingConsentType(db, options.ownerPk, SENSITIVE_REQUIRED_CONSENTS);
    if (missingAtStart) {
      throw new Error(`Speech style analysis aborted: consent withdrawn (${missingAtStart}).`);
    }
    if (!env.ELEVENLABS_API_KEY) {
      throw new Error('ELEVENLABS_API_KEY is not configured for speech style analysis.');
    }
    const client = new ElevenLabsClient(env.ELEVENLABS_API_KEY);
    const transcript = await client.speechToText(audioData, {
      mimeType: options.mimeType,
      fileName: options.fileName,
    });
    // null = Vertex 미설정/호출 실패/전사가 너무 짧음(전사 실패 의심) — 재시도로 복구 여지가
    // 있으므로 'failed' 로 기록한다(성공 판단은 speech_style 저장 여부).
    const style = await analyzeSpeechStyleWithVertex(env, transcript, options.language);
    if (!style) {
      throw new Error('Speech style analysis produced no result (empty transcript or Vertex failure).');
    }
    // 저장 직전 재확인 — 전사·분석 왕복 중 철회됐으면 파생 결과(speech_style)를 저장하지 않는다.
    const missingBeforeSave = await missingConsentType(db, options.ownerPk, SENSITIVE_REQUIRED_CONSENTS);
    if (missingBeforeSave) {
      throw new Error(`Speech style analysis discarded: consent withdrawn (${missingBeforeSave}).`);
    }
    await db.execute({
      sql: `UPDATE voice_profiles
            SET speech_style = ?, speech_style_status = 'done', updated_at = datetime('now')
            WHERE id = ? AND deleted_at IS NULL`,
      args: [JSON.stringify(style), profileId],
    });
    return { ok: true };
  } catch (error) {
    try {
      await setSpeechStyleStatus(db, profileId, 'failed');
    } catch {
      // 상태 기록까지 실패해도 분석 실패 자체는 아래 error 로 호출자가 로깅한다.
    }
    return { ok: false, error };
  }
}

/**
 * Dev/cleanup helper: delete every voice profile (and its dependent
 * messages + alarms) belonging to the calling user. Useful for wiping
 * failed clones that piled up during testing. R2 objects are left for
 * the periodic cleanup cron — only DB rows go away here.
 */
voiceProfile.delete('/_dev/clear-mine', async (c) => {
  const subId = c.get('userId') as string;
  // production 환경에서는 노출 자체를 막는다. 인증을 통과한 뒤에도 dev/test 가 아니면
  // 라우트가 존재하지 않는 것처럼 404 로 응답.
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'dev-only', error_code: 'DEV_ONLY_ROUTE' }, 404);
  }
  const pkId = (c.get('userIdPK') as string | undefined) ?? subId;
  const db = getDB(c.env);
  const ids = Array.from(new Set([subId, pkId].filter(Boolean)));
  const ph = ids.map(() => '?').join(',');
  const counts: Record<string, number> = {};
  const tryDel = async (label: string, sql: string, args: (string | number)[] = []) => {
    try {
      const r = await db.execute({ sql, args });
      counts[label] = r.rowsAffected ?? 0;
    } catch (err) {
      // Best-effort cleanup. Tables may not exist in every environment.
      // Log and continue.
      // eslint-disable-next-line no-console
      console.log('[clear-mine skip]', label, err instanceof Error ? err.message : String(err));
      counts[label] = -1;
    }
  };

  // 1) Tables that reference messages or voice_profiles (delete first).
  await tryDel(
    'gifts',
    `DELETE FROM gifts WHERE sender_id IN (${ph}) OR recipient_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))`,
    [...ids, ...ids, ...ids],
  );
  await tryDel(
    'message_library',
    `DELETE FROM message_library WHERE user_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))`,
    [...ids, ...ids],
  );
  await tryDel(
    'generated_audio_assets',
    `DELETE FROM generated_audio_assets WHERE user_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids, ...ids],
  );
  await tryDel(
    'voice_profile_relationships',
    `DELETE FROM voice_profile_relationships WHERE user_id IN (${ph})
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids],
  );
  await tryDel('dub_jobs', `DELETE FROM dub_jobs WHERE user_id IN (${ph})`, ids);
  await tryDel('notes', `DELETE FROM notes WHERE sender_id IN (${ph}) OR receiver_id IN (${ph})`, [
    ...ids,
    ...ids,
  ]);
  await tryDel(
    'alarms',
    `DELETE FROM alarms WHERE user_id IN (${ph}) OR target_user_id IN (${ph})
     OR message_id IN (SELECT id FROM messages WHERE user_id IN (${ph}))
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids, ...ids, ...ids],
  );

  // 2) Now safe to drop messages + voice_profiles.
  await tryDel(
    'messages',
    `DELETE FROM messages WHERE user_id IN (${ph})
     OR voice_profile_id IN (SELECT id FROM voice_profiles WHERE user_id IN (${ph}))`,
    [...ids, ...ids],
  );
  await tryDel('voice_profiles', `DELETE FROM voice_profiles WHERE user_id IN (${ph})`, ids);

  // 3) Per-user satellite tables.
  await tryDel('push_tokens', `DELETE FROM push_tokens WHERE user_id IN (${ph})`, ids);
  await tryDel(
    'friendships',
    `DELETE FROM friendships WHERE user_a IN (${ph}) OR user_b IN (${ph})`,
    [...ids, ...ids],
  );
  await tryDel(
    'voice_speakers',
    `DELETE FROM voice_speakers WHERE upload_id IN (SELECT id FROM voice_uploads WHERE user_id IN (${ph}))`,
    ids,
  );
  await tryDel('voice_uploads', `DELETE FROM voice_uploads WHERE user_id IN (${ph})`, ids);

  // 4) Finally the users row(s).
  await tryDel('users', `DELETE FROM users WHERE google_id = ? OR id IN (${ph})`, [subId, ...ids]);

  return c.json({
    deleted: counts,
    note: '다음 요청 시 auth middleware가 users 행을 새로 만듭니다 (id=google_id).',
  });
});

voiceProfile.get('/', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  const status = c.req.query('status');

  const ph = ids.map(() => '?').join(',');
  const validStatuses = ['ready', 'processing', 'failed'];
  let statusClause = '';
  const baseArgs: (string | number)[] = [...ids];
  if (status && validStatuses.includes(status)) {
    statusClause = ' AND status = ?';
    baseArgs.push(status);
  }

  // 시스템 제공(스톡) 보이스는 모든 사용자에게 노출 — 무료 플랜의 기본 목소리.
  // 내 목소리가 먼저, 시스템 보이스가 뒤에 오도록 정렬한다.
  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM voice_profiles WHERE (user_id IN (${ph}) OR COALESCE(is_system, 0) = 1) AND deleted_at IS NULL AND COALESCE(is_draft, 0) = 0${statusClause}`,
      args: baseArgs,
    }),
    db.execute({
      sql: `SELECT * FROM voice_profiles WHERE (user_id IN (${ph}) OR COALESCE(is_system, 0) = 1) AND deleted_at IS NULL AND COALESCE(is_draft, 0) = 0${statusClause} ORDER BY COALESCE(is_system, 0) ASC, created_at DESC LIMIT ? OFFSET ?`,
      args: [...baseArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0]!.total);
  return c.json({
    profiles: result.rows.map((row) => ({
      ...row,
      is_shared: Boolean(Number(row.is_shared ?? 0)),
      is_draft: Boolean(Number(row.is_draft ?? 0)),
      is_system: Boolean(Number(row.is_system ?? 0)),
      // 말투 분석 상태(NULL=대상 아님) — 클라가 실패 표시·재시도 버튼을 띄우는 근거.
      speech_style_status: (row.speech_style_status as string | null) ?? null,
    })),
    total,
    limit,
    offset,
  });
});

voiceProfile.get('/draft', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const ph = ids.map(() => '?').join(',');
  const result = await db.execute({
    sql: `SELECT * FROM voice_profiles
          WHERE user_id IN (${ph}) AND deleted_at IS NULL AND COALESCE(is_draft, 0) = 1
            AND status != 'failed'
          ORDER BY created_at DESC LIMIT 1`,
    args: ids,
  });
  const row = result.rows[0];
  return c.json({
    profile: row
      ? {
          ...row,
          // 드래프트는 isShared=true 로도 생성될 수 있고(공유 예약), promote 시 서버가 그 값으로 공유한다.
          // false 로 마스킹하면 앱이 '공유 안 함'으로 표시한 채 실제로는 공유돼 UI 가 어긋난다 → 실제 값 반환.
          is_shared: Boolean(Number(row.is_shared ?? 0)),
          is_draft: true,
          is_system: false,
          speech_style_status: (row.speech_style_status as string | null) ?? null,
        }
      : null,
  });
});

voiceProfile.get('/family', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const db = getDB(c.env);

  const memberRes = await db.execute({
    sql: `SELECT DISTINCT fm2.user_id AS member_user_id, u.google_id AS member_google_id
          FROM users me
          JOIN plan_group_members fm1 ON fm1.user_id = me.id
          JOIN plan_group_members fm2 ON fm1.plan_group_id = fm2.plan_group_id
          LEFT JOIN users u ON u.id = fm2.user_id
          WHERE me.google_id = ? AND fm2.user_id != me.id AND fm2.user_id != ?`,
    args: [userId, userId],
  });

  if (memberRes.rows.length === 0) {
    return c.json({ profiles: [] });
  }

  const memberIds = Array.from(
    new Set(
      memberRes.rows.flatMap((r) => {
        const row = typedRow<{
          member_user_id?: string;
          member_google_id?: string | null;
          user_id?: string;
        }>(r);
        return [row.member_user_id ?? row.user_id, row.member_google_id].filter(
          (value): value is string => Boolean(value),
        );
      }),
    ),
  );
  if (memberIds.length === 0) {
    return c.json({ profiles: [] });
  }

  const placeholders = memberIds.map(() => '?').join(',');
  const voicesRes = await db.execute({
    sql: `SELECT vp.id, vp.name, vp.status, vp.created_at, vp.user_id, vp.is_shared,
                 vpr.relationship_label AS relationship_label,
                 vpr.listener_title AS listener_title,
                 vpr.relationship_label AS viewer_relationship_raw,
                 vpr.listener_title AS viewer_listener_raw,
                 u.name as owner_name
          FROM voice_profiles vp
          LEFT JOIN users u ON vp.user_id = u.google_id OR vp.user_id = u.id
          LEFT JOIN voice_profile_relationships vpr
            ON vpr.voice_profile_id = vp.id AND vpr.user_id IN (?, ?)
          WHERE vp.user_id IN (${placeholders})
            AND vp.deleted_at IS NULL
            AND vp.status = 'ready'
            AND COALESCE(vp.is_shared, 0) = 1
            AND COALESCE(vp.is_draft, 0) = 0
          ORDER BY vp.created_at DESC`,
    args: [userPk, userId, ...memberIds],
  });

  return c.json({
    profiles: voicesRes.rows.map((row) => {
      const viewerRelationshipRaw = row.viewer_relationship_raw;
      const viewerListenerRaw = row.viewer_listener_raw;
      const needsViewerInfo =
        typeof viewerRelationshipRaw !== 'string' ||
        viewerRelationshipRaw.trim() === '' ||
        typeof viewerListenerRaw !== 'string' ||
        viewerListenerRaw.trim() === '';
      // viewer raw 필드는 응답에서 제외
      const {
        viewer_relationship_raw: _r,
        viewer_listener_raw: _l,
        ...rest
      } = row as Record<string, unknown>;
      return {
        ...rest,
        is_shared: Boolean(Number(row.is_shared ?? 0)),
        needs_viewer_info: needsViewerInfo,
      };
    }),
  });
});

voiceProfile.get('/:id', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const result = await db.execute({
    sql: `SELECT * FROM voice_profiles WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL`,
    args: [id, ...ids],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const row = result.rows[0]!;
  return c.json({
    profile: {
      ...row,
      is_shared: Boolean(Number(row.is_shared ?? 0)),
      is_draft: Boolean(Number(row.is_draft ?? 0)),
      speech_style_status: (row.speech_style_status as string | null) ?? null,
    },
  });
});

voiceProfile.post('/:id/preview-played', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  let body: { preview_playback_token?: unknown; previewPlaybackToken?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }
  const token = body.preview_playback_token ?? body.previewPlaybackToken;
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return c.json(
      { error: 'Valid preview playback token required', error_code: 'INVALID_PREVIEW_TOKEN' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const confirmed = await db.execute({
    sql: `UPDATE voice_profiles
          SET previewed_at = datetime('now'), preview_claim_token = NULL,
              updated_at = datetime('now')
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 1 AND status = 'ready'
            AND preview_claimed_at IS NULL AND preview_claim_token = ?`,
    args: [id, ...ids, token],
  });
  if ((confirmed.rowsAffected ?? 0) === 0) {
    return c.json(
      {
        error: 'Preview playback token is stale or the draft changed.',
        error_code: 'VOICE_PREVIEW_CONFIRMATION_CONFLICT',
      },
      409,
    );
  }
  return c.json({ success: true, previewed: true });
});

// 등록 미리듣기 문구 직접 수정(초안 전용) — "말투가 마음에 안 들면 수정" 플로우.
// 수정한 문구가 이후 미리듣기 합성 문구(캐시 키)이자 사전렌더 톤 스타일 레퍼런스가 된다.
// previewed_at/claim 을 함께 리셋해 수정본을 끝까지 다시 들어야 승격(keep)할 수 있게 하고,
// preview_tag 도 함께 비운다 — 이전 문구 기준으로 골랐던 delivery 태그가 수정본에 그대로
// 붙으면(예: 차분한 수정본이 [excited] 로) 어긋나므로, 수정본은 중립 기본 태그로 합성된다.
voiceProfile.patch('/:id/preview-text', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }
  const parsed = VoicePreviewTextUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: 'Preview text must be 1-200 characters without brackets.',
        error_code: 'VOICE_PREVIEW_TEXT_INVALID',
      },
      400,
    );
  }
  // 합성 문구는 한 줄로 조립되므로 개행/연속 공백은 단일 공백으로 정규화한다.
  const previewText = parsed.data.preview_text.replace(/\s+/g, ' ').trim();
  if (!previewText) {
    return c.json(
      {
        error: 'Preview text must be 1-200 characters without brackets.',
        error_code: 'VOICE_PREVIEW_TEXT_INVALID',
      },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const updated = await db.execute({
    sql: `UPDATE voice_profiles
          SET preview_text = ?, preview_tag = NULL, previewed_at = NULL,
              preview_claimed_at = NULL, preview_claim_token = NULL,
              updated_at = datetime('now')
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 1 AND status = 'ready'`,
    args: [previewText, id, ...ids],
  });
  if ((updated.rowsAffected ?? 0) === 0) {
    return c.json(
      { error: 'Voice draft not found', error_code: 'VOICE_PROFILE_NOT_FOUND' },
      404,
    );
  }
  return c.json({ success: true, preview_text: previewText });
});

voiceProfile.patch('/:id', async (c) => {
  const ids = ownerIds(c);
  const userId = c.get('userId') as string;
  const userPk = (c.get('userIdPK') as string | undefined) || userId;
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  let body: {
    name?: unknown;
    is_shared?: unknown;
    isShared?: unknown;
    is_draft?: unknown;
    isDraft?: unknown;
    relationship_label?: unknown;
    relationshipLabel?: unknown;
    listener_title?: unknown;
    listenerTitle?: unknown;
    language?: unknown;
    app_language?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }
  // draft→official 확정 시 사전렌더할 앱 언어(클라 전송, 미전송 시 ko).
  const prerenderLanguage =
    typeof (body.language ?? body.app_language) === 'string'
      ? String(body.language ?? body.app_language)
      : 'ko';

  const hasName = body.name !== undefined;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sharedValue = body.is_shared ?? body.isShared;
  const isSharedUpdate = typeof sharedValue === 'boolean' ? sharedValue : undefined;
  const hasShared = isSharedUpdate !== undefined;
  const draftValue = body.is_draft ?? body.isDraft;
  const isDraftUpdate = typeof draftValue === 'boolean' ? draftValue : undefined;
  const hasDraft = isDraftUpdate !== undefined;
  const hasRelationship =
    body.relationship_label !== undefined || body.relationshipLabel !== undefined;
  const relationshipLabel = normalizeRelationshipLabel(
    body.relationship_label ?? body.relationshipLabel,
  );
  const hasListenerTitle = body.listener_title !== undefined || body.listenerTitle !== undefined;
  const listenerTitle = normalizeRelationshipLabel(body.listener_title ?? body.listenerTitle);
  if (!hasName && !hasShared && !hasDraft && !hasRelationship && !hasListenerTitle) {
    return c.json(
      { error: 'name must be 1-50 characters', error_code: 'INVALID_NAME_LENGTH' },
      400,
    );
  }
  if (hasName && (name.length === 0 || name.length > 50)) {
    return c.json(
      { error: 'name must be 1-50 characters', error_code: 'INVALID_NAME_LENGTH' },
      400,
    );
  }
  if (!validateLabelLength(relationshipLabel, MAX_RELATIONSHIP_LABEL_LENGTH)) {
    return c.json(
      {
        error: `relationship_label must be ${MAX_RELATIONSHIP_LABEL_LENGTH} characters or less`,
        error_code: 'INVALID_RELATIONSHIP_LABEL',
      },
      400,
    );
  }
  if (!validateLabelLength(listenerTitle, MAX_LISTENER_TITLE_LENGTH)) {
    return c.json(
      {
        error: `listener_title must be ${MAX_LISTENER_TITLE_LENGTH} characters or less`,
        error_code: 'INVALID_LISTENER_TITLE',
      },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const existing = await db.execute({
    sql: `SELECT id, COALESCE(is_draft, 0) as is_draft, previewed_at
          FROM voice_profiles
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL`,
    args: [id, ...ids],
  });
  if (existing.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }
  const promotesDraftToOfficial =
    hasDraft && isDraftUpdate === false && Number(existing.rows[0]!.is_draft ?? 0) === 1;

  if (promotesDraftToOfficial && (hasRelationship || hasListenerTitle)) {
    return c.json(
      {
        error: 'Preview persona fields cannot change during registration.',
        error_code: 'VOICE_PROMOTION_FIELDS_NOT_ALLOWED',
      },
      409,
    );
  }

  if (hasDraft && isDraftUpdate === true && Number(existing.rows[0]!.is_draft ?? 0) === 0) {
    return c.json(
      { error: 'An official voice cannot become a draft.', error_code: 'INVALID_VOICE_TRANSITION' },
      409,
    );
  }
  if (promotesDraftToOfficial && !existing.rows[0]!.previewed_at) {
    return c.json(
      {
        error: 'Listen to the preview before keeping this voice.',
        error_code: 'VOICE_PREVIEW_REQUIRED',
      },
      409,
    );
  }
  if (Number(existing.rows[0]!.is_draft ?? 0) === 0 && (hasRelationship || hasListenerTitle)) {
    return c.json(
      {
        error: 'Relationship and title are fixed after registration.',
        error_code: 'VOICE_PERSONA_LOCKED',
      },
      409,
    );
  }

  // promote(draft=false) 시: 다른 non-draft 음성이 1개 이상이면 한도 초과.
  // 생성 쿼터와 동일하게 failed 잔여물은 슬롯을 점유하지 않으므로 제외한다.
  if (promotesDraftToOfficial) {
    const nonDraftCount = await db.execute({
      sql: `SELECT
                   SUM(CASE WHEN deleted_at IS NULL AND status != 'failed'
                              AND COALESCE(is_draft, 0) = 0 AND id != ?
                       THEN 1 ELSE 0 END) as active_count
            FROM voice_profiles
            WHERE user_id IN (${ph})`,
      args: [id, ...ids],
    });
    const row = nonDraftCount.rows[0]!;
    const existingCount = Number(row.active_count ?? row.count ?? 0);
    if (existingCount >= MAX_VOICE_PROFILES) {
      return c.json(
        {
          error: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
          error_code: 'VOICE_LIMIT_REACHED',
        },
        409,
      );
    }
  }

  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  if (hasName) {
    updates.push('name = ?');
    args.push(name);
  }
  if (hasShared) {
    updates.push('is_shared = ?');
    args.push(isSharedUpdate ? 1 : 0);
  }
  if (hasDraft) {
    updates.push('is_draft = ?');
    args.push(isDraftUpdate ? 1 : 0);
  }
  if (hasRelationship) {
    updates.push('relationship_label = ?');
    args.push(relationshipLabel ?? '');
    updates.push('previewed_at = NULL');
    updates.push('preview_claimed_at = NULL');
    updates.push('preview_claim_token = NULL');
    // 관계가 바뀌면 톤 적응 미리듣기 문구도 무효 — 리셋해 다음 미리듣기가 새 관계로 재생성되게 한다.
    updates.push('preview_text = NULL');
    updates.push('preview_tag = NULL');
  }
  if (hasListenerTitle) {
    updates.push('listener_title = ?');
    args.push(listenerTitle ?? '');
    if (!hasRelationship) {
      updates.push('previewed_at = NULL');
      updates.push('preview_claimed_at = NULL');
      updates.push('preview_claim_token = NULL');
      updates.push('preview_text = NULL');
      updates.push('preview_tag = NULL');
    }
  }
  updates.push("updated_at = datetime('now')");
  args.push(id, ...ids);

  // deleted_at IS NULL 재확인: 위 존재 확인과 이 UPDATE 사이에 cron 의 고아 draft
  // 스윕(cleanupStaleDraftVoices)이 행을 소프트 삭제했을 수 있다. 가드 없이 쓰면
  // 삭제된(클론 파기 큐 적재까지 끝난) 행을 promote 한 것처럼 200 을 돌려주게 된다.
  const updateProfile = (tx: DbExecutor, extraWhere = '') =>
    tx.execute({
      sql: `UPDATE voice_profiles SET ${updates.join(', ')}
            WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL ${extraWhere}`,
      args,
    });
  const updateRes = promotesDraftToOfficial
    ? await withWriteTransaction(db, async (tx) => {
        const plan = await tx.execute({
          sql: 'SELECT plan FROM users WHERE id = ? OR google_id = ? LIMIT 1',
          args: [userPk, userId],
        });
        if (plan.rows.length === 0 || !isPaidVoicePlan(plan.rows[0]!.plan)) {
          return { status: 'paid_required' as const, rowsAffected: 0 };
        }
        const missingConsent = await missingConsentType(tx, userPk, SENSITIVE_REQUIRED_CONSENTS);
        if (missingConsent) {
          return { status: 'consent_required' as const, consent: missingConsent, rowsAffected: 0 };
        }
        const existingCount = await activeOfficialVoiceProfileCount(tx, ids, id);
        if (existingCount >= MAX_VOICE_PROFILES) {
          return { status: 'voice_limit' as const, rowsAffected: 0 };
        }
        const ledgerId = await reserveMonthlyOfficialVoiceChange(tx, userPk, id);
        if (!ledgerId) {
          return { status: 'monthly_limit' as const, rowsAffected: 0 };
        }
        const promoted = await updateProfile(
          tx,
          'AND COALESCE(is_draft, 0) = 1 AND previewed_at IS NOT NULL',
        );
        if ((promoted.rowsAffected ?? 0) === 0) {
          await markMonthlyOfficialVoiceChange(tx, ledgerId, 'failed');
          return { status: 'not_found' as const, rowsAffected: 0 };
        }
        await markMonthlyOfficialVoiceChange(tx, ledgerId, 'succeeded');
        await enqueuePrerender(tx, id, userPk, prerenderLanguage);
        return { status: 'ok' as const, rowsAffected: promoted.rowsAffected ?? 0 };
      })
    : {
        status: 'ok' as const,
        ...(await updateProfile(
          db,
          hasRelationship || hasListenerTitle ? 'AND COALESCE(is_draft, 0) = 1' : '',
        )),
      };
  if (updateRes.status === 'voice_limit') {
    return c.json(
      {
        error: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
        error_code: 'VOICE_LIMIT_REACHED',
      },
      409,
    );
  }
  if (updateRes.status === 'monthly_limit') {
    return monthlyVoiceChangeLimitResponse(c);
  }
  if (updateRes.status === 'paid_required') {
    return c.json(
      {
        error: 'Voice features require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }
  if (updateRes.status === 'consent_required') {
    return c.json(
      {
        error: 'Required voice consent is missing.',
        error_code: 'CONSENT_REQUIRED',
        consent: updateRes.consent,
      },
      403,
    );
  }
  if ((updateRes.rowsAffected ?? 0) === 0) {
    if (promotesDraftToOfficial || hasRelationship || hasListenerTitle) {
      return c.json(
        {
          error: 'Voice state changed. Refresh and try again.',
          error_code: 'VOICE_TRANSITION_CONFLICT',
        },
        409,
      );
    }
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({
    profile: {
      id,
      ...(hasName ? { name } : {}),
      ...(hasShared ? { is_shared: Boolean(isSharedUpdate) } : {}),
      ...(hasDraft ? { is_draft: Boolean(isDraftUpdate) } : {}),
      ...(hasRelationship ? { relationship_label: relationshipLabel ?? '' } : {}),
      ...(hasListenerTitle ? { listener_title: listenerTitle ?? '' } : {}),
    },
  });
});

voiceProfile.patch('/:id/relationship', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');
  const userPk = c.get('userIdPK') || (await resolveUserPk(db, userId)) || userId;

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  let body: {
    relationship_label?: unknown;
    relationshipLabel?: unknown;
    listener_title?: unknown;
    listenerTitle?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }

  const relationshipLabel = normalizeRelationshipLabel(
    body.relationship_label ?? body.relationshipLabel,
  );
  if (
    relationshipLabel === undefined ||
    !validateLabelLength(relationshipLabel, MAX_RELATIONSHIP_LABEL_LENGTH)
  ) {
    return c.json(
      {
        error: `relationship_label must be ${MAX_RELATIONSHIP_LABEL_LENGTH} characters or less`,
        error_code: 'INVALID_RELATIONSHIP_LABEL',
      },
      400,
    );
  }
  const listenerTitleRaw = normalizeRelationshipLabel(body.listener_title ?? body.listenerTitle);
  const listenerTitle = listenerTitleRaw ?? '';
  if (!validateLabelLength(listenerTitle, MAX_LISTENER_TITLE_LENGTH)) {
    return c.json(
      {
        error: `listener_title must be ${MAX_LISTENER_TITLE_LENGTH} characters or less`,
        error_code: 'INVALID_LISTENER_TITLE',
      },
      400,
    );
  }

  const owned = await db.execute({
    sql: `SELECT id, COALESCE(is_draft, 0) AS is_draft
          FROM voice_profiles WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL`,
    args: [id, userPk, userId],
  });

  if (owned.rows.length > 0) {
    if (Number(owned.rows[0]!.is_draft ?? 0) !== 1) {
      return c.json(
        {
          error: 'Relationship and title are fixed after registration.',
          error_code: 'VOICE_PERSONA_LOCKED',
        },
        409,
      );
    }
    const updated = await db.execute({
      sql: `UPDATE voice_profiles
            SET relationship_label = ?, listener_title = ?, previewed_at = NULL,
                preview_claimed_at = NULL, preview_claim_token = NULL,
                preview_text = NULL, preview_tag = NULL,
                updated_at = datetime('now')
            WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
              AND COALESCE(is_draft, 0) = 1`,
      args: [relationshipLabel, listenerTitle, id, userPk, userId],
    });
    if ((updated.rowsAffected ?? 0) === 0) {
      return c.json(
        {
          error: 'Voice state changed. Refresh and try again.',
          error_code: 'VOICE_TRANSITION_CONFLICT',
        },
        409,
      );
    }
  } else {
    const canUse = await canUseSharedVoiceProfile(db, userPk, id);
    if (!canUse) {
      return c.json(
        { error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' },
        404,
      );
    }
    await db.execute({
      sql: `INSERT INTO voice_profile_relationships
              (id, user_id, voice_profile_id, relationship_label, listener_title)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, voice_profile_id) DO UPDATE SET
              relationship_label = excluded.relationship_label,
              listener_title = excluded.listener_title,
              updated_at = datetime('now')`,
      args: [crypto.randomUUID(), userPk, id, relationshipLabel, listenerTitle],
    });
  }

  return c.json({
    profile: {
      id,
      relationship_label: relationshipLabel,
      listener_title: listenerTitle,
    },
  });
});

voiceProfile.post('/clone', async (c) => {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userId;
  const db = getDB(c.env);
  // INSERT 후 클론이 실패하면 catch 에서 이 row 를 'failed' 로 정리해야 한다.
  // 그렇지 않으면 status 가 'processing' 에 영구히 갇혀 앱이 "생성중" 으로 표시된다.
  let insertedProfileId: string | null = null;
  let monthlyLedgerId: string | null = null;
  let draftAttemptMonth: string | null = null;
  let providerVoiceCreated = false;
  let createdProviderVoiceId: string | null = null;

  try {
    const formData = await c.req.formData();
    const isDraft = ['true', '1', 'yes'].includes(
      String(formData.get('isDraft') ?? formData.get('is_draft') ?? 'false'),
    );
    if (!isDraft) {
      return c.json(
        {
          error: 'Create a private draft and preview it before registration.',
          error_code: 'VOICE_DRAFT_REQUIRED',
        },
        409,
      );
    }
    if (resolvedUserPk) {
      const userPlan = await db.execute({
        sql: 'SELECT plan FROM users WHERE id = ? OR google_id = ? LIMIT 1',
        args: [userPk, userId],
      });
      if (userPlan.rows.length === 0 || !isPaidVoicePlan(userPlan.rows[0]!.plan)) {
        return c.json(
          {
            error: 'Voice features require a paid plan.',
            error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
          },
          403,
        );
      }
    }

    const missingSensitiveConsent = await missingConsentType(
      db,
      userPk,
      SENSITIVE_REQUIRED_CONSENTS,
    );
    if (missingSensitiveConsent) {
      return c.json(
        {
          error:
            missingSensitiveConsent === 'voice_biometric'
              ? 'Voice biometric consent is required to clone a voice.'
              : 'Overseas transfer consent is required for ElevenLabs voice cloning.',
          error_code: 'CONSENT_REQUIRED',
          consent: missingSensitiveConsent,
        },
        403,
      );
    }

    const audioFile = getFormFile(formData, 'audio');
    const rawName = formData.get('name');
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    const isShared = ['true', '1', 'yes'].includes(
      String(formData.get('isShared') ?? formData.get('is_shared') ?? 'false'),
    );
    const requestedPreviewLanguage = String(
      formData.get('language') ?? formData.get('app_language') ?? 'ko',
    ).toLowerCase();
    const previewLanguage = ['en', 'ja'].includes(requestedPreviewLanguage)
      ? requestedPreviewLanguage
      : 'ko';
    const relationshipLabel =
      normalizeRelationshipLabel(
        formData.get('relationshipLabel') ?? formData.get('relationship_label') ?? undefined,
      ) ?? '';
    const listenerTitle =
      normalizeRelationshipLabel(
        formData.get('listenerTitle') ?? formData.get('listener_title') ?? undefined,
      ) ?? '';

    // 한도 검사: non-draft 는 MAX_VOICE_PROFILES, draft 는 MAX_DRAFT_VOICE_PROFILES.
    // draft 도 즉시 실제 ElevenLabs 보이스를 생성하므로 반드시 상한을 둬야 무제한
    // draft 생성으로 인한 전역 슬롯 고갈(DoS)을 막는다.
    // failed 행은 제외: 클론 실패 잔여물은 프로바이더 슬롯을 점유하지 않고(voice_id 없이
    // 실패), 특히 draft 는 리스트에 노출되지 않아 클라가 지울 수도 없으므로 카운트하면
    // 일시 장애 몇 번에 한도가 영구 잠식된다.
    // 클라 정리를 못 거친 고아 draft(앱 강제종료 등)는 cron 의 cleanupStaleDraftVoices 가
    // DRAFT_VOICE_TTL_HOURS 경과 시 소프트 삭제하므로 이 한도가 영구히 잠기지 않는다.
    {
      const ids = ownerIds(c);
      const phCount = ids.map(() => '?').join(',');
      // draft 생성도 official 슬롯이 꽉 차 있으면 거부한다: 안 그러면 promote(활성 official 한도)에서 막혀
      // 월간 draft attempt 만 소모한 채 keep 할 수 없는 stranded draft 가 된다. draft/official 슬롯을 함께 센다.
      const profileCount = await db.execute({
        sql: `SELECT
                SUM(CASE WHEN deleted_at IS NULL AND status != 'failed' AND COALESCE(is_draft, 0) = 1 THEN 1 ELSE 0 END) as draft_count,
                SUM(CASE WHEN deleted_at IS NULL AND status != 'failed' AND COALESCE(is_draft, 0) = 0 THEN 1 ELSE 0 END) as official_count
              FROM voice_profiles
              WHERE user_id IN (${phCount})`,
        args: ids,
      });
      const row = profileCount.rows[0]!;
      const draftCount = Number(row.draft_count ?? 0);
      const officialCount = Number(row.official_count ?? 0);
      const draftLimitReached = isDraft && draftCount >= MAX_DRAFT_VOICE_PROFILES;
      const officialLimitReached = officialCount >= MAX_VOICE_PROFILES;
      if (draftLimitReached || officialLimitReached) {
        return c.json(
          {
            error: draftLimitReached
              ? `임시 보이스는 최대 ${MAX_DRAFT_VOICE_PROFILES}개까지 만들 수 있습니다`
              : `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
            error_code: 'VOICE_LIMIT_REACHED',
          },
          403,
        );
      }
    }

    if (!audioFile || !name) {
      // trim 후 공백만 남는 이름도 거부 — 빈 라벨 저장 방지
      return c.json(
        { error: 'audio file and name are required', error_code: 'AUDIO_AND_NAME_REQUIRED' },
        400,
      );
    }

    const audioMimeType = audioFile.type || 'application/octet-stream';
    if (!audioMimeType.startsWith('audio/')) {
      return c.json(
        { error: 'audio/* MIME type required', error_code: 'INVALID_AUDIO_MIME_TYPE' },
        415,
      );
    }

    // 크기 가드(J): arrayBuffer→R2→ElevenLabs 호출 전에 0바이트/과대 파일을 차단한다
    // (voice-upload.ts /upload 와 동일 패턴·공용 상수).
    if (audioFile.size === 0) {
      return c.json({ error: 'audio file is empty', error_code: 'AUDIO_FILE_EMPTY' }, 400);
    }
    if (audioFile.size > MAX_VOICE_UPLOAD_BYTES) {
      return c.json(
        {
          error: `audio file exceeds ${MAX_VOICE_UPLOAD_BYTES} bytes (got ${audioFile.size})`,
          error_code: 'AUDIO_FILE_TOO_LARGE',
        },
        413,
      );
    }

    const durationCheck = validateCloneDuration(formData.get('durationMs'), isDraft);
    if (durationCheck) return c.json(durationCheck.body, durationCheck.status);
    // 검증 통과 후의 durationMs — 아래 voice_uploads 보관(재시도용 원본)에 기록한다.
    const cloneDurationMs = Number.parseInt(String(formData.get('durationMs')), 10);

    if (name.length > 50) {
      return c.json(
        { error: 'Name must be 50 characters or less', error_code: 'NAME_TOO_LONG' },
        400,
      );
    }
    if (!validateLabelLength(relationshipLabel, MAX_RELATIONSHIP_LABEL_LENGTH)) {
      return c.json(
        {
          error: `relationship_label must be ${MAX_RELATIONSHIP_LABEL_LENGTH} characters or less`,
          error_code: 'INVALID_RELATIONSHIP_LABEL',
        },
        400,
      );
    }
    if (!validateLabelLength(listenerTitle, MAX_LISTENER_TITLE_LENGTH)) {
      return c.json(
        {
          error: `listener_title must be ${MAX_LISTENER_TITLE_LENGTH} characters or less`,
          error_code: 'INVALID_LISTENER_TITLE',
        },
        400,
      );
    }

    const audioBuffer = await audioFile.arrayBuffer();
    const profileId = crypto.randomUUID();

    const insertResult = await withWriteTransaction(db, async (tx) => {
      const ids = ownerIds(c);
      // draft 슬롯과 official 슬롯을 한 스냅샷으로 함께 센다(둘 사이 TOCTOU 없음). 둘 중 하나라도 한도면 차단.
      // official 이 이미 꽉 찼으면(=MAX_VOICE_PROFILES 개 등록) 새 draft 를 만들어도 promote 가
      // activeOfficialVoiceProfileCount 한도로 거부돼(아래 PATCH), 월간 draft attempt 만 소모한 채 영영 keep 할 수
      // 없는 stranded draft 가 된다. promote 와 동일 기준으로 여기서 조기 차단한다(새 목소리 등록은 기존 official
      // 을 먼저 삭제). attempt 예약(reserveMonthlyDraftAttempt) 전에 두어 draft 쿼터도 소모하지 않는다.
      const slotCounts = await tx.execute({
        sql: `SELECT
                SUM(CASE WHEN COALESCE(is_draft, 0) = 1 THEN 1 ELSE 0 END) AS draft_count,
                SUM(CASE WHEN COALESCE(is_draft, 0) = 0 THEN 1 ELSE 0 END) AS official_count
              FROM voice_profiles
              WHERE user_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
                AND status != 'failed'`,
        args: ids,
      });
      const slotRow = slotCounts.rows[0];
      if (
        Number(slotRow?.draft_count ?? 0) >= MAX_DRAFT_VOICE_PROFILES ||
        Number(slotRow?.official_count ?? 0) >= MAX_VOICE_PROFILES
      ) {
        return { status: 'voice_limit' as const, ledgerId: null };
      }
      draftAttemptMonth = await reserveMonthlyDraftAttempt(tx, userPk);
      if (!draftAttemptMonth) {
        return { status: 'draft_attempt_limit' as const, ledgerId: null };
      }
      await tx.execute({
        sql: `INSERT INTO voice_profiles
              (id, user_id, name, status, is_shared, is_draft, relationship_label, listener_title, preview_language)
              VALUES (?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
        args: [
          profileId,
          userId,
          name,
          isShared ? 1 : 0,
          isDraft ? 1 : 0,
          relationshipLabel,
          listenerTitle,
          previewLanguage,
        ],
      });
      return { status: 'ok' as const, ledgerId: null };
    });
    if (insertResult.status === 'voice_limit') {
      return c.json(
        {
          error: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
          error_code: 'VOICE_LIMIT_REACHED',
        },
        403,
      );
    }
    if (insertResult.status === 'draft_attempt_limit') {
      return c.json(
        {
          error: '이번 달 음성 초안 생성 횟수를 모두 사용했습니다.',
          error_code: 'VOICE_DRAFT_ATTEMPT_LIMIT_REACHED',
        },
        429,
      );
    }
    monthlyLedgerId = insertResult.ledgerId;
    insertedProfileId = profileId;

    // F1: 새 provider 보이스를 만들기 전에 전역 슬롯 상한을 초과하면 LRU 클론을 제거한다.
    // 방금 삽입한 processing 행(voice_id NULL)은 카운트에서 자동 제외된다.
    try {
      const evicted = await evictLruClonesIfOverCap(db, profileId);
      if (evicted > 0) {
        console.log(
          `[voice] LRU-evicted ${evicted} clone(s) to stay under cap ${MAX_PROVIDER_CLONE_VOICES}`,
        );
      }
    } catch (evictErr) {
      // eviction 실패가 등록 자체를 막지는 않는다(ElevenLabs 는 상한 미강제라 슬롯이 잠깐
      // 초과돼도 등록은 성공). 다음 등록/‑cron 백스톱에서 다시 정리된다. 로깅만 한다.
      logRouteError(c, evictErr);
    }

    const attempts = createEnrollmentAttempts({
      env: c.env,
      audioData: audioBuffer,
      name,
      audioMimeType,
      audioFileName: audioFile.name || undefined,
    });
    let lastError: unknown = new Error('No voice provider is configured.');
    let provider = '';
    let voiceId = '';
    for (const attempt of attempts) {
      try {
        const result = await attempt.enroll();
        provider = result.provider;
        voiceId = result.providerVoiceId;
        providerVoiceCreated = true;
        createdProviderVoiceId = voiceId;
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof UnsupportedVoiceProviderError) continue;
        if (attempt !== attempts[attempts.length - 1]) continue;
      }
    }
    if (!voiceId) throw lastError;

    const completion = await withWriteTransaction(db, async (tx) => {
      const missingConsent = await missingConsentType(tx, userPk, SENSITIVE_REQUIRED_CONSENTS);
      if (missingConsent) {
        await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'failed');
        return { status: 'consent_withdrawn' as const };
      }
      const updated = await tx.execute({
        sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ?, status = 'ready', updated_at = datetime('now')
              WHERE id = ? AND status = 'processing' AND deleted_at IS NULL`,
        args: [voiceId, profileId],
      });
      if ((updated.rowsAffected ?? 0) === 0) {
        await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'failed');
        return { status: 'draft_unavailable' as const };
      }
      await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'succeeded');
      return { status: 'ok' as const };
    });
    if (completion.status !== 'ok') {
      throw new Error(
        completion.status === 'consent_withdrawn'
          ? 'Voice consent was withdrawn during cloning.'
          : 'Voice draft was removed during cloning.',
      );
    }

    // 등록 원본을 R2+voice_uploads 에 프로필 연결(voice_profile_id)로 남긴다 —
    // 말투 분석 재시도(/:id/speech-style/retry)의 전사 소스. 실패해도 등록은 막지
    // 않는다(best-effort, 재시도가 SOURCE_AUDIO_MISSING 409 로 대신 안내).
    // 수명주기는 별도 관리 불필요: TTL 7일 sweep(audio-retention.cleanupExpiredAudio)이
    // R2 오브젝트·행을 함께 정리하고, 계정 삭제(account-deletion)·유료 음성 정리
    // (paid-voice-cleanup)도 voice_uploads 를 사용자 단위로 지운다. draft 가 승격 전에
    // 삭제돼 행이 남아도 같은 TTL sweep 이 거둔다.
    // R2 저장은 성공했는데 아래 INSERT 가 실패하면 추적행 없는 고아 객체가 남는다
    // (TTL sweep 은 voice_uploads 행 기준이라 회수 못 함) → catch 에서 보상 삭제 큐에
    // 적재할 수 있도록 저장된 키를 바깥 스코프로 올린다.
    let storedUploadKey: string | null = null;
    try {
      // 동의 철회 경쟁(H): 클론 완료(ready 전환)와 이 보관 사이에 사용자가 음성/국외이전
      // 동의를 철회했을 수 있다 — 철회됐으면 원본을 새로 보관하지 않는다(저장 스킵 + 로그).
      const uploadConsentMissing = await missingConsentType(db, userPk, SENSITIVE_REQUIRED_CONSENTS);
      if (uploadConsentMissing) {
        logRouteError(
          c,
          new Error(`Clone source upload skipped: consent withdrawn (${uploadConsentMissing}).`),
        );
      } else {
        const uploadStorage = c.env.VOICE_BUCKET
          ? new R2VoiceStorage(c.env.VOICE_BUCKET)
          : getSharedInMemoryVoiceStorage();
        // object key 는 JWT 인증 주체(userId=sub) + 타임스탬프로 생성된다(R2VoiceStorage.store)
        // — 사용자 입력에서 파생된 세그먼트가 없어 경로 조작 불가.
        const uploadMeta = await uploadStorage.store({
          userId,
          bytes: new Uint8Array(audioBuffer),
          mimeType: audioMimeType,
          durationMs: cloneDurationMs,
          originalName: audioFile.name || undefined,
        });
        storedUploadKey = uploadMeta.objectKey;
        await db.execute({
          sql: `INSERT INTO voice_uploads
                (id, user_id, object_key, mime_type, size_bytes, duration_ms, original_name, voice_profile_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            crypto.randomUUID(),
            userId,
            uploadMeta.objectKey,
            uploadMeta.mimeType,
            uploadMeta.sizeBytes,
            uploadMeta.durationMs ?? null,
            uploadMeta.originalName ?? null,
            profileId,
          ],
        });
      }
    } catch (uploadErr) {
      logRouteError(c, uploadErr);
      // R2 put 은 성공했는데 INSERT 가 실패한 경우(고아) 보상 삭제 큐에 적재해 누수를 막는다(C).
      if (storedUploadKey) {
        try {
          await enqueueExternalDeletion(db, 'r2_object', storedUploadKey);
        } catch (cleanupErr) {
          logRouteError(c, cleanupErr);
        }
      }
    }

    // 화자 말투(사투리·존댓말·특징 어미) 분석 — 응답을 지연시키지 않도록 waitUntil 로
    // 비동기 실행(실패해도 등록은 성공). 전사는 ElevenLabs Scribe(이미 음성을
    // 처리하는 고지된 수탁사), Vertex 에는 음성이 아니라 전사 텍스트만 전송한다.
    // 결과 상태는 speech_style_status 에 반드시 기록한다(pending→done|failed) — 과거처럼
    // 조용히 삼키면 클라가 알 수 없으므로, failed 는 /:id/speech-style/retry 로 복구한다.
    // 첫 자동 미리듣기와 레이스할 수 있다 — 그 경우 첫 미리듣기만 기본 톤이고,
    // 문구 수정·재생성과 매일 사전렌더부터는 분석 결과가 반영된다.
    await setSpeechStyleStatus(db, profileId, 'pending');
    let analysisScheduled = false;
    if (c.env.ELEVENLABS_API_KEY) {
      const analysisEnv = c.env;
      const analysisAudio = audioBuffer;
      const analysisMime = audioMimeType;
      const analysisFileName = audioFile.name || undefined;
      try {
        // 테스트/로컬 등 ExecutionContext 없는 환경에선 getter 가 throw — 아래 공통 failed 처리.
        const executionCtx = c.executionCtx;
        executionCtx.waitUntil(
          runSpeechStyleAnalysis(analysisEnv, profileId, analysisAudio, {
            mimeType: analysisMime,
            fileName: analysisFileName,
            language: previewLanguage,
            ownerPk: userPk,
          }).then((analysis) => {
            if (!analysis.ok) logRouteError(c, analysis.error);
          }),
        );
        analysisScheduled = true;
      } catch {
        // fallthrough — 아래에서 failed 기록.
      }
    }
    if (!analysisScheduled) {
      // 키 미설정/ExecutionContext 부재로 분석을 시작조차 못 함 — failed 로 남겨 재시도를 유도한다.
      await setSpeechStyleStatus(db, profileId, 'failed');
      logRouteError(
        c,
        new Error('speech style analysis was not scheduled (missing API key or execution context)'),
      );
    }

    return c.json(
      {
        profile: {
          id: profileId,
          name,
          voice_id: voiceId,
          provider,
          status: 'ready',
          is_shared: isShared,
          is_draft: isDraft,
          relationship_label: relationshipLabel,
          listener_title: listenerTitle,
        },
      },
      201,
    );
  } catch (err) {
    logRouteError(c, err);
    const detail = err instanceof Error ? err.message : 'Unknown error';

    // 'processing' 으로 INSERT 된 row 가 있으면 'failed' 로 종료시켜 stuck 방지.
    if (insertedProfileId) {
      try {
        await withWriteTransaction(db, async (tx) => {
          await tx.execute({
            sql: `UPDATE voice_profiles SET status = 'failed', updated_at = datetime('now')
                  WHERE id = ? AND status = 'processing'`,
            args: [insertedProfileId],
          });
          await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'failed');
        });
      } catch (markErr) {
        logRouteError(c, markErr);
      }
    }

    // 제공자에 실제 보이스가 만들어지기 전 실패(네트워크/설정 오류)만 시도 횟수를 돌려준다.
    // providerVoiceCreated 이후에는 응답 유실·DB 오류가 있어도 비용이 발생했으므로 환불하지 않는다.
    if (draftAttemptMonth && !providerVoiceCreated) {
      try {
        await refundMonthlyDraftAttempt(db, userPk, draftAttemptMonth);
      } catch (refundErr) {
        logRouteError(c, refundErr);
      }
    }
    if (providerVoiceCreated && createdProviderVoiceId) {
      try {
        await enqueueExternalDeletion(db, 'elevenlabs_voice', createdProviderVoiceId);
      } catch (cleanupErr) {
        logRouteError(c, cleanupErr);
      }
    }

    // K1: detail 에 제공자(ElevenLabs) 응답 원문(err.message)을 반사하지 않는다. 원문은
    // 위 logRouteError 로만 남기고, 응답에는 안정 에러코드만 노출한다. 슬롯 소진 판별은
    // throw 전 서버 내부(isVoiceSlotExhaustedError(detail))에서 하므로 그대로 동작한다.
    if (isVoiceSlotExhaustedError(detail)) {
      return c.json(
        {
          error: '서비스가 확장중이에요. 잠시만 기다려주세요!',
          error_code: 'VOICE_SLOT_EXHAUSTED',
          detail: 'VOICE_SLOT_EXHAUSTED',
        },
        503,
      );
    }

    return c.json(
      {
        error: 'Voice cloning failed',
        error_code: 'VOICE_CLONING_FAILED',
        detail: 'VOICE_CLONING_FAILED',
      },
      500,
    );
  }
});

function isVoiceSlotExhaustedError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes('voice_limit_reached') ||
    lower.includes('max_voice_limit_reached') ||
    lower.includes('voice_add_edit_counter') ||
    lower.includes('voice limit') ||
    lower.includes('voice slot')
  );
}

function validateCloneDuration(
  value: unknown,
  isDraft = false,
): {
  status: 400;
  body: { error: string; error_code: string };
} | null {
  if (value == null || value === '') {
    return {
      status: 400,
      body: { error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' },
    };
  }
  if (typeof value !== 'string') {
    return {
      status: 400,
      body: { error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' },
    };
  }
  const durationMs = Number.parseInt(value, 10);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return {
      status: 400,
      body: { error: 'durationMs must be a positive integer', error_code: 'INVALID_DURATION' },
    };
  }
  // 분리 프리뷰(draft) 는 격리 발화만 담은 짧은 클립을 허용한다.
  const minDurationMs = isDraft ? MIN_DRAFT_CLONE_DURATION_MS : MIN_CLONE_DURATION_MS;
  if (durationMs < minDurationMs) {
    return {
      status: 400,
      body: {
        error: `voice clone audio must be at least ${minDurationMs / 1000} seconds`,
        error_code: 'VOICE_CLONE_AUDIO_TOO_SHORT',
      },
    };
  }
  if (durationMs > MAX_CLONE_DURATION_MS + CLONE_DURATION_TOLERANCE_MS) {
    return {
      status: 400,
      body: {
        error: `voice clone audio must be ${MAX_CLONE_DURATION_MS / 1000} seconds or shorter`,
        error_code: 'VOICE_CLONE_AUDIO_TOO_LONG',
      },
    };
  }
  return null;
}

voiceProfile.get('/:id/stats', async (c) => {
  const ids = ownerIds(c);
  const userId = c.get('userId');
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const [profileRes, msgRes, alarmRes] = await Promise.all([
    db.execute({
      sql: `SELECT id, name FROM voice_profiles WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL`,
      args: [id, ...ids],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM messages WHERE voice_profile_id = ? AND user_id IN (${ph})`,
      args: [id, ...ids],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as count FROM alarms a
            JOIN messages m ON a.message_id = m.id
            WHERE m.voice_profile_id = ? AND (a.user_id = ? OR a.target_user_id = ?)`,
      args: [id, userId, userId],
    }),
  ]);

  if (profileRes.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  return c.json({
    voice_profile_id: id,
    messages: Number(typedRow<{ count: number }>(msgRes.rows[0]!).count ?? 0),
    alarms: Number(typedRow<{ count: number }>(alarmRes.rows[0]!).count ?? 0),
  });
});

// 말투 분석 재시도 — 등록 시 waitUntil 분석이 실패(speech_style_status='failed')했을 때
// 클라가 동기로 다시 돌린다. 전사 소스는 clone 등록 성공 시 이 프로필에 연결해 보관한
// 원본 녹음(voice_uploads.voice_profile_id, TTL 7일)이며, TTL 정리로 사라졌거나 보관
// 자체가 실패했으면 409 — 이때는 목소리를 다시 등록해야 말투를 분석할 수 있다.
voiceProfile.post('/:id/speech-style/retry', async (c) => {
  const ids = ownerIds(c);
  const userPk = (c.get('userIdPK') as string | undefined) || (c.get('userId') as string);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const profileRes = await db.execute({
    sql: `SELECT id, preview_language FROM voice_profiles
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL
            AND COALESCE(is_system, 0) = 0`,
    args: [id, ...ids],
  });
  if (profileRes.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  // 동의 철회 경쟁(H): 재시도 시작 시 민감 동의(음성/국외이전)를 재확인한다 —
  // 등록 후 철회한 사용자의 원본을 다시 외부 전사(ElevenLabs)로 보내지 않는다.
  const missingRetryConsent = await missingConsentType(db, userPk, SENSITIVE_REQUIRED_CONSENTS);
  if (missingRetryConsent) {
    return c.json(
      {
        error:
          missingRetryConsent === 'voice_biometric'
            ? 'Voice biometric consent is required to analyze the voice.'
            : 'Overseas transfer consent is required for speech style analysis.',
        error_code: 'CONSENT_REQUIRED',
        consent: missingRetryConsent,
      },
      403,
    );
  }
  // 등록 때와 동일한 언어 화이트리스트(ko/en/ja)로 분석 언어 확정.
  const requestedLanguage = String(profileRes.rows[0]!.preview_language ?? 'ko').toLowerCase();
  const language = ['en', 'ja'].includes(requestedLanguage) ? requestedLanguage : 'ko';

  // 전사 소스: clone 등록이 이 프로필에 연결해 남긴 원본 업로드만 쓴다.
  // '사용자 최신 1건' 폴백은 두지 않는다 — 가족알람용 녹음 등 이 목소리와 무관한
  // 업로드를 말투 분석에 쓰는 사고를 막는다(연결본이 없으면 아래 409).
  const uploadRes = await db.execute({
    sql: `SELECT object_key, mime_type, original_name FROM voice_uploads
          WHERE user_id IN (${ph}) AND voice_profile_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
    args: [...ids, id],
  });
  const upload = uploadRes.rows[0];
  const storage = c.env.VOICE_BUCKET
    ? new R2VoiceStorage(c.env.VOICE_BUCKET)
    : getSharedInMemoryVoiceStorage();
  const stored = upload ? await storage.get(String(upload.object_key)) : null;
  if (!stored) {
    return c.json(
      {
        error: 'Source recording is no longer available. Re-register the voice to analyze it.',
        error_code: 'SOURCE_AUDIO_MISSING',
      },
      409,
    );
  }

  // 원자적 상태 점유(H): failed 일 때만 pending 으로 클레임한다 — 동시 재시도가 겹치면
  // 한 요청만 실행되고 나머지는 409 로 떨어져 중복 전사/분석(외부 호출 비용)을 차단한다.
  // 이미 pending(진행 중)이거나 done/NULL(재시도 대상 아님)이어도 같은 409.
  const claimed = await db.execute({
    sql: `UPDATE voice_profiles
          SET speech_style_status = 'pending', updated_at = datetime('now')
          WHERE id = ? AND speech_style_status = 'failed' AND deleted_at IS NULL`,
    args: [id],
  });
  if ((claimed.rowsAffected ?? 0) === 0) {
    return c.json(
      {
        error: 'Speech style analysis is already running or not in a retryable state.',
        error_code: 'SPEECH_STYLE_RETRY_CONFLICT',
      },
      409,
    );
  }
  // Uint8Array 뷰 → 정확한 구간만 ArrayBuffer 로 복사(오프셋 있는 버퍼 안전).
  const audioBuffer = stored.bytes.buffer.slice(
    stored.bytes.byteOffset,
    stored.bytes.byteOffset + stored.bytes.byteLength,
  ) as ArrayBuffer;
  const result = await runSpeechStyleAnalysis(c.env, id, audioBuffer, {
    mimeType: (upload!.mime_type as string | null) ?? stored.meta.mimeType,
    fileName: (upload!.original_name as string | null) ?? stored.meta.originalName ?? null,
    language,
    ownerPk: userPk,
  });
  if (!result.ok) {
    logRouteError(c, result.error);
    return c.json(
      {
        error: 'Speech style analysis failed. Try again later.',
        error_code: 'SPEECH_STYLE_ANALYSIS_FAILED',
        status: 'failed',
      },
      502,
    );
  }
  return c.json({ success: true, status: 'done' });
});

// 유료 프리셋(사전렌더) 준비 상태 — 클론 목소리별 클립 생성 진행(n/total)·실패를 클라가 조회한다.
// 시스템 보이스/타인 목소리는 소유권 게이트에서 404.
voiceProfile.get('/:id/prerender-status', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const profileRes = await db.execute({
    sql: `SELECT id FROM voice_profiles
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL
            AND COALESCE(is_system, 0) = 0 AND COALESCE(is_draft, 0) = 0`,
    args: [id, ...ids],
  });
  if (profileRes.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const [generatedRes, queueRes] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as count FROM messages
            WHERE voice_profile_id = ? AND COALESCE(is_preset, 0) = 1 AND audio_url IS NOT NULL`,
      args: [id],
    }),
    db.execute({
      sql: 'SELECT status, attempts FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [id],
    }),
  ]);
  const generated = Number(generatedRes.rows[0]?.count ?? 0);
  const queue = queueRes.rows[0];
  const queueStatus = queue ? String(queue.status ?? '') : '';
  // 큐 행이 없으면(적재 전/삭제됨) 'none' — 클라는 prerender-retry 로 재적재할 수 있다.
  const status = ['pending', 'done', 'failed'].includes(queueStatus) ? queueStatus : 'none';
  return c.json({
    status,
    total: CLONE_PRERENDER_TOTAL,
    generated,
    attempts: queue ? Number(queue.attempts ?? 0) : 0,
  });
});

// 사전렌더 재시도 — attempts 상한(5) 초과로 'failed' 가 된 큐 행을 pending 으로 리셋해
// 다음 cron 이 빠진 클립만 다시 채우게 한다(findMissingStockTargets 가 기존 클립은 스킵).
// 행이 아예 없으면(promote 이전 큐 유실 등) 확정 언어(preview_language)로 재적재한다.
voiceProfile.post('/:id/prerender-retry', async (c) => {
  const ids = ownerIds(c);
  const userId = c.get('userId') as string;
  const userPk = (c.get('userIdPK') as string | undefined) || userId;
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  // 사전렌더 대상은 확정(공식)·ready 클론뿐 — draft/시스템/타인은 404.
  const profileRes = await db.execute({
    sql: `SELECT id, preview_language FROM voice_profiles
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL
            AND COALESCE(is_system, 0) = 0 AND COALESCE(is_draft, 0) = 0
            AND status = 'ready'`,
    args: [id, ...ids],
  });
  if (profileRes.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const reset = await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET status = 'pending', attempts = 0, claimed_at = NULL, claim_token = NULL,
              updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'failed'`,
    args: [id],
  });
  if ((reset.rowsAffected ?? 0) === 0) {
    // failed 행이 없었다면: 행 자체가 없을 때만 재적재된다(enqueuePrerender 는
    // ON CONFLICT DO NOTHING 이라 pending/done 행은 건드리지 않는 멱등 no-op).
    await enqueuePrerender(db, id, userPk, String(profileRes.rows[0]!.preview_language ?? 'ko'));
  }
  return c.json({ success: true });
});

voiceProfile.delete('/:id', async (c) => {
  const ids = ownerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json(
      { error: 'Invalid voice profile ID format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const ph = ids.map(() => '?').join(',');
  const draftOnly = c.req.query('draftOnly') === 'true';

  const deletionState = await withWriteTransaction(db, async (tx) => {
    const current = await tx.execute({
      sql: `SELECT * FROM voice_profiles
            WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL`,
      args: [id, ...ids],
    });
    if (current.rows.length === 0) {
      return { status: 'not_found' as const, profile: null, tombstoned: null, assets: [] };
    }
    const currentProfile = current.rows[0]!;
    if (draftOnly && Number(currentProfile.is_draft ?? 0) !== 1) {
      return {
        status: 'not_a_draft' as const,
        profile: currentProfile,
        tombstoned: null,
        assets: [],
      };
    }
    const tombstoned = await tx.execute({
      sql: `UPDATE voice_profiles
            SET deleted_at = datetime('now'), is_shared = 0, updated_at = datetime('now')
            WHERE id = ? AND deleted_at IS NULL
              ${draftOnly ? 'AND COALESCE(is_draft, 0) = 1' : ''}`,
      args: [id],
    });
    if ((tombstoned.rowsAffected ?? 0) === 0) {
      return { status: 'not_found' as const, profile: currentProfile, tombstoned, assets: [] };
    }
    await tx.execute({
      sql: 'DELETE FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [id],
    });
    // '마음에 안 들면 삭제'를 안내하므로, 삭제하면 같은 달에 다른 목소리를 다시 등록할 수 있어야
    // 한다. voice_profile_id 로 스코프해, 이전 달에 만든 목소리를 지워도 이번 달 슬롯엔 영향 없음.
    // (등록 확인창에서 promote 후 삭제 시 reserveMonthlyOfficialVoiceChange 의 월 예약이 남아
    //  다음 등록이 VOICE_MONTHLY_CHANGE_LIMIT_REACHED 로 막히는 것을 방지.)
    await tx.execute({
      sql: `DELETE FROM voice_profile_change_ledger
            WHERE voice_profile_id = ?
              AND owner_user_id IN (${ph})
              AND change_month = ${currentKstMonthSql()}`,
      args: [id, ...ids],
    });
    await enqueueExternalDeletion(
      tx,
      'elevenlabs_voice',
      currentProfile.elevenlabs_voice_id as string | null,
    );
    const assets = await tx.execute({
      sql: `SELECT audio_url, audio_object_key FROM generated_audio_assets
            WHERE voice_profile_id = ? AND audio_object_key IS NOT NULL`,
      args: [id],
    });
    for (const asset of assets.rows) {
      await enqueueExternalDeletion(tx, 'r2_object', asset.audio_object_key as string | null);
    }
    // 확정 목소리의 원본 업로드(voice_uploads + voice_speakers + R2 오브젝트)도 함께 삭제한다.
    // 확정분 원본은 TTL 스윕에서 제외돼 목소리 수명 동안 보관되므로(재생성용), 목소리를 지울 때
    // 여기서 cascade 로 정리하지 않으면 영구히 남는다.
    const sourceUploads = await tx.execute({
      sql: 'SELECT id, object_key FROM voice_uploads WHERE voice_profile_id = ?',
      args: [id],
    });
    for (const upload of sourceUploads.rows) {
      await enqueueExternalDeletion(tx, 'r2_object', upload.object_key as string | null);
      await tx.execute({
        sql: 'DELETE FROM voice_speakers WHERE upload_id = ?',
        args: [String(upload.id)],
      });
      await tx.execute({
        sql: 'DELETE FROM voice_uploads WHERE id = ?',
        args: [String(upload.id)],
      });
    }
    return {
      status: 'deleted' as const,
      profile: currentProfile,
      tombstoned,
      assets: assets.rows,
    };
  });
  if (deletionState.status === 'not_a_draft') {
    return c.json({ success: true, skipped: 'not_a_draft', voice_profile_id: id });
  }
  if (deletionState.status === 'not_found' || !deletionState.profile) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }
  const profile = deletionState.profile;
  if (profile.elevenlabs_voice_id) {
    const providerVoiceId = profile.elevenlabs_voice_id as string;
    try {
      const client = new ElevenLabsClient(c.env.ELEVENLABS_API_KEY);
      await client.deleteVoice(providerVoiceId);
      await db.execute({
        sql: `DELETE FROM pending_external_deletions
              WHERE kind = 'elevenlabs_voice' AND ref = ?`,
        args: [providerVoiceId],
      });
    } catch (error) {
      logRouteError(c, error);
    }
  }

  const assetsRes = { rows: deletionState.assets };
  const deletedAudioUrls = Array.from(
    new Set(
      assetsRes.rows
        .flatMap((row) => {
          const typed = typedRow<{ audio_url: string | null; audio_object_key: string | null }>(
            row,
          );
          return [
            typed.audio_url,
            typed.audio_object_key,
            typed.audio_object_key ? `r2://${typed.audio_object_key}` : null,
          ];
        })
        .filter((url): url is string => Boolean(url)),
    ),
  );
  const bucket = c.env?.VOICE_BUCKET;
  if (bucket && assetsRes.rows.length > 0) {
    const storage = new R2VoiceStorage(bucket);
    for (const row of assetsRes.rows) {
      const key = typedRow<{ audio_object_key: string | null }>(row).audio_object_key;
      if (!key) continue;
      try {
        await storage.delete(key);
        await db.execute({
          sql: `DELETE FROM pending_external_deletions WHERE kind = 'r2_object' AND ref = ?`,
          args: [key],
        });
      } catch (err) {
        // R2 객체 삭제 실패해도 DB 정리는 진행
        logRouteError(c, err);
      }
    }
  }

  if (deletedAudioUrls.length > 0) {
    const placeholders = deletedAudioUrls.map(() => '?').join(',');
    await db.execute({
      sql: `UPDATE notes SET audio_url = NULL WHERE audio_url IN (${placeholders})`,
      args: deletedAudioUrls,
    });
  }

  await db.execute({
    sql: 'DELETE FROM generated_audio_assets WHERE voice_profile_id = ?',
    args: [id],
  });

  await db.execute({
    sql: `UPDATE alarms
          SET mode = 'sound-only',
              wake_mode = 'sound_then_voice',
              message_id = NULL,
              voice_profile_id = NULL,
              speaker_id = NULL
          WHERE voice_profile_id = ?
             OR message_id IN (SELECT id FROM messages WHERE voice_profile_id = ?)`,
    args: [id, id],
  });

  await db.execute({
    sql: `UPDATE messages SET audio_url = NULL WHERE voice_profile_id = ?`,
    args: [id],
  });

  return c.json({ success: true, deleted: true });
});

export default voiceProfile;
