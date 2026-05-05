import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import familyGroupRoutes from '../src/routes/family-group';

function buildApp(userId = 'google-owner') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/family', familyGroupRoutes);
  return app;
}

const OWNER_PK = 'owner-pk-001';
const MEMBER_PK = 'member-pk-002';
const GROUP_ID = 'group-001';
const PLAN_ID = 'plan-family';
const MEMBER_ROW_ID = 'pgm-001';
const MEMBER_ROW_ID_2 = 'pgm-002';

function pushResolveUserPk(pk: string | null) {
  mockDB.pushResult(pk ? [{ id: pk }] : []);
}

beforeEach(() => {
  mockDB.reset();
});

// ─── GET /family/groups/current ────────────────────────────────

describe('GET /family/groups/current', () => {
  const app = buildApp();

  it('returns group with members for valid user', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([
      {
        id: GROUP_ID,
        owner_user_id: OWNER_PK,
        plan_id: PLAN_ID,
        max_members: 6,
        created_at: '2026-01-01T00:00:00Z',
        my_role: 'owner',
      },
    ]);
    mockDB.pushResult([
      {
        id: MEMBER_ROW_ID,
        user_id: OWNER_PK,
        role: 'owner',
        joined_at: '2026-01-01T00:00:00Z',
        email: 'owner@test.com',
        name: 'Owner',
        picture: null,
        allow_family_alarms: 1,
      },
      {
        id: MEMBER_ROW_ID_2,
        user_id: MEMBER_PK,
        role: 'member',
        joined_at: '2026-01-02T00:00:00Z',
        email: 'member@test.com',
        name: 'Member',
        picture: 'https://pic.example.com/m.jpg',
        allow_family_alarms: 0,
      },
    ]);

    const res = await app.request('/family/groups/current');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.group).toEqual({
      id: GROUP_ID,
      owner_user_id: OWNER_PK,
      plan_id: PLAN_ID,
      max_members: 6,
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(data.role).toBe('owner');
    expect(data.members).toHaveLength(2);
    expect(data.members[0].user_id).toBe(OWNER_PK);
    expect(data.members[0].allow_family_alarms).toBe(true);
    expect(data.members[1].user_id).toBe(MEMBER_PK);
    expect(data.members[1].allow_family_alarms).toBe(false);
    expect(data.members[1].picture).toBe('https://pic.example.com/m.jpg');
  });

  it('returns null group when user not found in DB', async () => {
    pushResolveUserPk(null);

    const res = await app.request('/family/groups/current');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.group).toBeNull();
    expect(data.members).toEqual([]);
    expect(data.role).toBeNull();
  });

  it('returns null group when user has no memberships', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]);

    const res = await app.request('/family/groups/current');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.group).toBeNull();
    expect(data.members).toEqual([]);
    expect(data.role).toBeNull();
  });

  it('repairs family voucher subscription without membership and returns the linked group', async () => {
    pushResolveUserPk(MEMBER_PK);
    mockDB.pushResult([]); // initial current group lookup
    mockDB.pushResult([
      {
        subscription_id: 'sub-member',
        plan_id: PLAN_ID,
        plan_type: 'family',
        max_members: 2,
        issuer_subscription_id: 'sub-owner',
        issuer_user_id: OWNER_PK,
      },
    ]);
    mockDB.pushResult([{ id: GROUP_ID, max_members: 2 }]); // issuer subscription group
    mockDB.pushResult([]); // existing member lookup
    mockDB.pushResult([{ c: 1 }]); // member count
    mockDB.pushResult([], 1); // INSERT plan_group_members
    mockDB.pushResult([], 1); // UPDATE subscription.plan_group_id
    mockDB.pushResult([
      {
        id: GROUP_ID,
        owner_user_id: OWNER_PK,
        plan_id: PLAN_ID,
        max_members: 2,
        created_at: '2026-01-01T00:00:00Z',
        my_role: 'member',
      },
    ]);
    mockDB.pushResult([
      {
        id: MEMBER_ROW_ID,
        user_id: OWNER_PK,
        role: 'owner',
        joined_at: '2026-01-01T00:00:00Z',
        email: 'owner@test.com',
        name: 'Owner',
        picture: null,
        allow_family_alarms: 1,
      },
      {
        id: MEMBER_ROW_ID_2,
        user_id: MEMBER_PK,
        role: 'member',
        joined_at: '2026-01-02T00:00:00Z',
        email: 'member@test.com',
        name: 'Member',
        picture: null,
        allow_family_alarms: 0,
      },
    ]);

    const res = await app.request('/family/groups/current');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.group.id).toBe(GROUP_ID);
    expect(data.role).toBe('member');
    expect(data.members).toHaveLength(2);

    const insertMember = mockDB.calls.find((c) => c.sql.includes('INSERT INTO plan_group_members'));
    expect(insertMember?.args[1]).toBe(GROUP_ID);
    expect(insertMember?.args[2]).toBe(MEMBER_PK);
    const updateSubscription = mockDB.calls.find((c) => c.sql.includes('UPDATE subscriptions SET plan_group_id'));
    expect(updateSubscription?.args).toEqual([GROUP_ID, 'sub-member']);
  });

  it('maps null email/name/picture to null', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([
      {
        id: GROUP_ID,
        owner_user_id: OWNER_PK,
        plan_id: PLAN_ID,
        max_members: 4,
        created_at: '2026-01-01T00:00:00Z',
        my_role: 'member',
      },
    ]);
    mockDB.pushResult([
      {
        id: MEMBER_ROW_ID,
        user_id: MEMBER_PK,
        role: 'member',
        joined_at: '2026-01-01T00:00:00Z',
        email: null,
        name: null,
        picture: null,
        allow_family_alarms: null,
      },
    ]);

    const res = await app.request('/family/groups/current');
    const data = await res.json();
    expect(data.members[0].email).toBeNull();
    expect(data.members[0].name).toBeNull();
    expect(data.members[0].picture).toBeNull();
    expect(data.members[0].allow_family_alarms).toBe(false);
  });
});

