import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { typedRow } from '../lib/db-types';
import { UUID_RE } from '../lib/validate';
import { R2VoiceStorage } from '../lib/r2-storage';
import { computeTtsCacheKey, generatedTtsObjectKey } from '../lib/audio-cache';
import { loadAudioBytes, uint8ToBase64 } from '../lib/audio-loader';
import { assertSameGroup } from '../lib/family-helpers';
import {
  createSynthesisAttempts,
  inferSynthesisLanguage,
  noVoiceProviderError,
  normalizeSynthesisLanguage,
  UnsupportedVoiceProviderError,
} from '../lib/voice-provider';
import {
  DynamicAlarmTextGenerationInvalidError,
  AlarmTextPreparationInvalidError,
  AlarmTextTranslationUnavailableError,
  generateDynamicAlarmTextWithVertex,
  generatePrerenderClipText,
  deriveAlarmDisplayText,
  prepareAlarmTextWithVertex,
  type WeatherSignal,
  type WeatherCondition,
} from '../lib/vertex-translate';
import { loadTtsPresets, type TtsPreset } from '../lib/tts-presets';
import {
  CLONE_CLIP_SEEDS,
  CLONE_WEATHER_CONDITIONS,
  STOCK_GREETING_CATEGORY,
} from '../lib/stock-clips';
import {
  readManualTtsUsage,
  refundManualTtsQuota,
  reserveManualTtsQuota,
  resolveManualTtsPool,
} from '../lib/manual-tts-quota';
import { isPaidVoicePlan } from './billing-helpers';
import { missingConsentType, SENSITIVE_REQUIRED_CONSENTS } from '../lib/consent';
import {
  type DynamicPromptSettings,
  EMPTY_DYNAMIC_PROMPT_SETTINGS,
  dynamicPromptSettingsFromRow,
} from '../lib/dynamic-prompt-settings';
import { withWriteTransaction, type DbExecutor } from '../lib/transactions';
import { enqueueExternalDeletion } from '../lib/audio-retention';

const tts = new Hono<AppEnv>();
const TTS_CATEGORIES = [
  'morning',
  'lunch',
  'evening',
  'night',
  'health',
  'medication',
  'study',
  'cheer',
  'love',
  'exercise',
  'custom',
] as const;

const LEGACY_TTS_CATEGORY_ALIASES: Record<string, (typeof TTS_CATEGORIES)[number]> = {
  afternoon: 'cheer',
  sleep: 'night',
  medicine: 'medication',
};
const RANDOM_CONTEXTS = [
  'preset',
  'wake_weather',
  'wake_fortune',
  'meal',
  'sleep',
  'exercise',
  'love',
] as const;
type RandomContext = (typeof RANDOM_CONTEXTS)[number];

const LEGACY_RANDOM_CONTEXT_ALIASES: Record<string, RandomContext> = {
  daily: 'wake_weather',
  weather: 'wake_weather',
  fortune: 'wake_fortune',
};

function consentRequired(c: Context<AppEnv>, consent: string) {
  const error =
    consent === 'voice_biometric'
      ? 'Voice biometric consent is required to use a custom voice for TTS.'
      : 'Overseas transfer consent is required for ElevenLabs TTS generation.';
  return c.json({ error, error_code: 'CONSENT_REQUIRED', consent }, 403);
}

class ConsentWithdrawnDuringTtsError extends Error {
  constructor(readonly consent: string) {
    super(`Required consent was withdrawn during TTS generation: ${consent}`);
    this.name = 'ConsentWithdrawnDuringTtsError';
  }
}

class VoiceAuthorizationChangedDuringTtsError extends Error {
  constructor() {
    super('Voice authorization changed during TTS generation.');
    this.name = 'VoiceAuthorizationChangedDuringTtsError';
  }
}

type WeatherForecastResponse = {
  daily?: {
    time?: unknown[];
    weather_code?: unknown[];
    temperature_2m_max?: unknown[];
    temperature_2m_min?: unknown[];
    precipitation_probability_max?: unknown[];
    precipitation_sum?: unknown[];
  };
};

type AirQualityForecastResponse = {
  hourly?: {
    time?: unknown[];
    pm10?: unknown[];
    pm2_5?: unknown[];
  };
};

type WeatherGeocodingResponse = {
  results?: Array<{
    name?: unknown;
    country?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  }>;
};

function normalizeTtsCategory(category: string): (typeof TTS_CATEGORIES)[number] | null {
  const raw = category.trim();
  if ((TTS_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as (typeof TTS_CATEGORIES)[number];
  }
  return LEGACY_TTS_CATEGORY_ALIASES[raw] ?? null;
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]! % length;
}

function normalizeRandomContext(value: unknown): RandomContext {
  const raw = typeof value === 'string' ? value.trim() : '';
  return (RANDOM_CONTEXTS as readonly string[]).includes(raw) ? (raw as RandomContext) : 'preset';
}

function normalizeRandomContextWithAliases(value: unknown): RandomContext {
  const raw = typeof value === 'string' ? value.trim() : '';
  return LEGACY_RANDOM_CONTEXT_ALIASES[raw] ?? normalizeRandomContext(raw);
}

function normalizeRelationshipLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  if (!label) return null;
  return label.slice(0, 30);
}

function optionalInt(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function optionalNumber(value: unknown, min: number, max: number): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

function normalizeShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function firstNonBlankText(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeShortText(value, 120);
    if (normalized) return normalized;
  }
  return null;
}

function mealLabelForHour(hour: number | null): string {
  if (hour == null) return '식사';
  if (hour >= 5 && hour < 10) return '아침';
  if (hour >= 10 && hour < 15) return '점심';
  if (hour >= 15 && hour < 22) return '저녁';
  return '가벼운 식사';
}

