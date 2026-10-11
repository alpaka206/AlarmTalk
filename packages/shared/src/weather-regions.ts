import { z } from 'zod';
import catalogJson from './weather-regions.json';

/**
 * 날씨 지역 목록 — **단일 출처는 옆의 `weather-regions.json`** 이다.
 *
 * 규칙 전문은 `docs/spec/voice-and-message.md` 「5-1」의 '날씨 지역은 목록에서만 고른다'. 요약:
 *
 * - 사용자는 **나라(KR·JP·US) → 그 나라의 지역**을 목록에서 고른다. 직접 입력은 없다.
 *   한국 17개 시·도, 일본 47개 도도부현, 미국은 50개 주의 최대 도시 + 워싱턴 D.C. + 잘 알려진
 *   대도시. 날씨는 지역마다 **고정된 원천의 칸**(`source` — 기상청 격자·気象庁 예보구역·NWS 격자)에서
 *   읽는다. 좌표(`lat`/`lon`, 한국·일본은 시·도청 소재지)는 그 칸을 찾고 검증하는 근거다 —
 *   지오코딩이 없다. 예전에는 두 글자 한국어 이름을 지오코딩해 동명 마을을 잡았다
 *   (부산 → 경북 의성군의 마을, 서울·제주 → 결과 0건).
 * - 저장·전송 값은 **키**(`kr-seoul`)다. 보이는 이름(`names`)은 번역하고, 옛 앱이 읽는
 *   `country`/`city` 칸에는 언어와 무관하게 **한국어 글자**(`canonicalLabels`)를 함께 적는다.
 * - 옛 앱이 저장한 (나라, 도시) 문자열은 `resolveAlias` 로 키를 되짚는다. 규칙은
 *   `scripts/gen-weather-regions.py` 의 `resolve` 와 글자 하나까지 같고, 두 앱의 생성 코드
 *   (`WeatherRegions.kt`·`WeatherRegions.generated.swift`)도 같다 — **하나만 고치지 말 것.**
 *
 * JSON 을 고치면 `python3 scripts/gen-weather-regions.py` 로 두 앱의 파일을 다시 만든다(CI 의
 * `--check` 가 어긋남을 잡는다). ⚠ **이미 나간 키는 바꾸거나 지우지 않는다** — 계정 설정·알람
 * 행·`weather_region_daily` 에 그대로 저장돼 있다. 이름·좌표·별칭은 고쳐도 된다.
 */
export const WEATHER_REGION_LOCALES = ['ko', 'en', 'ja'] as const;
export type WeatherRegionLocale = (typeof WEATHER_REGION_LOCALES)[number];

export const WEATHER_COUNTRY_CODES = ['KR', 'JP', 'US'] as const;
export type WeatherCountryCode = (typeof WEATHER_COUNTRY_CODES)[number];

const KEY_RE = /^(kr|jp|us)-[a-z0-9]+(-[a-z0-9]+)*$/;

const LocalizedNamesSchema = z.object({
  ko: z.string().trim().min(1),
  en: z.string().trim().min(1),
  ja: z.string().trim().min(1),
});

export const WeatherCountrySchema = z.object({
  code: z.enum(WEATHER_COUNTRY_CODES),
  names: LocalizedNamesSchema,
  /** 옛 앱이 읽는 `country` 칸에 쓰는 글자(한국어). */
  legacyLabel: z.string().min(1),
  /** 이름·legacyLabel 밖의 표기. 정규형(`canonicalizeWeatherLabel`)으로 적는다. */
  aliases: z.array(z.string().min(1)),
});

