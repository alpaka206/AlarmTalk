import type { TFunction } from 'i18next';

export function formatLastSeen(
  isoDate: string | undefined | null,
  t: TFunction,
): string {
  if (!isoDate) return t('lastSeen.unknown');

  const now = Date.now();
  const then = new Date(isoDate + 'Z').getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return t('lastSeen.unknown');

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('lastSeen.justNow');
  if (minutes < 60) return t('lastSeen.minutesAgo', { count: minutes });

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('lastSeen.hoursAgo', { count: hours });

  const days = Math.floor(hours / 24);
  if (days < 30) return t('lastSeen.daysAgo', { count: days });

  return t('lastSeen.longAgo');
}