// ─── POST /family/groups/:groupId/leave ────────────────────────

describe('POST /family/groups/:groupId/leave', () => {
  const app = buildApp('google-member');

  it('member leaves group successfully', async () => {
    pushResolveUserPk(MEMBER_PK);
    mockDB.pushResult([{ id: MEMBER_ROW_ID, role: 'member' }]);
    mockDB.pushResult([], 1);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/leave`),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.left_group_id).toBe(GROUP_ID);
    const delCall = mockDB.calls.find((c) => c.sql.includes('DELETE'));
    expect(delCall).toBeDefined();
    expect(delCall!.args).toContain(MEMBER_ROW_ID);
  });

  it('returns 404 USER_NOT_FOUND when user not in DB', async () => {
    pushResolveUserPk(null);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/leave`),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error_code).toBe('USER_NOT_FOUND');
  });

  it('returns 403 NOT_MEMBER when user is not in the group', async () => {
    pushResolveUserPk(MEMBER_PK);
    mockDB.pushResult([]);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/leave`),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_code).toBe('NOT_MEMBER');
  });

  it('returns 409 OWNER_CANNOT_LEAVE when user is owner', async () => {
    pushResolveUserPk(MEMBER_PK);
    mockDB.pushResult([{ id: MEMBER_ROW_ID, role: 'owner' }]);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/leave`),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error_code).toBe('OWNER_CANNOT_LEAVE');
  });
});

// ─── POST /family/groups/:groupId/transfer-ownership ───────────