function alarmTimeLabel(hour: number | null, minute: number | null): string | null {
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function fortuneProfile(args: {
  gender?: unknown;
  birthDate?: unknown;
  birthTime?: unknown;
}): string | null {
  const gender = normalizeShortText(args.gender, 12);
  const birthDate = normalizeShortText(args.birthDate, 16);
  const birthTime = normalizeShortText(args.birthTime, 8);
  const parts = [
    gender ? `gender=${gender}` : null,
    birthDate ? `birth date=${birthDate}` : null,
    birthTime ? `birth time=${birthTime}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

function randomContextUsesWeather(context: RandomContext): boolean {
  return context === 'wake_weather' || context === 'meal' || context === 'exercise';
}

async function loadTargetDynamicPromptSettings(
  db: ReturnType<typeof getDB>,
  userPk: string,
  targetUserId: unknown,
): Promise<DynamicPromptSettings> {
  if (typeof targetUserId !== 'string' || targetUserId.trim() === '') {
    return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  }
  const target = targetUserId.trim();
  const result = await db.execute({
    sql: `SELECT id, dynamic_prompt_settings_json
          FROM users
          WHERE id = ? OR google_id = ?
          LIMIT 1`,
    args: [target, target],
  });
  if (result.rows.length === 0) return EMPTY_DYNAMIC_PROMPT_SETTINGS;

  const targetPk = String(result.rows[0]!.id);
  if (targetPk !== userPk && !(await assertSameGroup(db, userPk, targetPk))) {
    return EMPTY_DYNAMIC_PROMPT_SETTINGS;
  }

  return dynamicPromptSettingsFromRow(result.rows[0] as Record<string, unknown>);
}

function todayKoreaLabel(): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

async function pickRandomPresetText(
  env: AppEnv['Bindings'],
  category: string,
): Promise<string | null> {
  const presets: TtsPreset[] = await loadTtsPresets(env);
  const preset = presets.find((item) => item.category === category);
  const messages = preset?.messages.map((message) => message.trim()).filter(Boolean) ?? [];
  if (messages.length === 0) return null;
  return messages[randomIndex(messages.length)]!;
}

function presetTextWithListenerTitle(text: string, listenerTitle: string | null): string {
  const title = listenerTitle?.trim();
  const base = text.trim();
  if (!title || !base || base.startsWith(title)) return base;
  const withTitle = `${title}, ${base}`;
  return withTitle.length <= 200 ? withTitle : base;
}

function draftPreviewText(language: string): string {
  if (language === 'ja') return 'おはよう。今日も気持ちよく起きよう。';
  if (language === 'en') return 'Good morning. It is time to start your day.';
  return '좋은 아침이야. 오늘도 기분 좋게 일어나자.';
}

async function findUsableVoiceProfile(
  db: DbExecutor,
  userId: string,
  userPk: string,
  voiceProfileId: string,
): Promise<Record<string, unknown> | null> {
  const owned = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL',
    args: [voiceProfileId, userPk, userId],
  });
  if (owned.rows.length > 0) return owned.rows[0] as Record<string, unknown>;

  // 시스템 스톡 보이스는 모든 사용자가 사용할 수 있다 (무료 플랜 포함).
  const system = await db.execute({
    sql: `SELECT * FROM voice_profiles
          WHERE id = ? AND COALESCE(is_system, 0) = 1 AND deleted_at IS NULL
          LIMIT 1`,
    args: [voiceProfileId],
  });
  if (system.rows.length > 0) return system.rows[0] as Record<string, unknown>;

  const shared = await db.execute({
    sql: `SELECT vp.*, u.id AS owner_pk
          FROM voice_profiles vp
          LEFT JOIN users u ON u.google_id = vp.user_id OR u.id = vp.user_id
          WHERE vp.id = ? AND COALESCE(vp.is_shared, 0) = 1
            AND COALESCE(vp.is_draft, 0) = 0
            AND vp.deleted_at IS NULL
          LIMIT 1`,
    args: [voiceProfileId],
  });
  if (shared.rows.length === 0) return null;

  const row = shared.rows[0] as Record<string, unknown>;
  const viewerPk = userPk;
  const ownerPk = typeof row.owner_pk === 'string' ? row.owner_pk : null;
  if (!viewerPk || !ownerPk || viewerPk === ownerPk) return null;

  const inSameGroup = await assertSameGroup(db, viewerPk, ownerPk);
  return inSameGroup ? row : null;
}

async function findViewerRelationshipLabel(
  db: ReturnType<typeof getDB>,
  userPk: string,
  userId: string,
  voiceProfileId: string,
): Promise<string | null> {
  const result = await db.execute({
    sql: `SELECT relationship_label
          FROM voice_profile_relationships
          WHERE voice_profile_id = ? AND user_id IN (?, ?)
          ORDER BY updated_at DESC
          LIMIT 1`,
    args: [voiceProfileId, userPk, userId],
  });
  return normalizeRelationshipLabel(result.rows[0]?.relationship_label);
}

async function findViewerListenerTitle(
  db: ReturnType<typeof getDB>,
  userPk: string,
  userId: string,
  voiceProfileId: string,
): Promise<string | null> {
  const result = await db.execute({
    sql: `SELECT listener_title
          FROM voice_profile_relationships
          WHERE voice_profile_id = ? AND user_id IN (?, ?)
          ORDER BY updated_at DESC
          LIMIT 1`,
    args: [voiceProfileId, userPk, userId],
  });
  return normalizeRelationshipLabel(result.rows[0]?.listener_title);
}

const RAIN_WMO_CODES = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
const SNOW_WMO_CODES = [71, 73, 75, 77, 85, 86];

async function loadWeatherSignal(args: {
  latitude?: unknown;
  longitude?: unknown;
  locationLabel?: unknown;
  country?: unknown;
  city?: unknown;
}): Promise<WeatherSignal | null> {
  const input = await loadWeatherSignalInput(args);
  return input ? buildWeatherSignal(input) : null;
}

/** open-meteo 원시 데이터(코드·기온·강수·미세먼지)를 가져와 구조화 입력으로만 환원한다. */
async function loadWeatherSignalInput(args: {
  latitude?: unknown;
  longitude?: unknown;
  locationLabel?: unknown;
  country?: unknown;
  city?: unknown;
  targetDate?: unknown;
  timezone?: unknown;
}): Promise<WeatherSignalInput | null> {
  const location = await resolveWeatherLocation(args);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set(
    'daily',
    [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_probability_max',
      'precipitation_sum',
    ].join(','),
  );
  const targetDate =
    typeof args.targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.targetDate)
      ? args.targetDate
      : null;
  const timezone =
    typeof args.timezone === 'string' && /^[A-Za-z0-9_+\-/]{1,64}$/.test(args.timezone)
      ? args.timezone
      : 'Asia/Seoul';
  url.searchParams.set('timezone', timezone);
  if (targetDate) {
    url.searchParams.set('start_date', targetDate);
    url.searchParams.set('end_date', targetDate);
  } else {
    url.searchParams.set('forecast_days', '1');
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
    });
    const json = await response
      .json<WeatherForecastResponse>()
      .catch(() => ({}) as WeatherForecastResponse);
    if (!response.ok || !json.daily) return null;
    const targetIndex = targetDate
      ? (json.daily.time?.findIndex((value) => value === targetDate) ?? -1)
      : 0;
    if (targetIndex < 0) return null;
    const code = Number(json.daily.weather_code?.[targetIndex]);
    const maxTemp = Number(json.daily.temperature_2m_max?.[targetIndex]);
    const minTemp = Number(json.daily.temperature_2m_min?.[targetIndex]);
    const rainProbability = Number(json.daily.precipitation_probability_max?.[targetIndex]);
    const precipitation = Number(json.daily.precipitation_sum?.[targetIndex]);
    // 코드·기온·강수가 모두 없으면(전부 NaN) 분류 불가 → null. 이때만 클라가 마지막 인덱스를 유지하고
    // 라이브는 generic 으로 떨어진다. 단 weather_code 만 없고 기온/강수가 있으면 그것으로 분류 가능하므로
    // 통과시킨다 — buildWeatherSignal(라이브)의 우산·한파 멘트, resolvePrerenderWeatherIndex 의
    // 비/더위/추위 인덱스는 code 없이도 산출된다. (code 만으로 null 반환하면 라이브 날씨멘트가 통째 사라짐)
    if (
      !Number.isFinite(code) &&
      !Number.isFinite(maxTemp) &&
      !Number.isFinite(minTemp) &&
      !Number.isFinite(rainProbability) &&
      !Number.isFinite(precipitation)
    ) {
      return null;
    }
    const hasDust = await loadDustSignal(location, targetDate, timezone);
    return { code, maxTemp, minTemp, rainProbability, precipitation, hasDust };
  } catch {
    return null;
  }
}

export interface WeatherSignalInput {
  code: number;
  maxTemp: number;
  minTemp: number;
  rainProbability: number;
  precipitation: number;
  hasDust: boolean;
}

// 날씨를 언어무관 구조화 시그널(condition+action, 최대 2개)로 환원한다(설계 #7). 한국어/타깃어
// 표면 생성은 vertex-translate의 *WeatherSurface 헬퍼가 담당.
function buildWeatherSignal(input: WeatherSignalInput): WeatherSignal | null {
  const { code, maxTemp, minTemp, rainProbability, precipitation, hasDust } = input;
  const heavyRain =
    (Number.isFinite(rainProbability) && rainProbability >= 60) ||
    (Number.isFinite(precipitation) && precipitation > 1) ||
    RAIN_WMO_CODES.includes(code);
  const lightRain =
    !heavyRain &&
    ((Number.isFinite(rainProbability) && rainProbability >= 30) ||
      (Number.isFinite(precipitation) && precipitation > 0));
  const snowy = SNOW_WMO_CODES.includes(code);

  const conditions: WeatherCondition[] = [];
  if (snowy) {
    conditions.push({ kind: 'snow', action: 'coat' });
  } else if (heavyRain || lightRain) {
    conditions.push({ kind: 'rain', action: 'umbrella' });
  }

  if (hasDust) {
    conditions.push({ kind: 'dust', action: 'mask' });
  }

  if (conditions.length === 0) {
    if (Number.isFinite(maxTemp) && maxTemp >= 30) {
      conditions.push({ kind: 'heat', action: 'water' });
    } else if (Number.isFinite(maxTemp) && maxTemp >= 25) {
      conditions.push({ kind: 'nice', action: 'walk' });
    } else if (
      (Number.isFinite(minTemp) && minTemp <= 0) ||
      (Number.isFinite(maxTemp) && maxTemp <= 5)
    ) {
      conditions.push({ kind: 'cold', action: 'coat' });
    } else if (Number.isFinite(maxTemp) && maxTemp <= 12) {
      conditions.push({ kind: 'cold', action: 'coat' });
    } else if (Number.isFinite(maxTemp) && maxTemp >= 15 && maxTemp <= 24) {
      conditions.push({ kind: 'nice', action: 'walk' });
    }
  }

  if (conditions.length === 0) return null;
  return { conditions: conditions.slice(0, 2) };
}

const FOG_WMO_CODES = [45, 48];
const CLOUD_WMO_CODES = [2, 3]; // partly cloudy / overcast = 흐림

/**
 * open-meteo 원시 입력을 CLONE_WEATHER_CONDITIONS(nice/rain/snow/dust/cloud/fog/heat) 인덱스로
 * 분류한다. 사전렌더 weather 클립은 이 순서로 저장되므로, 클라가 이 인덱스로 오프라인 선택한다.
 * 우선순위: 눈>비>미세먼지>안개>더위>흐림>맑음(기본).
 */
export function resolvePrerenderWeatherIndex(input: WeatherSignalInput): number {
  const { code, maxTemp, minTemp, rainProbability, precipitation, hasDust } = input;
  // 인덱스는 CLONE_WEATHER_CONDITIONS 순서에서 파생(하드코딩 대신 → 순서 바뀌어도 안전).
  const idx = (kind: (typeof CLONE_WEATHER_CONDITIONS)[number]) =>
    Math.max(0, CLONE_WEATHER_CONDITIONS.indexOf(kind));
  const rainy =
    (Number.isFinite(rainProbability) && rainProbability >= 30) ||
    (Number.isFinite(precipitation) && precipitation > 0) ||
    RAIN_WMO_CODES.includes(code);
  if (SNOW_WMO_CODES.includes(code)) return idx('snow');
  if (rainy) return idx('rain');
  if (hasDust) return idx('dust');
  if (FOG_WMO_CODES.includes(code)) return idx('fog');
  if (Number.isFinite(maxTemp) && maxTemp >= 30) return idx('heat');
  // 추위: 라이브 buildWeatherSignal 과 동일 기준(최저<=0 또는 최고<=12). buildWeatherSignal 은 최고<=5
  // 와 최고<=12 두 분기 모두 cold 로 밀어넣으므로 실질 기준이 <=12 → 6~12°C 맑은 날 '산책' 오재 방지.
  if ((Number.isFinite(minTemp) && minTemp <= 0) || (Number.isFinite(maxTemp) && maxTemp <= 12)) {
    return idx('cold');
  }
  if (CLOUD_WMO_CODES.includes(code)) return idx('cloud');
  return idx('nice');
}

async function loadDustSignal(
  location: { latitude: number; longitude: number },
  targetDate: string | null,
  timezone: string,
): Promise<boolean> {
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('hourly', ['pm10', 'pm2_5'].join(','));
  url.searchParams.set('timezone', timezone);
  if (targetDate) {
    url.searchParams.set('start_date', targetDate);
    url.searchParams.set('end_date', targetDate);
  } else {
    url.searchParams.set('forecast_days', '1');
  }

  try {
    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
    });
    const json = await response
      .json<AirQualityForecastResponse>()
      .catch(() => ({}) as AirQualityForecastResponse);
    if (!response.ok || !json.hourly) return false;
    const pm10Max = maxFinite(json.hourly.pm10);
    const pm25Max = maxFinite(json.hourly.pm2_5);
    const pm10Bad = pm10Max != null && pm10Max > 80;
    const pm25Bad = pm25Max != null && pm25Max > 35;
    return pm10Bad || pm25Bad;
  } catch {
    return false;
  }
}

function maxFinite(values: unknown[] | undefined): number | null {
  const numbers = (values ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

async function resolveWeatherLocation(args: {
  latitude?: unknown;
  longitude?: unknown;
  locationLabel?: unknown;
  country?: unknown;
  city?: unknown;
}): Promise<{ latitude: number; longitude: number; label: string }> {
  const fallback = { latitude: 37.5665, longitude: 126.978, label: '서울' };
  const latitude = optionalNumber(args.latitude, -90, 90);
  const longitude = optionalNumber(args.longitude, -180, 180);
  const country = normalizeShortText(args.country, 30);
  const city = normalizeShortText(args.city, 30);
  const label =
    normalizeShortText(args.locationLabel, 40) ||
    [country, city].filter(Boolean).join(' ').trim() ||
    fallback.label;
  if (latitude != null && longitude != null) {
    return { latitude, longitude, label };
  }
  if (!city && label !== fallback.label) {
    return { ...fallback, label: fallback.label };
  }
  if (!city) {
    return { ...fallback, label };
  }
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', city);
    url.searchParams.set('count', '10');
    url.searchParams.set('language', 'ko');
    url.searchParams.set('format', 'json');
    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
    });
    const json = await response
      .json<WeatherGeocodingResponse>()
      .catch(() => ({}) as WeatherGeocodingResponse);
    if (!response.ok) return { ...fallback, label };
    const results = json.results ?? [];
    const matched =
      results.find((item) => {
        const resultCountry = typeof item.country === 'string' ? item.country : '';
        return country ? resultCountry.toLowerCase().includes(country.toLowerCase()) : true;
      }) ?? results[0];
    const resolvedLatitude = optionalNumber(matched?.latitude, -90, 90);
    const resolvedLongitude = optionalNumber(matched?.longitude, -180, 180);
    if (resolvedLatitude == null || resolvedLongitude == null) return { ...fallback, label };
    const resolvedCity = typeof matched?.name === 'string' ? matched.name : city;
    const resolvedCountry = typeof matched?.country === 'string' ? matched.country : country;
    return {
      latitude: resolvedLatitude,
      longitude: resolvedLongitude,
      label: [resolvedCountry, resolvedCity].filter(Boolean).join(' ').trim() || label,
    };
  } catch {
    return { ...fallback, label };
  }
}

tts.post('/generate', async (c) => {
  const userId = c.get('userId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);

  const body = await c.req.json<{
    voice_profile_id: string;
    text?: string;
    category?: string;
    language?: string;
    translate?: boolean;
    random?: boolean;
    random_context?: string;
    randomContext?: string;
    random_mode?: string;
    randomMode?: string;
    relationship_label?: string;
    relationshipLabel?: string;
    listener_title?: string;
    listenerTitle?: string;
    target_user_id?: string;
    targetUserId?: string;
    weather_location_label?: string;
    weatherLocationLabel?: string;
    weather_latitude?: number;
    weatherLatitude?: number;
    weather_longitude?: number;
    weatherLongitude?: number;
    weather_country?: string;
    weatherCountry?: string;
    weather_city?: string;
    weatherCity?: string;
    alarm_hour?: number;
    alarmHour?: number;
    alarm_minute?: number;
    alarmMinute?: number;
    fortune_gender?: string;
    fortuneGender?: string;
    gender?: string;
    fortune_birth_date?: string;
    fortuneBirthDate?: string;
    birthDate?: string;
    fortune_birth_time?: string;
    fortuneBirthTime?: string;
    birthTime?: string;
    draft_preview?: boolean;
    draftPreview?: boolean;
  }>();

  if (!body.voice_profile_id) {
    return c.json(
      { error: 'voice_profile_id and text are required', error_code: 'VOICE_AND_TEXT_REQUIRED' },
      400,
    );
  }

  if (!UUID_RE.test(body.voice_profile_id)) {
    return c.json(
      { error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' },
      400,
    );
  }

  const draftPreviewRequested = body.draft_preview === true || body.draftPreview === true;
  const category = normalizeTtsCategory(
    draftPreviewRequested ? 'morning' : (body.category ?? 'custom'),
  );
  if (!category) {
    return c.json(
      {
        error: `Invalid category. Must be one of: ${TTS_CATEGORIES.join(', ')}`,
        error_code: 'INVALID_CATEGORY',
      },
      400,
    );
  }
  const randomRequested = !draftPreviewRequested && body.random === true;
  const randomContext = randomRequested
    ? normalizeRandomContextWithAliases(
        body.random_context ?? body.randomContext ?? body.random_mode ?? body.randomMode,
      )
    : 'preset';
  if (randomRequested && category === 'custom') {
    return c.json(
      {
        error: 'Random TTS requires a preset category.',
        error_code: 'RANDOM_CATEGORY_REQUIRED',
      },
      400,
    );
  }

  let requestText = draftPreviewRequested
    ? draftPreviewText('ko')
    : randomRequested && randomContext === 'preset'
      ? await pickRandomPresetText(c.env, category)
      : (body.text ?? '').trim();
  if (!requestText) {
    if (randomRequested && randomContext !== 'preset') {
      requestText = '';
    } else {
      return c.json(
        { error: 'voice_profile_id and text are required', error_code: 'VOICE_AND_TEXT_REQUIRED' },
        400,
      );
    }
  }

  if (requestText && requestText.length > 200) {
    return c.json(
      { error: 'Text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' },
      400,
    );
  }

  let freePlanRestricted = false;
  // 직접 입력 미터링 폴백용(구독/그룹을 못 찾을 때 페이월과 같은 출처인 users.plan 사용).
  let callerUserPlan: string | null = null;
  const user = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ? OR google_id = ? LIMIT 1',
    args: ownerIds,
  });

  if (user.rows.length > 0) {
    const u = user.rows[0]!;
    const plan = u.plan as string;
    callerUserPlan = plan ?? null;

    // 무료 플랜은 시스템 스톡 보이스 + 프리셋(고정) 문구 조합만 허용한다.
    // 보이스 조회 후에 is_system 여부와 함께 최종 판정한다.
    if (resolvedUserPk && !isPaidVoicePlan(plan)) {
      freePlanRestricted = true;
    }
  } else if (resolvedUserPk) {
    return c.json(
      {
        error: 'Voice features require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }

  const vp = await findUsableVoiceProfile(db, userId, userPk, body.voice_profile_id);
  if (!vp) {
    return c.json({ error: 'Voice profile not found', error_code: 'VOICE_PROFILE_NOT_FOUND' }, 404);
  }

  if (vp.status !== 'ready') {
    return c.json(
      { error: 'Voice profile is not ready yet', error_code: 'VOICE_PROFILE_NOT_READY' },
      400,
    );
  }

  const isDraftVoice = Number(vp.is_draft ?? 0) === 1;
  if (isDraftVoice && !draftPreviewRequested) {
    return c.json(
      {
        error: 'Draft voices can only be used for their confirmation preview.',
        error_code: 'VOICE_DRAFT_NOT_USABLE',
      },
      403,
    );
  }
  if (!isDraftVoice && draftPreviewRequested) {
    return c.json(
      {
        error: 'Only a private draft can use the confirmation preview.',
        error_code: 'VOICE_PREVIEW_DRAFT_REQUIRED',
      },
      409,
    );
  }
  const storedPreviewLanguage = normalizeSynthesisLanguage(
    typeof vp.preview_language === 'string' ? vp.preview_language : 'ko',
  );
  if (draftPreviewRequested) requestText = draftPreviewText(storedPreviewLanguage);

  const isSystemVoice = Boolean(Number(vp.is_system ?? 0));
  let draftPreviewListenerTitle: string | null = null;
  if ((randomRequested && randomContext === 'preset') || draftPreviewRequested) {
    const isSharedVoiceProfileForPreset =
      typeof vp.owner_pk === 'string' && vp.owner_pk.trim() !== '' && vp.owner_pk !== userPk;
    const listenerTitle =
      (draftPreviewRequested
        ? normalizeRelationshipLabel(vp.listener_title)
        : normalizeRelationshipLabel(body.listener_title ?? body.listenerTitle)) ??
      (isSharedVoiceProfileForPreset
        ? await findViewerListenerTitle(db, userPk, userId, body.voice_profile_id)
        : null) ??
      normalizeRelationshipLabel(vp.listener_title);
    if (draftPreviewRequested) draftPreviewListenerTitle = listenerTitle ?? null;
    // 미리듣기는 아래에서 관계·호칭 톤 적응 생성을 시도한다 — 여기서 만든 '고정 예문+호칭 접두어'는
    // 생성 실패(Vertex 미설정/모델 오류) 시의 폴백 문구가 된다.
    requestText = presetTextWithListenerTitle(requestText, listenerTitle);
  }
  if (freePlanRestricted) {
    if (!isSystemVoice) {
      return c.json(
        {
          error: 'Voice features require a paid plan.',
          error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
        },
        403,
      );
    }
    // 커스텀 텍스트·동적(날씨/운세) 문구·번역은 매번 생성 비용이 들어 유료 전용.
    if (!randomRequested || randomContext !== 'preset' || body.translate === true) {
      return c.json(
        {
          error: 'Free plan supports preset phrases with stock voices only.',
          error_code: 'FREE_PLAN_PRESET_ONLY',
        },
        403,
      );
    }
    // 암묵적 번역 우회 차단: 프리셋 문구는 여기서 이미 확정(604-606)되므로 source 언어를
    // 산정할 수 있다. 요청 언어가 source 와 다르면 아래 shouldTranslate(773-775)의
    // `randomRequested && requestedLanguage !== sourceLanguage` 분기가 켜져 유료 번역
    // 경로(prepareAlarmTextWithVertex translate:true)로 새어 나간다. translate===true 와
    // 동일하게 차단해 무료 프리셋 요청이 번역을 절대 호출하지 못하게 한다.
    const requestedLanguageForGate = normalizeSynthesisLanguage(body.language);
    const sourceLanguageForGate = inferSynthesisLanguage(requestText, 'ko');
    if (requestedLanguageForGate !== sourceLanguageForGate) {
      return c.json(
        {
          error: 'Free plan supports preset phrases with stock voices only.',
          error_code: 'FREE_PLAN_PRESET_ONLY',
        },
        403,
      );
    }
  }

  const requiredSensitiveConsents = isSystemVoice
    ? ['overseas_transfer']
    : SENSITIVE_REQUIRED_CONSENTS;
  const missingTtsConsent = await missingConsentType(db, userPk, requiredSensitiveConsents);
  if (missingTtsConsent) return consentRequired(c, missingTtsConsent);

  // 직접 입력(random 아님) = 유료 사용자가 문구를 직접 타이핑한 유료 생성 경로.
  // 무료는 위(693-729)에서 이미 차단되므로 여기 도달하는 수동 요청은 유료 전용.
  // 예약은 캐시 미스 뒤(합성 직전)에 하고, 예약됐는데 합성이 실패하면 catch 에서 환불.
  const isManualGeneration = !randomRequested && !draftPreviewRequested && Boolean(resolvedUserPk);
  let manualQuotaPoolKey: string | null = null;
  let manualQuotaMonth: string | null = null;
  let manualQuotaResult: { used: number; limit: number; remaining: number } | null = null;
  let previewClaimed = false;
  let activePreviewClaimToken: string | null = null;
  let draftPreviewTag = 'cheerfully';

  try {
    const requestedLanguage = draftPreviewRequested
      ? storedPreviewLanguage
      : normalizeSynthesisLanguage(body.language);

    if (draftPreviewRequested) {
      // 미리듣기 문구를 keep(승격) 후 사전렌더될 greeting 과 같은 seed 로 '관계·호칭 톤 적응' 생성한다
      // — 사용자가 확정 전에 그 목소리의 실제 말투(관계에 맞는 어투 + 호칭)를 듣고 결정하게 하기 위함.
      // 생성 문구는 요청마다 달라질 수 있으므로 첫 생성분을 draft 행(preview_text/preview_tag)에 영속해
      // 재생을 결정적으로 만든다 — previewed_at 이후 재생은 캐시 히트로만 성립하므로 같은 문구가 필수.
      // 관계/호칭 수정 시 previewed_at 과 함께 리셋돼 새 문구로 재생성된다(voice-profile PATCH).
      // 실패(Vertex 미설정·모델 오류·검증 탈락) 시 위의 고정 예문(+호칭 접두어)으로 폴백해 미리듣기
      // 자체는 절대 막지 않는다. Vertex(국외) 전송은 위 missingTtsConsent(overseas_transfer 포함) 통과
      // 뒤에만 일어난다.
      const storedText =
        typeof vp.preview_text === 'string' && vp.preview_text.trim() ? vp.preview_text.trim() : null;
      if (storedText) {
        requestText = storedText;
        const storedTag = typeof vp.preview_tag === 'string' ? vp.preview_tag.trim() : '';
        if (storedTag) draftPreviewTag = storedTag;
      } else {
        try {
          const greetingSeed = CLONE_CLIP_SEEDS.find((s) => s.category === STOCK_GREETING_CATEGORY);
          if (greetingSeed) {
            const generated = await generatePrerenderClipText(c.env, {
              seed: greetingSeed.seeds[0]!,
              relationshipLabel: normalizeRelationshipLabel(vp.relationship_label) ?? null,
              listenerTitle: draftPreviewListenerTitle,
              targetLanguage: storedPreviewLanguage,
              defaultTag: greetingSeed.defaultTag,
            });
            requestText = generated.text;
            if (generated.tag) draftPreviewTag = generated.tag;
            // 합성 전에 영속: 합성이 실패해도 재시도가 같은 문구를 쓰게(중복 생성 방지 + 캐시 정합).
            // 조건부(비어있을 때만) 쓰기 = first-writer-wins: 동시 첫-미리듣기 요청이 겹쳐도 늦은 쪽이
            // 이미 영속된(재생될) 문구를 덮어써 재생 결정성을 깨지 못한다. 지면 승자 문구를 재사용.
            const persisted = await db.execute({
              sql: `UPDATE voice_profiles
                    SET preview_text = ?, preview_tag = ?, updated_at = datetime('now')
                    WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                      AND COALESCE(is_draft, 0) = 1
                      AND COALESCE(preview_text, '') = ''`,
              args: [generated.text, draftPreviewTag, body.voice_profile_id, userPk, userId],
            });
            if ((persisted.rowsAffected ?? 0) === 0) {
              const winner = await db.execute({
                sql: `SELECT preview_text, preview_tag FROM voice_profiles
                      WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                      LIMIT 1`,
                args: [body.voice_profile_id, userPk, userId],
              });
              const winnerRow = winner.rows[0];
              const winnerText =
                typeof winnerRow?.preview_text === 'string' ? winnerRow.preview_text.trim() : '';
              if (winnerText) {
                requestText = winnerText;
                const winnerTag =
                  typeof winnerRow?.preview_tag === 'string' ? winnerRow.preview_tag.trim() : '';
                draftPreviewTag = winnerTag || 'cheerfully';
              }
            }
          }
        } catch {
          // 고정 예문 폴백 유지 (requestText 는 이미 예문+호칭으로 설정돼 있음)
        }
      }
    }

    // 국외 이전 동의(B4): 동적 문구 생성(wake_weather/wake_fortune 등)과 번역은
    // 텍스트를 국외(Google Vertex)로 전송하므로 overseas_transfer 동의가 필요하다.
    // 동의가 없으면 해당 크로스보더 경로를 차단(403)한다. 프리셋·동일언어 비번역
    // 합성은 국외 이전이 없어 게이트 대상이 아니다.
    let dynamicGenerated: Awaited<ReturnType<typeof generateDynamicAlarmTextWithVertex>> | null =
      null;
    if (randomRequested && randomContext !== 'preset') {
      const alarmHour = optionalInt(body.alarm_hour ?? body.alarmHour, 0, 23);
      const alarmMinute = optionalInt(body.alarm_minute ?? body.alarmMinute, 0, 59);
      const targetDynamicPromptSettings = await loadTargetDynamicPromptSettings(
        db,
        userPk,
        body.target_user_id ?? body.targetUserId,
      );
      const isSharedVoiceProfile =
        typeof vp.owner_pk === 'string' && vp.owner_pk.trim() !== '' && vp.owner_pk !== userPk;
      const relationshipLabel =
        normalizeRelationshipLabel(body.relationship_label ?? body.relationshipLabel) ??
        (await findViewerRelationshipLabel(db, userPk, userId, body.voice_profile_id)) ??
        (isSharedVoiceProfile ? null : normalizeRelationshipLabel(vp.relationship_label));
      const listenerTitle =
        normalizeRelationshipLabel(body.listener_title ?? body.listenerTitle) ??
        (await findViewerListenerTitle(db, userPk, userId, body.voice_profile_id)) ??
        (isSharedVoiceProfile ? null : normalizeRelationshipLabel(vp.listener_title));
      const weatherSignal = randomContextUsesWeather(randomContext)
        ? await loadWeatherSignal({
            latitude: body.weather_latitude ?? body.weatherLatitude,
            longitude: body.weather_longitude ?? body.weatherLongitude,
            locationLabel: body.weather_location_label ?? body.weatherLocationLabel,
            country: firstNonBlankText(
              body.weather_country,
              body.weatherCountry,
              targetDynamicPromptSettings.weather.country,
            ),
            city: firstNonBlankText(
              body.weather_city,
              body.weatherCity,
              targetDynamicPromptSettings.weather.city,
            ),
          })
        : null;
      const generated = await generateDynamicAlarmTextWithVertex(c.env, {
        mode: randomContext,
        category,
        targetLanguage: requestedLanguage,
        dateLabel: todayKoreaLabel(),
        relationshipLabel,
        listenerTitle,
        weatherSignal,
        fortuneProfile:
          randomContext === 'wake_fortune'
            ? fortuneProfile({
                gender: firstNonBlankText(
                  body.fortune_gender,
                  body.fortuneGender,
                  body.gender,
                  targetDynamicPromptSettings.fortune.gender,
                ),
                birthDate: firstNonBlankText(
                  body.fortune_birth_date,
                  body.fortuneBirthDate,
                  body.birthDate,
                  targetDynamicPromptSettings.fortune.birth_date,
                ),
                birthTime: firstNonBlankText(
                  body.fortune_birth_time,
                  body.fortuneBirthTime,
                  body.birthTime,
                  targetDynamicPromptSettings.fortune.birth_time,
                ),
              })
            : null,
        mealLabel: randomContext === 'meal' ? mealLabelForHour(alarmHour) : null,
        alarmTimeLabel: alarmTimeLabel(alarmHour, alarmMinute),
      });
      requestText = generated.text;
      dynamicGenerated = generated;
    }

    if (!requestText) {
      return c.json(
        { error: 'voice_profile_id and text are required', error_code: 'VOICE_AND_TEXT_REQUIRED' },
        400,
      );
    }
    if (requestText.length > 200) {
      return c.json(
        { error: 'Text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' },
        400,
      );
    }

    const sourceLanguage = inferSynthesisLanguage(requestText, 'ko');
    // 동적 모드는 생성 단계에서 이미 {text, tag}를 한 호출로 받았으므로(순환 모순 제거),
    // 2차 Vertex 호출(prepareAlarmTextWithVertex autoTag) 없이 [tag] +text 를 직접 조립한다.
    // prepare는 preset/custom + 번역 경로 전용으로 남긴다.
    let prepared: { text: string; translated: boolean; tags: string[] };
    if (draftPreviewRequested) {
      // 톤 적응 생성이 성공했으면 그 delivery 태그를, 폴백(고정 예문)이면 기본 cheerfully 를 쓴다.
      // 동적 경로와 동일하게 태그 포함 길이가 200을 넘으면 태그를 버려 메타와 합성 텍스트를 일치시킨다.
      const taggedText = `[${draftPreviewTag}] ${requestText}`;
      const tagApplied = taggedText.length <= 200;
      prepared = {
        text: tagApplied ? taggedText : requestText,
        translated: false,
        tags: tagApplied ? [draftPreviewTag] : [],
      };
    } else if (dynamicGenerated) {
      const dynamicTag = dynamicGenerated.tags[0] ?? '';
      const taggedText = dynamicTag
        ? `[${dynamicTag}] ${dynamicGenerated.text}`
        : dynamicGenerated.text;
      // 태그를 붙인 길이가 200자를 넘으면 태그를 버린다 — 이때 tags 배열도 비워서
      // DB delivery_tags/캐시 메타와 실제 합성 텍스트가 어긋나지 않게 한다.
      const tagApplied = dynamicTag !== '' && taggedText.length <= 200;
      prepared = {
        text: tagApplied ? taggedText : dynamicGenerated.text,
        translated: false,
        tags: tagApplied ? [dynamicTag] : [],
      };
    } else {
      const shouldTranslate =
        body.translate === true || (randomRequested && requestedLanguage !== sourceLanguage);
      prepared = await prepareAlarmTextWithVertex(c.env, requestText, {
        targetLanguage: shouldTranslate ? requestedLanguage : sourceLanguage,
        sourceLanguage,
        translate: shouldTranslate,
        autoTag: true,
      });
    }
    const synthesisText = prepared.text;
    // 표시/저장 문구(messageText): 실제 음성 텍스트(synthesisText, 번역됐으면 번역본)에서
    // '우리가 자동으로 맨 앞에 붙인 delivery 태그'만 벗긴 값. requestText 에 사용자가 친 대괄호가
    // 있으면 자동 태그가 아니므로 원문 보존, 없으면 맨 앞 태그 1개만 제거한다(deriveAlarmDisplayText).
    // → (1) 번역 경로에서도 화면 문구가 음성 언어와 일치하고, (2) '[after lunch]'·'[calm]'만 입력 등
    //   사용자 대괄호가 안 지워지며, (3) 모델이 붙인 비승인 태그도 화면엔 새지 않는다.
    const messageText = dynamicGenerated
      ? dynamicGenerated.text
      : deriveAlarmDisplayText(synthesisText, requestText);
    const deliveryTagsJson = JSON.stringify(prepared.tags);
    // synthesisLanguage 결정 시 요청 언어 의도를 보존한다.
    // - 번역 경로(translated): requestedLanguage 로 번역했으므로 그대로 사용.
    // - 동적 생성 경로(dynamicGenerated): targetLanguage=requestedLanguage 로 생성했으므로 사용.
    // - 그 외(preset/custom 비번역): 텍스트 스크립트로 추론하되, 라틴 스크립트라 en 으로
    //   떨어지는 지원언어(fr/it 등)는 요청 언어를 우선한다(en 오판 → 잘못된 발음 방지).
    let synthesisLanguage: string;
    if (prepared.translated || dynamicGenerated) {
      synthesisLanguage = requestedLanguage;
    } else {
      const inferred = inferSynthesisLanguage(synthesisText, sourceLanguage);
      // 라틴 스크립트라 en 으로 오추론되는 지원언어(fr/it)만 요청 언어로 보정한다.
      // 기본 ko/ja 보이스에 영어 텍스트를 넣은 경우(inferred='en')는 그대로 en 으로
      // 합성해 정상 발음을 유지한다(과교정 방지).
      const latinOverride = requestedLanguage === 'fr' || requestedLanguage === 'it';
      synthesisLanguage = inferred === 'en' && latinOverride ? requestedLanguage : inferred;
    }

    if (synthesisText.length > 200) {
      return c.json(
        { error: 'Prepared text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' },
        400,
      );
    }

    // 모드별 보이스 세팅: sleep은 저에너지를 위해 speed 0.95(그 외는 elevenlabs v3 디폴트
    // stability 0.5/similarity 0.8/style 0.4/speed 1.0/use_speaker_boost 적용). sleep만
    // 오버라이드하므로 캐시 키도 다른 모드와 자연히 분리된다.
    const dynamicVoiceSettings =
      randomRequested && randomContext === 'sleep' ? { speed: 0.95 } : undefined;
    const attempts = createSynthesisAttempts({
      env: c.env,
      profile: {
        elevenlabs_voice_id: vp.elevenlabs_voice_id as string | null | undefined,
      },
      text: synthesisText,
      language: synthesisLanguage,
      category,
      voiceSettings: dynamicVoiceSettings,
    });

    if (attempts.length === 0) {
      return c.json(
        { error: 'No voice ID available for this profile', error_code: 'NO_VOICE_ID' },
        400,
      );
    }

    const preparedAttempts = await Promise.all(
      attempts.map(async (attempt) => {
        const cacheKey = await computeTtsCacheKey({
          provider: attempt.provider,
          providerVoiceId: attempt.providerVoiceId,
          voiceProfileId: body.voice_profile_id,
          modelId: attempt.modelId,
          language: synthesisLanguage,
          languageCode: synthesisLanguage,
          text: synthesisText,
          outputFormat: attempt.outputFormat,
          voiceSettings: attempt.voiceSettings,
        });
        return { attempt, cacheKey };
      }),
    );

    if (draftPreviewRequested && !vp.previewed_at) {
      const previewClaimToken = crypto.randomUUID();
      const claimed = await db.execute({
        sql: `UPDATE voice_profiles
              SET preview_claimed_at = datetime('now'), preview_claim_token = ?,
                  updated_at = datetime('now')
              WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                AND COALESCE(is_draft, 0) = 1 AND status = 'ready' AND previewed_at IS NULL
                AND COALESCE(relationship_label, '') = ?
                AND COALESCE(listener_title, '') = ?
                AND (preview_claimed_at IS NULL OR preview_claimed_at <= datetime('now', '-5 minutes'))`,
        args: [
          previewClaimToken,
          body.voice_profile_id,
          userPk,
          userId,
          String(vp.relationship_label ?? ''),
          String(vp.listener_title ?? ''),
        ],
      });
      if ((claimed.rowsAffected ?? 0) === 0) {
        return c.json(
          {
            error: 'Voice preview is already being prepared.',
            error_code: 'VOICE_PREVIEW_IN_PROGRESS',
          },
          409,
        );
      }
      previewClaimed = true;
      activePreviewClaimToken = previewClaimToken;
    }

    for (const { cacheKey } of preparedAttempts) {
      // 시스템 보이스는 (보이스 × 문구)당 단 한 번만 생성되도록 전체 사용자가
      // 캐시를 공유한다 — 무료 플랜의 한계 비용을 0에 가깝게 유지.
      const cached = await findCachedGeneratedAudio(c, ownerIds, cacheKey, {
        anyUser: isSystemVoice,
      });
      if (cached) {
        if (draftPreviewRequested && activePreviewClaimToken) {
          const marked = await db.execute({
            sql: `UPDATE voice_profiles SET preview_claimed_at = NULL,
                        updated_at = datetime('now')
                  WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                    AND COALESCE(is_draft, 0) = 1 AND status = 'ready'
                    AND preview_claim_token = ?`,
            args: [body.voice_profile_id, userPk, userId, activePreviewClaimToken],
          });
          if ((marked.rowsAffected ?? 0) === 0) {
            return c.json(
              {
                error: 'Voice draft is no longer available.',
                error_code: 'VOICE_PROFILE_NOT_FOUND',
              },
              409,
            );
          }
        }
        return c.json(
          {
            message_id: cached.messageId,
            audio_base64: uint8ToBase64(cached.bytes),
            audio_format: cached.audioFormat,
            audio_url: cached.audioUrl,
            audio_object_key: cached.audioObjectKey,
            text: messageText,
            original_text: messageText,
            synthesis_text: cached.synthesisText,
            translated: prepared.translated,
            tags: prepared.tags,
            voice_profile_id: body.voice_profile_id,
            language: synthesisLanguage,
            provider: cached.provider,
            cache_key: cacheKey,
            cache_hit: true,
            random_context: randomRequested ? randomContext : null,
            preview_playback_token: activePreviewClaimToken,
            preview_playback_confirmed: Boolean(vp.previewed_at),
          },
          200,
        );
      }
    }

    if (draftPreviewRequested && !previewClaimed) {
      if (vp.previewed_at) {
        return c.json(
          {
            error: 'The saved preview audio is no longer available.',
            error_code: 'VOICE_PREVIEW_UNAVAILABLE',
          },
          409,
        );
      }
    }

    // 캐시 미스 확정 후 합성 직전에 직접 입력 월 쿼터를 예약(원자적 +1). 초과면 429.
    if (isManualGeneration) {
      const pool = await resolveManualTtsPool(db, ownerIds, userPk, callerUserPlan);
      const reservation = await reserveManualTtsQuota(db, pool.poolKey, pool.limit);
      if (!reservation.ok) {
        return c.json(
          {
            error: '이번 달 직접 입력 문구 만들기 횟수를 모두 사용했어요.',
            error_code: 'MANUAL_TTS_QUOTA_EXCEEDED',
            manual_quota: { limit: reservation.limit, used: reservation.used, remaining: 0 },
          },
          429,
        );
      }
      manualQuotaPoolKey = pool.poolKey;
      manualQuotaMonth = reservation.month;
      manualQuotaResult = {
        used: reservation.used,
        limit: reservation.limit,
        remaining: reservation.remaining,
      };
    }

    let lastError: unknown = noVoiceProviderError();
    for (const { attempt, cacheKey } of preparedAttempts) {
      try {
        const generated = await attempt.synthesize();
        const bytes = generated.bytes;

        let audioObjectKey: string | null = null;
        let audioUrl: string | null = null;
        if (c.env.VOICE_BUCKET) {
          const storage = new R2VoiceStorage(c.env.VOICE_BUCKET);
          audioObjectKey = generatedTtsObjectKey(userPk, cacheKey, generated.outputFormat);
          await storage.storeAtKey(audioObjectKey, {
            bytes,
            userId: userPk,
            mimeType: generated.mimeType,
            originalName: `tts_${cacheKey}.${generated.outputFormat}`,
          });
          audioUrl = `r2://${audioObjectKey}`;
        }

        const messageId = crypto.randomUUID();
        try {
          await withWriteTransaction(db, async (tx) => {
            const publicationVoice = await findUsableVoiceProfile(
              tx,
              userId,
              userPk,
              body.voice_profile_id,
            );
            if (
              !publicationVoice ||
              publicationVoice.status !== 'ready' ||
              (Number(publicationVoice.is_draft ?? 0) === 1) !== draftPreviewRequested
            ) {
              throw new VoiceAuthorizationChangedDuringTtsError();
            }
            const missingPublicationConsent = await missingConsentType(
              tx,
              userPk,
              requiredSensitiveConsents,
            );
            if (missingPublicationConsent) {
              throw new ConsentWithdrawnDuringTtsError(missingPublicationConsent);
            }
            await tx.execute({
              sql: `INSERT INTO messages
                (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json, category, audio_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [
                messageId,
                userPk,
                body.voice_profile_id,
                messageText,
                synthesisText,
                deliveryTagsJson,
                category,
                audioUrl,
              ],
            });

            if (audioUrl) {
              await tx.execute({
                sql: `INSERT OR IGNORE INTO generated_audio_assets
                  (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                   model_id, language, request_hash, text, original_text, delivery_tags_json, category, audio_url,
                   audio_object_key, audio_format, mime_type, size_bytes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                  crypto.randomUUID(),
                  userPk,
                  body.voice_profile_id,
                  messageId,
                  generated.provider,
                  generated.providerVoiceId,
                  generated.modelId,
                  synthesisLanguage,
                  cacheKey,
                  synthesisText,
                  messageText,
                  deliveryTagsJson,
                  category,
                  audioUrl,
                  audioObjectKey,
                  generated.outputFormat,
                  generated.mimeType,
                  bytes.byteLength,
                ],
              });
            }

            if (!draftPreviewRequested) {
              await tx.execute({
                sql: `INSERT INTO message_library (id, user_id, message_id) VALUES (?, ?, ?)`,
                args: [crypto.randomUUID(), userPk, messageId],
              });
            }

            if (draftPreviewRequested) {
              const marked = await tx.execute({
                sql: `UPDATE voice_profiles SET preview_claimed_at = NULL,
                        updated_at = datetime('now')
                  WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                    AND COALESCE(is_draft, 0) = 1 AND status = 'ready'
                    AND preview_claim_token = ?`,
                args: [body.voice_profile_id, userPk, userId, activePreviewClaimToken],
              });
              if ((marked.rowsAffected ?? 0) === 0) {
                throw new Error('Voice draft is no longer available.');
              }
            }
          });
        } catch (publicationError) {
          if (audioObjectKey && c.env.VOICE_BUCKET) {
            try {
              await new R2VoiceStorage(c.env.VOICE_BUCKET).delete(audioObjectKey);
            } catch {
              await enqueueExternalDeletion(db, 'r2_object', audioObjectKey);
            }
          }
          throw publicationError;
        }

        return c.json(
          {
            message_id: messageId,
            audio_base64: uint8ToBase64(bytes),
            audio_format: generated.outputFormat,
            audio_url: audioUrl,
            audio_object_key: audioObjectKey,
            text: messageText,
            original_text: messageText,
            synthesis_text: synthesisText,
            translated: prepared.translated,
            tags: prepared.tags,
            voice_profile_id: body.voice_profile_id,
            language: synthesisLanguage,
            provider: generated.provider,
            cache_key: cacheKey,
            cache_hit: false,
            random_context: randomRequested ? randomContext : null,
            manual_quota: manualQuotaResult,
            preview_playback_token: activePreviewClaimToken,
            preview_playback_confirmed: false,
          },
          201,
        );
      } catch (err) {
        lastError = err;
        if (err instanceof UnsupportedVoiceProviderError) continue;
        if (attempt !== attempts[attempts.length - 1]) continue;
      }
    }

    throw lastError;
  } catch (err) {
    // 쿼터를 예약했는데 합성이 끝내 실패했으면 카운터를 되돌린다(실패는 소비 안 함).
    // 예약이 증가시킨 바로 그 월로 환불(월 경계를 넘겨 실패해도 정확히 복구).
    if (manualQuotaPoolKey && manualQuotaMonth) {
      try {
        await refundManualTtsQuota(db, manualQuotaPoolKey, manualQuotaMonth);
      } catch (refundErr) {
        console.error('[tts/generate] manual quota refund failed', refundErr);
      }
    }
    if (previewClaimed) {
      try {
        await db.execute({
          sql: `UPDATE voice_profiles SET preview_claimed_at = NULL, preview_claim_token = NULL,
                      updated_at = datetime('now')
                WHERE id = ? AND user_id IN (?, ?) AND COALESCE(is_draft, 0) = 1
                  AND previewed_at IS NULL AND preview_claim_token = ?`,
          args: [body.voice_profile_id, userPk, userId, activePreviewClaimToken],
        });
      } catch (previewReleaseError) {
        console.error('[tts/generate] failed to release preview claim', previewReleaseError);
      }
    }
    console.error(
      '[tts/generate] failed',
      err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err,
    );
    if (err instanceof AlarmTextTranslationUnavailableError) {
      return c.json(
        {
          error: 'Alarm text translation is not configured.',
          error_code: 'TRANSLATION_NOT_CONFIGURED',
        },
        503,
      );
    }
    if (err instanceof ConsentWithdrawnDuringTtsError) {
      return consentRequired(c, err.consent);
    }
    if (err instanceof VoiceAuthorizationChangedDuringTtsError) {
      return c.json(
        {
          error: 'Voice authorization changed while generating audio.',
          error_code: 'VOICE_AUTHORIZATION_CHANGED',
        },
        409,
      );
    }
    if (err instanceof AlarmTextPreparationInvalidError) {
      return c.json(
        {
          error: 'Alarm text preparation returned invalid content.',
          error_code: 'TEXT_PREPARATION_FAILED',
        },
        502,
      );
    }
    if (err instanceof DynamicAlarmTextGenerationInvalidError) {
      return c.json(
        {
          error: 'Dynamic alarm text generation returned invalid content.',
          error_code: 'DYNAMIC_TEXT_GENERATION_FAILED',
        },
        502,
      );
    }
    return c.json(
      {
        error: 'TTS generation failed',
        error_code: 'TTS_GENERATION_FAILED',
        detail: err instanceof Error ? err.message : 'Unknown error',
      },
      500,
    );
  }
});

