import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { logRouteError } from '../lib/logger';
import { cancelActiveSubscriptionsForUser } from '../lib/billing-cancel';
import { withWriteTransaction } from '../lib/transactions';

const user = new Hono<AppEnv>();

user.get('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    // userId is the JWT sub (= users.google_id). Auth middleware guarantees
    // the row exists. The legacy INSERT branch (referencing the long-gone
    // firebase_uid column) is removed.
    const result = await db.execute({
      sql: 'SELECT * FROM users WHERE google_id = ?',
      args: [userId],
    });

    if (result.rows.length === 0) {
      return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
    }

    const u = result.rows[0]!;
    const [profileCount, alarmCount] = await Promise.all([
      db.execute({
        sql: 'SELECT COUNT(*) as count FROM voice_profiles WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: 'SELECT COUNT(*) as count FROM alarms WHERE user_id = ?',
        args: [userId],
      }),
      db.execute({
        sql: "UPDATE users SET last_active_at = datetime('now') WHERE google_id = ?",
        args: [userId],
      }),
    ]);

    return c.json({
      user: {
        ...u,
        allow_family_alarms: Number(u.allow_family_alarms ?? 0) === 1,
      },
      stats: {
        voice_profiles: Number(profileCount.rows[0]?.count ?? 0),
        alarms: Number(alarmCount.rows[0]?.count ?? 0),
      },
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to fetch user info', error_code: 'FETCH_USER_FAILED' }, 500);
  }
});

function toBoolFlag(raw: unknown): 0 | 1 | null {
  if (raw === true || raw === 1 || raw === '1' || raw === 'true') return 1;
  if (raw === false || raw === 0 || raw === '0' || raw === 'false') return 0;
  return null;
}

/**
 * PATCH /user/me { allow_family_alarms }
 * 본인 프로필 토글 필드 업데이트. 현재는 allow_family_alarms 만 지원.
 */
user.patch('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const body = await c.req
    .json<{ allow_family_alarms?: unknown; name?: unknown }>()
    .catch(() => ({}));

  const updates: string[] = [];
  const args: (string | number)[] = [];
  let resolvedName: string | null = null;

  if ('name' in body && body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return c.json({ error: 'name 은 문자열이어야 합니다', error_code: 'INVALID_NAME' }, 400);
    }
    const trimmed = body.name.trim();
    if (trimmed.length === 0 || trimmed.length > 30) {
      return c.json({ error: '닉네임은 1~30자여야 합니다', error_code: 'INVALID_NAME_LENGTH' }, 400);
    }
    updates.push('name = ?');
    args.push(trimmed);
    resolvedName = trimmed;
  }

  let resolvedFlag: 0 | 1 | null = null;
  if ('allow_family_alarms' in body && body.allow_family_alarms !== undefined) {
    const flag = toBoolFlag(body.allow_family_alarms);
    if (flag === null) {
      return c.json({ error: 'allow_family_alarms 는 boolean 이어야 합니다', error_code: 'INVALID_BOOLEAN' }, 400);
    }
    updates.push('allow_family_alarms = ?');
    args.push(flag);
    resolvedFlag = flag;
  }

  if (updates.length === 0) {
    return c.json({ error: '변경할 필드가 없습니다', error_code: 'NO_FIELDS_TO_UPDATE' }, 400);
  }

  args.push(userId);
  const result = await db.execute({
    sql: `UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now')
          WHERE google_id = ?`,
    args,
  });
  if (result.rowsAffected === 0) {
    return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);
  }

  return c.json({
    success: true,
    name: resolvedName,
    allow_family_alarms: resolvedFlag === null ? null : resolvedFlag === 1,
  });
});

user.patch('/plan', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const body = await c.req.json<{ plan: 'free' | 'plus' | 'family' }>();

    if (!['free', 'plus', 'family'].includes(body.plan)) {
      return c.json({ error: 'Invalid plan', error_code: 'INVALID_PLAN' }, 400);
    }

    const result = await db.execute({
      sql: `UPDATE users SET plan = ?, updated_at = datetime('now') WHERE google_id = ?`,
      args: [body.plan, userId],
    });

    if (result.rowsAffected === 0) {
      return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);
    }

    return c.json({ success: true, plan: body.plan });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to update plan', error_code: 'UPDATE_PLAN_FAILED' }, 500);
  }
});

