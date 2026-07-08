const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_QUIET_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_QUIET_START = '09:00';
const DEFAULT_QUIET_END = '18:30';
// 방해금지 요일은 평일/주말/매일 프리셋만 허용하고, 창은 최대 2개(평일 근무 + 주말 정도)로 제한한다.
// '누구를 깨울까요' 시트 멤버 행 라벨이 길어지지 않게 하려는 제약(2026-07-08 결정).
const MAX_QUIET_WINDOWS = 2;
const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
const WEEKEND_DAYS = [0, 6];
const EVERYDAY_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PRESET_QUIET_DAY_SETS = [WEEKDAY_DAYS, WEEKEND_DAYS, EVERYDAY_DAYS];

export function isPresetQuietDays(days: number[]): boolean {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  return PRESET_QUIET_DAY_SETS.some(
    (preset) => preset.length === sorted.length && preset.every((day, i) => day === sorted[i]),
  );
}

export interface FamilyAlarmQuietWindow {
  days: number[];
  start: string;
  end: string;
}

export interface FamilyAlarmSettings {
  allowFamilyAlarms: boolean;
  quietDays: number[];
  quietStart: string;
  quietEnd: string;
  quietWindows: FamilyAlarmQuietWindow[];
}

export function normalizeQuietDays(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(raw.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)),
    ).sort((a, b) => a - b);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return normalizeQuietDays(JSON.parse(raw));
    } catch {
      return DEFAULT_QUIET_DAYS;
    }
  }
  return DEFAULT_QUIET_DAYS;
}

export function validateQuietDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return null;
  return Array.from(new Set(raw as number[])).sort((a, b) => a - b);
}

export function normalizeQuietTime(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && TIME_RE.test(raw) ? raw : fallback;
}

export function validateQuietTime(raw: unknown): string | null {
  return typeof raw === 'string' && TIME_RE.test(raw) ? raw : null;
}

export function normalizeQuietWindows(
  raw: unknown,
  fallback: FamilyAlarmQuietWindow[] = [
    { days: DEFAULT_QUIET_DAYS, start: DEFAULT_QUIET_START, end: DEFAULT_QUIET_END },
  ],
): FamilyAlarmQuietWindow[] {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return normalizeQuietWindows(JSON.parse(raw), fallback);
    } catch {
      return fallback;
    }
  }
  if (!Array.isArray(raw)) return fallback;
  return raw
    .map((item) => normalizeQuietWindow(item))
    .filter((item): item is FamilyAlarmQuietWindow => item !== null)
    .slice(0, MAX_QUIET_WINDOWS);
}

export function validateQuietWindows(raw: unknown): FamilyAlarmQuietWindow[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_QUIET_WINDOWS) return null;
  const windows: FamilyAlarmQuietWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const days = validateQuietDays(record.days);
    const start = validateQuietTime(record.start);
    const end = validateQuietTime(record.end);
    if (days === null || days.length === 0 || !isPresetQuietDays(days) || start === null || end === null) {
      return null;
    }
    windows.push({ days, start, end });
  }
  return windows;
}

export function familyAlarmSettingsFromRow(row: Record<string, unknown>): FamilyAlarmSettings {
  const legacyWindow = {
    days: normalizeQuietDays(row.family_alarm_quiet_days),
    start: normalizeQuietTime(row.family_alarm_quiet_start, DEFAULT_QUIET_START),
    end: normalizeQuietTime(row.family_alarm_quiet_end, DEFAULT_QUIET_END),
  };
  const quietWindows = normalizeQuietWindows(row.family_alarm_quiet_windows, [legacyWindow]);
  const firstQuietWindow = quietWindows[0] ?? legacyWindow;
  return {
    allowFamilyAlarms: Number(row.allow_family_alarms ?? 0) === 1,
    quietDays: firstQuietWindow.days,
    quietStart: firstQuietWindow.start,
    quietEnd: firstQuietWindow.end,
    quietWindows,
  };
}

export function isBlockedByFamilyAlarmQuietTime(
  wakeAt: string,
  repeatDays: number[],
  settings: FamilyAlarmSettings,
  now: Date = new Date(),
): boolean {
  if (!TIME_RE.test(wakeAt) || settings.quietWindows.length === 0) return false;

  const daysToCheck = repeatDays.length > 0 ? repeatDays : [now.getDay()];
  return settings.quietWindows.some(
    (window) =>
      isTimeWithinWindow(wakeAt, window.start, window.end) &&
      daysToCheck.some((day) => window.days.includes(day)),
  );
}

function normalizeQuietWindow(raw: unknown): FamilyAlarmQuietWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const days = validateQuietDays(record.days);
  const start = validateQuietTime(record.start);
  const end = validateQuietTime(record.end);
  if (days === null || days.length === 0 || start === null || end === null) return null;
  return { days, start, end };
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function isTimeWithinWindow(value: string, start: string, end: string): boolean {
  const current = toMinutes(value);
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return true;
  if (from < to) return current >= from && current < to;
  return current >= from || current < to;
}
