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
import codeRoutes from '../src/routes/code';
import userRoutes from '../src/routes/user';

// 이 스위트는 mock DB 로 라우트 핸들러의 **절대 벽시계 지연**을 assert 한다(회귀 감지용
// 마이크로벤치). 로컬에선 엄격하게 유지하되, 공유 CI 러너는 부하로 6~10배 느려져 정상 코드도
// 임계를 넘겨 플레이크가 된다(타임아웃 상향으로는 안 잡히는 별개 클래스). CI 에서만 배수를
// 곱해 "치명적 회귀만 잡고 부하 노이즈는 흡수"하도록 한다. 로컬(CI 아님) 임계는 그대로.
const CI_LATENCY_FACTOR = process.env.CI ? 8 : 1;
const LATENCY_THRESHOLD_MS = 75 * CI_LATENCY_FACTOR;
const WRITE_LATENCY_THRESHOLD_MS = 80 * CI_LATENCY_FACTOR;

function buildApp(route: string, handler: Hono<AppEnv>, userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route(route, handler);
  return app;
}

function pushMessageBelongsToCaller() {
  mockDB.pushResult([{ '1': 1 }]);
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

beforeEach(() => {
  mockDB.reset();
});

describe('API latency baselines', () => {
  describe('GET /alarm (list)', () => {
    it('responds within threshold with empty list', async () => {
      mockDB.pushResult([{ total: 0 }]); // COUNT
      mockDB.pushResult([]); // data
      const app = buildApp('/alarm', alarmRoutes);
      await app.request(jsonReq('GET', '/alarm'));
      mockDB.pushResult([{ total: 0 }]); // COUNT
      mockDB.pushResult([]); // data
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
      pushMessageBelongsToCaller();
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

  describe('POST /code/register', () => {
    it('resolves an unknown code (invite/promo fallback) within threshold', async () => {
      mockDB.pushResult([{ id: 'pk-1' }]); // user lookup
      const app = buildApp('/code', codeRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(jsonReq('POST', '/code/register', { code: 'INVALID' })),
      );
      // 통합 디스패치: voucher/초대 포맷이 아닌 코드는 프로모 조회까지 간 뒤 404 로 끝난다.
      expect(res.status).toBe(404);
      expect(ms).toBeLessThan(LATENCY_THRESHOLD_MS);
    });
  });

  describe('PATCH /user/me', () => {
    it('responds within write threshold', async () => {
      mockDB.pushResult([], 1);
      const app = buildApp('/user', userRoutes);
      const { res, ms } = await measureLatency(() =>
        app.request(jsonReq('PATCH', '/user/me', { allow_family_alarms: true })),
      );
      expect(res.status).toBe(200);
      expect(ms).toBeLessThan(WRITE_LATENCY_THRESHOLD_MS);
    });
  });

  describe('validation fast-path', () => {
    it('POST /alarm rejects missing required fields within threshold', async () => {
      const app = buildApp('/alarm', alarmRoutes);
      const { res, ms } = await measureLatency(() => app.request(jsonReq('POST', '/alarm', {})));
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