/**
 * 날씨를 **어느 나라 원천의 어느 칸**에서 읽는가 — 지역마다 고정한다(`docs/spec/voice-and-message.md`
 * 5-1 「서버가 미리 계산해 둔다」). 좌표(`lat`/`lon`)에서 매번 계산하지 않고 박아 두는 이유는, 원천의
 * 칸이 바뀌면 그 지역의 날씨가 **조용히 다른 곳의 것**이 되기 때문이다 — 바꿀 때는 사람이 본다.
 *
 * - `kma`(기상청 단기예보): 격자 `nx`·`ny`. 값은 `lat`/`lon` 을 가이드의 LCC 식으로 바꾼 것과 같다
 *   (`packages/shared/test/weather-regions.test.ts` 가 다시 계산해 대조한다). 시·도청이 아니라 **앱이
 *   보여 주는 소재지**(경북 → 안동)의 칸이다.
 * - `jma`(気象庁 bosai): 예보 `office`, 날씨·강수확률을 읽는 1차 세분 구역 `class10`, 기온 지점
 *   `tempStation`(AMeDAS). 주간 예보의 구역은 계절에 따라 갈라지므로(青森·滋賀) 후보를 순서대로 두고
 *   그날 응답에 **실제로 있는 첫 구역**을 쓴다 — 기온 지점은 구역마다 짝지어 둔다.
 * - `nws`(미국 국립기상청): 원시 격자 `gridId`/`gridX`,`gridY`(`/points` 로 한 번 찾은 값).
 *
 * ⚠ 이 칸은 **필수**다 — zod 는 스키마에 없는 키를 지우므로, 선택으로 두면 오타 난 키가 조용히
 *   사라지고 그 지역의 날씨가 영영 미해결이 된다.
 */
export const WeatherSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('kma'),
    nx: z.number().int().min(1).max(149),
    ny: z.number().int().min(1).max(253),
  }),
  z.object({
    kind: z.literal('jma'),
    office: z.string().regex(/^\d{6}$/),
    class10: z.string().regex(/^\d{6}$/),
    tempStation: z.string().regex(/^\d{5}$/),
    week: z
      .array(z.object({ area: z.string().regex(/^\d{6}$/), tempStation: z.string().regex(/^\d{5}$/) }))
      .min(1),
  }),
  z.object({
    kind: z.literal('nws'),
    gridId: z.string().regex(/^[A-Z]{3}$/),
    gridX: z.number().int().nonnegative(),
    gridY: z.number().int().nonnegative(),
  }),
]);

/** 나라 → 그 나라의 원천. 한 나라는 한 원천만 쓴다 — 다른 나라 원천으로 대신하지 않는다. */
export const WEATHER_SOURCE_KIND_BY_COUNTRY = { KR: 'kma', JP: 'jma', US: 'nws' } as const;

export const WeatherRegionSchema = z.object({
  key: z.string().regex(KEY_RE),
  country: z.enum(WEATHER_COUNTRY_CODES),
  /** 나라 안에서의 목록 순서(1부터). */
  order: z.number().int().positive(),
  names: LocalizedNamesSchema,
  /** 날씨를 재는 대표 도시(경기 → 수원)가 지역 이름과 다를 때만 있다. */
  seatNames: LocalizedNamesSchema.optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** IANA 시간대. `target_date` 는 이 시간대의 달력 날짜다. */
  tz: z.string().min(1),
  /** 날씨 원천의 칸(`WeatherSourceSchema`). 앱으로는 내보내지 않는다(서버만 쓴다). */
  source: WeatherSourceSchema,
  /** 이름·대표 도시 밖의 표기(옛 앱이 저장했을 글자). 정규형으로 적는다. */
  aliases: z.array(z.string().min(1)),
});

