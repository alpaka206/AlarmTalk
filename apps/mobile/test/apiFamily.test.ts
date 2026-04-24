jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

import { get, post } from '../src/services/api/core';
import {
  getFamilyGroupCurrent,
  createFamilyAlarmText,
  createFamilyInvite,
  getFamilyInvites,
  revokeFamilyInvite,
} from '../src/services/api/family';
import type {
  FamilyGroupCurrent,
  FamilyAlarmCreatePayload,
  FamilyAlarmCreateResponse,
  FamilyInvite,
} from '../src/services/api/family';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;

beforeEach(() => jest.clearAllMocks());

describe('Family Group API', () => {
  it('getFamilyGroupCurrent → GET /family/groups/current', async () => {
    const current: FamilyGroupCurrent = {
      group: {
        id: 'g1',
        owner_user_id: 'u1',
        plan_id: 'p1',
        max_members: 6,
        created_at: '2026-01-01',
      },
      role: 'owner',
      members: [
        {
          id: 'm1',
          user_id: 'u1',
          role: 'owner',
          joined_at: '2026-01-01',
          email: 'owner@b.com',
          name: 'Owner',
          picture: null,
          allow_family_alarms: true,
        },
      ],
    };
    mockGet.mockResolvedValue(current);

    const result = await getFamilyGroupCurrent();

    expect(mockGet).toHaveBeenCalledWith('/family/groups/current');
    expect(result).toEqual(current);
  });

  it('getFamilyGroupCurrent returns null group for non-family users', async () => {
    const current: FamilyGroupCurrent = {
      group: null,
      role: null,
      members: [],
    };
    mockGet.mockResolvedValue(current);

    const result = await getFamilyGroupCurrent();

    expect(result.group).toBeNull();
    expect(result.role).toBeNull();
    expect(result.members).toEqual([]);
  });
});

describe('Family Alarm API', () => {
  it('createFamilyAlarmText → POST /family/alarms', async () => {
    const payload: FamilyAlarmCreatePayload = {
      recipient_user_id: 'u2',
      wake_at: '08:00',
      message_text: 'Good morning!',
      repeat_days: [1, 2, 3, 4, 5],
      voice_profile_id: 'vp1',
    };
    const response: FamilyAlarmCreateResponse = {
      alarm: {
        id: 'fa1',
        sender_user_id: 'u1',
        recipient_user_id: 'u2',
        wake_at: '08:00',
        repeat_days: [1, 2, 3, 4, 5],
        mode: 'tts',
        voice_profile_id: 'vp1',
      },
      message: { id: 'msg1', text: 'Good morning!', category: 'morning' },
    };
    mockPost.mockResolvedValue(response);

    const result = await createFamilyAlarmText(payload);

    expect(mockPost).toHaveBeenCalledWith('/family/alarms', payload);
    expect(result.alarm.id).toBe('fa1');
    expect(result.message.text).toBe('Good morning!');
  });

  it('createFamilyAlarmText without optional fields', async () => {
    const payload: FamilyAlarmCreatePayload = {
      recipient_user_id: 'u3',
      wake_at: '07:00',
      message_text: 'Wake up!',
    };
    mockPost.mockResolvedValue({
      alarm: { id: 'fa2', sender_user_id: 'u1', recipient_user_id: 'u3', wake_at: '07:00', repeat_days: [], mode: 'tts', voice_profile_id: '' },
      message: { id: 'msg2', text: 'Wake up!', category: 'custom' },
    });

    await createFamilyAlarmText(payload);

    expect(mockPost).toHaveBeenCalledWith('/family/alarms', payload);
  });
});

describe('Family Invites API', () => {
  it('createFamilyInvite → POST /family/invites', async () => {
    const invite: FamilyInvite = {
      id: 'inv1',
      plan_group_id: 'pg1',
      code: 'FAMILY-ABC',
      status: 'pending',
      created_at: '2026-01-01T00:00:00Z',
      expires_at: '2026-01-08T00:00:00Z',
      deep_link: 'voicealarm://invite/FAMILY-ABC',
      web_url: 'https://voicealarm.app/invite/FAMILY-ABC',
    };
    mockPost.mockResolvedValue({ invite });

    const result = await createFamilyInvite();

    expect(mockPost).toHaveBeenCalledWith('/family/invites', {});
    expect(result).toEqual(invite);
  });

  it('getFamilyInvites → GET /family/invites', async () => {
    const invites: FamilyInvite[] = [
      {
        id: 'inv1',
        plan_group_id: 'pg1',
        code: 'CODE-1',
        status: 'pending',
        created_at: '2026-01-01',
        expires_at: '2026-01-08',
        deep_link: '',
        web_url: '',
      },
      {
        id: 'inv2',
        plan_group_id: 'pg1',
        code: 'CODE-2',
        status: 'used',
        created_at: '2026-01-02',
        expires_at: '2026-01-09',
        deep_link: '',
        web_url: '',
      },
    ];
    mockGet.mockResolvedValue({ invites });

    const result = await getFamilyInvites();

    expect(mockGet).toHaveBeenCalledWith('/family/invites');
    expect(result).toHaveLength(2);
    expect(result[0]!.status).toBe('pending');
  });

  it('revokeFamilyInvite → POST /family/invites/:code/revoke', async () => {
    mockPost.mockResolvedValue({ success: true });

    const result = await revokeFamilyInvite('FAMILY-ABC');

    expect(mockPost).toHaveBeenCalledWith('/family/invites/FAMILY-ABC/revoke', {});
    expect(result).toEqual({ success: true });
  });
});
