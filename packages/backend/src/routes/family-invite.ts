import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  generateInviteCode,
  isValidInviteCodeFormat,
  normalizeInviteCode,
  computeInviteExpiresAt,
  buildInviteDeepLink,
  buildInviteWebUrl,
} from '../lib/invites';
import { resolveUserPk } from '../lib/family-helpers';
import { acceptFamilyInvite, FamilyInviteAcceptError } from '../lib/family-invite-accept';

const familyInvite = new Hono<AppEnv>();

familyInvite.post('/invites', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req
    .json<{ plan_group_id?: unknown }>()
    .catch(() => ({ plan_group_id: undefined }));

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  let planGroupId =
    typeof body.plan_group_id === 'string' ? body.plan_group_id.trim() : '';

  if (!planGroupId) {
    const resolved = await db.execute({
      sql: `SELECT pg.id FROM plan_groups pg
            WHERE pg.owner_user_id = ?
            ORDER BY pg.created_at DESC
            LIMIT 1`,
      args: [userPk],
    });
    if (resolved.rows.length === 0) {
      return c.json({ error: '소유한 가족 플랜 그룹이 없습니다', error_code: 'NO_OWNED_GROUP' }, 404);
    }
    planGroupId = String(resolved.rows[0]!.id);
  }

  const groupRes = await db.execute({
    sql: `SELECT id, owner_user_id, max_members FROM plan_groups WHERE id = ?`,
    args: [planGroupId],
  });
  if (groupRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 그룹입니다', error_code: 'GROUP_NOT_FOUND' }, 404);
  }
  const group = groupRes.rows[0]!;
  if (String(group.owner_user_id) !== userPk) {
    return c.json({ error: '그룹 소유자만 초대할 수 있습니다', error_code: 'OWNER_ONLY' }, 403);
  }
  const maxMembers = Number(group.max_members) || 6;

  const countRes = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM plan_group_members WHERE plan_group_id = ?) AS member_count,
            (SELECT COUNT(*) FROM plan_group_invites
              WHERE plan_group_id = ? AND status = 'pending'
                AND datetime(expires_at) > datetime('now')) AS pending_count`,
    args: [planGroupId, planGroupId],
  });
  const memberCount = Number(countRes.rows[0]!.member_count) || 0;
  const pendingCount = Number(countRes.rows[0]!.pending_count) || 0;
  if (memberCount + pendingCount >= maxMembers) {
    return c.json(
      { error: `정원 초과 (최대 ${maxMembers}명, 멤버 ${memberCount} + 대기 ${pendingCount})`, error_code: 'GROUP_FULL' },
      409,
    );
  }

  const inviteId = crypto.randomUUID();
  const code = generateInviteCode();
  const expiresAt = computeInviteExpiresAt();

  await db.execute({
    sql: `INSERT INTO plan_group_invites
          (id, plan_group_id, inviter_user_id, code, status, expires_at)
          VALUES (?, ?, ?, ?, 'pending', ?)`,
    args: [inviteId, planGroupId, userPk, code, expiresAt],
  });

  return c.json({
    invite: {
      id: inviteId,
      plan_group_id: planGroupId,
      code,
      status: 'pending',
      expires_at: expiresAt,
      deep_link: buildInviteDeepLink(code),
      web_url: buildInviteWebUrl(code),
    },
  });
});

familyInvite.get('/invites', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ invites: [] });

  const result = await db.execute({
    sql: `SELECT i.id, i.plan_group_id, i.code, i.status, i.created_at, i.expires_at,
                 i.used_by_user_id, i.used_at
          FROM plan_group_invites i
          JOIN plan_groups pg ON pg.id = i.plan_group_id
          WHERE pg.owner_user_id = ?
          ORDER BY i.created_at DESC`,
    args: [userPk],
  });

  return c.json({
    invites: result.rows.map((r) => ({
      id: String(r.id),
      plan_group_id: String(r.plan_group_id),
      code: String(r.code),
      status: String(r.status),
      created_at: String(r.created_at),
      expires_at: String(r.expires_at),
      used_by_user_id: (r.used_by_user_id as string | null) ?? null,
      used_at: (r.used_at as string | null) ?? null,
      deep_link: buildInviteDeepLink(String(r.code)),
      web_url: buildInviteWebUrl(String(r.code)),
    })),
  });
});

familyInvite.post('/invites/:code/accept', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const code = normalizeInviteCode(c.req.param('code'));
  if (!isValidInviteCodeFormat(code)) {
    return c.json({ error: '잘못된 초대 코드 형식입니다', error_code: 'INVALID_CODE_FORMAT' }, 400);
  }

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  try {
    const result = await acceptFamilyInvite(db, { userPk, code });
    return c.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof FamilyInviteAcceptError) {
      return c.json(
        { error: error.message, error_code: error.errorCode },
        error.status as 400 | 404 | 409,
      );
    }
    throw error;
  }
});

familyInvite.post('/invites/:code/revoke', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const code = normalizeInviteCode(c.req.param('code'));
  if (!isValidInviteCodeFormat(code)) {
    return c.json({ error: '잘못된 초대 코드 형식입니다', error_code: 'INVALID_CODE_FORMAT' }, 400);
  }

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const inviteRes = await db.execute({
    sql: `SELECT id, inviter_user_id, status FROM plan_group_invites WHERE code = ?`,
    args: [code],
  });
  if (inviteRes.rows.length === 0) {
    return c.json({ error: '해당 초대 코드를 찾을 수 없습니다', error_code: 'INVITE_NOT_FOUND' }, 404);
  }
  const invite = inviteRes.rows[0]!;
  if (String(invite.inviter_user_id) !== userPk) {
    return c.json({ error: '발급자만 취소할 수 있습니다', error_code: 'NOT_INVITER' }, 403);
  }
  if (String(invite.status) !== 'pending') {
    return c.json({ error: 'pending 상태의 초대만 취소할 수 있습니다', error_code: 'NOT_PENDING' }, 409);
  }

  await db.execute({
    sql: `UPDATE plan_group_invites SET status = 'revoked' WHERE id = ?`,
    args: [String(invite.id)],
  });

  return c.json({ success: true, invite: { id: String(invite.id), status: 'revoked' } });
});

export default familyInvite;
