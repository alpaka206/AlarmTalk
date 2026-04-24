import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import familyInviteRoutes from '../src/routes/family-invite';

function buildApp(userId = 'google-owner') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/family', familyInviteRoutes);
  return app;
}

const OWNER_PK = 'owner-pk-001';
const MEMBER_PK = 'member-pk-002';
const OTHER_PK = 'other-pk-003';
const GROUP_ID = 'group-001';
const INVITE_ID = 'invite-001';
const INVITE_CODE = '123456';

function pushResolveUserPk(pk: string | null) {
  mockDB.pushResult(pk ? [{ id: pk }] : []);
}

beforeEach(() => {
  mockDB.reset();
});

// ─── POST /family/invites ───────────────────────────────────────

describe('POST /family/invites', () => {
  const app = buildApp();

  it('creates invite for owned group (auto-resolve)', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID }]); // resolve owned group
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK, max_members: 6 }]);
    mockDB.pushResult([{ member_count: 2, pending_count: 1 }]);
    mockDB.pushResult([], 1); // INSERT

    const res = await app.request(jsonReq('POST', '/family/invites', {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invite).toBeDefined();
    expect(body.invite.plan_group_id).toBe(GROUP_ID);
    expect(body.invite.status).toBe('pending');
    expect(body.invite.code).toBeDefined();
    expect(body.invite.deep_link).toContain('voicealarm://invite/');
    expect(body.invite.web_url).toContain('/invite/');
  });

  it('creates invite with explicit plan_group_id', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK, max_members: 6 }]);
    mockDB.pushResult([{ member_count: 1, pending_count: 0 }]);
    mockDB.pushResult([], 1);

    const res = await app.request(
      jsonReq('POST', '/family/invites', { plan_group_id: GROUP_ID }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invite.plan_group_id).toBe(GROUP_ID);
  });

  it('returns 404 when user not found', async () => {
    pushResolveUserPk(null);

    const res = await app.request(jsonReq('POST', '/family/invites', {}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('returns 404 when no owned group exists', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]); // no owned groups

    const res = await app.request(jsonReq('POST', '/family/invites', {}));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('NO_OWNED_GROUP');
  });

  it('returns 404 when explicit group_id does not exist', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]); // group lookup empty

    const res = await app.request(
      jsonReq('POST', '/family/invites', { plan_group_id: 'nonexistent' }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('GROUP_NOT_FOUND');
  });

  it('returns 403 when user is not group owner', async () => {
    pushResolveUserPk(MEMBER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK, max_members: 6 }]);

    const res = await app.request(
      jsonReq('POST', '/family/invites', { plan_group_id: GROUP_ID }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('OWNER_ONLY');
  });

  it('returns 409 when group is full (members + pending >= max)', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK, max_members: 4 }]);
    mockDB.pushResult([{ member_count: 3, pending_count: 1 }]);

    const res = await app.request(
      jsonReq('POST', '/family/invites', { plan_group_id: GROUP_ID }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('GROUP_FULL');
  });

  it('handles malformed JSON body gracefully', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: GROUP_ID }]); // auto-resolve owned group
    mockDB.pushResult([{ id: GROUP_ID, owner_user_id: OWNER_PK, max_members: 6 }]);
    mockDB.pushResult([{ member_count: 0, pending_count: 0 }]);
    mockDB.pushResult([], 1);

    const req = new Request('http://localhost/family/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await app.request(req);
    expect(res.status).toBe(200);
  });
});

// ─── GET /family/invites ────────────────────────────────────────

describe('GET /family/invites', () => {
  const app = buildApp();

  it('returns invites list for group owner', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([
      {
        id: INVITE_ID,
        plan_group_id: GROUP_ID,
        code: INVITE_CODE,
        status: 'pending',
        created_at: '2026-04-25T00:00:00Z',
        expires_at: '2026-04-25T00:10:00Z',
        used_by_user_id: null,
        used_at: null,
      },
    ]);

    const res = await app.request(new Request('http://localhost/family/invites'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0].id).toBe(INVITE_ID);
    expect(body.invites[0].code).toBe(INVITE_CODE);
    expect(body.invites[0].status).toBe('pending');
    expect(body.invites[0].deep_link).toBe(`voicealarm://invite/${INVITE_CODE}`);
    expect(body.invites[0].web_url).toContain(`/invite/${INVITE_CODE}`);
  });

  it('returns empty array when user not found', async () => {
    pushResolveUserPk(null);

    const res = await app.request(new Request('http://localhost/family/invites'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toEqual([]);
  });

  it('returns empty array when no invites exist', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]);

    const res = await app.request(new Request('http://localhost/family/invites'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toEqual([]);
  });

  it('maps used invite fields correctly', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([
      {
        id: INVITE_ID,
        plan_group_id: GROUP_ID,
        code: INVITE_CODE,
        status: 'used',
        created_at: '2026-04-25T00:00:00Z',
        expires_at: '2026-04-25T00:10:00Z',
        used_by_user_id: MEMBER_PK,
        used_at: '2026-04-25T00:05:00Z',
      },
    ]);

    const res = await app.request(new Request('http://localhost/family/invites'));
    const body = await res.json();
    expect(body.invites[0].status).toBe('used');
    expect(body.invites[0].used_by_user_id).toBe(MEMBER_PK);
    expect(body.invites[0].used_at).toBe('2026-04-25T00:05:00Z');
  });
});

