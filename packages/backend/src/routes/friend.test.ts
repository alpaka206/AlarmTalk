import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDB, createTestApp, jsonReq, type MockDB } from '../test-helper';

const U1 = '00000000-0000-0000-0000-000000000001';

let mockDB: MockDB;
vi.mock('../lib/db', () => ({
  getDB: () => mockDB,
}));

import friendRoutes from './friend';

describe('friend routes', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    mockDB = createMockDB();
    app = createTestApp(friendRoutes, '/friend');
  });

  describe('POST /friend — send friend request', () => {
    it('returns 400 for invalid email', async () => {
      const res = await app.request('/friend', jsonReq('POST', '/friend', { email: 'bad' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('INVALID_EMAIL');
    });

    it('returns 400 for empty email', async () => {
      const res = await app.request('/friend', jsonReq('POST', '/friend', { email: '' }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('INVALID_EMAIL');
    });

    it('returns 400 for missing email field', async () => {
      const res = await app.request('/friend', jsonReq('POST', '/friend', {}));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('INVALID_EMAIL');
    });

    it('returns 404 when target user not found', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      const res = await app.request(
        '/friend',
        jsonReq('POST', '/friend', { email: 'other@example.com' }),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error_code).toBe('USER_NOT_FOUND');
    });

    it('returns 400 when sending request to self', async () => {
      mockDB.execute.mockResolvedValueOnce({
        rows: [{ google_id: 'test-user-id', email: 'other@example.com', name: 'Other' }],
      });
      const res = await app.request(
        '/friend',
        jsonReq('POST', '/friend', { email: 'other@example.com' }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('SELF_REQUEST');
    });

    it('returns 409 when already friends', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id', email: 'o@e.com', name: 'O' }] })
        .mockResolvedValueOnce({ rows: [{ id: U1, status: 'accepted' }] });
      const res = await app.request('/friend', jsonReq('POST', '/friend', { email: 'o@e.com' }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error_code).toBe('ALREADY_FRIENDS');
    });

    it('returns 409 when request already pending', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id', email: 'o@e.com', name: 'O' }] })
        .mockResolvedValueOnce({ rows: [{ id: U1, status: 'pending' }] });
      const res = await app.request('/friend', jsonReq('POST', '/friend', { email: 'o@e.com' }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error_code).toBe('ALREADY_PENDING');
    });

    it('creates friendship and returns 201 with full response shape', async () => {
      mockDB.execute
        .mockResolvedValueOnce({
          rows: [{ google_id: 'other-id', email: 'o@e.com', name: 'Other' }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [], rowsAffected: 1 });
      const res = await app.request('/friend', jsonReq('POST', '/friend', { email: 'o@e.com' }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.friendship).toMatchObject({
        user_a: 'test-user-id',
        user_b: 'other-id',
        target_email: 'o@e.com',
        target_name: 'Other',
        status: 'pending',
      });
      expect(body.friendship.id).toBeDefined();
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('DB connection failed'));
      const res = await app.request('/friend', jsonReq('POST', '/friend', { email: 'x@y.com' }));
      expect(res.status).toBe(500);
    });
  });

  describe('GET /friend/list — accepted friends', () => {
    it('returns friends list with pagination metadata', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: U1, friend_email: 'a@b.com', friend_name: 'A' }],
        });
      const res = await app.request('/friend/list', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.friends).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('returns empty list when no friends', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/friend/list', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.friends).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('respects limit and offset query params', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 50 }] })
        .mockResolvedValueOnce({ rows: [{ id: U1, friend_email: 'a@b.com' }] });
      const res = await app.request('/friend/list?limit=5&offset=10', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
      const args = mockDB.execute.mock.calls[1][0].args;
      expect(args).toContain(5);
      expect(args).toContain(10);
    });

    it('clamps limit to max 100', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/friend/list?limit=999', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(100);
    });

    it('clamps limit to min 1', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/friend/list?limit=-5', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(1);
    });

    it('passes search query to SQL LIKE clauses', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({ rows: [{ id: U1, friend_name: 'Alice' }] });
      const res = await app.request('/friend/list?q=alice', { method: 'GET' });
      expect(res.status).toBe(200);
      const countArgs = mockDB.execute.mock.calls[0][0].args;
      expect(countArgs).toContain('%alice%');
      const listArgs = mockDB.execute.mock.calls[1][0].args;
      expect(listArgs).toContain('%alice%');
    });

    it('trims whitespace from search query', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/friend/list?q=  ', { method: 'GET' });
      expect(res.status).toBe(200);
      const sql = mockDB.execute.mock.calls[0][0].sql;
      expect(sql).not.toContain('LIKE');
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('timeout'));
      const res = await app.request('/friend/list', { method: 'GET' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /friend/pending — pending requests', () => {
    it('returns pending requests with metadata', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: U1, requester_email: 'a@b.com', requester_name: 'A' }],
        });
      const res = await app.request('/friend/pending', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pending).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('returns empty pending list', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/friend/pending', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pending).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('respects pagination params', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 30 }] })
        .mockResolvedValueOnce({ rows: [{ id: U1 }] });
      const res = await app.request('/friend/pending?limit=10&offset=20', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(20);
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/friend/pending', { method: 'GET' });
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /friend/:id/accept', () => {
    it('returns 400 for invalid UUID format', async () => {
      const res = await app.request('/friend/not-a-uuid/accept', { method: 'PATCH' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when pending request not found', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      const res = await app.request(`/friend/${U1}/accept`, { method: 'PATCH' });
      expect(res.status).toBe(404);
    });

    it('accepts pending request and returns friendship with requester details', async () => {
      const friendship = {
        id: U1,
        user_a: 'other-id',
        user_b: 'test-user-id',
        status: 'accepted',
        name: 'Other User',
        email: 'other@e.com',
        picture: 'https://pic.example.com/other.jpg',
      };
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ id: U1 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [friendship] });
      const res = await app.request(`/friend/${U1}/accept`, { method: 'PATCH' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.friendship.status).toBe('accepted');
      expect(body.friendship.name).toBe('Other User');
      expect(body.friendship.email).toBe('other@e.com');
    });

    it('queries only pending requests for the current user', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      await app.request(`/friend/${U1}/accept`, { method: 'PATCH' });
      const { sql, args } = mockDB.execute.mock.calls[0][0];
      expect(sql).toContain("status = 'pending'");
      expect(args).toContain('test-user-id');
      expect(args).toContain(U1);
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('update failed'));
      const res = await app.request(`/friend/${U1}/accept`, { method: 'PATCH' });
      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /friend/:id', () => {
    it('returns 400 for invalid UUID format', async () => {
      const res = await app.request('/friend/bad-id', { method: 'DELETE' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when friendship not found', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [], rowsAffected: 0 });
      const res = await app.request(`/friend/${U1}`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });

    it('deletes friendship and returns success', async () => {
      mockDB.execute.mockResolvedValueOnce({ rowsAffected: 1 });
      const res = await app.request(`/friend/${U1}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('only deletes friendships where current user is a party', async () => {
      mockDB.execute.mockResolvedValueOnce({ rowsAffected: 0 });
      await app.request(`/friend/${U1}`, { method: 'DELETE' });
      const { sql, args } = mockDB.execute.mock.calls[0][0];
      expect(sql).toContain('user_a = ?');
      expect(sql).toContain('user_b = ?');
      expect(args).toContain('test-user-id');
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('delete failed'));
      const res = await app.request(`/friend/${U1}`, { method: 'DELETE' });
      expect(res.status).toBe(500);
    });
  });
});
