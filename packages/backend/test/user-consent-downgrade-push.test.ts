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

function stubDeletedClone(groupMembers: string[] = []) {
  mockDB.pushResultFor('SELECT id FROM voice_profiles', [{ id: 'clone-1' }]);
  mockDB.pushResultFor(
    'FROM plan_group_members m1',
    groupMembers.map((user_id) => ({ user_id })),
  );
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
    stubDeletedClone(['group-member-1']);
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
    expect(new Set(notifyDowngradedAlarms.mock.calls[0]![3] as string[])).toEqual(
      new Set(['user-1', 'group-member-1']),
    );
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

/**
 * ⚠ **재동의 화면에서 안 누른 것을 '철회' 로 읽으면 안 된다.**
 *
 * voice_biometric 은 `optional` 로 내려가 동의 화면의 CTA 가 체크를 요구하지 않는다.
 * 이미 동의한 사용자가 그 화면을 그냥 통과하면 `agreed=false` 가 제출되는데, 그걸 철회로
 * 처리하면 ElevenLabs 보이스와 R2 원본이 **영구 삭제**된다 — 사용자는 무언가를 지운다는
 * 자각조차 없다. 이 지뢰는 `CONSENT_MIN_POLICY_VERSION.voice_biometric` 을 올리는 순간
 * 전원에게 터진다.
 */
describe('POST /user/consents — 재동의 대상은 철회로 읽지 않는다', () => {
  it('재동의 대상(collect)인 민감 유형의 미체크는 데이터를 파기하지 않는다', async () => {
    // 이 계정의 voice_biometric 기록이 **옛 버전**이라 지금 다시 묻고 있는 상황.
    mockDB.setConsentMissing(true);
    mockDB.pushResult([
      { consent_type: 'voice_biometric', policy_version: '1', agreed: 1 },
      { consent_type: 'terms', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'privacy', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'age14', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
    ]);
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
    // 파기가 없어야 한다. notify 는 항상 불리므로 **인자**로 확인한다 —
    // 강등된 알람 0개, 접근권 상실을 알릴 계정 0개.
    expect(notifyDowngradedAlarms.mock.calls[0]![2]).toEqual([]);
    expect(notifyDowngradedAlarms.mock.calls[0]![3]).toEqual([]);
  });

  /**
   * 반대로 아무도 묻지 않았는데 온 false 는 설정 화면의 **명시적 철회**다
   * (`withdrawVoiceBiometricConsent`). 이 경로는 계속 파기해야 한다 — 사용자가
   * '철회하고 삭제' 를 눌렀는데 아무 일도 안 일어나면 그게 더 큰 사고다.
   */
  it('재동의 대상이 아닐 때의 false 는 명시적 철회로 처리한다', async () => {
    mockDB.setConsentMissing(true);
    mockDB.pushResult([
      { consent_type: 'voice_biometric', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'terms', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'privacy', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'age14', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
      { consent_type: 'overseas_transfer', policy_version: CURRENT_POLICY_VERSION, agreed: 1 },
    ]);
    stubDeletedClone();
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
    expect(notifyDowngradedAlarms.mock.calls[0]![3]).toEqual(['user-1']);
  });
});
