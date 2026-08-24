import { Hono, type Context } from 'hono';
import type { AppEnv, Env } from '../types';
import { ElevenLabsClient } from '../lib/elevenlabs';
import { getDB } from '../lib/db';
import { typedRow, getFormFile } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { logRouteError, logStructured } from '../lib/logger';
import { R2VoiceStorage, MAX_VOICE_UPLOAD_BYTES } from '../lib/r2-storage';
import { createEnrollmentAttempts, UnsupportedVoiceProviderError } from '../lib/voice-provider';
import { assertSameGroup, resolveUserPk } from '../lib/family-helpers';
import { isPaidVoicePlan } from './billing-helpers';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from '../lib/consent';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import {
  enqueuePrerender,
  CLONE_CLIP_SEEDS,
  listReadyCloneVoices,
  findMissingStockTargets,
  generateStockClip,
  markPrerenderDone,
  releasePrerenderClaim,
} from '../lib/stock-clips';
import { enqueueExternalDeletion, enqueueExternalDeletionsBatch } from '../lib/audio-retention';
import { revokeDeletedVoices } from '../lib/voice-revocation';
import { notifyDowngradedAlarms } from '../lib/fcm';
import {
  MAX_PROVIDER_CLONE_VOICES,
  evictLruClonesIfOverCapTx,
  hasCloneSlotCapacity,
} from '../lib/voice-slots';
import { analyzeSpeechStyleWithVertex } from '../lib/vertex-translate';
import { getSharedInMemoryVoiceStorage } from '@alarmtalk/voice';
import {
  VoicePreviewTextUpdateSchema,
  VOICE_NAME_MAX_LENGTH,
  normalizeDisplayName,
} from '@alarmtalk/shared';

const voiceProfile = new Hono<AppEnv>();
const MAX_VOICE_PROFILES = 1;
// draft(미승격) 보이스 상한. draft 도 생성 즉시 실제 ElevenLabs 보이스를 만들므로
// (유한·계정 공유 슬롯) 무제한 생성 시 전역 슬롯이 고갈된다. 재시도 여유를 두되
// 사용자당 개수를 제한해 전역 DoS 를 막는다.
const MAX_DRAFT_VOICE_PROFILES = 1;
// 정식 등록(= 사용자가 체감하는 '이번 달 만들 수 있는 목소리') 한도. 월 1개.
// 위 초안 시도 3회는 이 1개를 만들기까지의 재시도 여유다(마음에 안 들면 지우고 다시).
const MAX_OFFICIAL_VOICE_CHANGES_PER_MONTH = 1;
// 최소 길이는 초안·정식 등록이 같다. 예전에는 정식 등록만 60초를 요구했는데, 실제로 1분을
// 채우는 게 부담이라는 제보가 많았다 — 길수록 클론 품질이 좋아지는 건 맞지만 그건 안내로
// 유도할 일이지 등록을 막을 일이 아니다. "5초 한마디"만 배제하고, 세그먼트를 이어붙일 때
// 프레임 경계로 몇백 ms 짧아져도 거부되지 않을 만큼의 여유를 둔다.
const MIN_CLONE_DURATION_MS = 12_000;
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

