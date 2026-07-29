// 강등 알림 팬아웃 가드 (Codex #654).
//
// 클라 핸들러(AlarmTalkMessagingService)는 family_alarm payload 의 alarmId 를 쓰지 않고 원격
// 알람을 '전부' 다시 받는다. 그래서 알람마다 보내면 토큰 조회와 FCM 왕복만 알람 수만큼 늘고,
// 한 스윕이 여러 알람을 강등하면 Workers 서브리퀘스트 상한에 걸린다.
//
// 팬아웃 규칙만 떼어 낸 buildDowngradeNotifications 를 직접 검증한다 — 토큰 조회를 인자로 받는
// 순수 함수라 DB·네트워크 없이 '누구에게 몇 번' 나가는지 단언할 수 있다.
import { describe, it, expect } from 'vitest';
import { buildDowngradeNotifications } from '../src/lib/fcm';

/** 사용자당 토큰 하나. 조회 횟수도 함께 센다 — 그게 곧 DB 서브리퀘스트 수다. */
function tokenLookup(tokens: Record<string, string[]>) {
  const lookups: string[] = [];
  return {
    lookups,
    getTokens: async (userId: string) => {
      lookups.push(userId);
      return tokens[userId] ?? [];
    },
  };
}

describe('buildDowngradeNotifications 팬아웃', () => {
  it('같은 수신자의 알람이 여러 개여도 한 번만 만든다', async () => {
    const { lookups, getTokens } = tokenLookup({ recipient: ['tok-r'] });

    const messages = await buildDowngradeNotifications(getTokens, [
      { alarmId: 'al-1', ownerUserId: 'recipient', isReceived: true },
      { alarmId: 'al-2', ownerUserId: 'recipient', isReceived: true },
      { alarmId: 'al-3', ownerUserId: 'recipient', isReceived: true },
    ]);

    expect(lookups).toEqual(['recipient']); // 알람 3개여도 토큰 조회는 1회
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      token: 'tok-r',
      data: { type: 'family_alarm', alarmId: 'al-1' },
    });
  });

  it('수신자가 여럿이면 각자 한 번씩', async () => {
    const { lookups, getTokens } = tokenLookup({ a: ['tok-a'], b: ['tok-b1', 'tok-b2'] });

    const messages = await buildDowngradeNotifications(getTokens, [
      { alarmId: 'al-1', ownerUserId: 'a', isReceived: true },
      { alarmId: 'al-2', ownerUserId: 'b', isReceived: true },
      { alarmId: 'al-3', ownerUserId: 'a', isReceived: true },
    ]);

    expect(lookups.sort()).toEqual(['a', 'b']);
    // 기기가 둘인 사용자에게는 토큰 수만큼 나간다(그건 접을 수 없다).
    expect(messages.map((m) => m.token).sort()).toEqual(['tok-a', 'tok-b1', 'tok-b2']);
  });

  it('받은 알람과 본인 소유 알람에 서로 다른 신호를 만든다', async () => {
    const { getTokens } = tokenLookup({ recipient: ['tok-r'], owner: ['tok-o'] });

    const messages = await buildDowngradeNotifications(getTokens, [
      { alarmId: 'al-1', ownerUserId: 'recipient', isReceived: true },
      { alarmId: 'al-2', ownerUserId: 'owner', isReceived: false },
    ]);

    expect(messages.map((m) => m.data?.type).sort()).toEqual([
      'family_alarm',
      'voice_access_revoked',
    ]);
  });

  it('알람 행이 없어도 접근권 상실 계정에는 만든다', async () => {
    const { getTokens } = tokenLookup({ 'user-1': ['tok-1'] });

    const messages = await buildDowngradeNotifications(getTokens, [], ['user-1']);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ token: 'tok-1', data: { type: 'voice_access_revoked' } });
  });

  it('본인 소유 알람 주인과 접근권 상실 계정이 겹쳐도 한 번만', async () => {
    const { lookups, getTokens } = tokenLookup({ me: ['tok-me'] });

    const messages = await buildDowngradeNotifications(
      getTokens,
      [{ alarmId: 'al-1', ownerUserId: 'me', isReceived: false }],
      ['me'],
    );

    expect(lookups).toEqual(['me']);
    expect(messages).toHaveLength(1);
  });

  it('대상이 없으면 빈 목록', async () => {
    const { lookups, getTokens } = tokenLookup({});

    expect(await buildDowngradeNotifications(getTokens, [], [])).toEqual([]);
    expect(lookups).toEqual([]);
  });
});