// 이번 달 직접 입력 문구 만들기 사용 현황(선택기 '직접 입력 (남은/총)' 표시용). 소비 없음.
tts.get('/manual-quota', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);

  const userRow = await db.execute({
    sql: 'SELECT plan FROM users WHERE id = ? OR google_id = ? LIMIT 1',
    args: ownerIds,
  });
  const callerUserPlan =
    userRow.rows.length > 0 && userRow.rows[0]!.plan != null ? String(userRow.rows[0]!.plan) : null;

  const pool = await resolveManualTtsPool(db, ownerIds, userPk, callerUserPlan);
  const used = pool.limit > 0 ? await readManualTtsUsage(db, pool.poolKey) : 0;
  return c.json({
    plan_key: pool.planKey,
    limit: pool.limit,
    used,
    remaining: Math.max(0, pool.limit - used),
  });
});

tts.get('/messages', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const category = c.req.query('category');
  const voiceProfileId = c.req.query('voice_profile_id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);

  // /tts/messages 는 사용자가 '저장한 문구' 라이브러리(message_library)만 반환한다. messages 테이블에는
  // 내부 프리셋 버킷 클립(is_preset=1), 드래프트 미리듣기(승격 후 non-draft 로 노출), 알람 raw 플레이스홀더,
  // 가족 수신 클립 등 저장 문구가 아닌 내부 행이 섞이는데 이들은 message_library 에 등록되지 않는다 →
  // 라이브러리 멤버십으로 거른다. (is_preset 은 라이브러리에 없어 이미 제외되지만, 명시적 가드로도 남긴다.)
  let whereClause = `WHERE m.user_id IN (?, ?)
    AND EXISTS (
      SELECT 1 FROM message_library ml
      WHERE ml.message_id = m.id AND ml.user_id IN (?, ?)
    )
    AND COALESCE(m.is_preset, 0) = 0
    AND EXISTS (
      SELECT 1 FROM voice_profiles visible_vp
      WHERE visible_vp.id = m.voice_profile_id
        AND visible_vp.deleted_at IS NULL
        AND COALESCE(visible_vp.is_draft, 0) = 0
    )`;
  const filterArgs: (string | number)[] = [...ownerIds, ...ownerIds];

  if (category) {
    whereClause += ' AND m.category = ?';
    filterArgs.push(category);
  }

  if (voiceProfileId) {
    if (!UUID_RE.test(voiceProfileId)) {
      return c.json(
        { error: 'Invalid voice_profile_id format', error_code: 'INVALID_VOICE_PROFILE_ID' },
        400,
      );
    }
    whereClause += ' AND m.voice_profile_id = ?';
    filterArgs.push(voiceProfileId);
  }

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: `SELECT COUNT(*) as total FROM messages m ${whereClause}`,
      args: filterArgs,
    }),
    db.execute({
      sql: `SELECT m.*, vp.name as voice_name
            FROM messages m
            JOIN voice_profiles vp ON m.voice_profile_id = vp.id
            ${whereClause}
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?`,
      args: [...filterArgs, limit, offset],
    }),
  ]);

  const total = Number(countRes.rows[0]!.total);
  return c.json({ messages: result.rows, total, limit, offset });
});

