import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { resolveUserPk } from '../lib/family-helpers';

const familyGroup = new Hono<AppEnv>();

familyGroup.get('/groups/current', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ group: null, members: [], role: null });

  const groupRes = await db.execute({
    sql: `SELECT pg.id, pg.owner_user_id, pg.plan_id, pg.max_members, pg.created_at,
                 m.role AS my_role
          FROM plan_group_members m
          JOIN plan_groups pg ON pg.id = m.plan_group_id
          WHERE m.user_id = ?
          ORDER BY m.joined_at DESC
          LIMIT 1`,
    args: [userPk],
  });
  if (groupRes.rows.length === 0) {
    return c.json({ group: null, members: [], role: null });
  }
  const g = groupRes.rows[0];
  const groupId = String(g.id);

  const membersRes = await db.execute({
    sql: `SELECT m.id, m.user_id, m.role, m.joined_at,
                 u.email, u.name, u.picture, u.allow_family_alarms
          FROM plan_group_members m
          LEFT JOIN users u ON u.id = m.user_id
          WHERE m.plan_group_id = ?
          ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.joined_at ASC`,
    args: [groupId],
  });

  return c.json({
    group: {
      id: groupId,
      owner_user_id: String(g.owner_user_id),
      plan_id: String(g.plan_id),
      max_members: Number(g.max_members),
      created_at: String(g.created_at),
    },
    role: String(g.my_role),
    members: membersRes.rows.map((r) => ({
      id: String(r.id),
      user_id: String(r.user_id),
      role: String(r.role),
      joined_at: String(r.joined_at),
      email: (r.email as string | null) ?? null,
      name: (r.name as string | null) ?? null,
      picture: (r.picture as string | null) ?? null,
      allow_family_alarms: Number(r.allow_family_alarms ?? 0) === 1,
    })),
  });
});

familyGroup.post('/groups/:groupId/leave', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const groupId = c.req.param('groupId');

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const memberRes = await db.execute({
    sql: `SELECT id, role FROM plan_group_members
          WHERE plan_group_id = ? AND user_id = ?`,
    args: [groupId, userPk],
  });
  if (memberRes.rows.length === 0) {
    return c.json({ error: '해당 그룹의 멤버가 아닙니다', error_code: 'NOT_MEMBER' }, 403);
  }
  const myRole = String(memberRes.rows[0].role);
  if (myRole === 'owner') {
    return c.json(
      { error: '소유자는 탈퇴할 수 없습니다. 먼저 권한을 양도하거나 그룹을 해체하세요', error_code: 'OWNER_CANNOT_LEAVE' },
      409,
    );
  }

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE id = ?`,
    args: [String(memberRes.rows[0].id)],
  });

  return c.json({ success: true, left_group_id: groupId });
});

familyGroup.post('/groups/:groupId/transfer-ownership', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const groupId = c.req.param('groupId');

  const body = await c.req
    .json<{ target_user_id?: unknown }>()
    .catch(() => ({ target_user_id: undefined }));
  const targetUserId =
    typeof body.target_user_id === 'string' ? body.target_user_id.trim() : '';
  if (!targetUserId) {
    return c.json({ error: 'target_user_id 는 필수입니다', error_code: 'TARGET_REQUIRED' }, 400);
  }

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  if (targetUserId === userPk) {
    return c.json({ error: '자기 자신에게는 양도할 수 없습니다', error_code: 'SELF_TRANSFER' }, 400);
  }

  const groupRes = await db.execute({
    sql: `SELECT id, owner_user_id FROM plan_groups WHERE id = ?`,
    args: [groupId],
  });
  if (groupRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 그룹입니다', error_code: 'GROUP_NOT_FOUND' }, 404);
  }
  if (String(groupRes.rows[0].owner_user_id) !== userPk) {
    return c.json({ error: '그룹 소유자만 양도할 수 있습니다', error_code: 'OWNER_ONLY' }, 403);
  }

  const targetMemberRes = await db.execute({
    sql: `SELECT id, role FROM plan_group_members
          WHERE plan_group_id = ? AND user_id = ?`,
    args: [groupId, targetUserId],
  });
  if (targetMemberRes.rows.length === 0) {
    return c.json({ error: '대상이 해당 그룹의 멤버가 아닙니다', error_code: 'TARGET_NOT_MEMBER' }, 400);
  }

  await db.execute({
    sql: `UPDATE plan_group_members SET role = 'member'
          WHERE plan_group_id = ? AND user_id = ?`,
    args: [groupId, userPk],
  });
  await db.execute({
    sql: `UPDATE plan_group_members SET role = 'owner'
          WHERE plan_group_id = ? AND user_id = ?`,
    args: [groupId, targetUserId],
  });
  await db.execute({
    sql: `UPDATE plan_groups SET owner_user_id = ?, updated_at = datetime('now')
          WHERE id = ?`,
    args: [targetUserId, groupId],
  });

  return c.json({
    success: true,
    group: {
      id: groupId,
      owner_user_id: targetUserId,
      previous_owner_user_id: userPk,
    },
  });
});

familyGroup.delete('/groups/:groupId/members/:userId', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const groupId = c.req.param('groupId');
  const targetUserId = c.req.param('userId');

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const groupRes = await db.execute({
    sql: `SELECT id, owner_user_id FROM plan_groups WHERE id = ?`,
    args: [groupId],
  });
  if (groupRes.rows.length === 0) {
    return c.json({ error: '존재하지 않는 그룹입니다', error_code: 'GROUP_NOT_FOUND' }, 404);
  }
  if (String(groupRes.rows[0].owner_user_id) !== userPk) {
    return c.json({ error: '그룹 소유자만 멤버를 제거할 수 있습니다', error_code: 'OWNER_ONLY' }, 403);
  }
  if (targetUserId === userPk) {
    return c.json({ error: '자기 자신은 제거할 수 없습니다 (탈퇴·양도 사용)', error_code: 'SELF_REMOVE' }, 400);
  }

  const targetRes = await db.execute({
    sql: `SELECT id, role FROM plan_group_members
          WHERE plan_group_id = ? AND user_id = ?`,
    args: [groupId, targetUserId],
  });
  if (targetRes.rows.length === 0) {
    return c.json({ error: '대상이 해당 그룹의 멤버가 아닙니다', error_code: 'TARGET_NOT_MEMBER' }, 404);
  }
  if (String(targetRes.rows[0].role) === 'owner') {
    return c.json({ error: 'owner 는 제거할 수 없습니다', error_code: 'CANNOT_REMOVE_OWNER' }, 400);
  }

  await db.execute({
    sql: `DELETE FROM plan_group_members WHERE id = ?`,
    args: [String(targetRes.rows[0].id)],
  });

  return c.json({ success: true, removed_user_id: targetUserId });
});

export default familyGroup;
