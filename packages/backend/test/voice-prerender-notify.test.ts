import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDB } from './helpers';

const sendVoiceShareChangedPush = vi.fn();
vi.mock('../src/lib/fcm', () => ({
  sendVoiceShareChangedPush: (...args: unknown[]) => sendVoiceShareChangedPush(...args),
}));

import { notifySharedVoicePrerenderComplete } from '../src/lib/stock-clips';

const db = createMockDB();

beforeEach(() => {
  db.reset();
  sendVoiceShareChangedPush.mockReset();
});

describe('제자리 목소리 교체 완료 알림', () => {
  it('공유 프로필의 새 클립 게시가 끝난 뒤 그룹원에게 갱신 신호를 보낸다', async () => {
    db.pushResult([{ 1: 1 }]);
    db.pushResult([{ user_id: 'member-1' }, { user_id: 'member-2' }]);

    await notifySharedVoicePrerenderComplete(
      db.client as never,
      {} as never,
      'voice-1',
      'owner-1',
    );

    expect(sendVoiceShareChangedPush).toHaveBeenCalledWith(
      db.client,
      {},
      ['member-1', 'member-2'],
    );
  });

  it('공유하지 않는 프로필은 그룹원을 조회하거나 알리지 않는다', async () => {
    db.pushResult([]);

    await notifySharedVoicePrerenderComplete(
      db.client as never,
      {} as never,
      'voice-1',
      'owner-1',
    );

    expect(sendVoiceShareChangedPush).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(1);
  });
});