export const WeatherRegionCatalogSchema = z
  .object({
    version: z.literal(1),
    countries: z.array(WeatherCountrySchema),
    regions: z.array(WeatherRegionSchema).min(1),
  })
  .superRefine((catalog, ctx) => {
    const codes = catalog.countries.map((c) => c.code);
    if (codes.join() !== WEATHER_COUNTRY_CODES.join()) {
      ctx.addIssue({ code: 'custom', message: `countries 는 ${WEATHER_COUNTRY_CODES.join('·')} 순서여야 한다` });
    }
    const keys = new Set<string>();
    for (const region of catalog.regions) {
      if (keys.has(region.key)) ctx.addIssue({ code: 'custom', message: `지역 키가 겹친다: ${region.key}` });
      keys.add(region.key);
      if (!region.key.startsWith(`${region.country.toLowerCase()}-`)) {
        ctx.addIssue({ code: 'custom', message: `키 접두사와 나라가 다르다: ${region.key}` });
      }
      if (region.source.kind !== WEATHER_SOURCE_KIND_BY_COUNTRY[region.country]) {
        ctx.addIssue({
          code: 'custom',
          message: `${region.key}: ${region.country} 지역의 원천은 ${WEATHER_SOURCE_KIND_BY_COUNTRY[region.country]} 여야 한다`,
        });
      }
    }
  });

export type WeatherCountry = z.infer<typeof WeatherCountrySchema>;
export type WeatherSource = z.infer<typeof WeatherSourceSchema>;
export type WeatherRegion = z.infer<typeof WeatherRegionSchema>;
export type WeatherRegionCatalog = z.infer<typeof WeatherRegionCatalogSchema>;
export type WeatherRegionLabels = { country: string; city: string };

/** JSON 을 한 번 검증해 둔 목록. 모양이 틀리면 모듈을 불러오는 순간 던진다 — 배포 전에 걸린다. */
export const WEATHER_REGION_CATALOG: WeatherRegionCatalog = WeatherRegionCatalogSchema.parse(catalogJson);

// ── 정규화 — scripts/gen-weather-regions.py 의 canon·alias_key·strip_suffix 와 같다 ──────────

/** NFKC 뒤 공백으로 바꾸는 글자(ASCII 공백류 + 구분 부호). */
const SEPARATORS = ' \t\n\r\u000b\u000c.,·・\'’"()/_-、。';
/** 정확히 맞는 별칭이 없을 때 **한 번만** 떼어 본다. 긴 것부터. */
const SUFFIXES = [
  '특별자치시', '특별자치도', '특별시', '광역시',
  ' prefecture', ' city', ' ken', ' shi', ' si', ' gun', ' do', ' to', ' fu',
  '시', '도', '군', '都', '道', '府', '県', '市',
] as const;

/** NFKC → 소문자 → 구분 글자를 공백으로 → 공백 하나로·앞뒤 제거. */
export function canonicalizeWeatherLabel(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  let spaced = '';
  for (const ch of raw.normalize('NFKC').toLowerCase()) spaced += SEPARATORS.includes(ch) ? ' ' : ch;
  return spaced.split(' ').filter(Boolean).join(' ');
}

/** 별칭 표의 열쇠 — 정규형에서 공백까지 뺀 것("New York" 을 "New"·"York" 으로 가른 옛 입력도 모인다). */
export function weatherAliasKey(raw: unknown): string {
  return canonicalizeWeatherLabel(raw).replaceAll(' ', '');
}

function stripSuffix(text: string): string | null {
  for (const suffix of SUFFIXES) {
    if (text.endsWith(suffix)) return text.slice(0, -suffix.length).trim() || null;
  }
  return null;
}

function labelsOfRegion(region: WeatherRegion): string[] {
  const labels = WEATHER_REGION_LOCALES.map((l) => region.names[l]);
  if (region.seatNames) labels.push(...WEATHER_REGION_LOCALES.map((l) => region.seatNames![l]));
  return [...labels, ...region.aliases];
}

function labelsOfCountry(country: WeatherCountry): string[] {
  return [...WEATHER_REGION_LOCALES.map((l) => country.names[l]), country.legacyLabel, ...country.aliases];
}

