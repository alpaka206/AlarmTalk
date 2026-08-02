// 동의 철회로 알람이 강등되면 그 기기에 알람 동기화 신호가 나가는지 고정한다.
//
// deleteSensitiveVoiceDataForUser 는 강등된 알람을 돌려주는데, 호출부가 그 반환값을 흘려보내면
// 서버는 수신자의 가족알람을 sound-only 로 내리고 R2 오브젝트까지 지웠는데도 수신자는 캐시된
// 녹음으로 계속 울린다(다음 폴백 pull 까지). 실제로 보관 만료 스윕에서 한 번, 이 동의 철회
// 경로에서 또 한 번 같은 식으로 빠졌다(Codex #654).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

const notifyDowngradedAlarms = vi.fn();
vi.mock('../src/lib/fcm', () => ({
  notifyDowngradedAlarms: (...args: unknown[]) => notifyDowngradedAlarms(...args),
}));

import userRoutes from '../src/routes/user';
import { CURRENT_POLICY_VERSION } from '../src/lib/consent';

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware('user-1'));
  app.route('/user', userRoutes);
  return app;
}

const originalExecute = mockDB.client.execute;

beforeEach(() => {
  mockDB.reset();
  mockDB.client.execute = originalExecute;
  notifyDowngradedAlarms.mockClear();
});

/** 강등 대상 조회에만 행을 돌려주는 스텁 — FIFO 순서에 기대지 않는다. */
function stubDowngradeTarget(
  row: { id: string; owner_user_id: string; is_received: number } | null,
) {
  const base = mockDB.client.execute;
  mockDB.client.execute = (async (q: { sql: string; args: (string | number | null)[] }) => {
    if (row && /COALESCE\(target_user_id, user_id\)/.test(q.sql) && /WHERE message_id IN/.test(q.sql)) {
      return { rows: [row], rowsAffected: 0 };
    }
    return base(q);
  }) as typeof mockDB.client.execute;
}

describe('POST /user/consents — 민감 동의 철회', () => {
  it('강등된 알람의 주인에게 알람 동기화 신호를 보낸다', async () => {
    stubDowngradeTarget({ id: 'al-1', owner_user_id: 'recipient', is_received: 1 });
    const app = buildApp();

    const res = await app.request(
      jsonReq('POST', '/user/consents', {
        document_version: CURRENT_POLICY_VERSION,
        consents: [{ type: 'voice_biometric', agreed: false }],
      }),
      undefined,
      {} as AppEnv['Bindings'],
    );

    expect(res.status).toBe(200);
    expect(notifyDowngradedAlarms).toHaveBeenCalledTimes(1);
    // 울리는 기기의 주인은 target_user_id(수신자)다.
    expect(notifyDowngradedAlarms.mock.calls[0]![2]).toEqual([
      { alarmId: 'al-1', ownerUserId: 'recipient', isReceived: true },
    ]);
  });

  /**
   * 서버에 아직 동기화되지 않은 로컬 알람은 정리 대상 조회에 안 잡힌다. 발사는 로컬이고
   * 울림 시점 동의 게이트도 없으니, 알람 행을 못 찾아도 그 계정에는 접근권 상실을 알려야
   * 한다 — 아니면 그 기기는 지워진 녹음으로 계속 울린다(Codex #654).
   */
  it('강등할 알람 행이 없어도 철회한 계정에는 접근권 상실을 알린다', async () => {
    const app = buildApp();

    const res = await app.request(
      jsonReq('POST', '/user/consents', {
        document_version: CURRENT_POLICY_VERSION,
        consents: [{ type: 'voice_biometric', agreed: false }],
      }),
      undefined,
      {} as AppEnv['Bindings'],
    );

    expect(res.status).toBe(200);
    expect(notifyDowngradedAlarms.mock.calls[0]![2]).toEqual([]);
    expect(notifyDowngradedAlarms.mock.calls[0]![3]).toEqual(['user-1']);
  });

  /**
   * 같은 유형이 여러 번 오면 마지막 값이 유효 동의다(GET /consents 규칙). 'false 가 하나라도
   * 있으면'으로 보면 [false, true] 처럼 결국 동의한 요청에도 민감 음성 데이터를 되돌릴 수
   * 없게 지워 버린다(Codex #654).
   */
  it('같은 유형이 중복되면 마지막 값으로 철회를 판정한다', async () => {
    const app = buildApp();

    const res = await app.request(
      jsonReq('POST', '/user/consents', {
        document_version: CURRENT_POLICY_VERSION,
        consents: [
          { type: 'voice_biometric', agreed: false },
          { type: 'voice_biometric', agreed: true },
        ],
      }),
      undefined,
      {} as AppEnv['Bindings'],
    );

    expect(res.status).toBe(200);
    // 최종값이 동의이므로 삭제도 신호도 없어야 한다.
    expect(notifyDowngradedAlarms.mock.calls[0]![3]).toEqual([]);
    const deletedProfiles = mockDB.calls.some((call) =>
      /DELETE FROM voice_profiles/.test(call.sql),
    );
    expect(deletedProfiles).toBe(false);
  });

  it('철회가 아니면 정리도 신호도 없다', async () => {
    const app = buildApp();

    const res = await app.request(
      jsonReq('POST', '/user/consents', {
        document_version: CURRENT_POLICY_VERSION,
        consents: [{ type: 'voice_biometric', agreed: true }],
      }),
      undefined,
      {} as AppEnv['Bindings'],
    );

    expect(res.status).toBe(200);
    expect(notifyDowngradedAlarms).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [],
      [],
    );
  });
});