user.delete('/me', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  try {
    const userRes = await db.execute({
      sql: `SELECT id FROM users WHERE google_id = ? OR id = ? LIMIT 1`,
      args: [userId, userId],
    });
    const userPk = userRes.rows.length > 0 ? String(userRes.rows[0]!.id) : null;

    await withWriteTransaction(db, async (tx) => {
      if (userPk) {
        const userIds = [userPk, userId];
        await cancelActiveSubscriptionsForUser(tx, userPk);

        await tx.execute({
          sql: `DELETE FROM voucher_redemptions
                WHERE user_id = ?
                   OR voucher_id IN (
                     SELECT id FROM voucher_codes WHERE issuer_user_id = ?
                   )`,
          args: [userPk, userPk],
        });
        await tx.execute({
          sql: `UPDATE voucher_codes
                SET redeemed_by_user_id = NULL
                WHERE redeemed_by_user_id = ?`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM voucher_codes WHERE issuer_user_id = ?`,
          args: [userPk],
        });

        await tx.execute({
          sql: `DELETE FROM plan_group_invites
                WHERE inviter_user_id = ?
                   OR used_by_user_id = ?
                   OR plan_group_id IN (
                     SELECT id FROM plan_groups WHERE owner_user_id = ?
                   )`,
          args: [userPk, userPk, userPk],
        });
        await tx.execute({
          sql: `DELETE FROM plan_group_members WHERE user_id = ?`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM plan_group_members
                WHERE plan_group_id IN (SELECT id FROM plan_groups WHERE owner_user_id = ?)`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM plan_groups WHERE owner_user_id = ?`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM subscriptions WHERE user_id = ?`,
          args: [userPk],
        });

        await tx.execute({
          sql: `DELETE FROM notes WHERE sender_id = ? OR receiver_id = ?`,
          args: [userPk, userPk],
        });
        await tx.execute({
          sql: `DELETE FROM push_tokens WHERE user_id = ?`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM character_xp_logs
                WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM character_stats
                WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM streak_achievements
                WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM characters WHERE user_id = ?`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM voice_speakers
                WHERE upload_id IN (SELECT id FROM voice_uploads WHERE user_id = ?)`,
          args: [userPk],
        });
        await tx.execute({
          sql: `DELETE FROM voice_uploads WHERE user_id = ?`,
          args: [userPk],
        });

        await tx.execute({
          sql: `DELETE FROM generated_audio_assets
                WHERE user_id IN (?, ?)
                   OR voice_profile_id IN (
                     SELECT id FROM voice_profiles WHERE user_id IN (?, ?)
                   )
                   OR message_id IN (
                     SELECT id FROM messages WHERE user_id IN (?, ?)
                   )`,
          args: [...userIds, ...userIds, ...userIds],
        });
        await tx.execute({
          sql: `DELETE FROM alarms
                WHERE user_id IN (?, ?) OR target_user_id IN (?, ?)`,
          args: [...userIds, ...userIds],
        });
        await tx.execute({
          sql: `DELETE FROM message_library
                WHERE user_id IN (?, ?)
                   OR message_id IN (
                     SELECT id FROM messages WHERE user_id IN (?, ?)
                   )`,
          args: [...userIds, ...userIds],
        });
        await tx.execute({
          sql: `DELETE FROM gifts
                WHERE sender_id IN (?, ?)
                   OR recipient_id IN (?, ?)
                   OR message_id IN (
                     SELECT id FROM messages WHERE user_id IN (?, ?)
                   )`,
          args: [...userIds, ...userIds, ...userIds],
        });
        await tx.execute({
          sql: `DELETE FROM messages WHERE user_id IN (?, ?)`,
          args: userIds,
        });
        await tx.execute({
          sql: `DELETE FROM voice_profiles WHERE user_id IN (?, ?)`,
          args: userIds,
        });
        await tx.execute({
          sql: `DELETE FROM friendships
                WHERE user_a IN (?, ?) OR user_b IN (?, ?)`,
          args: [...userIds, ...userIds],
        });
      }

      await tx.execute({
        sql: `DELETE FROM users WHERE id = ? OR google_id = ?`,
        args: [userPk ?? userId, userId],
      });
    });

    return c.json({ success: true });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Failed to delete account', error_code: 'DELETE_ACCOUNT_FAILED' }, 500);
  }
});

user.get('/search', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const q = (c.req.query('q') || '').trim();

  if (q.length < 2) {
    return c.json({ users: [] });
  }

  try {
    const result = await db.execute({
      sql: `SELECT google_id, email, name, picture FROM users
            WHERE google_id != ? AND email LIKE ?
            LIMIT 10`,
      args: [userId, `%${q}%`],
    });

    return c.json({
      users: result.rows.map((r) => ({
        id: r.google_id,
        email: r.email,
        name: r.name,
        picture: r.picture,
      })),
    });
  } catch (err) {
    logRouteError(c, err);
    return c.json({ error: 'Search failed', error_code: 'SEARCH_FAILED' }, 500);
  }
});

export default user;
