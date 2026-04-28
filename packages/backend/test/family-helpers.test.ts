import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDB } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import { resolveUserPk, assertSameGroup } from '../src/lib/family-helpers';

beforeEach(() => {
  mockDB.reset();
});

// ─── resolveUserPk ─────────────────────────────────────────────

describe('resolveUserPk', () => {
  it('returns user PK when user exists', async () => {
    mockDB.pushResult([{ id: 'user-pk-001' }]);
    const pk = await resolveUserPk(mockDB.client as never, 'google-123');
    expect(pk).toBe('user-pk-001');
    expect(mockDB.calls[0].sql).toContain('SELECT id FROM users');
    expect(mockDB.calls[0].args).toEqual(['google-123']);
  });

  it('returns null when user not found', async () => {
    mockDB.pushResult([]);
    const pk = await resolveUserPk(mockDB.client as never, 'unknown');
    expect(pk).toBeNull();
  });

  it('coerces id to string', async () => {
    mockDB.pushResult([{ id: 42 }]);
    const pk = await resolveUserPk(mockDB.client as never, 'google-num');
    expect(pk).toBe('42');
  });
});

// ─── assertSameGroup ───────────────────────────────────────────

describe('assertSameGroup', () => {
  it('returns true when both users share a group', async () => {
    mockDB.pushResult([{ plan_group_id: 'group-A' }]);
    mockDB.pushResult([{ plan_group_id: 'group-A' }]);
    const result = await assertSameGroup(mockDB.client as never, 'sender', 'recipient');
    expect(result).toBe(true);
  });

  it('returns false when sender has no groups', async () => {
    mockDB.pushResult([]);
    const result = await assertSameGroup(mockDB.client as never, 'sender', 'recipient');
    expect(result).toBe(false);
    expect(mockDB.calls).toHaveLength(1);
  });

  it('returns false when groups do not overlap', async () => {
    mockDB.pushResult([{ plan_group_id: 'group-A' }]);
    mockDB.pushResult([{ plan_group_id: 'group-B' }]);
    const result = await assertSameGroup(mockDB.client as never, 'sender', 'recipient');
    expect(result).toBe(false);
  });

  it('returns true with multiple groups where one overlaps', async () => {
    mockDB.pushResult([
      { plan_group_id: 'group-A' },
      { plan_group_id: 'group-B' },
    ]);
    mockDB.pushResult([
      { plan_group_id: 'group-C' },
      { plan_group_id: 'group-B' },
    ]);
    const result = await assertSameGroup(mockDB.client as never, 'sender', 'recipient');
    expect(result).toBe(true);
  });

  it('returns false when recipient has no groups', async () => {
    mockDB.pushResult([{ plan_group_id: 'group-A' }]);
    mockDB.pushResult([]);
    const result = await assertSameGroup(mockDB.client as never, 'sender', 'recipient');
    expect(result).toBe(false);
  });
});
