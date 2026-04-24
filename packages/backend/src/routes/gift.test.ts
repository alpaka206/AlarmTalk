import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDB, createTestApp, jsonReq, type MockDB } from '../test-helper';

const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';

let mockDB: MockDB;
vi.mock('../lib/db', () => ({
  getDB: () => mockDB,
}));

import giftRoutes from './gift';

describe('gift routes', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    mockDB = createMockDB();
    app = createTestApp(giftRoutes, '/gift');
  });

  describe('POST /gift — send gift', () => {
    it('returns 400 + INVALID_EMAIL for invalid email', async () => {
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'bad', message_id: U1 }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('INVALID_EMAIL');
    });

    it('returns 400 + INVALID_EMAIL for empty email', async () => {
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: '', message_id: U1 }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('INVALID_EMAIL');
    });

    it('returns 400 when message_id missing', async () => {
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when message_id is not valid UUID', async () => {
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: 'not-uuid' }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 + NOTE_TOO_LONG when note exceeds 200 chars', async () => {
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', {
          recipient_email: 'a@b.com',
          message_id: U1,
          note: 'x'.repeat(201),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('NOTE_TOO_LONG');
    });

    it('accepts note exactly 200 chars', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id' }] })
        .mockResolvedValueOnce({ rows: [{ id: U2 }] })
        .mockResolvedValueOnce({ rows: [{ id: U1 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', {
          recipient_email: 'a@b.com',
          message_id: U1,
          note: 'x'.repeat(200),
        }),
      );
      expect(res.status).toBe(201);
    });

    it('returns 404 + RECIPIENT_NOT_FOUND when recipient not found', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: U1 }),
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error_code).toBe('RECIPIENT_NOT_FOUND');
    });

    it('returns 400 + SELF_GIFT when gifting to self', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [{ google_id: 'test-user-id' }] });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: U1 }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe('SELF_GIFT');
    });

    it('returns 403 + NOT_FRIENDS when not friends', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id' }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: U1 }),
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error_code).toBe('NOT_FRIENDS');
    });

    it('returns 404 when message not owned by sender', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id' }] })
        .mockResolvedValueOnce({ rows: [{ id: U2 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: U1 }),
      );
      expect(res.status).toBe(404);
    });

    it('creates gift and returns 201 with full response shape', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id' }] })
        .mockResolvedValueOnce({ rows: [{ id: U2 }] })
        .mockResolvedValueOnce({ rows: [{ id: U1 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', {
          recipient_email: 'a@b.com',
          message_id: U1,
          note: 'hello!',
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.gift.id).toBeDefined();
      expect(body.gift.message_id).toBe(U1);
      expect(body.gift.status).toBe('pending');
    });

    it('stores null note when not provided', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ google_id: 'other-id' }] })
        .mockResolvedValueOnce({ rows: [{ id: U2 }] })
        .mockResolvedValueOnce({ rows: [{ id: U1 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 });
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: U1 }),
      );
      expect(res.status).toBe(201);
      const insertArgs = mockDB.execute.mock.calls[3][0].args;
      expect(insertArgs[5]).toBeNull();
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('DB down'));
      const res = await app.request(
        '/gift',
        jsonReq('POST', '/gift', { recipient_email: 'a@b.com', message_id: U1 }),
      );
      expect(res.status).toBe(500);
    });
  });

  describe('GET /gift/received', () => {
    it('returns received gifts with pagination metadata', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: U1, sender_email: 'a@b.com', message_text: 'hi' }],
        });
      const res = await app.request('/gift/received', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gifts).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('returns empty list', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/gift/received', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gifts).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('respects limit and offset params', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 50 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/gift/received?limit=5&offset=10', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
    });

    it('clamps limit to max 100', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/gift/received?limit=999', { method: 'GET' });
      const body = await res.json();
      expect(body.limit).toBe(100);
    });

    it('passes search query to SQL LIKE clauses', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/gift/received?q=hello', { method: 'GET' });
      expect(res.status).toBe(200);
      const countArgs = mockDB.execute.mock.calls[0][0].args;
      expect(countArgs).toContain('%hello%');
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('timeout'));
      const res = await app.request('/gift/received', { method: 'GET' });
      expect(res.status).toBe(500);
    });
  });

  describe('GET /gift/sent', () => {
    it('returns sent gifts with pagination metadata', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: U1, recipient_email: 'a@b.com' }],
        });
      const res = await app.request('/gift/sent', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gifts).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
    });

    it('returns empty sent list', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/gift/sent', { method: 'GET' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.gifts).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('passes search query to LIKE for name, email, and text', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });
      const res = await app.request('/gift/sent?q=test', { method: 'GET' });
      expect(res.status).toBe(200);
      const countSql = mockDB.execute.mock.calls[0][0].sql;
      expect(countSql).toContain('LIKE');
      const countArgs = mockDB.execute.mock.calls[0][0].args;
      expect(countArgs.filter((a: string) => a === '%test%')).toHaveLength(3);
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('DB error'));
      const res = await app.request('/gift/sent', { method: 'GET' });
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /gift/:id/accept', () => {
    it('returns 400 for invalid UUID format', async () => {
      const res = await app.request('/gift/bad-id/accept', { method: 'PATCH' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent pending gift', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      const res = await app.request(`/gift/${U1}/accept`, { method: 'PATCH' });
      expect(res.status).toBe(404);
    });

    it('accepts gift, inserts into message_library, and returns updated gift', async () => {
      const giftRow = { id: U1, sender_id: 'other', recipient_id: 'test-user-id', message_id: U2, status: 'accepted', note: 'hi', created_at: '2026-01-01' };
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ id: U1, message_id: U2 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [giftRow] });
      const res = await app.request(`/gift/${U1}/accept`, { method: 'PATCH' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.gift.status).toBe('accepted');
      expect(body.gift.message_id).toBe(U2);
    });

    it('inserts correct message_id into message_library', async () => {
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ id: U1, message_id: U2 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [{ id: U1, status: 'accepted' }] });
      await app.request(`/gift/${U1}/accept`, { method: 'PATCH' });
      expect(mockDB.execute).toHaveBeenCalledTimes(4);
      const libInsert = mockDB.execute.mock.calls[2][0];
      expect(libInsert.sql).toContain('message_library');
      expect(libInsert.args[1]).toBe('test-user-id');
      expect(libInsert.args[2]).toBe(U2);
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('update failed'));
      const res = await app.request(`/gift/${U1}/accept`, { method: 'PATCH' });
      expect(res.status).toBe(500);
    });
  });

  describe('PATCH /gift/:id/reject', () => {
    it('returns 400 for invalid UUID format', async () => {
      const res = await app.request('/gift/bad-id/reject', { method: 'PATCH' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent pending gift', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      const res = await app.request(`/gift/${U1}/reject`, { method: 'PATCH' });
      expect(res.status).toBe(404);
    });

    it('rejects gift and returns updated status', async () => {
      const giftRow = { id: U1, sender_id: 'other', recipient_id: 'test-user-id', message_id: U2, status: 'rejected', note: null, created_at: '2026-01-01' };
      mockDB.execute
        .mockResolvedValueOnce({ rows: [{ id: U1 }] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [giftRow] });
      const res = await app.request(`/gift/${U1}/reject`, { method: 'PATCH' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.gift.status).toBe('rejected');
    });

    it('only queries pending gifts for current user', async () => {
      mockDB.execute.mockResolvedValueOnce({ rows: [] });
      await app.request(`/gift/${U1}/reject`, { method: 'PATCH' });
      const { sql, args } = mockDB.execute.mock.calls[0][0];
      expect(sql).toContain("status = 'pending'");
      expect(sql).toContain('recipient_id = ?');
      expect(args).toContain('test-user-id');
    });

    it('returns 500 on DB error', async () => {
      mockDB.execute.mockRejectedValueOnce(new Error('reject failed'));
      const res = await app.request(`/gift/${U1}/reject`, { method: 'PATCH' });
      expect(res.status).toBe(500);
    });
  });
});
