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

// 레거시(개별 요일 선택) 방해금지 창을 프리셋(평일/주말/매일)으로 흡수한다. 정확히 프리셋이면
// 표준 정렬형으로, 아니면 포함하는 요일에 따라 가장 가까운(감싸는) 프리셋으로 확장 — 저장 시
// 거부(400)로 막지 않고 프리셋 저장 규약을 유지하기 위함(PR #536 P2).
export function coerceToPresetDays(days: number[]): number[] {
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  if (isPresetQuietDays(sorted)) return sorted;
  const set = new Set(sorted);
  const hasWeekday = WEEKDAY_DAYS.some((d) => set.has(d));
  const hasWeekend = WEEKEND_DAYS.some((d) => set.has(d));
  if (hasWeekday && hasWeekend) return [...EVERYDAY_DAYS];
  if (hasWeekend) return [...WEEKEND_DAYS];
  return [...WEEKDAY_DAYS];
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
    if (days === null || days.length === 0 || start === null || end === null) {
      return null;
    }
    // 레거시 개별 요일은 거부하지 않고 프리셋으로 흡수한다(무관한 시간 편집이 400 나지 않도록).
    windows.push({ days: coerceToPresetDays(days), start, end });
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
  oneTimeFireDayOfWeek: number,
): boolean {
  if (!TIME_RE.test(wakeAt) || settings.quietWindows.length === 0) return false;

  // 반복 알람은 선택한 요일 그대로, 일회성 알람은 호출부가 계산한 '다음 발사 시각의
  // 수신자 시간대 요일'(computeNextAlarmFire.fireDayOfWeek)로 판정한다. 이전 구현은
  // now.getDay()(Workers 서버 = UTC 요일)를 써서 수신자 로컬 자정 부근에 요일이 하루
  // 어긋났다(예: UTC 금 15:30 = KST 토 00:30 → 토요일 quiet 창을 놓침).
  const daysToCheck = repeatDays.length > 0 ? repeatDays : [oneTimeFireDayOfWeek];
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
  return { days: coerceToPresetDays(days), start, end };
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
