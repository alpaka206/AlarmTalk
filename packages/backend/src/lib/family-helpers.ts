import { getDB } from './db';

export async function resolveUserPk(
  db: ReturnType<typeof getDB>,
  googleId: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [googleId],
  });
  return res.rows.length === 0 ? null : String(res.rows[0]!.id);
}

export async function assertSameGroup(
  db: ReturnType<typeof getDB>,
  senderPk: string,
  recipientPk: string,
): Promise<boolean> {
  const senderGroupRes = await db.execute({
    sql: `SELECT plan_group_id FROM plan_group_members WHERE user_id = ?`,
    args: [senderPk],
  });
  if (senderGroupRes.rows.length === 0) return false;

  const senderGroupIds = new Set(senderGroupRes.rows.map((r) => String(r.plan_group_id)));
  const recipientMemberRes = await db.execute({
    sql: `SELECT plan_group_id FROM plan_group_members WHERE user_id = ?`,
    args: [recipientPk],
  });
  return recipientMemberRes.rows.some((r) => senderGroupIds.has(String(r.plan_group_id)));
}