const ALL_REGIONS: readonly WeatherRegion[] = [...WEATHER_REGION_CATALOG.regions].sort(
  (a, b) =>
    WEATHER_COUNTRY_CODES.indexOf(a.country) - WEATHER_COUNTRY_CODES.indexOf(b.country) || a.order - b.order,
);
const REGION_BY_KEY = new Map(ALL_REGIONS.map((r) => [r.key, r] as const));
const COUNTRY_BY_CODE = new Map(WEATHER_REGION_CATALOG.countries.map((c) => [c.code, c] as const));

function buildIndex<T>(entries: Iterable<[string, T]>, what: string): Map<string, T> {
  const index = new Map<string, T>();
  for (const [label, value] of entries) {
    const key = weatherAliasKey(label);
    const owner = index.get(key);
    if (owner !== undefined && owner !== value) throw new Error(`${what} 별칭 '${label}' 이 두 곳에 겹친다`);
    index.set(key, value);
  }
  return index;
}

const COUNTRY_ALIAS_INDEX = buildIndex<WeatherCountryCode>(
  WEATHER_REGION_CATALOG.countries.flatMap((c) => labelsOfCountry(c).map((l) => [l, c.code] as [string, WeatherCountryCode])),
  '나라',
);
const REGION_ALIAS_INDEX = buildIndex<string>(
  ALL_REGIONS.flatMap((r) => labelsOfRegion(r).map((l) => [l, r.key] as [string, string])),
  '지역',
);

function match(text: string): string | null {
  if (!text) return null;
  const hit = REGION_ALIAS_INDEX.get(weatherAliasKey(text));
  if (hit) return hit;
  const stripped = stripSuffix(text);
  return stripped ? (REGION_ALIAS_INDEX.get(weatherAliasKey(stripped)) ?? null) : null;
}

// ── 공개 API — 두 앱의 `WeatherRegions` 와 같은 이름이다 ──────────────────────────────────

function byKey(key: unknown): WeatherRegion | undefined {
  return typeof key === 'string' ? REGION_BY_KEY.get(key.trim()) : undefined;
}

function countryForLabel(label: unknown): WeatherCountryCode | null {
  const key = weatherAliasKey(label);
  return key ? (COUNTRY_ALIAS_INDEX.get(key) ?? null) : null;
}

/** 로마자가 있는 낱말은 첫 낱말로 다시 찾지 않는다 — `resolveAlias` 의 셋째 규칙. */
function hasLatin(text: string): boolean {
  return /[a-z]/.test(text);
}

/**
 * 옛 (나라, 도시) 문자열 → 지역. 못 찾으면 undefined.
 *
 * - 나라가 비었거나 **아는 나라**면 도시로 찾는다. 나라가 `대한민국`(또는 빈 값)이면 도시가 다른
 *   나라 지역이어도 받는다 — 옛 앱은 공백 없는 입력에 나라를 자동으로 `대한민국` 으로 붙였다
 *   (일본어 목록의 東京, 영어 기기의 "Tokyo"). 일본·미국이라고 적었으면 그 나라 안에서만 찾는다.
 * - **모르는 나라**면 옛 입력칸이 첫 낱말을 나라로 떼어 간 것이다("New York" → New/York,
 *   "경기도 수원시", "서울 강남구"). 이어 붙여 찾는다. 도시만으로는 찾지 않는다 — "영국 버밍엄" 이
 *   앨라배마로 가면 안 된다.
 * - **첫 낱말로 한 번 더** 찾는 것(여러 낱말 도시의 첫 낱말, 모르는 나라 자리의 낱말)은 그 낱말에
 *   **로마자가 없을 때만**이다. 한국어·일본어 주소는 넓은 곳이 앞이지만("서울 강남구"), 영어는
 *   도시가 앞이고 뒤가 주·나라라서("Birmingham England", "La Paz", "Jackson Hole") 앞 낱말만 보면
 *   다른 나라의 같은 이름 도시로 간다.
 * - 대표 지점이 아닌 도시는 별칭이 아니다(속초 → 강원이 아니다). 해안 날씨가 내륙(춘천)
 *   날씨로 조용히 바뀌기 때문이다 — 그런 옛 값은 되짚지 않고 옛 경로로 둔다.
 */
