import type { Client } from '@libsql/client';

/**
 * 가족 그룹 초대 코드 수락 로직. family-invite.ts 라우트와 통합 코드 등록
 * (routes/code.ts)이 공유하는 단일 출처다. 검증/에러 코드는 기존 라우트와 동일하게
 * 유지한다(클라이언트 에러 매핑 호환).
 */
export class FamilyInviteAcceptError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'FamilyInviteAcceptError';
  }
}

export interface FamilyInviteAcceptResult {
  membership: {
    id: string;
    plan_group_id: string;
    user_id: string;
    role: 'member';
  };
  invite: { id: string; status: 'used' };
}

/**
 * 정규화·포맷 검증이 끝난 초대 코드를 수락한다. 원자적 소비(UPDATE pending→used)와
 * 정원 조건부 INSERT 로 동시 수락 TOCTOU 를 막는 기존 로직을 그대로 옮겼다.
 */
export async function acceptFamilyInvite(
  db: Client,
  params: { userPk: string; code: string },
): Promise<FamilyInviteAcceptResult> {
  const { userPk, code } = params;

  const inviteRes = await db.execute({
    sql: `SELECT id, plan_group_id, inviter_user_id, status, expires_at
          FROM plan_group_invites WHERE code = ?`,
    args: [code],
  });
  if (inviteRes.rows.length === 0) {
    throw new FamilyInviteAcceptError(404, 'INVITE_NOT_FOUND', '해당 초대 코드를 찾을 수 없습니다');
  }
  const invite = inviteRes.rows[0]!;
  const inviteId = String(invite.id);
  const planGroupId = String(invite.plan_group_id);
  const inviterUserId = String(invite.inviter_user_id);
  const status = String(invite.status);

  if (status === 'used') {
    throw new FamilyInviteAcceptError(409, 'CODE_ALREADY_USED', '이미 사용된 초대 코드입니다');
  }
  if (status === 'revoked') {
    throw new FamilyInviteAcceptError(409, 'CODE_REVOKED', '취소된 초대 코드입니다');
  }
  if (status === 'expired') {
    throw new FamilyInviteAcceptError(409, 'CODE_EXPIRED', '만료된 초대 코드입니다');
  }

  const now = new Date();
  const expiresAt = new Date(String(invite.expires_at));
  if (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= now.getTime()) {
    await db.execute({
      sql: `UPDATE plan_group_invites SET status = 'expired' WHERE id = ?`,
      args: [inviteId],
    });
    throw new FamilyInviteAcceptError(409, 'CODE_EXPIRED', '만료된 초대 코드입니다');
  }

  if (inviterUserId === userPk) {
    throw new FamilyInviteAcceptError(400, 'SELF_ACCEPT', '본인이 발급한 초대는 수락할 수 없습니다');
  }

  const memberRes = await db.execute({
    sql: `SELECT id FROM plan_group_members WHERE plan_group_id = ? AND user_id = ?`,
    args: [planGroupId, userPk],
  });
  if (memberRes.rows.length > 0) {
    throw new FamilyInviteAcceptError(409, 'ALREADY_MEMBER', '이미 해당 그룹 멤버입니다');
  }

  const groupRes = await db.execute({
    sql: `SELECT max_members FROM plan_groups WHERE id = ?`,
    args: [planGroupId],
  });
  if (groupRes.rows.length === 0) {
    throw new FamilyInviteAcceptError(404, 'GROUP_NOT_FOUND', '존재하지 않는 그룹입니다');
  }
  const maxMembers = Number(groupRes.rows[0]!.max_members) || 6;
  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM plan_group_members WHERE plan_group_id = ?`,
    args: [planGroupId],
  });
  const memberCount = Number(countRes.rows[0]!.c) || 0;
  if (memberCount >= maxMembers) {
    throw new FamilyInviteAcceptError(409, 'GROUP_FULL', `정원 초과 (최대 ${maxMembers}명)`);
  }

  // 초대를 먼저 원자적으로 소비한다(일회용 보장). SQLite/libSQL 단일 라이터에서
  // pending→used 전환은 동시 수락 중 한 요청만 성공하므로, 유출/공유된 일회용 코드
  // 하나로 여러 명이 가입되는 TOCTOU 를 막는다. 소비 성공자만 좌석 삽입을 진행한다.
  const consumeRes = await db.execute({
    sql: `UPDATE plan_group_invites
          SET status = 'used', used_by_user_id = ?, used_at = ?
          WHERE id = ? AND status = 'pending'`,
    args: [userPk, now.toISOString(), inviteId],
  });
  if ((consumeRes.rowsAffected ?? 0) === 0) {
    throw new FamilyInviteAcceptError(409, 'CODE_ALREADY_USED', '이미 사용된 초대 코드입니다');
  }

  // 좌석을 원자적으로 삽입한다: 정원 미만일 때만 INSERT 되도록 한 문장으로 처리해
  // 동시 수락이 정원을 넘기는 TOCTOU 를 막는다. 삽입이 rowsAffected=0(정원 초과) 이거나
  // 예외(예: 동시 수락으로 UNIQUE(plan_group_id, user_id) 충돌)로 실패하면, 방금 소비한
  // 초대가 헛되이 버려지지 않도록 pending 으로 되돌린 뒤 적절한 오류를 던진다.
  const revertConsumedInvite = () =>
    db.execute({
      sql: `UPDATE plan_group_invites
            SET status = 'pending', used_by_user_id = NULL, used_at = NULL
            WHERE id = ?`,
      args: [inviteId],
    });

  const memberId = crypto.randomUUID();
  let insertRes;
  try {
    insertRes = await db.execute({
      sql: `INSERT INTO plan_group_members (id, plan_group_id, user_id, role)
            SELECT ?, ?, ?, 'member'
            WHERE (SELECT COUNT(*) FROM plan_group_members WHERE plan_group_id = ?) < ?`,
      args: [memberId, planGroupId, userPk, planGroupId, maxMembers],
    });
  } catch (err) {
    await revertConsumedInvite().catch(() => {});
    if (err instanceof Error && /unique constraint/i.test(err.message)) {
      throw new FamilyInviteAcceptError(409, 'ALREADY_MEMBER', '이미 해당 그룹 멤버입니다');
    }
    throw err;
  }
  if ((insertRes.rowsAffected ?? 0) === 0) {
    await revertConsumedInvite();
    throw new FamilyInviteAcceptError(409, 'GROUP_FULL', `정원 초과 (최대 ${maxMembers}명)`);
  }

  return {
    membership: {
      id: memberId,
      plan_group_id: planGroupId,
      user_id: userPk,
      role: 'member',
    },
    invite: { id: inviteId, status: 'used' },
  };
}
