jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  del: jest.fn(),
  request: jest.fn(),
}));

import { get, post, patch, del, request } from '../src/services/api/core';
import {
  sendFriendRequest,
  getFriendList,
  getPendingRequests,
  acceptFriendRequest,
  deleteFriend,
  sendGift,
  getReceivedGifts,
  getSentGifts,
  acceptGift,
  rejectGift,
  sendNote,
  getReceivedNotes,
  getSentNotes,
  markNoteRead,
} from '../src/services/api/social';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;
const mockPatch = patch as jest.MockedFunction<typeof patch>;
const mockDel = del as jest.MockedFunction<typeof del>;
const mockRequest = request as jest.MockedFunction<typeof request>;

beforeEach(() => jest.clearAllMocks());

describe('Friend API', () => {
  it('sendFriendRequest → POST /friend', async () => {
    const friendship = { id: 'f1', email: 'a@b.com', status: 'pending' };
    mockPost.mockResolvedValue({ friendship });

    const result = await sendFriendRequest('a@b.com');

    expect(mockPost).toHaveBeenCalledWith('/friend', { email: 'a@b.com' });
    expect(result).toEqual(friendship);
  });

  it('getFriendList → GET /friend/list', async () => {
    const friends = [{ id: 'f1' }, { id: 'f2' }];
    mockGet.mockResolvedValue({ friends });

    const result = await getFriendList();

    expect(mockGet).toHaveBeenCalledWith('/friend/list');
    expect(result).toEqual(friends);
  });

  it('getPendingRequests → GET /friend/pending', async () => {
    const pending = [{ id: 'p1', from_email: 'x@y.com' }];
    mockGet.mockResolvedValue({ pending });

    const result = await getPendingRequests();

    expect(mockGet).toHaveBeenCalledWith('/friend/pending');
    expect(result).toEqual(pending);
  });

  it('acceptFriendRequest → PATCH /friend/:id/accept', async () => {
    mockPatch.mockResolvedValue(undefined);

    await acceptFriendRequest('f1');

    expect(mockPatch).toHaveBeenCalledWith('/friend/f1/accept');
  });

  it('deleteFriend → DELETE /friend/:id', async () => {
    mockDel.mockResolvedValue(undefined);

    await deleteFriend('f1');

    expect(mockDel).toHaveBeenCalledWith('/friend/f1');
  });
});

describe('Gift API', () => {
  it('sendGift → POST /gift', async () => {
    const gift = { id: 'g1', status: 'sent' };
    mockPost.mockResolvedValue({ gift });

    const result = await sendGift({
      recipient_email: 'r@b.com',
      message_id: 'm1',
      note: 'hello',
    });

    expect(mockPost).toHaveBeenCalledWith('/gift', {
      recipient_email: 'r@b.com',
      message_id: 'm1',
      note: 'hello',
    });
    expect(result).toEqual(gift);
  });

  it('sendGift without note', async () => {
    mockPost.mockResolvedValue({ gift: { id: 'g2' } });

    await sendGift({ recipient_email: 'r@b.com', message_id: 'm1' });

    expect(mockPost).toHaveBeenCalledWith('/gift', {
      recipient_email: 'r@b.com',
      message_id: 'm1',
    });
  });

  it('getReceivedGifts → GET /gift/received', async () => {
    const gifts = [{ id: 'g1' }];
    mockGet.mockResolvedValue({ gifts });

    const result = await getReceivedGifts();

    expect(mockGet).toHaveBeenCalledWith('/gift/received');
    expect(result).toEqual(gifts);
  });

  it('getSentGifts → GET /gift/sent', async () => {
    const gifts = [{ id: 'g2' }];
    mockGet.mockResolvedValue({ gifts });

    const result = await getSentGifts();

    expect(mockGet).toHaveBeenCalledWith('/gift/sent');
    expect(result).toEqual(gifts);
  });

  it('acceptGift → PATCH /gift/:id/accept', async () => {
    mockPatch.mockResolvedValue(undefined);

    await acceptGift('g1');

    expect(mockPatch).toHaveBeenCalledWith('/gift/g1/accept');
  });

  it('rejectGift → PATCH /gift/:id/reject', async () => {
    mockPatch.mockResolvedValue(undefined);

    await rejectGift('g1');

    expect(mockPatch).toHaveBeenCalledWith('/gift/g1/reject');
  });
});

describe('Notes API', () => {
  it('sendNote → POST /notes', async () => {
    const response = { success: true, note: { id: 'n1', text: 'hi' } };
    mockPost.mockResolvedValue(response);

    const result = await sendNote('user-1', 'hi');

    expect(mockPost).toHaveBeenCalledWith('/notes', {
      receiver_id: 'user-1',
      text: 'hi',
    });
    expect(result).toEqual(response);
  });

  it('getReceivedNotes → GET /notes/received with defaults', async () => {
    const notes = [{ id: 'n1', text: 'hello' }];
    mockGet.mockResolvedValue({ notes });

    const result = await getReceivedNotes();

    expect(mockGet).toHaveBeenCalledWith('/notes/received?limit=20&offset=0');
    expect(result).toEqual(notes);
  });

  it('getReceivedNotes with custom limit/offset', async () => {
    mockGet.mockResolvedValue({ notes: [] });

    await getReceivedNotes(10, 5);

    expect(mockGet).toHaveBeenCalledWith('/notes/received?limit=10&offset=5');
  });

  it('getSentNotes → GET /notes/sent with defaults', async () => {
    const notes = [{ id: 'n2', text: 'bye' }];
    mockGet.mockResolvedValue({ notes });

    const result = await getSentNotes();

    expect(mockGet).toHaveBeenCalledWith('/notes/sent?limit=20&offset=0');
    expect(result).toEqual(notes);
  });

  it('getSentNotes with custom limit/offset', async () => {
    mockGet.mockResolvedValue({ notes: [] });

    await getSentNotes(5, 10);

    expect(mockGet).toHaveBeenCalledWith('/notes/sent?limit=5&offset=10');
  });

  it('markNoteRead → PATCH /notes/:id/read', async () => {
    const response = { success: true, read_at: '2026-01-01T00:00:00Z' };
    mockRequest.mockResolvedValue(response);

    const result = await markNoteRead('n1');

    expect(mockRequest).toHaveBeenCalledWith({
      method: 'PATCH',
      path: '/notes/n1/read',
    });
    expect(result).toEqual(response);
  });
});
