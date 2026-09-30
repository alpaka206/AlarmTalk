import { isValidFortuneBirthDate, isValidFortuneBirthTime, WeatherRegions } from '@alarmtalk/shared';

export type DynamicPromptSettings = {
  /**
   * 날씨 지역. `region` 은 목록의 키(`packages/shared/src/weather-regions.json`)이고, `country`/`city`
   * 는 **옛 앱이 읽는 글자**다 — 알맞은 `region` 이면 서버가 한국어 글자(`WeatherRegions.canonicalLabels`)
   * 로 덮어 적는다. 옛 앱은 `region` 을 모르고 글자만 주고받는다. 규칙은 `normalizeWeatherSetting`.
   */
  weather: {
    region: string | null;
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
    region: null,
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

function parseDynamicPromptSettings(raw: unknown): DynamicPromptSettings {
  if (typeof raw !== 'string' || raw.trim() === '') return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  try {
    return normalizeDynamicPromptSettings(JSON.parse(raw));
  } catch {
    return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  }
}

function normalizeDynamicPromptSettings(raw: unknown): DynamicPromptSettings {
  if (!raw || typeof raw !== 'object') return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  const record = raw as Record<string, unknown>;
  const weather = record.weather && typeof record.weather === 'object'
    ? (record.weather as Record<string, unknown>)
    : {};
  const fortune = record.fortune && typeof record.fortune === 'object'
    ? (record.fortune as Record<string, unknown>)
    : {};

  return {
    weather: normalizeWeatherSetting(weather),
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
  if (normalized.fortune.birth_date && !isValidFortuneBirthDate(normalized.fortune.birth_date)) {
    return null;
  }
  // ⚠ 형식 판정은 `@alarmtalk/shared` 가 유일 출처다. 예전에는 여기에 `HH:MM` 정규식이
  // 박혀 있었는데, 안드로이드는 사주 시진을 **구간**(`"00:00~01:30"`)으로 보내므로
  // **모든 선택지가 400** 이었다. 게다가 이 라우트는 운세와 날씨를 한 payload 로 받아서,
  // 태어난 시간을 고른 순간 **날씨 지역까지 함께 저장에 실패**했다.
  if (normalized.fortune.birth_time && !isValidFortuneBirthTime(normalized.fortune.birth_time)) {
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

/**
 * 계정의 날씨 지역 한 벌 — **쓸 때(PATCH)와 읽을 때(GET·가족 목록·라이브 생성) 같은 함수**다.
 * `docs/spec/voice-and-message.md` 5-1 「날씨 지역은 목록에서만 고른다」.
 *
 * - 알맞은 `region` → 그 지역. `country`/`city` 는 옛 앱용 한국어 글자로 **덮는다**(옛 앱이 계속 읽는다).
 * - 모르는 `region` → **그 칸만 버린다.** ⚠ 요청 전체를 400 으로 거절하지 말 것 — `PATCH /user/me` 는
 *   운세 설정을 같은 payload 로 싣고 오므로, 날씨 한 칸 때문에 운세까지 저장에 실패한다
 *   (`validateDynamicPromptSettings` 의 태어난 시간 사고와 같은 모양).
 * - `region` 없이 옛 글자만 → 목록으로 되짚어 `region` 을 채운다. 글자는 그대로 둔다. 못 되짚으면
 *   `region: null` 로 옛 경로(엄격한 지오코딩)에 맡긴다. 읽을 때 되짚은 값은 **다시 쓰지 않는다**.
 *
 * 길이 상한을 먼저 건다(`WeatherRegions.normalizeSetting` 은 상한을 두지 않는다).
 */
function normalizeWeatherSetting(weather: Record<string, unknown>): DynamicPromptSettings['weather'] {
  return WeatherRegions.normalizeSetting({
    region: normalizeShortSetting(weather.region, 64),
    country: normalizeShortSetting(weather.country, 80),
    city: normalizeShortSetting(weather.city, 80),
  });
}

function normalizeShortSetting(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}
