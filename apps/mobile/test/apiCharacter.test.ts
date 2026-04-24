jest.mock('../src/services/api/core', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

import { get, post } from '../src/services/api/core';
import {
  getCharacterMe,
  grantCharacterXp,
} from '../src/services/api/character';
import type {
  CharacterResponse,
  CharacterGrantResponse,
} from '../src/services/api/character';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockPost = post as jest.MockedFunction<typeof post>;

beforeEach(() => jest.clearAllMocks());

const sampleCharacter: CharacterResponse = {
  character: {
    id: 'c1',
    user_id: 'u1',
    name: 'My Tree',
    level: 5,
    xp: 450,
    affection: 30,
    stage: 'sprout',
    daily_xp: 80,
    daily_xp_reset_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01',
    updated_at: '2026-01-15',
  },
  progress: {
    xp_into_level: 50,
    xp_to_next_level: 100,
    level_span: 100,
    progress_ratio: 0.5,
  },
  streak: {
    current: 7,
    longest: 14,
    last_wakeup_date: '2026-01-15',
  },
  stats: {
    diligence: 65,
    health: 70,
    consistency: 80,
  },
  achievements: [
    { milestone: 7, bonus_xp: 50, achieved_at: '2026-01-08' },
  ],
};

describe('Character API', () => {
  it('getCharacterMe → GET /characters/me', async () => {
    mockGet.mockResolvedValue(sampleCharacter);

    const result = await getCharacterMe();

    expect(mockGet).toHaveBeenCalledWith('/characters/me');
    expect(result.character.stage).toBe('sprout');
    expect(result.streak.current).toBe(7);
    expect(result.stats.diligence).toBe(65);
    expect(result.achievements).toHaveLength(1);
  });

  it('grantCharacterXp → POST /characters/xp with event only', async () => {
    const grantResponse: CharacterGrantResponse = {
      ...sampleCharacter,
      grant: {
        event: 'alarm_completed',
        granted_xp: 20,
        affection: 5,
        capped: false,
        remaining_cap: 80,
        duplicated: false,
      },
    };
    mockPost.mockResolvedValue(grantResponse);

    const result = await grantCharacterXp({ event: 'alarm_completed' });

    expect(mockPost).toHaveBeenCalledWith('/characters/xp', { event: 'alarm_completed' });
    expect(result.grant.granted_xp).toBe(20);
    expect(result.grant.capped).toBe(false);
  });

  it('grantCharacterXp with client_nonce and local_date', async () => {
    const grantResponse: CharacterGrantResponse = {
      ...sampleCharacter,
      grant: {
        event: 'alarm_completed',
        granted_xp: 20,
        affection: 5,
        capped: false,
        remaining_cap: 60,
        duplicated: false,
      },
    };
    mockPost.mockResolvedValue(grantResponse);

    await grantCharacterXp({
      event: 'alarm_completed',
      client_nonce: 'nonce-123',
      local_date: '2026-01-15',
    });

    expect(mockPost).toHaveBeenCalledWith('/characters/xp', {
      event: 'alarm_completed',
      client_nonce: 'nonce-123',
      local_date: '2026-01-15',
    });
  });

  it('grantCharacterXp detects duplicated grant', async () => {
    const grantResponse: CharacterGrantResponse = {
      ...sampleCharacter,
      grant: {
        event: 'alarm_completed',
        granted_xp: 0,
        affection: 0,
        capped: false,
        remaining_cap: 80,
        duplicated: true,
      },
    };
    mockPost.mockResolvedValue(grantResponse);

    const result = await grantCharacterXp({
      event: 'alarm_completed',
      client_nonce: 'same-nonce',
    });

    expect(result.grant.duplicated).toBe(true);
    expect(result.grant.granted_xp).toBe(0);
  });

  it('grantCharacterXp with milestone grants', async () => {
    const grantResponse: CharacterGrantResponse = {
      ...sampleCharacter,
      grant: {
        event: 'alarm_completed',
        granted_xp: 20,
        affection: 5,
        capped: false,
        remaining_cap: 0,
        duplicated: false,
        milestone_grants: [
          { event: 'streak_bonus_7', xp: 50 },
        ],
      },
    };
    mockPost.mockResolvedValue(grantResponse);

    const result = await grantCharacterXp({
      event: 'alarm_completed',
      local_date: '2026-01-15',
    });

    expect(result.grant.milestone_grants).toHaveLength(1);
    expect(result.grant.milestone_grants![0]!.event).toBe('streak_bonus_7');
  });

  it('grantCharacterXp when daily cap is hit', async () => {
    const grantResponse: CharacterGrantResponse = {
      ...sampleCharacter,
      grant: {
        event: 'alarm_snoozed',
        granted_xp: 5,
        affection: 1,
        capped: true,
        remaining_cap: 0,
        duplicated: false,
      },
    };
    mockPost.mockResolvedValue(grantResponse);

    const result = await grantCharacterXp({ event: 'alarm_snoozed' });

    expect(result.grant.capped).toBe(true);
    expect(result.grant.remaining_cap).toBe(0);
  });
});
