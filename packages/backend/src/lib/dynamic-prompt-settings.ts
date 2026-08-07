export type DynamicPromptSettings = {
  weather: {
    country: string | null;
    city: string | null;
  };
  fortune: {
    gender: string | null;
    birth_date: string | null;
    birth_time: string | null;
  };
};

export type DynamicPromptSettingsState = {
  weather_ready: boolean;
  fortune_ready: boolean;
};

export const EMPTY_DYNAMIC_PROMPT_SETTINGS: DynamicPromptSettings = {
  weather: {
    country: null,
    city: null,
  },
  fortune: {
    gender: null,
    birth_date: null,
    birth_time: null,
  },
};


export function dynamicPromptSettingsFromRow(row: Record<string, unknown>): DynamicPromptSettings {
  return parseDynamicPromptSettings(row.dynamic_prompt_settings_json);
}

export function parseDynamicPromptSettings(raw: unknown): DynamicPromptSettings {
  if (typeof raw !== 'string' || raw.trim() === '') return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  try {
    return normalizeDynamicPromptSettings(JSON.parse(raw));
  } catch {
    return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  }
}

export function normalizeDynamicPromptSettings(raw: unknown): DynamicPromptSettings {
  if (!raw || typeof raw !== 'object') return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  const record = raw as Record<string, unknown>;
  const weather = record.weather && typeof record.weather === 'object'
    ? (record.weather as Record<string, unknown>)
    : {};
  const fortune = record.fortune && typeof record.fortune === 'object'
    ? (record.fortune as Record<string, unknown>)
    : {};

  return {
    weather: {
      country: normalizeShortSetting(weather.country, 80),
      city: normalizeShortSetting(weather.city, 80),
    },
    fortune: {
      gender: normalizeShortSetting(fortune.gender, 20),
      birth_date: normalizeShortSetting(fortune.birth_date ?? fortune.birthDate, 20),
      birth_time: normalizeShortSetting(fortune.birth_time ?? fortune.birthTime, 12),
    },
  };
}

export function validateDynamicPromptSettings(raw: unknown): DynamicPromptSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = normalizeDynamicPromptSettings(raw);
  if (normalized.fortune.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.fortune.birth_date)) {
    return null;
  }
  if (normalized.fortune.birth_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized.fortune.birth_time)) {
    return null;
  }
  return normalized;
}

export function dynamicPromptSettingsState(
  settings: DynamicPromptSettings,
): DynamicPromptSettingsState {
  return {
    weather_ready: Boolean(settings.weather.city),
    fortune_ready: Boolean(
      settings.fortune.gender &&
        settings.fortune.birth_date &&
        settings.fortune.birth_time,
    ),
  };
}

function normalizeShortSetting(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
