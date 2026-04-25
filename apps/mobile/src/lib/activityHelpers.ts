import type { TFunction } from 'i18next';
import type { ActivityItem } from '../services/api';

const ACTIVITY_EMOJI: Record<ActivityItem['type'], string> = {
  alarm: '⏰',
  message: '💬',
  gift: '🎁',
  voice: '🎙️',
};

export function activityEmoji(type: ActivityItem['type']): string {
  return ACTIVITY_EMOJI[type] ?? '📋';
}

export function activityTypeLabel(type: ActivityItem['type'], t: TFunction): string {
  const key = `home.activityType${type.charAt(0).toUpperCase()}${type.slice(1)}` as const;
  return t(key);
}

export function activityDescription(item: ActivityItem, t: TFunction): string {
  switch (item.type) {
    case 'alarm':
      return t('home.activityAlarm', { time: item.detail.time });
    case 'message':
      return t('home.activityMessage', { text: item.detail.text });
    case 'gift':
      return item.detail.note
        ? t('home.activityGiftNote', { note: item.detail.note, status: item.detail.status })
        : t('home.activityGift', { status: item.detail.status });
    case 'voice':
      return t('home.activityVoice', { name: item.detail.name });
  }
}
