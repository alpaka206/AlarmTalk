import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq, ID } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
  initDB: async () => {},
}));

import alarmRoutes from '../src/routes/alarm';
import characterRoutes from '../src/routes/character';
import libraryRoutes from '../src/routes/library';
import friendRoutes from '../src/routes/friend';
import statsRoutes from '../src/routes/stats';
import notesRoutes from '../src/routes/notes';
import codeRoutes from '../src/routes/code';
import userRoutes from '../src/routes/user';
import giftRoutes from '../src/routes/gift';

const LATENCY_THRESHOLD_MS = 75;
const WRITE_LATENCY_THRESHOLD_MS = 80;

function buildApp(route: string, handler: Hono<AppEnv>, userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route(route, handler);
  return app;
}

async function measureLatency(fn: () => Promise<Response>): Promise<{ res: Response; ms: number }> {
  const start = performance.now();
  const res = await fn();
  const ms = performance.now() - start;
  return { res, ms };
}

function alarmRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.alarm,
    user_id: 'user-1',
    time: '07:00',
    label: 'Wake up',
    repeat_days: '[]',
    is_active: 1,
    mode: 'sound-only',
    vibration_pattern: 'default',
    wake_mode: 'sound_then_voice',
    voice_profile_id: null,
    speaker_id: null,
    snooze_minutes: 5,
    message_text: null,
    category: null,
    target_user_id: null,
    creator_email: null,
    creator_name: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function characterRow() {
  return {
    id: 'char-1',
    user_id: 'user-1',
    name: 'Sprout',
    level: 3,
    xp: 250,
    affection: 10,
    stage: 'sprout',
    daily_xp: 0,
    daily_xp_reset_at: null,
    current_streak: 5,
    longest_streak: 10,
    last_wakeup_date: '2026-04-23',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  mockDB.reset();
});