// 원장은 '이 달에 정식 목소리를 몇 번 바꿨나' 만 센다(월 1회 한도). 어느 프로필인지는
// 판정에 쓰이지 않아 #90 에서 컬럼째 걷었다 — 인자도 함께 없앤다.
async function reserveMonthlyOfficialVoiceChange(
  db: DbExecutor,
  ownerUserId: string,
): Promise<string | null> {
  const ledgerId = crypto.randomUUID();
  const reserved = await db.execute({
    sql: `INSERT OR IGNORE INTO voice_profile_change_ledger
            (id, owner_user_id, change_month, change_type, status)
          VALUES (?, ?, ${currentKstMonthSql()}, ?, 'reserved')`,
    args: [ledgerId, ownerUserId, OFFICIAL_VOICE_CHANGE_TYPE],
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

// KST 기준 'YYYY-MM' — 월 생성(초안) 쿼터의 키. reserve/read 가 동일 월 문자열을 쓰도록 단일 출처.
function currentKstAttemptMonth(): string {
  const monthParts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${monthParts.find((part) => part.type === 'year')!.value}-${monthParts.find((part) => part.type === 'month')!.value}`;
}

// 이번 달(KST) 목소리 초안 생성 사용량 조회 — 클라가 삭제 전 '재생성 가능 여부'를 판정하는 데 쓴다.
async function readMonthlyDraftAttemptUsage(
  db: DbExecutor,
  ownerUserId: string,
): Promise<{ limit: number; used: number; remaining: number }> {
  const res = await db.execute({
    sql: `SELECT used_count FROM voice_draft_attempt_usage
          WHERE owner_user_id = ? AND attempt_month = ?`,
    args: [ownerUserId, currentKstAttemptMonth()],
  });
  const used = Number(res.rows[0]?.used_count ?? 0);
  // 초안 시도에는 제한이 없다 — 확정 전까지는 마음에 들 때까지 만들고 지울 수 있다.
  // 여기서 세는 건 운영 지표일 뿐이고, 사용자에게 보여줄 숫자는 registration_*(월 1회
  // 정식 등록)이다. limit=0 은 '제한 없음'을 뜻하며 응답 필드 호환을 위해 남긴다.
  return { limit: 0, used, remaining: 0 };
}

// 이번 달(KST) '정식 등록' 사용량 — 목소리는 한 달에 1개만 만들 수 있고(월 1회 교체),
// 이게 사용자에게 보여줄 숫자다. 초안 시도는 제한이 없어
// (마음에 안 들면 지우고 다시) 내부 값이지 사용자가 셀 숫자가 아니다.
async function readMonthlyRegistrationUsage(
  db: DbExecutor,
  ownerUserId: string,
): Promise<{ limit: number; used: number; remaining: number }> {
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS used FROM voice_profile_change_ledger
          WHERE owner_user_id = ? AND change_type = ?
            AND change_month = ${currentKstMonthSql()}
            AND status != 'failed'`,
    args: [ownerUserId, OFFICIAL_VOICE_CHANGE_TYPE],
  });
  const used = Number(res.rows[0]?.used ?? 0);
  return {
    limit: MAX_OFFICIAL_VOICE_CHANGES_PER_MONTH,
    used,
    remaining: Math.max(0, MAX_OFFICIAL_VOICE_CHANGES_PER_MONTH - used),
  };
}

async function reserveMonthlyDraftAttempt(
  db: DbExecutor,
  ownerUserId: string,
): Promise<string | null> {
  const attemptMonth = currentKstAttemptMonth();
  const result = await db.execute({
    sql: `INSERT INTO voice_draft_attempt_usage
            (owner_user_id, attempt_month, used_count)
          VALUES (?, ?, 1)
          ON CONFLICT(owner_user_id, attempt_month) DO UPDATE SET
            used_count = used_count + 1,
            updated_at = datetime('now')`,
    args: [ownerUserId, attemptMonth],
  });
  // 사용량은 세지만 막지 않는다 — 초안은 확정 전 단계라 마음에 들 때까지 만들고 지울 수
  // 있어야 한다. 월 1회 제한은 '최종 확정'에만 건다. 동시 보유 개수는
  // MAX_DRAFT_VOICE_PROFILES=1 이 여전히 막으므로 클론 슬롯이 쌓이지는 않는다.
  void result;
  return attemptMonth;
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
function ownerIds(c: {
  get: (k: 'userId' | 'userIdPK' | 'userLoginId') => string | undefined;
}): string[] {
  // 기준은 users.id, 보조로 토큰의 로그인 식별자(구 토큰이면 google_id)를 함께 매칭한다.
  const pk = (c.get('userIdPK') ?? c.get('userId')) as string | undefined;
  const loginId = c.get('userLoginId') as string | undefined;
  return Array.from(new Set([pk, loginId].filter((v): v is string => Boolean(v))));
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
      // ⚠ **`SELECT *` 를 되돌리지 말 것.** 이 결과는 아래에서 스프레드(`...row`)로
      // 그대로 응답에 실린다. voice_profiles 에는 말투 분석 결과 JSON(`speech_style`),
      // 미리듣기 클레임 토큰(`preview_claim_token`), 프로바이더 보이스 id
      // (`elevenlabs_voice_id`) 처럼 **클라가 쓰지도 않고 나가서도 안 되는** 컬럼이 있다.
      // 같은 파일이 users 조회에는 이미 컬럼을 나열하고 있었다 — 여기만 빠져 있었다.
      // 목록은 두 앱의 모델(`VoiceProfileApi.kt` / `AlarmTalkAPIModels.swift`)이 읽는 것.
      sql: `SELECT id, user_id, name, status, created_at, updated_at, is_shared, is_draft, is_system, relationship_label, listener_title, speech_style_status, previewed_at FROM voice_profiles WHERE (user_id IN (${ph}) OR COALESCE(is_system, 0) = 1) AND deleted_at IS NULL AND COALESCE(is_draft, 0) = 0${statusClause} ORDER BY COALESCE(is_system, 0) ASC, created_at DESC LIMIT ? OFFSET ?`,
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
    // 위 목록과 같은 이유로 컬럼을 나열한다 — 아래에서 `...row` 로 그대로 나간다.
    sql: `SELECT id, user_id, name, status, created_at, updated_at, is_shared, is_draft, is_system, relationship_label, listener_title, speech_style_status, previewed_at FROM voice_profiles
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

// 이번 달(KST) 목소리 초안 생성 쿼터 — 클라가 삭제 전 '이번 달 재생성 가능 여부'를 판정한다.
// '/:id' 보다 먼저 등록해야 draft-quota 가 id 로 잡히지 않는다.
voiceProfile.get('/draft-quota', async (c) => {
  const userId = c.get('userId');
  const userPk = (c.get('userIdPK') as string | undefined) || userId;
  const db = getDB(c.env);
  const quota = await readMonthlyDraftAttemptUsage(db, userPk);
  const registration = await readMonthlyRegistrationUsage(db, userPk);
  return c.json({
    ...quota,
    // 클라가 '생성 가능 n/1회'로 보여주는 값. draft 시도 쿼터(limit 0)와 다르다.
    registration_limit: registration.limit,
    registration_used: registration.used,
    registration_remaining: registration.remaining,
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
          WHERE me.id = ? AND fm2.user_id != me.id AND fm2.user_id != ?`,
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

type ReplaceResult =
  | { ok: true; profile: Record<string, unknown> }
  | { ok: false; error: string; errorCode: string; status: 404 | 409 };

/**
 * **목소리 교체 — 옛 프로필 자리에 새 목소리를 앉힌다.**
 *
 * 사용자에게는 "이전에 저장해둔 목소리는 삭제됩니다" 지만, 서버는 옛 프로필 행을
 * **지우지 않고 재사용**한다. 지우면 그 목소리를 쓰던 알람이 전부 기본 알람음으로
 * 떨어지기 때문이다(알람은 `voice_profile_id`·`message_id` 를 가리킨다).
 *
 * 순서가 중요하다 — **먼저 옮기고, 마지막에 정리한다.**
 * 중간에 끊겨도 사용자는 "옛 목소리 그대로" 이거나 "새 목소리로 바뀜" 중 하나이지,
 * **둘 다 없는 상태가 되지 않는다.** 반대로 옛 provider voice 를 먼저 지우면 그 사이에
 * 실패했을 때 되돌릴 수 없는 것을 먼저 잃는다.
 *
 * 1. 드래프트에서 새 목소리의 실체(provider voice id·이름·페르소나·미리듣기)를 읽는다.
 * 2. 한 트랜잭션에서 **옛 프로필에 덮어쓰고**, 드래프트 행은 소비된 것으로 지운다.
 * 3. 프리셋 클립 재렌더를 큐에 넣는다(`refresh_existing = 1`) — 클립은 cron 이 덮어쓴다.
 * 4. 옛 provider voice 는 **커밋 뒤에** 외부 삭제 큐로 넘긴다.
 */
async function replaceVoiceInPlace(
  db: ReturnType<typeof getDB>,
  params: { targetUserIds: string[]; draftProfileId: string; language: string; isShared?: boolean },
): Promise<ReplaceResult> {
  const { targetUserIds, draftProfileId, language, isShared } = params;
  const ph = targetUserIds.map(() => '?').join(',');

  const draftRes = await db.execute({
    sql: `SELECT id, user_id, name, elevenlabs_voice_id, relationship_label, listener_title,
                 preview_text, preview_language, speech_style, is_shared
          FROM voice_profiles
          WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL
            AND COALESCE(is_draft, 0) = 1
          LIMIT 1`,
    args: [draftProfileId, ...targetUserIds],
  });
  const draft = draftRes.rows[0];
  if (!draft) {
    return { ok: false, error: 'Voice draft not found', errorCode: 'VOICE_PROFILE_NOT_FOUND', status: 404 };
  }

  // 교체 대상 = 이 사용자의 **현역** 목소리. 한도가 1이라 하나뿐이지만, 늘어나도
  // 가장 오래된 것을 고르지 않도록 명시적으로 하나만 있을 때만 진행한다.
  const targetRes = await db.execute({
    sql: `SELECT id, elevenlabs_voice_id
          FROM voice_profiles
          WHERE user_id IN (${ph}) AND deleted_at IS NULL AND status != 'failed'
            AND COALESCE(is_draft, 0) = 0 AND id != ?`,
    args: [...targetUserIds, draftProfileId],
  });
  if (targetRes.rows.length !== 1) {
    return {
      ok: false,
      error: 'Exactly one registered voice is required to replace.',
      errorCode: 'VOICE_REPLACE_TARGET_AMBIGUOUS',
      status: 409,
    };
  }
  const target = targetRes.rows[0]!;
  const targetId = String(target.id);
  const staleProviderVoiceId = target.elevenlabs_voice_id ? String(target.elevenlabs_voice_id) : null;
  const ownerUserId = String(draft.user_id);

  await withWriteTransaction(db, async (tx) => {
    await tx.execute({
      sql: `UPDATE voice_profiles
            SET name = ?, elevenlabs_voice_id = ?, relationship_label = ?, listener_title = ?,
                preview_text = ?, preview_language = ?, speech_style = ?, is_shared = ?,
                status = 'ready'
            WHERE id = ?`,
      args: [
        draft.name ?? null,
        draft.elevenlabs_voice_id ?? null,
        draft.relationship_label ?? null,
        draft.listener_title ?? null,
        draft.preview_text ?? null,
        draft.preview_language ?? null,
        draft.speech_style ?? null,
        isShared === undefined ? Number(draft.is_shared ?? 0) : (isShared ? 1 : 0),
        targetId,
      ],
    });
    // 드래프트는 소비됐다. provider voice 는 **대상 프로필로 넘어갔으므로 지우지 않는다** —
    // 여기서 외부 삭제 큐에 넣으면 방금 앉힌 목소리를 스스로 지운다.
    await tx.execute({
      sql: `UPDATE voice_profiles SET deleted_at = datetime('now') WHERE id = ?`,
      args: [draftProfileId],
    });

    // ⚠ **직접 입력 알람은 기본 알람으로 내린다.**
    //
    // 프리셋 문구는 아래 `voice_prerender_queue` 가 새 목소리로 **다시 만들어** 주지만,
    // 직접 입력(`category = 'custom'`)은 사용자가 그때 친 문장을 **옛 목소리로** 합성해
    // 둔 것이라 다시 만들 수 없다. 그대로 두면 교체한 뒤에도 **지운 목소리가 계속
    // 울린다** — 화면이 "직접 입력으로 해둔 알람들도 기본 알람으로 설정됩니다" 라고
    // 약속하고 동의까지 받은 것과 정반대다(2026-08-12 확인, 그 약속은 코드에 없었다).
    //
    // 목소리 **삭제** 경로(`DELETE /voice/:id`)가 하는 것과 같은 정리이고, 다른 점은
    // 대상을 `category = 'custom'` 으로 좁힌다는 것뿐이다 — 교체에서는 프리셋 알람이
    // 살아남아야 한다.
    await tx.execute({
      sql: `UPDATE alarms
            SET mode = 'sound-only',
                wake_mode = 'sound_then_voice',
                message_id = NULL,
                voice_profile_id = NULL
            WHERE message_id IN (
              SELECT id FROM messages WHERE voice_profile_id = ? AND category = 'custom'
            )`,
      args: [targetId],
    });
    // 못 쓰게 된 음원은 참조를 끊는다. 행 자체는 남겨 사용량 집계를 보존한다
    // (삭제 경로와 같은 방식).
    await tx.execute({
      sql: `UPDATE messages SET audio_url = NULL
            WHERE voice_profile_id = ? AND category = 'custom'`,
      args: [targetId],
    });
  });

  // 프리셋 클립 재렌더 예약. `refresh_existing = 1` 이라 `generateStockClip` 이 기존
  // preset 을 no-op 로 건너뛰지 않고 덮어쓴다. 이미 큐에 행이 있으면 그 행을 재렌더로
  // 되돌린다(done 으로 끝나 있던 경우 포함).
  await db.execute({
    sql: `INSERT INTO voice_prerender_queue
            (voice_profile_id, owner_user_id, language, status, attempts, refresh_existing)
          VALUES (?, ?, ?, 'pending', 0, 1)
          ON CONFLICT(voice_profile_id) DO UPDATE SET
            status = 'pending', attempts = 0, refresh_existing = 1,
            claimed_at = NULL, claim_token = NULL,
            language = excluded.language, updated_at = datetime('now')`,
    args: [targetId, ownerUserId, language],
  });

  // 옛 provider voice 정리는 **맨 마지막**이다(위 주석 참조).
  if (staleProviderVoiceId && staleProviderVoiceId !== String(draft.elevenlabs_voice_id ?? '')) {
    await enqueueExternalDeletion(db, 'elevenlabs_voice', staleProviderVoiceId);
  }

  const refreshed = await db.execute({
    sql: `SELECT id, name, status, is_shared, relationship_label, listener_title, created_at
          FROM voice_profiles WHERE id = ? LIMIT 1`,
    args: [targetId],
  });
  return { ok: true, profile: (refreshed.rows[0] ?? {}) as Record<string, unknown> };
}

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
    replace_existing?: unknown;
    replaceExisting?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'JSON body required', error_code: 'JSON_BODY_REQUIRED' }, 400);
  }
  // 사전렌더 언어 폴백(레거시 클라 전송값) — 실제 언어는 promote 시 preview_language 가 우선.
  const prerenderLanguage =
    typeof (body.language ?? body.app_language) === 'string'
      ? String(body.language ?? body.app_language)
      : 'ko';

  const hasName = body.name !== undefined;
  // trim 만으로는 부족하다 — 제어문자·제로폭·양방향 문자는 공백이 아니라 살아남고,
  // 목소리 이름은 가족에게 공유될 때 그대로 노출된다. 글자 규칙은 표시 이름과 같다.
  const name = typeof body.name === 'string' ? normalizeDisplayName(body.name) : '';
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
  /**
   * 등록 확정 화면의 **체크 하나**. "이전에 저장해둔 목소리는 삭제됩니다 / 직접 입력으로
   * 해둔 알람들도 기본 알람으로 설정됩니다" 에 동의했다는 뜻이다.
   *
   * 켜져 있으면 한도 초과(`VOICE_LIMIT_REACHED`)로 막는 대신 **기존 목소리 자리에 새
   * 목소리를 앉힌다.** 사용자에게는 '교체' 지만 서버는 프로필 행을 **지우지 않고 재사용**
   * 한다 — 지우면 그 목소리를 쓰던 알람이 전부 기본 알람음으로 떨어지기 때문이다.
   * 프리셋 문구를 쓰는 알람은 그대로 살아서 새 목소리로 울고, 직접 입력 알람만 기본
   * 알람음이 된다(그 음성은 옛 목소리로 만들어 둔 것이라 자동 재생성이 안 된다).
   */
  const replaceExisting =
    body.replace_existing === true || body.replaceExisting === true;
  if (!hasName && !hasShared && !hasDraft && !hasRelationship && !hasListenerTitle) {
    return c.json(
      { error: `name must be 1-${VOICE_NAME_MAX_LENGTH} characters`, error_code: 'INVALID_NAME_LENGTH' },
      400,
    );
  }
  if (hasName && (name.length === 0 || name.length > VOICE_NAME_MAX_LENGTH)) {
    return c.json(
      { error: `name must be 1-${VOICE_NAME_MAX_LENGTH} characters`, error_code: 'INVALID_NAME_LENGTH' },
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
      // 체크를 안 했으면 지금까지처럼 막는다.
      if (!replaceExisting) {
        return c.json(
          {
            error: `최대 ${MAX_VOICE_PROFILES}개까지 등록 가능합니다`,
            error_code: 'VOICE_LIMIT_REACHED',
          },
          409,
        );
      }
      // ⚠ **교체는 지우지 않는다.** 옛 프로필을 DELETE 하면 그 목소리를 쓰던 알람이
      // 전부 기본 알람음으로 떨어진다 — 그게 없애려던 동작이다. 대신 옛 프로필 행을
      // **그대로 재사용**해서 새 목소리(provider voice id·이름·페르소나)를 그 자리에
      // 앉히고, 프리셋 클립은 재렌더로 덮어쓴다(`refresh_existing`).
      // 알람은 `voice_profile_id`·`message_id` 가 안 바뀌므로 아무것도 눈치채지 못한다.
      const replaced = await replaceVoiceInPlace(db, {
        targetUserIds: ids,
        draftProfileId: id,
        language: prerenderLanguage,
        isShared: isSharedUpdate,
      });
      if (!replaced.ok) {
        return c.json({ error: replaced.error, error_code: replaced.errorCode }, replaced.status);
      }
      return c.json({ profile: replaced.profile, replaced: true });
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
        const ledgerId = await reserveMonthlyOfficialVoiceChange(tx, userPk);
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
        // 사전렌더 언어는 '등록 때 고른 언어'(preview_language)가 단일 출처 — 클라가 보낸
        // 기기 언어(prerenderLanguage)로 큐잉하면 일본어로 만든 목소리가 한국어 기기에서
        // promote 될 때 한국어 클립이 만들어진다(재시도/advance 경로와도 어긋남).
        const langRes = await tx.execute({
          sql: 'SELECT preview_language FROM voice_profiles WHERE id = ? LIMIT 1',
          args: [id],
        });
        const promotedLanguage = String(
          langRes.rows[0]?.preview_language ?? prerenderLanguage ?? 'ko',
        );
        await enqueuePrerender(tx, id, userPk, promotedLanguage);
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

  // 공유 on/off 변경은 같은 그룹 멤버들에게 data-only push 로 즉시 알린다 — 받은 쪽이
  // 새로고침 없이 목소리 탭에서 바로 보이게(가족 알람 push 와 동일 패턴, 실패는 무시).
  // waitUntil 등록 필수: 미등록 fire-and-forget 은 응답 직후 워커가 종료되면 FCM 호출이
  // 실행되기 전에 끊길 수 있다. executionCtx 없는 컨텍스트(테스트)에선 접근이 던지므로
  // try 로 생략 — 인자 평가 전에 던져서 멤버 조회도 안 돌아 mock FIFO 도 안 밀린다.
  if (hasShared) {
    try {
      c.executionCtx.waitUntil(
        (async () => {
          const { sendVoiceShareChangedPush } = await import('../lib/fcm');
          const memberRes = await db.execute({
            sql: `SELECT DISTINCT m2.user_id
                  FROM plan_group_members m1
                  JOIN plan_group_members m2 ON m2.plan_group_id = m1.plan_group_id
                  WHERE m1.user_id = ? AND m2.user_id != ?`,
            args: [userPk, userPk],
          });
          const recipients = memberRes.rows.map((row) => String(row.user_id));
          if (recipients.length > 0) {
            await sendVoiceShareChangedPush(db, c.env, recipients);
          }
        })().catch(() => {}),
      );
    } catch {
      // executionCtx 없음(비-fetch/테스트) → push 생략, 15분 주기 pull/재조회 폴백.
    }
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
    // 유료 플랜 확인은 조건 없이 수행한다. 예전에는 `if (resolvedUserPk)` 안에 들어
    // 있어서, 식별자를 해석하지 못하면 플랜 확인 없이 클론이 진행됐다(fail-open).
    // 같은 파일의 promote 경로는 무조건 확인하고 있어 두 경로의 강도도 어긋나 있었다.
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
    // 등록 경로도 같은 규칙을 태운다(PATCH 만 막으면 여기로 그냥 들어온다).
    const name = typeof rawName === 'string' ? normalizeDisplayName(rawName) : '';
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
      const draftLimitReached = isDraft && draftCount >= MAX_DRAFT_VOICE_PROFILES;
      // ⚠ **official 슬롯이 찼다고 초안 생성을 막지 않는다**(2026-08-12 확정).
      // 그러면 사용자가 '교체' 를 고를 기회 자체가 없다 — 승격(PATCH)의 `replace_existing`
      // 갈래가 **도달 불가능한 죽은 코드**가 된다. 교체 여부는 등록을 끝낸 **마지막 확정
      // 화면**에서 묻는다(`VoicePreviewConfirmView` 의 교체 체크).
      //
      // 옛 주석은 "promote 가 한도로 거부되니 stranded draft 가 된다" 였는데, 그 전제는
      // `replace_existing` 이 생기면서 사라졌다 — 승격은 이제 기존 행을 **재사용**한다.
      // 월 등록 한도(`reserveMonthlyDraftAttempt`)는 그대로 남아 있어, 한 달에 한 번이라는
      // 규칙은 여기서 풀리지 않는다.
      if (draftLimitReached) {
        return c.json(
          {
            error: `임시 보이스는 최대 ${MAX_DRAFT_VOICE_PROFILES}개까지 만들 수 있습니다`,
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

    const durationCheck = validateCloneDuration(formData.get('durationMs'));
    if (durationCheck) return c.json(durationCheck.body, durationCheck.status);
    // 검증 통과 후의 durationMs — 아래 voice_uploads 보관(재시도용 원본)에 기록한다.
    const cloneDurationMs = Number.parseInt(String(formData.get('durationMs')), 10);

    if (name.length > VOICE_NAME_MAX_LENGTH) {
      return c.json(
        { error: `Name must be ${VOICE_NAME_MAX_LENGTH} characters or less`, error_code: 'NAME_TOO_LONG' },
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
      // ⚠ **official 슬롯은 여기서 보지 않는다**(2026-08-12 확정 — 위 선검사와 같은 이유).
      // 슬롯이 찼어도 초안을 만들 수 있어야 사용자가 마지막 확정 화면에서 '교체' 를 고를
      // 수 있다. 승격이 `replace_existing` 로 기존 행을 재사용하므로 stranded draft 가
      // 되지 않는다. draft 슬롯 한도는 그대로 본다 — 동시에 여러 초안을 두는 것은 별개다.
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
      if (Number(slotRow?.draft_count ?? 0) >= MAX_DRAFT_VOICE_PROFILES) {
        return { status: 'voice_limit' as const, ledgerId: null };
      }
      // F1(Codex #599 3차): 전역 슬롯이 꽉 찼는데 evict 후보가 전부 보호 대상(공유·draft)이면
      // 등록 후 eviction 이 후보 부족으로 짧게 끝나 상한 초과가 지속된다 → enroll·쿼터 소모 전에
      // 조기 거부. draft attempt 예약 앞에 두어 쿼터도 아끼고, 같은 tx 스냅샷이라 TOCTOU 최소화.
      if (!(await hasCloneSlotCapacity(tx))) {
        return { status: 'clone_capacity' as const, ledgerId: null };
      }
      // 사용량만 센다 — 막지 않는다(위 readMonthlyDraftAttemptUsage 주석 참고).
      draftAttemptMonth = await reserveMonthlyDraftAttempt(tx, userPk);
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
    if (insertResult.status === 'clone_capacity') {
      return c.json(
        {
          error: '지금은 목소리 등록이 몰려 있어요. 잠시 후 다시 시도해 주세요.',
          error_code: 'VOICE_CAPACITY_EXHAUSTED',
        },
        503,
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
        return { status: 'draft_unavailable' as const, evicted: 0 };
      }
      // F1: 새 보이스가 ready 로 반영된 같은 쓰기 트랜잭션에서 상한 초과분을 LRU 제거한다.
      // enroll 성공 후라 애먼 보이스가 억울하게 evict 되는 일이 없고(Codex #599 2차), 같은
      // 트랜잭션이라 동시 등록이 직렬화된다 — 사전 체크를 함께 통과한 두 요청 중 늦은 쪽은
      // 앞선 쪽이 유일한 후보를 소진했으면 shortfall 을 보고, 초과 상태로 커밋하는 대신
      // 등록 자체를 실패로 되돌린다(Codex #599 4차).
      const { evicted, shortfall } = await evictLruClonesIfOverCapTx(tx, profileId);
      if (shortfall > 0) {
        await tx.execute({
          sql: `UPDATE voice_profiles SET elevenlabs_voice_id = NULL, status = 'failed', updated_at = datetime('now')
                WHERE id = ?`,
          args: [profileId],
        });
        await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'failed');
        return { status: 'capacity_lost' as const, evicted };
      }
      await markMonthlyOfficialVoiceChange(tx, monthlyLedgerId, 'succeeded');
      return { status: 'ok' as const, evicted };
    });
    if (completion.status !== 'ok') {
      // capacity_lost 의 provider 보이스 삭제는 아래 catch 의 createdProviderVoiceId 정리가 맡는다.
      throw new Error(
        completion.status === 'consent_withdrawn'
          ? 'Voice consent was withdrawn during cloning.'
          : completion.status === 'capacity_lost'
            ? 'VOICE_CAPACITY_EXHAUSTED'
            : 'Voice draft was removed during cloning.',
      );
    }
    if (completion.evicted > 0) {
      logStructured('info', {
        at: 'voice.clone.evict',
        removed: completion.evicted,
        capacity: MAX_PROVIDER_CLONE_VOICES,
      });
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

    // F1(Codex #599 4차): 완료 트랜잭션에서 eviction shortfall 로 등록을 되돌린 경우 —
    // 사전 체크의 503 과 같은 코드로 응답한다(클라는 잠시 후 재시도 안내).
    if (detail === 'VOICE_CAPACITY_EXHAUSTED') {
      return c.json(
        {
          error: '지금은 목소리 등록이 몰려 있어요. 잠시 후 다시 시도해 주세요.',
          error_code: 'VOICE_CAPACITY_EXHAUSTED',
          detail: 'VOICE_CAPACITY_EXHAUSTED',
        },
        503,
      );
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

function validateCloneDuration(value: unknown): {
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
  if (durationMs < MIN_CLONE_DURATION_MS) {
    return {
      status: 400,
      body: {
        error: `voice clone audio must be at least ${MIN_CLONE_DURATION_MS / 1000} seconds`,
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

// 사전렌더 전진(owner-driven). promote 직후 앱이 done 까지 반복 호출해 cron(5분 틱,
// 6클립) 을 기다리지 않고 클립을 즉시 채운다. 호출 1건 = Workers invocation 1건이라
// 서브리퀘스트 예산이 매번 새로 시작된다 — 그래서 호출당 소량(3클립)만 만들고 클라가
// 루프를 돈다. 앱이 중간에 죽거나 화면을 닫으면 남은 몫은 기존 cron 드레인이 이어받는다
// (advance 의 claim 은 완료/부분 진행 시 즉시 release, 비정상 종료 시 15분 임대 만료로 회수).
voiceProfile.post('/:id/prerender/advance', async (c) => {
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
  // 생성은 소유자 원본 음성 파생물(생체정보) 처리다 — cron 과 동일하게 민감 동의를 강제한다.
  if (await missingConsentType(db, userPk, SENSITIVE_REQUIRED_CONSENTS)) {
    return c.json(
      { error: 'Voice consent is required.', error_code: 'CONSENT_REQUIRED' },
      403,
    );
  }

  const countGenerated = async () =>
    Number(
      (
        await db.execute({
          sql: `SELECT COUNT(*) AS count FROM messages
                WHERE voice_profile_id = ? AND COALESCE(is_preset, 0) = 1 AND audio_url IS NOT NULL`,
          args: [id],
        })
      ).rows[0]?.count ?? 0,
    );

  // failed 큐는 사용자 주도 재시도로 살리고, 행이 없으면 재적재한다(prerender-retry 와 동일 정책).
  await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET status = 'pending', attempts = 0, claimed_at = NULL, claim_token = NULL,
              updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'failed'`,
    args: [id],
  });
  await enqueuePrerender(db, id, userPk, String(profileRes.rows[0]!.preview_language ?? 'ko'));

  // 클레임 규칙 (Codex #609 P1 — 동시 advance 가 서로의 claim 을 덮어써 유료 합성이 중복되는
  // 것 방지):
  //  - cron 클레임(uuid 토큰)은 즉시 인수한다 — 소유자 주도가 우선이고, 진행 중이던 cron 쪽
  //    publish 는 claim_token 불일치로 no-op(멱등 INSERT), 이쪽이 이어서 채운다.
  //  - 다른 advance 클레임('adv-' 접두사)이 살아 있으면(2분 리스) 인수하지 않고 현재 진행만
  //    돌려준다. 정상 루프는 매 호출 끝에 release 로 토큰을 비우므로 순차 호출은 항상 통과하고,
  //    죽은 호출의 클레임은 2분 뒤 회수된다.
  const claimToken = `adv-${crypto.randomUUID()}`;
  const claimed = await db.execute({
    sql: `UPDATE voice_prerender_queue
          SET claimed_at = datetime('now'), claim_token = ?, updated_at = datetime('now')
          WHERE voice_profile_id = ? AND status = 'pending'
            AND (
              claim_token IS NULL
              OR claim_token NOT LIKE 'adv-%'
              OR claimed_at <= datetime('now', '-2 minutes')
            )
          RETURNING language`,
    args: [claimToken, id],
  });
  if (claimed.rows.length === 0) {
    const pendingRes = await db.execute({
      sql: `SELECT 1 FROM voice_prerender_queue WHERE voice_profile_id = ? AND status = 'pending'`,
      args: [id],
    });
    if (pendingRes.rows.length > 0) {
      // 다른 advance 호출이 진행 중 — 합성 없이 현재 진행 상황만 돌려준다.
      return c.json({
        done: false,
        generated: await countGenerated(),
        total: CLONE_PRERENDER_TOTAL,
      });
    }
    // pending 이 아니면 이미 done — 현재 개수만 돌려준다.
    return c.json({ done: true, generated: await countGenerated(), total: CLONE_PRERENDER_TOTAL });
  }
  const language = String(claimed.rows[0]!.language ?? 'ko');

  const voices = await listReadyCloneVoices(db, [
    { voiceProfileId: id, ownerUserId: userPk, language, claimToken },
  ]);
  const voice = voices[0];
  if (!voice) {
    await releasePrerenderClaim(db, id, claimToken);
    return c.json(
      { error: 'Voice profile is not ready for prerender.', error_code: 'VOICE_NOT_READY' },
      409,
    );
  }

  const targets = await findMissingStockTargets(db, [voice]);
  if (targets.length === 0) {
    await markPrerenderDone(db, id, claimToken);
    return c.json({ done: true, generated: await countGenerated(), total: CLONE_PRERENDER_TOTAL });
  }

  // 호출당 3클립: 클립 1개 ≈ Vertex+합성+R2+DB 여러 서브리퀘스트라, 인증/조회분을 감안해
  // 무료 플랜 한도(50) 안에 안전하게 들어가는 수로 잡는다. 남은 몫은 클라 재호출/cron.
  const MAX_CLIPS_PER_CALL = 3;
  let made = 0;
  for (const target of targets.slice(0, MAX_CLIPS_PER_CALL)) {
    try {
      await generateStockClip(db, c.env, target);
      made += 1;
    } catch (genErr) {
      logRouteError(c, genErr);
      // 서브리퀘스트 소진이면 이 호출에서 더 만들 수 없다 — 즉시 반환하고 클라가 재호출.
      if (String(genErr).includes('Too many subrequests')) break;
    }
  }

  const done = made >= targets.length;
  if (done) {
    await markPrerenderDone(db, id, claimToken);
  } else {
    // 즉시 release 해 다음 advance 호출(또는 cron)이 바로 이어받게 한다.
    await releasePrerenderClaim(db, id, claimToken);
  }
  return c.json({ done, generated: await countGenerated(), total: CLONE_PRERENDER_TOTAL });
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
  const noRevocation = { downgradedAlarms: [], voiceAccessRevokedUserIds: [] };

  const deletionState = await withWriteTransaction(db, async (tx) => {
    const current = await tx.execute({
      sql: `SELECT * FROM voice_profiles
            WHERE id = ? AND user_id IN (${ph}) AND deleted_at IS NULL`,
      args: [id, ...ids],
    });
    if (current.rows.length === 0) {
      return {
        status: 'not_found' as const,
        profile: null,
        tombstoned: null,
        revocation: noRevocation,
      };
    }
    const currentProfile = current.rows[0]!;
    if (draftOnly && Number(currentProfile.is_draft ?? 0) !== 1) {
      return {
        status: 'not_a_draft' as const,
        profile: currentProfile,
        tombstoned: null,
        revocation: noRevocation,
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
      return {
        status: 'not_found' as const,
        profile: currentProfile,
        tombstoned,
        revocation: noRevocation,
      };
    }
    await tx.execute({
      sql: 'DELETE FROM voice_prerender_queue WHERE voice_profile_id = ?',
      args: [id],
    });
    // 초안(is_draft=1)을 지우는 건 이번 달 슬롯과 무관하다 — 초안은 애초에 원장을 쓰지 않는다.
    // 정식 등록한 목소리를 지우면 이번 달은 그대로 소진된 채로 둔다. 한 달에 고를 수 있는
    // 목소리는 하나이고, 지웠다 만들기를 반복하면 그 규칙이 사실상 없는 것과 같아진다.
    // (예전에는 여기서 원장을 지워 같은 달 재등록을 허용했다.)
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
    // 확정 목소리의 원본 업로드(voice_uploads + R2 오브젝트)도 함께 삭제한다.
    // 확정분 원본은 TTL 스윕에서 제외돼 목소리 수명 동안 보관되므로(재생성용), 목소리를 지울 때
    // 여기서 cascade 로 정리하지 않으면 영구히 남는다.
    const sourceUploads = await tx.execute({
      sql: 'SELECT id, object_key FROM voice_uploads WHERE voice_profile_id = ?',
      args: [id],
    });
    // R2 오브젝트는 전부 큐로 일괄 적재 — 자산별 개별 INSERT/삭제는 자산이 많은 목소리
    // (사전렌더 21클립×언어 재생성 이력)에서 서브리퀘스트 한도를 넘겨 DELETE 전체가 500 났다.
    // 실제 R2 삭제는 cron 드레인(예산 가드 내)이 처리한다.
    await enqueueExternalDeletionsBatch(tx, 'r2_object', [
      ...assets.rows.map((asset) => asset.audio_object_key as string | null),
      ...sourceUploads.rows.map((upload) => upload.object_key as string | null),
    ]);
    await tx.execute({
      sql: 'DELETE FROM voice_uploads WHERE voice_profile_id = ?',
      args: [id],
    });

    // 프로필 tombstone·원본 삭제와 철회는 **한 커밋**이다. 새 철회 컬럼 마이그레이션이
    // 아직이면 전부 롤백돼 재시도할 수 있어야 한다. 프로필만 먼저 사라지면 재시도는 404다.
    const revocation = await revokeDeletedVoices(tx, {
      voiceProfileIds: [id],
      ownerUserIds: ids,
    });
    await tx.execute({
      sql: 'DELETE FROM generated_audio_assets WHERE voice_profile_id = ?',
      args: [id],
    });
    await tx.execute({
      sql: `UPDATE messages SET audio_url = NULL WHERE voice_profile_id = ?`,
      args: [id],
    });
    return {
      status: 'deleted' as const,
      profile: currentProfile,
      tombstoned,
      revocation,
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

  // DB 쓰기가 끝난 뒤에 보낸다(FCM 은 네트워크 I/O). 실패해도 흐름을 깨지 않는다 —
  // 정확성은 클라의 재조회(VoiceAccessSyncWorker 하루 주기·앱 시작)가 보장하고
  // 푸시는 즉시성만 맡는다.
  await notifyDowngradedAlarms(
    db,
    c.env,
    deletionState.revocation.downgradedAlarms,
    deletionState.revocation.voiceAccessRevokedUserIds,
  );

  return c.json({ success: true, deleted: true });
});

export default voiceProfile;
