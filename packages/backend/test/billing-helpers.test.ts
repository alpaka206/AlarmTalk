import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../src/types';
import { createMockDB, fakeAuthMiddleware } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

import {
  planTypeToUserPlan,
  PAID_PLAN_TYPES,
  resolveUserPk,
} from '../src/routes/billing-helpers';

const ENV: Env = {
  PERSO_API_KEY: 'x',
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  JWT_SECRET: 'test-secret-32-chars-or-longer-pls!',
  PASSWORD_PEPPER: 'pepper-test',
  ENVIRONMENT: 'test',
};

function buildApp(userId = 'user-1') {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', fakeAuthMiddleware(userId));
  app.get('/resolve', async (c) => {
    const pk = await resolveUserPk(c as never);
    return c.json({ pk });
  });
  return app;
}

beforeEach(() => {
  mockDB.reset();
});

describe('PAID_PLAN_TYPES', () => {
  it('contains personal and family', () => {
    expect(PAID_PLAN_TYPES.has('personal')).toBe(true);
    expect(PAID_PLAN_TYPES.has('family')).toBe(true);
  });

  it('does not contain free', () => {
    expect(PAID_PLAN_TYPES.has('free')).toBe(false);
  });

  it('has exactly 2 entries', () => {
    expect(PAID_PLAN_TYPES.size).toBe(2);
  });
});

describe('planTypeToUserPlan', () => {
  it('maps family to family', () => {
    expect(planTypeToUserPlan('family')).toBe('family');
  });

  it('maps personal to plus', () => {
    expect(planTypeToUserPlan('personal')).toBe('plus');
  });

  it('maps unknown types to free', () => {
    expect(planTypeToUserPlan('free')).toBe('free');
    expect(planTypeToUserPlan('enterprise')).toBe('free');
    expect(planTypeToUserPlan('')).toBe('free');
  });

  it('maps capitalized variants to free (case-sensitive)', () => {
    expect(planTypeToUserPlan('Family')).toBe('free');
    expect(planTypeToUserPlan('Personal')).toBe('free');
    expect(planTypeToUserPlan('FAMILY')).toBe('free');
  });

  it('maps whitespace-padded strings to free', () => {
    expect(planTypeToUserPlan(' family')).toBe('free');
    expect(planTypeToUserPlan('personal ')).toBe('free');
  });
});

describe('resolveUserPk', () => {
  it('returns user PK when user exists', async () => {
    mockDB.pushResult([{ id: 'pk-42' }]);

    const app = buildApp('google-abc');
    const res = await app.request('/resolve', undefined, ENV);
    const body = await res.json();

    expect(body.pk).toBe('pk-42');
    expect(mockDB.calls[0]!.sql).toContain('SELECT id FROM users');
    expect(mockDB.calls[0]!.args).toEqual(['google-abc']);
  });

  it('returns null when user not found', async () => {
    mockDB.pushResult([]);

    const app = buildApp('nonexistent');
    const res = await app.request('/resolve', undefined, ENV);
    const body = await res.json();

    expect(body.pk).toBeNull();
  });

  it('converts numeric id to string', async () => {
    mockDB.pushResult([{ id: 12345 }]);

    const app = buildApp('user-num');
    const res = await app.request('/resolve', undefined, ENV);
    const body = await res.json();

    expect(body.pk).toBe('12345');
    expect(typeof body.pk).toBe('string');
  });

  it('passes the context userId as google_id query arg', async () => {
    mockDB.pushResult([{ id: 'pk-1' }]);

    const app = buildApp('specific-google-id-999');
    await app.request('/resolve', undefined, ENV);

    expect(mockDB.calls).toHaveLength(1);
    expect(mockDB.calls[0]!.args[0]).toBe('specific-google-id-999');
  });

  it('returns first row when multiple rows exist', async () => {
    mockDB.pushResult([{ id: 'first' }, { id: 'second' }]);

    const app = buildApp('dup-user');
    const res = await app.request('/resolve', undefined, ENV);
    const body = await res.json();

    expect(body.pk).toBe('first');
  });
});