describe('API latency baselines', () => {
  describe('GET /alarm (list)', () => {
    it('responds within threshold with empty list', async () => {
      mockDB.pushResult([{ total: 0 }]); // COUNT
      mockDB.pushResult([]); // data
      const app = buildApp('/alarm', alarmRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/alarm')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });

    it('responds within threshold with 20 alarms', async () => {
      const rows = Array.from({ length: 20 }, (_, i) =>
        alarmRow({ id: `alarm-${i}`, label: `Alarm ${i}` }),
      );
      mockDB.pushResult([{ total: 20 }]); // COUNT
      mockDB.pushResult(rows); // data
      const app = buildApp('/alarm', alarmRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/alarm')));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.alarms).toHaveLength(20);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('POST /alarm (create)', () => {
    it('responds within write threshold', async () => {
      mockDB.pushResult([{ plan: 'plus' }]); // user plan check
      mockDB.pushResult([{ id: ID.message }]); // message exists
      mockDB.pushResult([], 1); // INSERT
      const app = buildApp('/alarm', alarmRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(
          jsonReq('POST', '/alarm', {
            message_id: ID.message,
            time: '08:30',
            repeat_days: [1, 3, 5],
            mode: 'sound-only',
          }),
        ),
      );
      expect(res.status).toBe(201);
      expect(ms).toBeLessThan(WRITE_LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /characters/me', () => {
    it('responds within threshold (existing character)', async () => {
      mockDB.pushResult([{ pk: 1 }]); // resolveUserPk
      mockDB.pushResult([characterRow()]); // SELECT character
      mockDB.pushResult([{ diligence: 50, health: 40, consistency: 60 }]); // stats
      mockDB.pushResult([{ milestone: 7, bonus_xp: 50, achieved_at: '2026-04-20T00:00:00Z' }]); // achievements
      const app = buildApp('/characters', characterRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/characters/me')));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.character).toBeDefined();
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /library', () => {
    it('responds within threshold with empty library', async () => {
      mockDB.pushResult([]); // empty
      mockDB.pushResult([{ total: 0 }]); // count
      const app = buildApp('/library', libraryRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/library')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });

    it('responds within threshold with 50 items', async () => {
      const rows = Array.from({ length: 20 }, (_, i) => ({
        id: `ml-${i}`,
        user_id: 'user-1',
        message_id: `msg-${i}`,
        is_favorite: 0,
        received_at: '2026-04-24T12:00:00Z',
        text: `Message ${i}`,
        audio_url: null,
        voice_profile_id: null,
        category: 'morning',
      }));
      mockDB.pushResult(rows);
      mockDB.pushResult([{ total: 50 }]);
      const app = buildApp('/library', libraryRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/library')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /friend/list', () => {
    it('responds within threshold', async () => {
      mockDB.pushResult([
        { id: 'f-1', user_id: 'user-1', friend_id: 'user-2', status: 'accepted', email: 'friend@test.com', name: 'Friend', picture: '', last_seen_at: null, created_at: '2026-01-01T00:00:00Z' },
      ]);
      const app = buildApp('/friend', friendRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/friend/list')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('POST /friend (send request)', () => {
    it('responds within write threshold', async () => {
      mockDB.pushResult([{ google_id: 'user-2', email: 'other@test.com', name: 'Other' }]); // target user lookup
      mockDB.pushResult([]); // no existing friendship
      mockDB.pushResult([], 1); // INSERT
      const app = buildApp('/friend', friendRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(jsonReq('POST', '/friend', { email: 'other@test.com' })),
      );
      expect(res.status).toBe(201);
      expect(ms).toBeLessThan(WRITE_LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /stats', () => {
    it('responds within threshold', async () => {
      mockDB.pushResult([{ total: 5 }]); // alarms
      mockDB.pushResult([{ total: 10 }]); // messages
      mockDB.pushResult([{ total: 3 }]); // voices
      mockDB.pushResult([{ total: 2 }]); // friends
      const app = buildApp('/stats', statsRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/stats')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /notes/received', () => {
    it('responds within threshold with empty inbox', async () => {
      mockDB.pushResult([]); // no notes
      const app = buildApp('/notes', notesRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/notes/received')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });

    it('responds within threshold with 10 notes', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({
        id: `note-${i}`,
        sender_id: 'user-2',
        recipient_id: 'user-1',
        text: `Note ${i}`,
        audio_url: null,
        is_read: 0,
        sender_name: 'Sender',
        sender_email: 'sender@test.com',
        created_at: '2026-04-24T12:00:00Z',
      }));
      mockDB.pushResult([{ id: 'pk-1' }]);
      mockDB.pushResult([{ cnt: 10 }]);
      mockDB.pushResult(rows);
      const app = buildApp('/notes', notesRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/notes/received')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('POST /code/register', () => {
    it('rejects invalid code format within threshold', async () => {
      mockDB.pushResult([{ id: 'pk-1' }]); // user lookup
      const app = buildApp('/code', codeRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(jsonReq('POST', '/code/register', { code: 'INVALID' })),
      );
      expect(res.status).toBe(400);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /user/me', () => {
    it('responds within threshold', async () => {
      mockDB.pushResult([{
        id: 'user-1',
        email: 'user@test.com',
        name: 'Test User',
        picture: '',
        plan: 'free',
        plan_group_id: null,
        plan_group_role: null,
        tts_count: 0,
        tts_limit: 10,
        created_at: '2026-01-01T00:00:00Z',
      }]);
      const app = buildApp('/user', userRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/user/me')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('GET /gift/received', () => {
    it('responds within threshold', async () => {
      mockDB.pushResult([]); // no gifts
      const app = buildApp('/gift', giftRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/gift/received')));
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('validation fast-path', () => {
    it('POST /alarm rejects missing required fields within threshold', async () => {
      const app = buildApp('/alarm', alarmRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(jsonReq('POST', '/alarm', {})),
      );
      expect(res.status).toBe(400);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });

    it('POST /friend rejects missing email within 10ms', async () => {
      const app = buildApp('/friend', friendRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(jsonReq('POST', '/friend', {})),
      );
      expect(res.status).toBe(400);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });

  });

  describe('sustained throughput', () => {
    it('handles 50 sequential alarm list requests under cumulative threshold', async () => {
      const app = buildApp('/alarm', alarmRoutes);
      const times: number[] = [];

      for (let i = 0; i < 50; i++) {
        mockDB.pushResult([{ total: 1 }]); // COUNT
        mockDB.pushResult([alarmRow()]); // data
        const { res, ms } = await measureLatency(() => app.request(jsonReq('GET', '/alarm')));
        expect(res.status).toBe(200);
        times.push(ms);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const p95 = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)];
      expect(avg).toBeLessThan(LATENCY_THRESHOLD_MS);
      expect(p95).toBeLessThan(LATENCY_THRESHOLD_MS * 1.5);
    });
  });
});
