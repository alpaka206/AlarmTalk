import { describe, expect, it } from 'vitest';
import { dynamicPromptSettingsState } from '../src/lib/dynamic-prompt-settings';

describe('dynamicPromptSettingsState', () => {
  it('marks weather ready when only city is stored', () => {
    const settings = {
      weather: { country: null, city: 'Paris' },
      fortune: { gender: null, birth_date: null, birth_time: null },
    };

    const state = dynamicPromptSettingsState(settings);

    expect(state.weather_ready).toBe(true);
  });
});