// ─── POST /family/invites/:code/accept ──────────────────────────

describe('POST /family/invites/:code/accept', () => {
  const app = buildApp('google-member');

  function pushValidInvite(overrides: Record<string, unknown> = {}) {
    const future = new Date(Date.now() + 600_000).toISOString();
    mockDB.pushResult([
      {
        id: INVITE_ID,
        plan_group_id: GROUP_ID,
        inviter_user_id: OWNER_PK,
        status: 'pending',
        expires_at: future,
        ...overrides,
      },
    ]);
  }

  it('accepts valid invite and creates membership', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite();
    mockDB.pushResult([]); // not already a member
    mockDB.pushResult([{ max_members: 6 }]); // group lookup
    mockDB.pushResult([{ c: 2 }]); // current member count
    mockDB.pushResult([], 1); // INSERT member
    mockDB.pushResult([], 1); // UPDATE invite

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.membership.plan_group_id).toBe(GROUP_ID);
    expect(body.membership.role).toBe('member');
    expect(body.invite.status).toBe('used');
  });

  it('returns 400 for invalid code format', async () => {
    const res = await app.request(
      jsonReq('POST', '/family/invites/abc/accept'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_CODE_FORMAT');
  });

  it('returns 404 when user not found', async () => {
    pushResolveUserPk(null);

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('returns 404 when invite code does not exist', async () => {
    pushResolveUserPk(MEMBER_PK);
    mockDB.pushResult([]); // no invite

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('INVITE_NOT_FOUND');
  });

  it('returns 409 for already-used invite', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite({ status: 'used' });

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_ALREADY_USED');
  });

  it('returns 409 for revoked invite', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite({ status: 'revoked' });

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_REVOKED');
  });

  it('returns 409 for expired invite (status=expired)', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite({ status: 'expired' });

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_EXPIRED');
  });

  it('returns 409 and marks expired when expires_at is in the past', async () => {
    pushResolveUserPk(MEMBER_PK);
    const past = new Date(Date.now() - 60_000).toISOString();
    pushValidInvite({ expires_at: past });
    mockDB.pushResult([], 1); // UPDATE to expired

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('CODE_EXPIRED');
  });

  it('returns 400 when inviter tries to accept own invite', async () => {
    pushResolveUserPk(OWNER_PK);
    pushValidInvite({ inviter_user_id: OWNER_PK });

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('SELF_ACCEPT');
  });

  it('returns 409 when user is already a group member', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite();
    mockDB.pushResult([{ id: 'existing-membership' }]); // already member

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('ALREADY_MEMBER');
  });

  it('returns 404 when group does not exist at accept time', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite();
    mockDB.pushResult([]); // not already member
    mockDB.pushResult([]); // group not found

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('GROUP_NOT_FOUND');
  });

  it('returns 409 when group is full at accept time', async () => {
    pushResolveUserPk(MEMBER_PK);
    pushValidInvite();
    mockDB.pushResult([]); // not already member
    mockDB.pushResult([{ max_members: 4 }]);
    mockDB.pushResult([{ c: 4 }]); // already at max

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/accept`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('GROUP_FULL');
  });
});

// ─── POST /family/invites/:code/revoke ──────────────────────────

describe('POST /family/invites/:code/revoke', () => {
  const app = buildApp('google-owner');

  it('revokes a pending invite', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: INVITE_ID, inviter_user_id: OWNER_PK, status: 'pending' }]);
    mockDB.pushResult([], 1); // UPDATE

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/revoke`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.invite.status).toBe('revoked');
  });

  it('returns 400 for invalid code format', async () => {
    const res = await app.request(
      jsonReq('POST', '/family/invites/bad!/revoke'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('INVALID_CODE_FORMAT');
  });

  it('returns 404 when user not found', async () => {
    pushResolveUserPk(null);

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/revoke`),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('returns 404 when invite code not found', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([]); // no invite

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/revoke`),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('INVITE_NOT_FOUND');
  });

  it('returns 403 when non-inviter tries to revoke', async () => {
    pushResolveUserPk(OTHER_PK);
    mockDB.pushResult([{ id: INVITE_ID, inviter_user_id: OWNER_PK, status: 'pending' }]);

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/revoke`),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('NOT_INVITER');
  });

  it('returns 409 when invite is not pending', async () => {
    pushResolveUserPk(OWNER_PK);
    mockDB.pushResult([{ id: INVITE_ID, inviter_user_id: OWNER_PK, status: 'used' }]);

    const res = await app.request(
      jsonReq('POST', `/family/invites/${INVITE_CODE}/revoke`),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('NOT_PENDING');
  });
});