tts.get('/messages/:id/audio', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid message ID format', error_code: 'INVALID_MESSAGE_ID' }, 400);
  }

  const result = await db.execute({
    sql: `SELECT id, user_id, voice_profile_id, text, synthesis_text,
                 delivery_tags_json, audio_url, category
          FROM messages
          WHERE id = ?
            AND EXISTS (
              SELECT 1 FROM voice_profiles visible_vp
              WHERE visible_vp.id = messages.voice_profile_id
                AND visible_vp.deleted_at IS NULL
                AND COALESCE(visible_vp.is_draft, 0) = 0
            )
            AND (
              user_id IN (?, ?)
              OR EXISTS (
                SELECT 1 FROM alarms a
                WHERE a.message_id = messages.id
                  AND a.target_user_id IN (?, ?)
              )
              OR (
                COALESCE(messages.is_preset, 0) = 1
                AND EXISTS (
                  SELECT 1 FROM voice_profiles vp
                  WHERE vp.id = messages.voice_profile_id
                    AND COALESCE(vp.is_system, 0) = 1
                )
              )
            )`,
    args: [id, ...ownerIds, ...ownerIds],
  });

  if (result.rows.length === 0) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  const message = typedRow<{
    id: string;
    voice_profile_id: string;
    text: string | null;
    synthesis_text: string | null;
    delivery_tags_json: string | null;
    audio_url: string | null;
    category: string | null;
  }>(result.rows[0]!);
  const audioUrl = message.audio_url;
  if (!audioUrl) {
    return c.json(
      { error: 'Message has no stored audio', error_code: 'MESSAGE_AUDIO_MISSING' },
      404,
    );
  }

  const loaded = await loadAudioBytes(c, audioUrl);
  if (!loaded) {
    return c.json(
      { error: 'Stored audio object not found', error_code: 'MESSAGE_AUDIO_NOT_FOUND' },
      404,
    );
  }

  return c.json({
    message_id: message.id,
    audio_base64: uint8ToBase64(loaded.bytes),
    audio_format: loaded.format,
    audio_url: audioUrl,
    text: message.text ?? '',
    synthesis_text: message.synthesis_text ?? message.text ?? '',
    tags: parseDeliveryTags(message.delivery_tags_json),
    category: message.category ?? 'custom',
    voice_profile_id: message.voice_profile_id,
  });
});

