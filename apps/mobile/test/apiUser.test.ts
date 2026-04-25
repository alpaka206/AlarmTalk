jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  del: jest.fn(),
}));

import { get, patch, del } from '../src/services/api/core';
import {
  getUserProfile,
  updatePlan,
  deleteAccount,
  getStats,
  getActivity,
  searchUsers,
  getLibrary,
  toggleFavorite,
  deleteLibraryItem,
} from '../src/services/api/user';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPatch = patch as jest.MockedFunction<typeof patch>;
const mockDel = del as jest.MockedFunction<typeof del>;

beforeEach(() => jest.clearAllMocks());

describe('User API', () => {
  it('getUserProfile → GET /user/me', async () => {
    const profile = { id: 'u1', email: 'a@b.com', name: 'Test', plan: 'free' };
    mockGet.mockResolvedValue(profile);

    const result = await getUserProfile();

    expect(mockGet).toHaveBeenCalledWith('/user/me');
    expect(result).toEqual(profile);
  });

  it('updatePlan → PATCH /user/plan', async () => {
    mockPatch.mockResolvedValue({ plan: 'plus' });

    const result = await updatePlan('plus');

    expect(mockPatch).toHaveBeenCalledWith('/user/plan', { plan: 'plus' });
    expect(result).toEqual({ plan: 'plus' });
  });

  it('updatePlan accepts family plan', async () => {
    mockPatch.mockResolvedValue({ plan: 'family' });

    await updatePlan('family');

    expect(mockPatch).toHaveBeenCalledWith('/user/plan', { plan: 'family' });
  });

  it('deleteAccount → DELETE /user/me', async () => {
    mockDel.mockResolvedValue({ success: true });

    const result = await deleteAccount();

    expect(mockDel).toHaveBeenCalledWith('/user/me');
    expect(result).toEqual({ success: true });
  });
});

describe('Stats API', () => {
  it('getStats → GET /stats', async () => {
    const stats = {
      alarms: { total: 5, active: 3 },
      messages: { total: 10 },
      voices: { total: 2 },
      friends: { total: 4 },
      gifts: { received: 1, receivedPending: 0, sent: 2 },
      trends: {
        alarms: { thisWeek: 3, lastWeek: 2 },
        messages: { thisWeek: 5, lastWeek: 3 },
        voices: { thisWeek: 1, lastWeek: 0 },
        friends: { thisWeek: 1, lastWeek: 1 },
        gifts: { thisWeek: 0, lastWeek: 1 },
      },
    };
    mockGet.mockResolvedValue(stats);

    const result = await getStats();

    expect(mockGet).toHaveBeenCalledWith('/stats');
    expect(result).toEqual(stats);
  });

  it('getActivity → GET /stats/activity returns activities array', async () => {
    const activities = [
      { id: 'a1', type: 'alarm', detail: { time: '08:30' }, created_at: '2026-04-25T00:00:00Z' },
      { id: 'm1', type: 'message', detail: { text: 'hello' }, created_at: '2026-04-24T00:00:00Z' },
    ];
    mockGet.mockResolvedValue({ activities });

    const result = await getActivity();

    expect(mockGet).toHaveBeenCalledWith('/stats/activity');
    expect(result).toEqual(activities);
  });

  it('searchUsers → GET /user/search with query param', async () => {
    const users = [{ id: 'u1', name: 'Alice', email: 'alice@b.com', picture: '' }];
    mockGet.mockResolvedValue({ users });

    const result = await searchUsers('alice');

    expect(mockGet).toHaveBeenCalledWith('/user/search', { q: 'alice' });
    expect(result).toEqual(users);
  });
});

describe('Library API', () => {
  it('getLibrary → GET /library without filter', async () => {
    const items = [{ id: 'l1', title: 'msg1' }];
    mockGet.mockResolvedValue({ items });

    const result = await getLibrary();

    expect(mockGet).toHaveBeenCalledWith('/library', undefined);
    expect(result).toEqual(items);
  });

  it('getLibrary with filter', async () => {
    mockGet.mockResolvedValue({ items: [] });

    await getLibrary('favorites');

    expect(mockGet).toHaveBeenCalledWith('/library', { filter: 'favorites' });
  });

  it('toggleFavorite → PATCH /library/:id/favorite', async () => {
    mockPatch.mockResolvedValue({ is_favorite: true });

    const result = await toggleFavorite('l1');

    expect(mockPatch).toHaveBeenCalledWith('/library/l1/favorite');
    expect(result).toBe(true);
  });

  it('toggleFavorite returns false when unfavorited', async () => {
    mockPatch.mockResolvedValue({ is_favorite: false });

    const result = await toggleFavorite('l1');

    expect(result).toBe(false);
  });

  it('deleteLibraryItem → DELETE /library/:id', async () => {
    mockDel.mockResolvedValue({ ok: true });

    const result = await deleteLibraryItem('l1');

    expect(mockDel).toHaveBeenCalledWith('/library/l1');
    expect(result).toEqual({ ok: true });
  });
});
