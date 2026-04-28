export interface PresetCategory {
  key: string;
  emoji: string;
  i18nKey: string;
  messageKeys: string[];
}

export function getCategoryLabel(cat: PresetCategory, t: (key: string) => string): string {
  return t(cat.i18nKey);
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  {
    key: 'morning',
    emoji: '🌅',
    i18nKey: 'library.categoryMorning',
    messageKeys: ['preset.morning.0', 'preset.morning.1', 'preset.morning.2'],
  },
  {
    key: 'lunch',
    emoji: '🍽️',
    i18nKey: 'library.categoryLunch',
    messageKeys: ['preset.lunch.0', 'preset.lunch.1', 'preset.lunch.2'],
  },
  {
    key: 'afternoon',
    emoji: '☕',
    i18nKey: 'library.categoryAfternoon',
    messageKeys: ['preset.afternoon.0', 'preset.afternoon.1', 'preset.afternoon.2'],
  },
  {
    key: 'evening',
    emoji: '🌙',
    i18nKey: 'library.categoryEvening',
    messageKeys: ['preset.evening.0', 'preset.evening.1', 'preset.evening.2'],
  },
  {
    key: 'night',
    emoji: '😴',
    i18nKey: 'library.categoryNight',
    messageKeys: ['preset.night.0', 'preset.night.1', 'preset.night.2'],
  },
  {
    key: 'cheer',
    emoji: '💪',
    i18nKey: 'library.categoryCheer',
    messageKeys: ['preset.cheer.0', 'preset.cheer.1', 'preset.cheer.2'],
  },
  {
    key: 'love',
    emoji: '❤️',
    i18nKey: 'library.categoryLove',
    messageKeys: ['preset.love.0', 'preset.love.1', 'preset.love.2'],
  },
  {
    key: 'health',
    emoji: '🏥',
    i18nKey: 'library.categoryHealth',
    messageKeys: ['preset.health.0', 'preset.health.1', 'preset.health.2'],
  },
];

export const DAY_KEYS = [
  'alarms.daySun',
  'alarms.dayMon',
  'alarms.dayTue',
  'alarms.dayWed',
  'alarms.dayThu',
  'alarms.dayFri',
  'alarms.daySat',
] as const;