tts.delete('/messages/:id', async (c) => {
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const ownerIds = [userPk, userId] as [string, string];
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid message ID format', error_code: 'INVALID_MESSAGE_ID' }, 400);
  }

  // 내부 프리셋 버킷 클립은 삭제 금지 — 삭제하면 /tts/stock-clips 오프라인 버킷이 불완전해진다.
  // R2/asset 삭제 부수효과가 아래에서 먼저 실행되므로, 반드시 그 전에 early-return 으로 막는다
  // (messages DELETE 에만 is_preset 가드를 걸면 오디오가 이미 지워진 뒤 404 로 no-op 됨).
  const presetCheck = await db.execute({
    sql: `SELECT COALESCE(is_preset, 0) AS is_preset FROM messages
          WHERE id = ? AND user_id IN (?, ?)`,
    args: [id, ...ownerIds],
  });
  if (presetCheck.rows.length > 0 && Number(presetCheck.rows[0]!.is_preset) === 1) {
    return c.json(
      { error: 'Preset stock clips cannot be deleted.', error_code: 'MESSAGE_PRESET_LOCKED' },
      403,
    );
  }

  const alarmCheck = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM alarms WHERE message_id = ?',
    args: [id],
  });
  const alarmCount = Number(typedRow<{ cnt: number }>(alarmCheck.rows[0]!).cnt ?? 0);

  if (alarmCount > 0 && c.req.query('force') !== 'true') {
    return c.json(
      {
        warning: true,
        error_code: 'MESSAGE_IN_USE',
        alarm_count: alarmCount,
        message: `This message is used by ${alarmCount} alarm(s). Add ?force=true to delete anyway.`,
      },
      409,
    );
  }

  if (alarmCount > 0) {
    await db.execute({
      sql: `UPDATE alarms
            SET mode = 'sound-only',
                wake_mode = 'sound_then_voice',
                message_id = NULL,
                voice_profile_id = NULL,
                speaker_id = NULL,
                raw_audio_url = NULL,
                raw_audio_duration_ms = NULL
            WHERE message_id = ?
              AND EXISTS (
                SELECT 1 FROM messages WHERE id = ? AND user_id IN (?, ?)
              )`,
      args: [id, id, ...ownerIds],
    });
  }

  await db.execute({
    sql: 'DELETE FROM message_library WHERE message_id = ? AND user_id IN (?, ?)',
    args: [id, ...ownerIds],
  });

  // 메시지를 지우기 전에 백킹 R2 오브젝트를 삭제 큐에 적재한다. 큐에 넣지 않고
  // generated_audio_assets 행만 지우면 object_key 가 어디에도 기록되지 않아
  // R2 의 mp3 가 영구히 고아로 남는다(가장 흔한 사용자 동작인 메시지 삭제마다 누수).
  const assetKeysRes = await db.execute({
    sql: `SELECT audio_object_key FROM generated_audio_assets
          WHERE message_id = ? AND user_id IN (?, ?) AND audio_object_key IS NOT NULL`,
    args: [id, ...ownerIds],
  });
  if (assetKeysRes.rows.length > 0) {
    const { enqueueExternalDeletion } = await import('../lib/audio-retention');
    for (const row of assetKeysRes.rows) {
      await enqueueExternalDeletion(db, 'r2_object', row.audio_object_key as string);
    }
  }

  await db.execute({
    sql: 'DELETE FROM generated_audio_assets WHERE message_id = ? AND user_id IN (?, ?)',
    args: [id, ...ownerIds],
  });

  const result = await db.execute({
    sql: 'DELETE FROM messages WHERE id = ? AND user_id IN (?, ?)',
    args: [id, ...ownerIds],
  });

  if (result.rowsAffected === 0) {
    return c.json({ error: 'Message not found', error_code: 'MESSAGE_NOT_FOUND' }, 404);
  }

  return c.json({ ok: true, alarms_affected: alarmCount });
});

