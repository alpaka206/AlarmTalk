import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError } from '../lib/logger';
import { R2VoiceStorage } from '../lib/r2-storage';
import { createEnrollmentAttempts, UnsupportedVoiceProviderError } from '../lib/voice-provider';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import { isPaidVoicePlan } from './billing-helpers';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from '../lib/consent';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { enqueuePrerender } from '../lib/stock-clips';

const voiceProfile = new Hono<AppEnv>();
const MAX_VOICE_PROFILES = 1;
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

async function reserveMonthlyDraftAttempt(db: DbExecutor, ownerUserId: string): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO voice_draft_attempt_usage
            (owner_user_id, attempt_month, used_count)
          VALUES (?, ${currentKstMonthSql()}, 1)
          ON CONFLICT(owner_user_id, attempt_month) DO UPDATE SET
            used_count = used_count + 1,
            updated_at = datetime('now')
          WHERE used_count < ?`,
    args: [ownerUserId, MAX_DRAFT_ATTEMPTS_PER_MONTH],
  });
  return (result.rowsAffected ?? 0) > 0;
}

async function refundMonthlyDraftAttempt(db: DbExecutor, ownerUserId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE voice_draft_attempt_usage
          SET used_count = MAX(used_count - 1, 0), updated_at = datetime('now')
          WHERE owner_user_id = ? AND attempt_month = ${currentKstMonthSql()}`,
    args: [ownerUserId],
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

function validateRelationshipLabel(label: string | undefined): boolean {
  return label === undefined || label.length <= MAX_RELATIONSHIP_LABEL_LENGTH;
}

function normalizeListenerTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  return String(value).trim();
}

function validateListenerTitle(label: string | undefined): boolean {
  return label === undefined || label.length <= MAX_LISTENER_TITLE_LENGTH;
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
          is_shared: false,
          is_draft: true,
          is_system: false,
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
    },
  });
});

