import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import {
  generateInviteCode,
  isValidInviteCodeFormat,
  computeInviteExpiresAt,
  buildInviteDeepLink,
  buildInviteWebUrl,
} from '../lib/invites';
import { resolveUserPk } from '../lib/family-helpers';

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
    planGroupId = String(resolved.rows[0].id);
  }

  const groupRes = await db.execute({
    sql: `SELECT id, owner_user_id, max_members FROM plan_groups WHERE id = ?`,
    args: [planGroupId],
  });
  if (groupRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 그룹입니다', error_code: 'GROUP_NOT_FOUND' }, 404);
  }
  const group = groupRes.rows[0];
  if (String(group.owner_user_id) !== userPk) {
    return c.json({ error: '그룹 소유자만 초대할 수 있습니다', error_code: 'OWNER_ONLY' }, 403);
  }
  const maxMembers = Number(group.max_members) || 6;

  const countRes = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM plan_group_members WHERE plan_group_id = ?) AS member_count,
            (SELECT COUNT(*) FROM plan_group_invites
              WHERE plan_group_id = ? AND status = 'pending'
                AND expires_at > datetime('now')) AS pending_count`,
    args: [planGroupId, planGroupId],
  });
  const memberCount = Number(countRes.rows[0].member_count) || 0;
  const pendingCount = Number(countRes.rows[0].pending_count) || 0;
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

  const code = c.req.param('code').trim();
  if (!isValidInviteCodeFormat(code)) {
    return c.json({ error: '잘못된 초대 코드 형식입니다', error_code: 'INVALID_CODE_FORMAT' }, 400);
  }

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const inviteRes = await db.execute({
    sql: `SELECT id, plan_group_id, inviter_user_id, status, expires_at
          FROM plan_group_invites WHERE code = ?`,
    args: [code],
  });
  if (inviteRes.rows.length === 0) {
    return c.json({ error: '해당 초대 코드를 찾을 수 없습니다', error_code: 'INVITE_NOT_FOUND' }, 404);
  }
  const invite = inviteRes.rows[0];
  const inviteId = String(invite.id);
  const planGroupId = String(invite.plan_group_id);
  const inviterUserId = String(invite.inviter_user_id);
  const status = String(invite.status);

  if (status === 'used') {
    return c.json({ error: '이미 사용된 초대 코드입니다', error_code: 'CODE_ALREADY_USED' }, 409);
  }
  if (status === 'revoked') {
    return c.json({ error: '취소된 초대 코드입니다', error_code: 'CODE_REVOKED' }, 409);
  }
  if (status === 'expired') {
    return c.json({ error: '만료된 초대 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
  }

  const now = new Date();
  const expiresAt = new Date(String(invite.expires_at));
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    await db.execute({
      sql: `UPDATE plan_group_invites SET status = 'expired' WHERE id = ?`,
      args: [inviteId],
    });
    return c.json({ error: '만료된 초대 코드입니다', error_code: 'CODE_EXPIRED' }, 409);
  }

  if (inviterUserId === userPk) {
    return c.json({ error: '본인이 발급한 초대는 수락할 수 없습니다', error_code: 'SELF_ACCEPT' }, 400);
  }

  const memberRes = await db.execute({
    sql: `SELECT id FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
    args: [planGroupId, userPk],
  });
  if (memberRes.rows.length > 0) {
    return c.json({ error: '이미 해당 그룹 멤버입니다', error_code: 'ALREADY_MEMBER' }, 409);
  }

  const groupRes = await db.execute({
    sql: `SELECT max_members FROM plan_groups WHERE id = ?`,
    args: [planGroupId],
  });
  if (groupRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 그룹입니다', error_code: 'GROUP_NOT_FOUND' }, 404);
  }
  const maxMembers = Number(groupRes.rows[0].max_members) || 6;
  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM plan_group_members WHERE plan_group_id = ?`,
    args: [planGroupId],
  });
  const memberCount = Number(countRes.rows[0].c) || 0;
  if (memberCount >= maxMembers) {
    return c.json({ error: `정원 초과 (최대 ${maxMembers}명)`, error_code: 'GROUP_FULL' }, 409);
  }

  const memberId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
          VALUES (?, ?, ?, 'member')`,
    args: [memberId, planGroupId, userPk],
  });

  await db.execute({
    sql: `UPDATE plan_group_invites
          SET status = 'used', used_by_user_id = ?, used_at = ?
          WHERE id = ? AND status = 'pending'`,
    args: [userPk, now.toISOString(), inviteId],
  });

  return c.json({
    success: true,
    membership: {
      id: memberId,
      plan_group_id: planGroupId,
      user_id: userPk,
      role: 'member',
    },
    invite: { id: inviteId, status: 'used' },
  });
});

familyInvite.post('/invites/:code/revoke', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const code = c.req.param('code').trim();
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
  const invite = inviteRes.rows[0];
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