tts.get('/presets', async (c) => {
  return c.json({ presets: await loadTtsPresets(c.env) });
});

// 무료 플랜용 스톡(미리 만든) 알람 클립 목록. 시스템 보이스로 서버에서 합성해 둔
// 고정 클립을 보이스 × 언어 × 카테고리로 노출한다. 오디오는 message_id 로
// 오디오 자체는 GET /tts/messages/:id/audio 에서 받는다. 시스템 스톡은 모든 사용자가 조회
// 가능하고, 유료 클론 사전렌더 클립은 '소유자 본인'에게만 노출한다(is_system=0·실소유자 user_id).
tts.get('/stock-clips', async (c) => {
  const db = getDB(c.env);
  const userId = c.get('userId');
  const userPk = c.get('userIdPK') || userId;
  const result = await db.execute({
    sql: `SELECT m.id AS message_id, m.voice_profile_id, m.text, m.category, m.language,
                 m.variant, m.delivery_tags_json, m.audio_url, vp.name AS voice_name
          FROM messages m
          JOIN voice_profiles vp ON vp.id = m.voice_profile_id
          WHERE COALESCE(m.is_preset, 0) = 1
            AND (COALESCE(vp.is_system, 0) = 1 OR m.user_id IN (?, ?))
            AND vp.deleted_at IS NULL
            AND m.audio_url IS NOT NULL
          ORDER BY vp.id ASC, m.category ASC, m.language ASC, m.variant ASC`,
    args: [userPk, userId],
  });
  return c.json({
    clips: result.rows.map((row) => ({
      message_id: row.message_id,
      voice_profile_id: row.voice_profile_id,
      voice_name: row.voice_name,
      category: row.category,
      language: row.language,
      variant: Number(row.variant ?? 0),
      text: row.text,
      audio_url: row.audio_url,
      tags: parseDeliveryTags(row.delivery_tags_json),
    })),
  });
});