voiceProfile.patch('/:id', async (c) => {
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
  const listenerTitle = normalizeListenerTitle(body.listener_title ?? body.listenerTitle);
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
  if (!validateRelationshipLabel(relationshipLabel)) {
    return c.json(
      {
        error: `relationship_label must be ${MAX_RELATIONSHIP_LABEL_LENGTH} characters or less`,
        error_code: 'INVALID_RELATIONSHIP_LABEL',
      },
      400,
    );
  }
  if (!validateListenerTitle(listenerTitle)) {
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
  }
  if (hasListenerTitle) {
    updates.push('listener_title = ?');
    args.push(listenerTitle ?? '');
    if (!hasRelationship) updates.push('previewed_at = NULL');
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
        const existingCount = await activeOfficialVoiceProfileCount(tx, ids, id);
        if (existingCount >= MAX_VOICE_PROFILES) {
          return { status: 'voice_limit' as const, rowsAffected: 0 };
        }
        const ledgerId = await reserveMonthlyOfficialVoiceChange(tx, userPk, id);
        if (!ledgerId) {
          return { status: 'monthly_limit' as const, rowsAffected: 0 };
        }
        const promoted = await updateProfile(tx, 'AND COALESCE(is_draft, 0) = 1');
        if ((promoted.rowsAffected ?? 0) === 0) {
          await markMonthlyOfficialVoiceChange(tx, ledgerId, 'failed');
          return { status: 'not_found' as const, rowsAffected: 0 };
        }
        await markMonthlyOfficialVoiceChange(tx, ledgerId, 'succeeded');
        await enqueuePrerender(tx, id, userPk, prerenderLanguage);
        return { status: 'ok' as const, rowsAffected: promoted.rowsAffected ?? 0 };
      })
    : { status: 'ok' as const, ...(await updateProfile(db)) };
  if (updateRes.status === 'voice_limit') {
    return c.json(
      {
        error: `理쒕? ${MAX_VOICE_PROFILES}媛쒓퉴吏 ?깅줉 媛?ν빀?덈떎`,
        error_code: 'VOICE_LIMIT_REACHED',
      },
      409,
    );
  }
  if (updateRes.status === 'monthly_limit') {
    return monthlyVoiceChangeLimitResponse(c);
  }
  if ((updateRes.rowsAffected ?? 0) === 0) {
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
  if (relationshipLabel === undefined || !validateRelationshipLabel(relationshipLabel)) {
    return c.json(
      {
        error: `relationship_label must be ${MAX_RELATIONSHIP_LABEL_LENGTH} characters or less`,
        error_code: 'INVALID_RELATIONSHIP_LABEL',
      },
      400,
    );
  }
  const listenerTitleRaw = normalizeListenerTitle(body.listener_title ?? body.listenerTitle);
  const listenerTitle = listenerTitleRaw ?? '';
  if (!validateListenerTitle(listenerTitle)) {
    return c.json(
      {
        error: `listener_title must be ${MAX_LISTENER_TITLE_LENGTH} characters or less`,
        error_code: 'INVALID_LISTENER_TITLE',
      },
      400,
    );
  }

  const owned = await db.execute({
    sql: 'SELECT id FROM voice_profiles WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL',
    args: [id, userPk, userId],
  });

  if (owned.rows.length > 0) {
    await db.execute({
      sql: `UPDATE voice_profiles
            SET relationship_label = ?, listener_title = ?, updated_at = datetime('now')
            WHERE id = ?`,
      args: [relationshipLabel, listenerTitle, id],
    });
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
  let draftAttemptReserved = false;
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
    const relationshipLabel =
      normalizeRelationshipLabel(
        formData.get('relationshipLabel') ?? formData.get('relationship_label') ?? undefined,
      ) ?? '';
    const listenerTitle =
      normalizeListenerTitle(
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
      const draftClause = isDraft ? 'COALESCE(is_draft, 0) = 1' : 'COALESCE(is_draft, 0) = 0';
      const limit = isDraft ? MAX_DRAFT_VOICE_PROFILES : MAX_VOICE_PROFILES;
      const profileCount = await db.execute({
        sql: `SELECT
                SUM(CASE WHEN deleted_at IS NULL AND status != 'failed' AND ${draftClause} THEN 1 ELSE 0 END) as active_count
              FROM voice_profiles
              WHERE user_id IN (${phCount})`,
        args: ids,
      });
      const row = profileCount.rows[0]!;
      const count = Number(row.active_count ?? row.count ?? 0);
      if (count >= limit) {
        return c.json(
          {
            error: isDraft
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

    const durationCheck = validateCloneDuration(formData.get('durationMs'), isDraft);
    if (durationCheck) return c.json(durationCheck.body, durationCheck.status);

    if (name.length > 50) {
      return c.json(
        { error: 'Name must be 50 characters or less', error_code: 'NAME_TOO_LONG' },
        400,
      );
    }
    if (!validateRelationshipLabel(relationshipLabel)) {
      return c.json(
        {
          error: `relationship_label must be ${MAX_RELATIONSHIP_LABEL_LENGTH} characters or less`,
          error_code: 'INVALID_RELATIONSHIP_LABEL',
        },
        400,
      );
    }
    if (!validateListenerTitle(listenerTitle)) {
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
      const activeDrafts = await tx.execute({
        sql: `SELECT COUNT(*) AS count FROM voice_profiles
              WHERE user_id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
                AND status != 'failed' AND COALESCE(is_draft, 0) = 1`,
        args: ids,
      });
      if (Number(activeDrafts.rows[0]?.count ?? 0) >= MAX_DRAFT_VOICE_PROFILES) {
        return { status: 'voice_limit' as const, ledgerId: null };
      }
      if (!(await reserveMonthlyDraftAttempt(tx, userPk))) {
        return { status: 'draft_attempt_limit' as const, ledgerId: null };
      }
      draftAttemptReserved = true;
      await tx.execute({
        sql: `INSERT INTO voice_profiles (id, user_id, name, status, is_shared, is_draft, relationship_label, listener_title)
              VALUES (?, ?, ?, 'processing', ?, ?, ?, ?)`,
        args: [
          profileId,
          userId,
          name,
          isShared ? 1 : 0,
          isDraft ? 1 : 0,
          relationshipLabel,
          listenerTitle,
        ],
      });
      return { status: 'ok' as const, ledgerId: null };
    });
    if (insertResult.status === 'voice_limit') {
      return c.json(
        {
          error: `理쒕? ${MAX_VOICE_PROFILES}媛쒓퉴吏 ?깅줉 媛?ν빀?덈떎`,
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

    await withWriteTransaction(db, async (tx) => {
      await tx.execute({
        sql: `UPDATE voice_profiles SET elevenlabs_voice_id = ?, status = 'ready', updated_at = datetime('now')
              WHERE id = ?`,
        args: [voiceId, profileId],
      });
      await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'succeeded');
    });

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
    if (draftAttemptReserved && !providerVoiceCreated) {
      try {
        await refundMonthlyDraftAttempt(db, userPk);
      } catch (refundErr) {
        logRouteError(c, refundErr);
      }
    }
    if (providerVoiceCreated && createdProviderVoiceId) {
      try {
        const { enqueueExternalDeletion } = await import('../lib/audio-retention');
        await enqueueExternalDeletion(db, 'elevenlabs_voice', createdProviderVoiceId);
      } catch (cleanupErr) {
        logRouteError(c, cleanupErr);
      }
    }

    if (isVoiceSlotExhaustedError(detail)) {
      return c.json(
        {
          error: '서비스가 확장중이에요. 잠시만 기다려주세요!',
          error_code: 'VOICE_SLOT_EXHAUSTED',
          detail,
        },
        503,
      );
    }

    return c.json(
      {
        error: 'Voice cloning failed',
        error_code: 'VOICE_CLONING_FAILED',
        detail,
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
  const result = await db.execute({
    sql: `SELECT * FROM voice_profiles WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL`,
    args: [id, ...ids],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  const profile = result.rows[0]!;

  // draft 정리 전용 삭제(draftOnly=true): 클라가 '미선택 draft'로 알고 지우려 해도, 그 사이
  // promote 로 is_draft=0(정식 등록)이 됐다면(응답 유실 등 '팬텀 성공') 절대 지우지 않는다.
  // 방금 등록된 보이스와 그 외부 클론이 하드 삭제되는 데이터 손실을 막는 게이트.
  const draftOnly = c.req.query('draftOnly') === 'true';
  if (draftOnly && Number(profile.is_draft ?? 0) !== 1) {
    return c.json({ success: true, skipped: 'not_a_draft', voice_profile_id: id });
  }

  const tombstoned = await db.execute({
    sql: `UPDATE voice_profiles
          SET deleted_at = datetime('now'), is_shared = 0, updated_at = datetime('now')
          WHERE id = ? AND deleted_at IS NULL
            ${draftOnly ? 'AND COALESCE(is_draft, 0) = 1' : ''}`,
    args: [id],
  });
  if ((tombstoned.rowsAffected ?? 0) === 0) {
    return draftOnly
      ? c.json({ success: true, skipped: 'not_a_draft', voice_profile_id: id })
      : c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }
  await db.execute({
    sql: 'DELETE FROM voice_prerender_queue WHERE voice_profile_id = ?',
    args: [id],
  });

  if (profile.elevenlabs_voice_id) {
    const providerVoiceId = profile.elevenlabs_voice_id as string;
    const { enqueueExternalDeletion } = await import('../lib/audio-retention');
    await enqueueExternalDeletion(db, 'elevenlabs_voice', providerVoiceId);
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

  const assetsRes = await db.execute({
    sql: `SELECT audio_url, audio_object_key FROM generated_audio_assets
          WHERE voice_profile_id = ? AND audio_object_key IS NOT NULL`,
    args: [id],
  });
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
              speaker_id = NULL,
              raw_audio_url = NULL,
              raw_audio_duration_ms = NULL
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