function resolveAlias(country: unknown, city: unknown): WeatherRegion | undefined {
  const c = canonicalizeWeatherLabel(country);
  const t = canonicalizeWeatherLabel(city);
  if (!c && !t) return undefined;
  const code = c ? countryForLabel(c) : null;
  if (!c || code) {
    const first = t.includes(' ') ? t.slice(0, t.indexOf(' ')) : '';
    const hit = REGION_BY_KEY.get(match(t) ?? (hasLatin(first) ? null : match(first)) ?? '');
    if (!hit) return undefined;
    return code && code !== 'KR' && hit.country !== code ? undefined : hit;
  }
  const key = match(canonicalizeWeatherLabel(`${c} ${t}`)) ?? (hasLatin(c) ? null : match(c));
  return key ? REGION_BY_KEY.get(key) : undefined;
}

/** 지역 키 → 옛 앱이 읽는 (나라, 도시) 글자(한국어). 모르는 키면 undefined. */
function canonicalLabels(key: unknown): WeatherRegionLabels | undefined {
  const region = byKey(key);
  if (!region) return undefined;
  return { country: COUNTRY_BY_CODE.get(region.country)!.legacyLabel, city: region.names.ko };
}

/** 그 지역 시간대의 달력 날짜(YYYY-MM-DD). `target_date` 는 이 기준이다. */
function localDate(region: WeatherRegion, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: region.tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export type WeatherSettingInput = { region?: unknown; country?: unknown; city?: unknown };
export type WeatherSetting = { region: string | null; country: string | null; city: string | null };

/**
 * 계정 설정의 `weather` 한 벌을 정리한다 — 쓸 때(PATCH)와 읽을 때(GET) 같은 함수다.
 *
 * - 알맞은 `region` → 그 지역, `country`/`city` 는 **옛 앱용 한국어 글자로 덮는다**(옛 앱이 계속 읽는다).
 * - 모르는 `region` → **그 칸만 버린다.** 요청 전체를 400 으로 거절하지 않는다 — 같은 PATCH 에
 *   운세 설정이 함께 실려 온다(`validateDynamicPromptSettings` 의 교훈).
 * - `region` 없이 옛 글자만 → `resolveAlias` 로 되짚어 `region` 을 채운다. 글자는 **그대로 둔다**
 *   (사용자가 적은 것을 바꾸지 않는다). 못 되짚으면 `region: null` 로 옛 경로에 맡긴다.
 */
function normalizeSetting(input: WeatherSettingInput): WeatherSetting {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const chosen = byKey(input.region);
  if (chosen) {
    const labels = canonicalLabels(chosen.key)!;
    return { region: chosen.key, country: labels.country, city: labels.city };
  }
  const country = text(input.country);
  const city = text(input.city);
  return { region: resolveAlias(country, city)?.key ?? null, country, city };
}

export const WeatherRegions = {
  /** 전체 목록 — 나라(KR·JP·US) 순, 나라 안에서는 `order` 순. */
  all: ALL_REGIONS,
  countries: WEATHER_REGION_CATALOG.countries as readonly WeatherCountry[],
  byKey,
  isKey: (key: unknown): key is string => byKey(key) !== undefined,
  /** 그 나라의 지역들, 목록 순서대로. */
  byCountry: (code: WeatherCountryCode): WeatherRegion[] => ALL_REGIONS.filter((r) => r.country === code),
  country: (code: WeatherCountryCode): WeatherCountry => COUNTRY_BY_CODE.get(code)!,
  /** 나라 표기("대한민국"·"Japan"·"アメリカ"·"US" …) → 코드. 모르는 표기면 null. */
  countryForLabel,
  resolveAlias,
  canonicalLabels,
  normalizeSetting,
  localDate,
} as const;