// 사전렌더 클론 버킷(날씨/운세)의 '어느 variant 를 틀지' 인덱스만 서버가 resolve 한다. 클라는
// 발사 전날 준비창(온라인)에서 이걸 호출해 알람에 인덱스를 스냅샷하고, 발사는 오프라인 lookup 만
// 한다(발사 순간 네트워크 0). 오디오는 이미 로컬 캐시돼 있으므로 여기서 생성/전송하지 않는다.
tts.get('/prerender-variant', async (c) => {
  const context = c.req.query('context') ?? '';
  if (context === 'wake_weather') {
    const input = await loadWeatherSignalInput({
      country: c.req.query('country'),
      city: c.req.query('city'),
      targetDate: c.req.query('target_date'),
      timezone: c.req.query('timezone'),
    });
    // 날씨 조회 실패(open-meteo 불통·위치 미상 등)면 null 을 돌려, 클라가 '맑음(index 0)'과
    // '해결 실패'를 구분해 잘못된 스냅샷을 저장하지 않게 한다.
    return c.json({ context, variant_index: input ? resolvePrerenderWeatherIndex(input) : null });
  }
  // 운세는 클라가 사주+날짜로 온디바이스 결정(fortuneThemeIndex)한다. 그 외(love/medication 회전)도
  // 서버 인덱스 불필요.
  return c.json({ context, variant_index: null });
});

