jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
  patch: jest.fn(),
  del: jest.fn(),
  request: jest.fn(),
}));

import { get, post, patch, del, request } from '../src/services/api/core';
import {
  getAlarms,
  getAlarm,
  createAlarm,
  updateAlarm,
  deleteAlarm,
  registerPushToken,
  unregisterPushToken,
} from '../src/services/api/alarm';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;
const mockPatch = patch as jest.MockedFunction<typeof patch>;
const mockDel = del as jest.MockedFunction<typeof del>;
const mockRequest = request as jest.MockedFunction<typeof request>;

beforeEach(() => jest.clearAllMocks());

describe('Alarm API', () => {
  it('getAlarms → GET /alarm', async () => {
    const alarms = [{ id: 'a1', time: '08:00' }, { id: 'a2', time: '09:00' }];
    mockGet.mockResolvedValue({ alarms });

    const result = await getAlarms();

    expect(mockGet).toHaveBeenCalledWith('/alarm');
    expect(result).toEqual(alarms);
  });

  it('getAlarm → GET /alarm/:id', async () => {
    const alarm = { id: 'a1', time: '08:00', is_active: true };
    mockGet.mockResolvedValue({ alarm });

    const result = await getAlarm('a1');

    expect(mockGet).toHaveBeenCalledWith('/alarm/a1');
    expect(result).toEqual(alarm);
  });

  it('createAlarm → POST /alarm with minimal params', async () => {
    const alarm = { id: 'a-new', time: '07:30' };
    mockPost.mockResolvedValue({ alarm });

    const result = await createAlarm({ message_id: 'm1', time: '07:30' });

    expect(mockPost).toHaveBeenCalledWith('/alarm', { message_id: 'm1', time: '07:30' });
    expect(result).toEqual(alarm);
  });

  it('createAlarm with all optional params', async () => {
    mockPost.mockResolvedValue({ alarm: { id: 'a-full' } });

    await createAlarm({
      message_id: 'm1',
      time: '07:30',
      repeat_days: [1, 2, 3, 4, 5],
      snooze_minutes: 5,
      target_user_id: 'u2',
      mode: 'tts',
      vibration_pattern: 'strong',
      wake_mode: 'sound_then_voice',
      voice_profile_id: 'vp1',
      speaker_id: 'sp1',
    });

    expect(mockPost).toHaveBeenCalledWith('/alarm', {
      message_id: 'm1',
      time: '07:30',
      repeat_days: [1, 2, 3, 4, 5],
      snooze_minutes: 5,
      target_user_id: 'u2',
      mode: 'tts',
      vibration_pattern: 'strong',
      wake_mode: 'sound_then_voice',
      voice_profile_id: 'vp1',
      speaker_id: 'sp1',
    });
  });

  it('updateAlarm → PATCH /alarm/:id', async () => {
    mockPatch.mockResolvedValue(undefined);

    await updateAlarm('a1', { time: '08:30', is_active: false });

    expect(mockPatch).toHaveBeenCalledWith('/alarm/a1', { time: '08:30', is_active: false });
  });

  it('updateAlarm with mode change', async () => {
    mockPatch.mockResolvedValue(undefined);

    await updateAlarm('a1', { mode: 'sound-only', voice_profile_id: null });

    expect(mockPatch).toHaveBeenCalledWith('/alarm/a1', {
      mode: 'sound-only',
      voice_profile_id: null,
    });
  });

  it('deleteAlarm → DELETE /alarm/:id', async () => {
    mockDel.mockResolvedValue(undefined);

    await deleteAlarm('a1');

    expect(mockDel).toHaveBeenCalledWith('/alarm/a1');
  });
});

describe('Push Token API', () => {
  it('registerPushToken → POST /push/token', async () => {
    mockPost.mockResolvedValue({ success: true });

    const result = await registerPushToken('expo-token-abc', 'android');

    expect(mockPost).toHaveBeenCalledWith('/push/token', {
      token: 'expo-token-abc',
      platform: 'android',
    });
    expect(result).toEqual({ success: true });
  });

  it('registerPushToken with ios platform', async () => {
    mockPost.mockResolvedValue({ success: true });

    await registerPushToken('apns-token', 'ios');

    expect(mockPost).toHaveBeenCalledWith('/push/token', {
      token: 'apns-token',
      platform: 'ios',
    });
  });

  it('unregisterPushToken → DELETE /push/token with body', async () => {
    mockRequest.mockResolvedValue({ success: true });

    const result = await unregisterPushToken('old-token');

    expect(mockRequest).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/push/token',
      body: { token: 'old-token' },
    });
    expect(result).toEqual({ success: true });
  });
});
