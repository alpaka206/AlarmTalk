import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { callerOwnerIds } from '../lib/caller-ids';
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
import { recloneEvictedVoiceProfile } from '../lib/voice-recover';
import {
  AlarmTextPreparationInvalidError,
  AlarmTextTranslationUnavailableError,
  applyDeliveryTagPerSentence,
  generateDynamicAlarmTextWithVertex,
  generatePrerenderClipText,
  deriveAlarmDisplayText,
  normalizeAlarmTextWithoutTags,
  parseSpeechStyle,
  prepareAlarmTextWithVertex,
  type WeatherSignal,
  type WeatherCondition,
} from '../lib/vertex-translate';
import {
  CLONE_CLIP_SEEDS,
  CLONE_WEATHER_CONDITIONS,
  FREE_BUCKET_CATEGORIES,
  STOCK_CLIP_PRESETS,
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
// 클라가 보내는 카테고리(= messages.category 저장값). 넷이 전부다.
//  - morning: 기본값·날씨·운세가 공통으로 쓰는 라벨(문구는 preset/동적 경로가 따로 정한다)
//  - medication / love: 그 문구를 고른 알람
//  - custom: 직접 입력
const TTS_CATEGORIES = ['morning', 'medication', 'love', 'custom'] as const;

// 편집기가 실제로 고를 수 있는 문구 종류. medication 은 일부러 빠져 있다 — 아래
// normalizeRandomContext 의 폴백으로 'preset' 에 접혀 고정 문구 경로를 탄다.
const RANDOM_CONTEXTS = ['preset', 'wake_weather', 'wake_fortune', 'love'] as const;
type RandomContext = (typeof RANDOM_CONTEXTS)[number];


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
  return null;
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
  return context === 'wake_weather';
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

/**
 * 요청 카테고리(TTS_CATEGORIES) → 스톡 프리셋 카테고리. 클라는 기본값 문구를 'morning' 으로
 * 보내는데, 문구 출처인 STOCK_CLIP_PRESETS 는 greeting·weather·medication 만 갖는다.
 * 여기서만 이어 붙이고 클라는 건드리지 않는다.
 *  - morning = 사용자가 문구를 안 바꿨을 때의 기본값 → greeting(목소리 미리듣기와 같은 인사말)
 *  - medication = 그대로
 *  - love 는 스톡 프리셋에 대응 문구가 없다(동적 생성 전용) → null 이 돌아가고
 *    호출부가 VOICE_AND_TEXT_REQUIRED 로 막는다.
 */
function stockPresetCategory(category: string): string {
  return category === 'morning' ? STOCK_GREETING_CATEGORY : category;
}

/**
 * random_context='preset' 의 문구를 고른다. 출처는 사전렌더와 **같은** STOCK_CLIP_PRESETS 다.
 * 버킷이 아직 준비 안 돼 이 라이브 폴백으로 내려와도 사전렌더 클립과 같은 문장이 나온다.
 */
function pickRandomPresetText(category: string, language: string): string | null {
  const preset = STOCK_CLIP_PRESETS.find((item) => item.category === stockPresetCategory(category));
  if (!preset) return null;
  const texts = preset.texts as Partial<Record<string, readonly string[]>>;
  const messages = (texts[language] ?? texts.ko ?? [])
    .map((message) => message.trim())
    .filter(Boolean);
  if (messages.length === 0) return null;
  return messages[randomIndex(messages.length)]!;
}

// 프리셋 문구 앞에 호칭을 붙인다. 프리셋은 '[brightly] 오늘은…' 처럼 delivery 태그로 시작하는데,
// 호칭을 그 **앞**에 붙이면 태그가 문장 중간으로 밀려 호칭만 톤 지시 없이 읽힌다.
// 그래서 선두 태그는 그대로 두고 그 뒤에 끼워 넣는다.
function presetTextWithListenerTitle(text: string, listenerTitle: string | null): string {
  const title = listenerTitle?.trim();
  const base = text.trim();
  if (!title || !base) return base;
  const lead = base.match(/^\[[a-z][a-z -]{1,32}\]\s*/i)?.[0] ?? '';
  const spoken = base.slice(lead.length);
  if (!spoken || spoken.startsWith(title)) return base;
  const withTitle = `${lead}${title}, ${spoken}`;
  return withTitle.length <= 200 ? withTitle : base;
}

function draftPreviewText(language: string): string {
  if (language === 'ja') return 'おはよう。今日も気持ちよく起きよう。';
  if (language === 'en') return 'Good morning. It is time to start your day.';
  return '좋은 아침이야. 오늘도 기분 좋게 일어나자.';
}

async function findUsableVoiceProfile(
  db: DbExecutor,
  // 소유권 기준은 userPk(users.id). 이 값은 통일 이전에 user_id 에 저장된 로그인
  // 식별자까지 매칭하기 위한 보조값이다.
  userLoginId: string,
  userPk: string,
  voiceProfileId: string,
): Promise<Record<string, unknown> | null> {
  const owned = await db.execute({
    sql: 'SELECT * FROM voice_profiles WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL',
    args: [voiceProfileId, userPk, userLoginId],
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

async function findViewerRelationshipField(
  db: ReturnType<typeof getDB>,
  userPk: string,
  // 통일 이전에 저장된 로그인 식별자까지 매칭하기 위한 보조값.
  userLoginId: string,
  voiceProfileId: string,
  column: 'relationship_label' | 'listener_title',
): Promise<string | null> {
  const result = await db.execute({
    sql: `SELECT ${column}
          FROM voice_profile_relationships
          WHERE voice_profile_id = ? AND user_id IN (?, ?)
          ORDER BY updated_at DESC
          LIMIT 1`,
    args: [voiceProfileId, userPk, userLoginId],
  });
  return normalizeRelationshipLabel(result.rows[0]?.[column]);
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
  // 소유권 기준은 users.id(userPk). userLoginId 는 통일 이전에 user_id 컬럼에 저장된
  // 로그인 식별자(구글 로그인이면 google_id)까지 매칭하기 위한 보조값이다.
  const userLoginId = c.get('userLoginId');
  const resolvedUserPk = c.get('userIdPK');
  const userPk = resolvedUserPk || userLoginId;
  const ownerIds = callerOwnerIds(c);
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
    ? normalizeRandomContext(
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

  // 프리셋 문구는 STOCK_CLIP_PRESETS 에서 오고 '[brightly]' 같은 delivery 태그를 달고 온다.
  // 사용자가 친 대괄호가 아니라 우리 마크업이므로 표시 문구에서는 벗겨야 한다(아래 messageText).
  const presetTextUsed = !draftPreviewRequested && randomRequested && randomContext === 'preset';
  let requestText = draftPreviewRequested
    ? draftPreviewText('ko')
    : presetTextUsed
      ? pickRandomPresetText(category, normalizeSynthesisLanguage(body.language))
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

  // ⚠ `SELECT *` 로 두지 말 것. 여기서 쓰는 건 `plan` 하나인데, users 행에는
  // `apple_refresh_token` 같은 **비밀값**과 JSON 덩어리(`dynamic_prompt_settings_json`,
  // `family_alarm_quiet_windows`)가 함께 있다. 알람 저장마다 도는 경로라 필요 없는 값을
  // 메모리에 올릴 이유가 없고, 특히 토큰은 쓰지도 않으면서 끌어오면 안 된다.
  const user = await db.execute({
    sql: 'SELECT plan FROM users WHERE id = ? OR google_id = ? LIMIT 1',
    args: ownerIds,
  });
  if (user.rows.length === 0) {
    // 계정 행을 못 찾으면 막는다. 예전에는 `else if (resolvedUserPk)` 라 식별자
    // 미해결 시 사용량 체크를 건너뛰고 그대로 진행했다(fail-open).
    return c.json(
      {
        error: 'Voice features require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }

  // 직접 입력 미터링 폴백용(구독/그룹을 못 찾을 때 페이월과 같은 출처인 users.plan 사용).
  const callerUserPlan = (user.rows[0]!.plan as string) ?? null;
  // 무료 플랜은 시스템 스톡 보이스 + 프리셋(고정) 문구 조합만 허용한다.
  // 보이스 조회 후에 is_system 여부와 함께 최종 판정한다.
  const freePlanRestricted = !isPaidVoicePlan(callerUserPlan);

  const vp = await findUsableVoiceProfile(db, userLoginId, userPk, body.voice_profile_id);
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
        ? await findViewerRelationshipField(db, userPk, userLoginId, body.voice_profile_id, 'listener_title')
        : null) ??
      normalizeRelationshipLabel(vp.listener_title);
    if (draftPreviewRequested) draftPreviewListenerTitle = listenerTitle ?? null;
    // 미리듣기는 아래에서 관계·호칭 톤 적응 생성을 시도한다 — 여기서 만든 '고정 예문+호칭 접두어'는
    // 생성 실패(Vertex 미설정/모델 오류) 시의 폴백 문구가 된다.
    requestText = presetTextWithListenerTitle(requestText, listenerTitle);
  }
  // 기본(시스템) 목소리는 원칙적으로 '프리셋(날씨/약)'만 허용한다 — 동적 생성·번역은
  // 매번 비용이 들어 유료 커스텀 클론 전용이다.
  //
  // ⚠ **단 하나 예외: 유료 사용자의 '직접 입력' 은 기본 목소리로도 허용한다**
  // (2026-08-11 결정). 예전에는 유료여도 기본 목소리면 직접 입력이 막혀서, 이용권을 산
  // 사람이 **왜 안 되는지 알 수 없는 벽**을 만났다("왜 사라졌지"). 시스템 보이스에도
  // `elevenlabs_voice_id` 가 있어 **말할 수는 있고**, 막던 이유는 비용이었다 —
  // 그 비용은 **직접 입력 월 한도**(`reserveManualTtsQuota`)가 이미 세고 있다.
  // 그래서 한도를 차감하는 조건으로 연다.
  //
  // 여전히 막는 것: 무료 플랜 / 동적 문구(날씨·운세) / 번역. 그쪽은 한도로 세지 않는다.
  const manualTextOnSystemVoice =
    !freePlanRestricted && isSystemVoice && !randomRequested && body.translate !== true;
  const presetOnlyRestricted = (freePlanRestricted || isSystemVoice) && !manualTextOnSystemVoice;
  // 무료 플랜은 시스템 스톡 보이스만 쓸 수 있다(커스텀 클론 불가). 시스템 보이스면 통과.
  if (freePlanRestricted && !isSystemVoice) {
    return c.json(
      {
        error: 'Voice features require a paid plan.',
        error_code: 'VOICE_FEATURE_REQUIRES_PAID_PLAN',
      },
      403,
    );
  }
  if (presetOnlyRestricted) {
    // 무료는 기존 코드 유지, 기본 목소리(유료+시스템)는 별도 코드로 구분.
    const presetOnlyCode = freePlanRestricted ? 'FREE_PLAN_PRESET_ONLY' : 'BASIC_VOICE_PRESET_ONLY';
    // 커스텀 텍스트·동적(날씨/운세) 문구·번역은 매번 생성 비용이 들어 유료 커스텀 클론 전용.
    if (!randomRequested || randomContext !== 'preset' || body.translate === true) {
      return c.json(
        {
          error: 'This voice supports preset phrases only.',
          error_code: presetOnlyCode,
        },
        403,
      );
    }
    // F2: 기본 목소리(=무료 버킷)는 날씨·약만 허용한다. love 만 막던 블랙리스트로는
    // morning/love 등 다른 요청 카테고리가 새어 시스템 보이스로 합성됐다(Codex #599).
    // 무료 버킷 카테고리(FREE_BUCKET_CATEGORIES = weather, medication) 화이트리스트로 바꿔 그 외
    // 카테고리를 전부 차단한다(날씨 동적은 위 randomContext!=='preset' 에서 이미 걸리므로, 실제
    // 프리셋 경로로 통과하는 건 medication 뿐). 무료 플랜도 동일 버킷이라 함께 조인다.
    if (!FREE_BUCKET_CATEGORIES.includes(category)) {
      return c.json(
        {
          error: 'This voice supports weather and medication phrases only.',
          error_code: presetOnlyCode,
        },
        403,
      );
    }
    // 암묵적 번역 우회 차단: 프리셋 문구는 여기서 이미 확정되므로 source 언어를 산정할 수 있다.
    // 요청 언어가 source 와 다르면 아래 shouldTranslate 분기가 켜져 유료 번역 경로로 새어 나간다.
    // translate===true 와 동일하게 차단해 프리셋 요청이 번역을 절대 호출하지 못하게 한다.
    const requestedLanguageForGate = normalizeSynthesisLanguage(body.language);
    const sourceLanguageForGate = inferSynthesisLanguage(requestText, 'ko');
    if (requestedLanguageForGate !== sourceLanguageForGate) {
      return c.json(
        {
          error: 'This voice supports preset phrases only.',
          error_code: presetOnlyCode,
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
      } else if (vp.previewed_at) {
        // 이미 확정(previewed_at)됐는데 저장 문구가 없는 draft = 이 기능 이전(또는 고정 폴백으로 확정).
        // 그때 합성된 문구는 '고정 예문+호칭'이므로 새로 생성하면 캐시 키가 어긋나 재생이
        // VOICE_PREVIEW_UNAVAILABLE 이 된다 → 생성하지 않고 고정 폴백을 유지해 재생 캐시 히트를 지킨다.
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
              // 등록 녹음에서 분석한 화자 말투(사투리 등) — 미리듣기 문구를 그 말투로.
              speechStyle: parseSpeechStyle(vp.speech_style),
            });
            // ⚠ **여기 들어오는 문구는 태그를 벗겨서 쓴다**(2026-08-20).
            // `generatePrerenderClipText` 는 이제 딜리버리 태그가 인라인으로 박힌 문구를
            // 돌려준다. 그런데 이 값은 `preview_text` 로 저장돼 **사용자가 직접 고치는**
            // 문구이고, 아래에서 `applyDeliveryTagPerSentence` 로 태그를 다시 입힌다 —
            // 그대로 받으면 화면에 대괄호가 노출되고 합성 문구는 `[cheerfully] [cheerfully] …`
            // 로 겹친다(테스트 `draft 미리듣기는 … 톤 적응 문구로 합성한다` 가 잡았다).
            requestText = normalizeAlarmTextWithoutTags(generated.text) || generated.text;
            if (generated.tag) draftPreviewTag = generated.tag;
            // 합성 전에 영속: 합성이 실패해도 재시도가 같은 문구를 쓰게(중복 생성 방지 + 캐시 정합).
            // 조건부(비어있을 때만) 쓰기 = first-writer-wins: 동시 첫-미리듣기 요청이 겹쳐도 늦은 쪽이
            // 이미 영속된(재생될) 문구를 덮어써 재생 결정성을 깨지 못한다. 지면 승자 문구를 재사용.
            // 페르소나 predicate(관계/호칭, preview claim 과 동일 기준): 생성 왕복 중 관계·호칭이
            // 편집됐으면 옛 페르소나로 만든 문구를 저장하지 않는다(써 두면 다음 미리듣기가 재사용).
            // previewed_at/claim 가드: 다른 요청이 이미 확정했거나(폴백 문구로 합성됐을 수 있음)
            // 활성 claim 으로 합성 중이면 저장하지 않는다 — 늦은 영속이 '실제 합성된 문구'와 다른
            // 문구를 남겨 재생 캐시 키를 어긋내는 것 방지(claim 과 동일한 5분 lease 기준).
            const persisted = await db.execute({
              sql: `UPDATE voice_profiles
                    SET preview_text = ?, preview_tag = ?, updated_at = datetime('now')
                    WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                      AND COALESCE(is_draft, 0) = 1
                      AND COALESCE(relationship_label, '') = ?
                      AND COALESCE(listener_title, '') = ?
                      AND COALESCE(preview_text, '') = ''
                      AND previewed_at IS NULL
                      AND (preview_claimed_at IS NULL
                        OR preview_claimed_at <= datetime('now', '-5 minutes'))`,
              args: [
                // 위에서 태그를 벗겨 `requestText` 로 쓴 그 문구를 그대로 저장한다.
                // `generated.text`(태그 포함)를 저장하면 **저장본과 합성·표시본이 갈려**
                // 다음 재생이 캐시를 빗나가고, 사용자가 고치는 화면에 대괄호가 뜬다.
                requestText,
                draftPreviewTag,
                body.voice_profile_id,
                userPk,
                userLoginId,
                String(vp.relationship_label ?? ''),
                String(vp.listener_title ?? ''),
              ],
            });
            if ((persisted.rowsAffected ?? 0) === 0) {
              const winner = await db.execute({
                sql: `SELECT preview_text, preview_tag FROM voice_profiles
                      WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                      LIMIT 1`,
                args: [body.voice_profile_id, userPk, userLoginId],
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
        (await findViewerRelationshipField(db, userPk, userLoginId, body.voice_profile_id, 'relationship_label')) ??
        (isSharedVoiceProfile ? null : normalizeRelationshipLabel(vp.relationship_label));
      const listenerTitle =
        normalizeRelationshipLabel(body.listener_title ?? body.listenerTitle) ??
        (await findViewerRelationshipField(db, userPk, userLoginId, body.voice_profile_id, 'listener_title')) ??
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
      // 태그는 문장마다 다시 앞세워 끝까지 톤을 고정하고, 상한 초과 시 태그 없이 폴백한다
      // (그때 tags 배열도 비워 메타와 합성 텍스트를 일치시킨다).
      // 상한 200 = 아래 synthesisText 200자 검증과 동일 값 — 기본 300을 쓰면 태그 부착으로
      // 200을 넘긴 텍스트가 폴백 없이 통과했다가 뒤늦게 TEXT_TOO_LONG 으로 거부된다.
      const taggedText = applyDeliveryTagPerSentence(draftPreviewTag, requestText, 200);
      const tagApplied = taggedText !== requestText;
      prepared = {
        text: taggedText,
        translated: false,
        tags: tagApplied ? [draftPreviewTag] : [],
      };
    } else if (dynamicGenerated) {
      // ⚠ **모델이 배치한 인라인 태그를 살린다**(Codex #701 P2).
      // 예전에는 `tags[0]` 하나를 뽑아 문장마다 다시 앞세웠다. 모델이 태그를 인라인으로
      // 내기 시작하면 그 경로는 배치를 뭉갤 뿐 아니라, `tags` 가 빈 채로 남아
      // `delivery_tags_json` 이 `[]` 가 되고 대괄호가 화면 문구로 샌다.
      // `synthesisText` 가 있으면 그게 곧 합성 문구다(표시는 아래 `messageText` 가 태그 없는
      // `dynamicGenerated.text` 를 쓴다). 없으면 예전대로 태그 하나를 문장마다 입힌다.
      const dynamicTag = dynamicGenerated.tags[0] ?? '';
      // 상한 200: 위 draft 미리듣기 경로와 동일 — 태그 부착이 200자 검증을 넘기지 않게 한다.
      const taggedText =
        dynamicGenerated.synthesisText ??
        applyDeliveryTagPerSentence(dynamicTag, dynamicGenerated.text, 200);
      const tagApplied = taggedText !== dynamicGenerated.text;
      prepared = {
        text: taggedText,
        translated: false,
        tags: tagApplied ? dynamicGenerated.tags : [],
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
    //
    // 프리셋 경로는 사용자가 친 문구가 없다(우리 스톡 문구 + 그 안의 delivery 태그). 원문을
    // 그대로 넘기면 태그를 '사용자 대괄호'로 보고 보존해 화면에 '[brightly] …' 가 샌다.
    // 빈 원문을 넘겨 태그를 벗긴다 — 사전렌더 경로(stock-clips.ts stripDeliveryTags)와 같은 결과.
    const messageText = dynamicGenerated
      ? dynamicGenerated.text
      : deriveAlarmDisplayText(synthesisText, presetTextUsed ? '' : requestText);
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

    // ⚠ **태그를 뺀 길이로 잰다**(2026-08-13 — C안).
    // 200자는 **사용자에게 들리는 말**의 상한이다. 태그는 낭독되지 않는데 예전에는 그것까지
    // 세어서, 태그가 여러 개 붙으면(`[through gritted teeth]` 하나만 24자) 규격대로 만든
    // 문구가 뒤늦게 400 으로 거절됐다.
    if (normalizeAlarmTextWithoutTags(synthesisText).length > 200) {
      return c.json(
        { error: 'Prepared text must be 200 characters or less', error_code: 'TEXT_TOO_LONG' },
        400,
      );
    }

    const buildPreparedAttempts = async (voiceIdForSynthesis: string | null | undefined) => {
      const attempts = createSynthesisAttempts({
        env: c.env,
        profile: {
          elevenlabs_voice_id: voiceIdForSynthesis,
        },
        text: synthesisText,
        language: synthesisLanguage,
      });
      return Promise.all(
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
          });
          return { attempt, cacheKey };
        }),
      );
    };

    // F3: 이 프로필이 슬롯 상한(F1)으로 evict돼 provider 보이스가 없으면(elevenlabs_voice_id NULL
    // + evicted_at 세팅) 곧바로 재클론하지 않는다 — 캐시 키는 provider voice id 를 포함하므로,
    // evict 직전 id(evicted_provider_voice_id)로 캐시를 먼저 프로브해 보관 오디오가 있으면 재클론
    // 없이 그대로 서빙한다(불필요한 외부 등록·연쇄 eviction 방지, Codex #602). 캐시 미스가 확정된
    // 뒤(아래, 합성 직전)에만 R2 원본으로 재클론한다. 위 게이트에서 소유자(비공유 클론=caller
    // 본인)의 민감 동의를 이미 검증했고, 재클론 직전 소유자 동의 재검증도 lib 안에서 수행된다.
    // 시스템 보이스는 evict 대상이 아니다.
    const recloneIfEvicted = async (): Promise<string | undefined> => {
      try {
        return (
          (await recloneEvictedVoiceProfile(c.env, db, body.voice_profile_id, String(vp.name ?? ''))) ??
          undefined
        );
      } catch (recloneErr) {
        // 재클론 실패(일시적 공급자 오류 등)가 합성 요청 전체를 500 으로 만들지 않게 —
        // 미복구 시 NO_VOICE_ID 경로가 클라에 재등록을 안내한다.
        console.error('[tts/generate] evicted voice reclone failed', recloneErr);
        return undefined;
      }
    };
    let providerVoiceId = vp.elevenlabs_voice_id as string | null | undefined;
    const isEvictedWithoutVoice = !providerVoiceId && Boolean(vp.evicted_at);
    const evictedProbeVoiceId = isEvictedWithoutVoice
      ? ((vp.evicted_provider_voice_id as string | null | undefined) ?? null)
      : null;
    if (isEvictedWithoutVoice && !evictedProbeVoiceId) {
      // 프로브할 옛 id 가 없는 evict 행(마이그레이션 76 이전 evict 분) — 기존처럼 즉시 재클론.
      providerVoiceId = await recloneIfEvicted();
    }

    let preparedAttempts = await buildPreparedAttempts(providerVoiceId ?? evictedProbeVoiceId);
    if (preparedAttempts.length === 0) {
      return c.json(
        { error: 'No voice ID available for this profile', error_code: 'NO_VOICE_ID' },
        400,
      );
    }

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
          userLoginId,
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
        // ⚠ **직접 입력은 사용자끼리 캐시를 공유하지 않는다.**
        // 공유하면 남의 `messages` 행 id 를 그대로 돌려주는데, 그 행은 `is_preset` 이
        // 0이라 `messageBelongsToCaller` 가 나중에 거절한다 — **들리는데 저장이 안 되는**
        // 그 사고다(CLAUDE.md 「messageBelongsToCaller」 절). 게다가 캐시 히트가
        // `reserveManualTtsQuota` 보다 앞이라, 남의 문구에 얹히면 **월 한도가 안 깎인다.**
        // 프리셋(랜덤) 문구는 문구 자체가 우리 것이라 예전처럼 공유한다.
        anyUser: isSystemVoice && !isManualGeneration,
      });
      if (cached) {
        // F1: 캐시 히트도 '사용'으로 보고 LRU 신호를 갱신한다(사전렌더/캐시 재생 알람이 자주
        // 쓰는 커스텀 클론이 오래 안 쓴 것으로 오판돼 evict되지 않게). 시스템 보이스는 no-op.
        await db.execute({
          sql: `UPDATE voice_profiles SET last_used_at = datetime('now')
                WHERE id = ? AND COALESCE(is_system, 0) = 0`,
          args: [body.voice_profile_id],
        });
        if (draftPreviewRequested && activePreviewClaimToken) {
          const marked = await db.execute({
            sql: `UPDATE voice_profiles SET preview_claimed_at = NULL,
                        updated_at = datetime('now')
                  WHERE id = ? AND user_id IN (?, ?) AND deleted_at IS NULL
                    AND COALESCE(is_draft, 0) = 1 AND status = 'ready'
                    AND preview_claim_token = ?`,
            args: [body.voice_profile_id, userPk, userLoginId, activePreviewClaimToken],
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

    // F3(Codex #602): 캐시 미스 확정 — 프로브만 있고 실제 provider 보이스는 없는 상태라면
    // 이제서야 R2 원본으로 재클론하고, 새 voice id 로 합성 attempt 를 다시 만든다.
    // (쿼터 예약보다 앞: 재클론 실패 시 쿼터를 소모하지 않고 NO_VOICE_ID 로 재등록을 안내.)
    if (!providerVoiceId && isEvictedWithoutVoice && evictedProbeVoiceId) {
      providerVoiceId = await recloneIfEvicted();
      if (!providerVoiceId) {
        return c.json(
          { error: 'No voice ID available for this profile', error_code: 'NO_VOICE_ID' },
          400,
        );
      }
      preparedAttempts = await buildPreparedAttempts(providerVoiceId);
      if (preparedAttempts.length === 0) {
        return c.json(
          { error: 'No voice ID available for this profile', error_code: 'NO_VOICE_ID' },
          400,
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
              userLoginId,
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

            // F1: 합성 성공을 '사용'으로 보고 LRU 신호를 갱신한다. 시스템 보이스는 no-op.
            await tx.execute({
              sql: `UPDATE voice_profiles SET last_used_at = datetime('now')
                    WHERE id = ? AND COALESCE(is_system, 0) = 0`,
              args: [body.voice_profile_id],
            });

            if (audioUrl) {
              await tx.execute({
                sql: `INSERT OR IGNORE INTO generated_audio_assets
                  (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                   model_id, language, request_hash, text, audio_url,
                   audio_object_key, audio_format, mime_type)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                  audioUrl,
                  audioObjectKey,
                  generated.outputFormat,
                  generated.mimeType,
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
                args: [body.voice_profile_id, userPk, userLoginId, activePreviewClaimToken],
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
        if (attempt !== preparedAttempts[preparedAttempts.length - 1]?.attempt) continue;
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
          args: [body.voice_profile_id, userPk, userLoginId, activePreviewClaimToken],
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
    // K1: 제공자(ElevenLabs/Vertex) 응답 원문을 detail 로 반사하지 않는다. 원문은 위
    // console.error 로만 남기고, 응답에는 안정 에러코드만 노출한다.
    return c.json(
      {
        error: 'TTS generation failed',
        error_code: 'TTS_GENERATION_FAILED',
        detail: 'TTS_GENERATION_FAILED',
      },
      500,
    );
  }
});

// 이번 달 직접 입력 문구 만들기 사용 현황(선택기 '직접 입력 (남은/총)' 표시용). 소비 없음.
tts.get('/manual-quota', async (c) => {
  // 소유권 기준은 users.id(userPk). userLoginId 는 통일 이전에 user_id 컬럼에 저장된
  // 로그인 식별자(구글 로그인이면 google_id)까지 매칭하기 위한 보조값이다.
  const userLoginId = c.get('userLoginId');
  const userPk = c.get('userIdPK') || userLoginId;
  const ownerIds = callerOwnerIds(c);
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
  // 소유권 기준은 users.id(userPk). userLoginId 는 통일 이전에 user_id 컬럼에 저장된
  // 로그인 식별자(구글 로그인이면 google_id)까지 매칭하기 위한 보조값이다.
  const ownerIds = callerOwnerIds(c);
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
  // 소유권 기준은 users.id(userPk). userLoginId 는 통일 이전에 user_id 컬럼에 저장된
  // 로그인 식별자(구글 로그인이면 google_id)까지 매칭하기 위한 보조값이다.
  const userLoginId = c.get('userLoginId');
  const userPk = c.get('userIdPK') || userLoginId;
  const ownerIds = callerOwnerIds(c);
  const db = getDB(c.env);
  const id = c.req.param('id');

  if (!UUID_RE.test(id)) {
    return c.json({ error: 'Invalid message ID format', error_code: 'INVALID_MESSAGE_ID' }, 400);
  }

  const result = await db.execute({
    sql: `SELECT messages.id, messages.user_id, messages.voice_profile_id, messages.text,
                 messages.synthesis_text, messages.delivery_tags_json, messages.audio_url,
                 messages.category,
                 COALESCE(vp.is_system, 0) AS is_system,
                 owner.plan AS owner_plan
          FROM messages
          JOIN voice_profiles vp
            ON vp.id = messages.voice_profile_id
           AND vp.deleted_at IS NULL
           AND COALESCE(vp.is_draft, 0) = 0
          LEFT JOIN users owner
            ON owner.id = vp.user_id OR owner.google_id = vp.user_id
          WHERE messages.id = ?
            AND (
              messages.user_id IN (?, ?)
              OR EXISTS (
                SELECT 1 FROM alarms a
                WHERE a.message_id = messages.id
                  AND a.target_user_id IN (?, ?)
              )
              OR (
                COALESCE(messages.is_preset, 0) = 1
                AND COALESCE(vp.is_system, 0) = 1
              )
              OR (
                COALESCE(messages.is_preset, 0) = 1
                AND COALESCE(vp.is_shared, 0) = 1
                AND EXISTS (
                  SELECT 1
                  FROM plan_group_members pgm_me
                  JOIN plan_group_members pgm_owner
                    ON pgm_owner.plan_group_id = pgm_me.plan_group_id
                  WHERE pgm_me.user_id = ?
                    AND pgm_owner.user_id = owner.id
                )
              )
            )`,
    args: [id, ...ownerIds, ...ownerIds, userPk],
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
    is_system: number | null;
    owner_plan: string | null;
  }>(result.rows[0]!);

  // 무료 플랜 잠금 강제: 유료 클론(비시스템) 보이스의 오디오는 그 보이스 소유자가 유료일 때만
  // 내려준다. 소유자가 무료로 내려가면(다운그레이드) 데이터는 보존하되 재생은 잠기며, 소유자
  // 본인은 물론 공유받은 대상에게도 서버가 오디오를 주지 않는다(삭제된 것과 동일하게 사라짐).
  // 재유료가 되면 users.plan 이 복구돼 그대로 다시 풀린다. 시스템 스톡 보이스는 항상 허용.
  const isSystemVoice = Number(message.is_system ?? 0) === 1;
  if (!isSystemVoice && !isPaidVoicePlan(message.owner_plan)) {
    return c.json(
      {
        error: 'This voice is locked on the free plan.',
        error_code: 'VOICE_LOCKED_FREE_PLAN',
      },
      403,
    );
  }

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

tts.get('/stock-clips', async (c) => {
  const db = getDB(c.env);
  // 소유권 기준은 users.id(userPk). userLoginId 는 통일 이전에 user_id 컬럼에 저장된
  // 로그인 식별자(구글 로그인이면 google_id)까지 매칭하기 위한 보조값이다.
  const userLoginId = c.get('userLoginId');
  const userPk = c.get('userIdPK') || userLoginId;
  const result = await db.execute({
    sql: `SELECT m.id AS message_id, m.voice_profile_id, m.text, m.category, m.language,
                 m.variant, m.delivery_tags_json, m.audio_url, vp.name AS voice_name
          FROM messages m
          JOIN voice_profiles vp ON vp.id = m.voice_profile_id
          WHERE COALESCE(m.is_preset, 0) = 1
            AND (
              COALESCE(vp.is_system, 0) = 1
              OR m.user_id IN (?, ?)
              OR (
                COALESCE(vp.is_shared, 0) = 1
                AND COALESCE(vp.is_draft, 0) = 0
                AND EXISTS (
                  SELECT 1
                  FROM plan_group_members pgm_me
                  JOIN plan_group_members pgm_owner
                    ON pgm_owner.plan_group_id = pgm_me.plan_group_id
                  JOIN users owner_u ON owner_u.id = pgm_owner.user_id
                  WHERE pgm_me.user_id = ?
                    AND (owner_u.id = vp.user_id OR owner_u.google_id = vp.user_id)
                )
              )
            )
            AND vp.deleted_at IS NULL
            AND m.audio_url IS NOT NULL
          ORDER BY vp.id ASC, m.category ASC, m.language ASC, m.variant ASC`,
    args: [userPk, userLoginId, userPk],
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
    // 카테고리별로 **몇 개가 있어야 완전한가**. 앱은 이 값과 자기 캐시를 비교해 부족분만 받고,
    // 클론 버킷이 '완전한지'(variant 0..N-1 이 다 있는지) 판정한다.
    //
    // ⚠ **앱에 개수를 박아 두지 않으려고 서버가 내려준다.** 운영이 시드를 늘리면
    // (예: 날씨 9 → 11) 앱 업데이트 없이 그 값이 따라와야 한다. 상수로 두면 늘어난 분을
    // 영영 안 받고, 그 클립을 고른 알람이 무음이 된다.
    // 날씨처럼 **절대 인덱스로 조건을 고르는** 버킷은 부분 세트면 엉뚱한 문구가 나가므로
    // 이 판정이 특히 중요하다.
    expected_variants: expectedVariantCounts(),
  });
});

/**
 * 목소리 종류별 · 카테고리별로 **완전한 세트의 클립 수**.
 *
 * ⚠ **기본 목소리와 등록(클론) 목소리는 개수가 다르다.** 지금도 `medication` 이 시스템 2 /
 * 클론 3 이다. 그래서 하나로 합치면 안 된다 — 큰 쪽으로 합치면 기본 목소리의 **완전한**
 * 세트(2개)가 '불완전' 으로 읽혀 오프라인 재생이 영영 안 켜지고, 작은 쪽으로 합치면 클론이
 * 부분 세트인데도 완전하다고 읽혀 **없는 클립 자리를 재생하려 든다.**
 *
 * 출처: 시스템은 `STOCK_CLIP_PRESETS`, 클론은 `CLONE_CLIP_SEEDS`. 앱은 고른 목소리가
 * 시스템인지에 따라 둘 중 하나를 본다.
 */
function expectedVariantCounts(): { system: Record<string, number>; clone: Record<string, number> } {
  const system: Record<string, number> = {};
  for (const preset of STOCK_CLIP_PRESETS) {
    // 언어별 문구 수는 같아야 하지만, 어긋나도 ko 를 기준으로 삼는다(시드 원본이 ko 다).
    system[preset.category] = preset.texts.ko?.length ?? 0;
  }
  const clone: Record<string, number> = {};
  for (const group of CLONE_CLIP_SEEDS) {
    clone[group.category] = group.seeds.length;
  }
  return { system, clone };
}

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