async function findCachedGeneratedAudio(
  c: Context<AppEnv>,
  userIds: [string, string],
  cacheKey: string,
  options?: { anyUser?: boolean },
): Promise<{
  messageId: string;
  provider: string;
  synthesisText: string;
  audioUrl: string;
  audioObjectKey: string | null;
  audioFormat: string;
  bytes: Uint8Array;
} | null> {
  const db = getDB(c.env);
  // anyUser=true (시스템 보이스): 누가 생성했든 같은 request_hash 캐시를 재사용.
  const result = await db.execute({
    sql: `SELECT ga.message_id, ga.provider,
                 COALESCE(ga.text, m.synthesis_text, m.text) AS synthesis_text,
                 ga.audio_url, ga.audio_object_key, ga.audio_format, ga.mime_type
          FROM generated_audio_assets ga
          JOIN messages m ON m.id = ga.message_id
          WHERE ${options?.anyUser ? '' : 'ga.user_id IN (?, ?) AND '}ga.request_hash = ?
          LIMIT 1`,
    args: options?.anyUser ? [cacheKey] : [...userIds, cacheKey],
  });

  if (result.rows.length === 0) return null;
  const cached = typedRow<{
    message_id: string;
    provider: string;
    synthesis_text: string | null;
    audio_url: string | null;
    audio_object_key: string | null;
    audio_format: string | null;
  }>(result.rows[0]!);

  if (!cached.audio_url) return null;
  const loaded = await loadAudioBytes(c, cached.audio_url);
  if (!loaded) return null;

  return {
    messageId: cached.message_id,
    provider: cached.provider,
    synthesisText: cached.synthesis_text ?? '',
    audioUrl: cached.audio_url,
    audioObjectKey: cached.audio_object_key,
    audioFormat: cached.audio_format ?? loaded.format,
    bytes: loaded.bytes,
  };
}

function parseDeliveryTags(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export default tts;