describe('POST /family/groups/:groupId/transfer-ownership', () => {
  const app = buildApp();

  function pushOwnerSetup() {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK }]);
  }

  it('transfers ownership successfully', async () => {
    pushOwnerSetup();
    mockDB.pushResult([{ id: MEMBER_ROW_ID_2, role: 'member' }]);
    mockDB.pushResult([], 1); // demote old owner
    mockDB.pushResult([], 1); // promote new owner
    mockDB.pushResult([], 1); // update plan_groups

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: MEMBER_PK,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.group.owner_user_id).toBe(MEMBER_PK);
    expect(data.group.previous_owner_user_id).toBe(OWNER_PK);
    expect(data.group.id).toBe(GROUP_ID);

    const updates = mockDB.calls.filter((c) => c.sql.includes('UPDATE'));
    expect(updates).toHaveLength(3);
  });

  it('returns 400 TARGET_REQUIRED when target_user_id missing', async () => {
    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {}),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('TARGET_REQUIRED');
  });

  it('returns 400 TARGET_REQUIRED for empty string target', async () => {
    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: '   ',
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('TARGET_REQUIRED');
  });

  it('returns 400 TARGET_REQUIRED for non-string target', async () => {
    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: 12345,
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('TARGET_REQUIRED');
  });

  it('returns 400 TARGET_REQUIRED for malformed JSON body', async () => {
    const req = new Request(
      `http://localhost/family/groups/${GROUP_ID}/transfer-ownership`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json',
      },
    );
    const res = await app.request(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('TARGET_REQUIRED');
  });

  it('returns 404 USER_NOT_FOUND when user not in DB', async () => {
    pushResolveUserPk(null);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: MEMBER_PK,
      }),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error_code).toBe('USER_NOT_FOUND');
  });

  it('returns 400 SELF_TRANSFER when target is self', async () => {
    pushResolveUserPk(OWNER_PK);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: OWNER_PK,
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('SELF_TRANSFER');
  });

  it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: MEMBER_PK,
      }),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error_code).toBe('GROUP_NOT_FOUND');
  });

  it('returns 403 OWNER_ONLY when non-owner tries to transfer', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: 'someone-else' }]);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: MEMBER_PK,
      }),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_code).toBe('OWNER_ONLY');
  });

  it('returns 400 TARGET_NOT_MEMBER when target is not in group', async () => {
    pushOwnerSetup();
    mockDB.pushResult([]);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: MEMBER_PK,
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('TARGET_NOT_MEMBER');
  });

  it('trims whitespace from target_user_id', async () => {
    pushOwnerSetup();
    mockDB.pushResult([{ id: MEMBER_ROW_ID_2, role: 'member' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);
    mockDB.pushResult([], 1);

    const res = await app.request(
      jsonReq('POST', `/family/groups/${GROUP_ID}/transfer-ownership`, {
        target_user_id: `  ${MEMBER_PK}  `,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.group.owner_user_id).toBe(MEMBER_PK);
  });
});

// ─── DELETE /family/groups/:groupId/members/:userId ────────────

describe('DELETE /family/groups/:groupId/members/:userId', () => {
  const app = buildApp();

  function pushOwnerGroupSetup() {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK }]);
  }

  it('removes member successfully', async () => {
    pushOwnerGroupSetup();
    mockDB.pushResult([{ id: MEMBER_ROW_ID_2, role: 'member' }]);
    mockDB.pushResult([], 1);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${MEMBER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.removed_user_id).toBe(MEMBER_PK);
    const delCall = mockDB.calls.find((c) => c.sql.includes('DELETE'));
    expect(delCall).toBeDefined();
    expect(delCall!.args).toContain(MEMBER_ROW_ID_2);
  });

  it('returns 404 USER_NOT_FOUND when executor not in DB', async () => {
    pushResolveUserPk(null);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${MEMBER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error_code).toBe('USER_NOT_FOUND');
  });

  it('returns 404 GROUP_NOT_FOUND when group does not exist', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${MEMBER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error_code).toBe('GROUP_NOT_FOUND');
  });

  it('returns 403 OWNER_ONLY when non-owner tries to remove', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: 'someone-else' }]);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${MEMBER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error_code).toBe('OWNER_ONLY');
  });

  it('returns 400 SELF_REMOVE when owner tries to remove self', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK }]);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${OWNER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('SELF_REMOVE');
  });

  it('returns 404 TARGET_NOT_MEMBER when target not in group', async () => {
    pushOwnerGroupSetup();
    mockDB.pushResult([]);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${MEMBER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error_code).toBe('TARGET_NOT_MEMBER');
  });

  it('returns 400 CANNOT_REMOVE_OWNER when target is owner', async () => {
    const OTHER_OWNER_PK = 'other-owner-pk';
    pushOwnerGroupSetup();
    mockDB.pushResult([{ id: MEMBER_ROW_ID_2, role: 'owner' }]);

    const res = await app.request(
      new Request(
        `http://localhost/family/groups/${GROUP_ID}/members/${OTHER_OWNER_PK}`,
        { method: 'DELETE' },
      ),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe('CANNOT_REMOVE_OWNER');
  });
});
