import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDB } from './helpers';

const sendVoiceShareChangedPush = vi.fn();
vi.mock('../src/lib/fcm', () => ({
  sendVoiceShareChangedPush: (...args: unknown[]) => sendVoiceShareChangedPush(...args),
}));

import { notifyVoicePrerenderComplete } from '../src/lib/stock-clips';

const db = createMockDB();

beforeEach(() => {
  db.reset();
  sendVoiceShareChangedPush.mockReset();
});

describe('제자리 목소리 교체 완료 알림', () => {
  // 신호 이름(`voice_share_changed`)은 옛 목소리 공유 시절 것이지만 두 앱이 이 문자열로 매니페스트 재조회를
  // 깨운다 — 받는 사람만 목소리 주인 한 사람으로 줄었다.
  it('새 클립 게시가 끝나면 목소리 주인의 기기에만 갱신 신호를 보낸다 — 다른 사람을 찾는 조회가 없다', async () => {
    await notifyVoicePrerenderComplete(db.client as never, {} as never, 'owner-1');

    expect(sendVoiceShareChangedPush).toHaveBeenCalledTimes(1);
    expect(sendVoiceShareChangedPush).toHaveBeenCalledWith(db.client, {}, ['owner-1']);
    expect(db.calls).toHaveLength(0);
  });
});
