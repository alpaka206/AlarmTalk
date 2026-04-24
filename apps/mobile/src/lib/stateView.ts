import type { TFunction } from 'i18next';

export type StateViewVariant = 'loading' | 'empty' | 'error';

export interface StateViewConfig {
  variant: StateViewVariant;
  emoji: string;
  title: string;
  subtitle?: string;
}

const DEFAULT_KEYS: Record<StateViewVariant, { emoji: string; titleKey: string; subtitleKey: string }> = {
  loading: { emoji: '⏳', titleKey: 'stateView.loading', subtitleKey: '' },
  empty: { emoji: '📭', titleKey: 'stateView.empty', subtitleKey: '' },
  error: { emoji: '😵', titleKey: 'stateView.error', subtitleKey: 'stateView.errorSubtitle' },
};

export function resolveStateView(
  variant: StateViewVariant,
  t: TFunction,
  overrides?: Partial<Pick<StateViewConfig, 'emoji' | 'title' | 'subtitle'>>,
): StateViewConfig {
  const defaults = DEFAULT_KEYS[variant];
  return {
    variant,
    emoji: overrides?.emoji ?? defaults.emoji,
    title: overrides?.title ?? t(defaults.titleKey),
    subtitle: (overrides?.subtitle ?? (defaults.subtitleKey ? t(defaults.subtitleKey) : '')) || undefined,
  };
}
