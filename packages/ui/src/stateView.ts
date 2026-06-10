// 공통 상태 화면(로딩/빈 목록/오류) 구성. 기본 이모지·문구를 제공하고
// 호출부가 필요한 항목만 override 한다.
export type StateViewVariant = 'loading' | 'empty' | 'error';

export interface StateViewConfig {
  variant: StateViewVariant;
  emoji: string;
  title: string;
  subtitle?: string;
}

const DEFAULTS: Record<StateViewVariant, { emoji: string; title: string; subtitle: string }> = {
  loading: { emoji: '⏳', title: '불러오는 중...', subtitle: '' },
  empty: { emoji: '📭', title: '아직 데이터가 없어요', subtitle: '' },
  error: { emoji: '😵', title: '문제가 발생했습니다', subtitle: '다시 시도해 주세요' },
};

export function resolveStateView(
  variant: StateViewVariant,
  overrides?: Partial<Pick<StateViewConfig, 'emoji' | 'title' | 'subtitle'>>,
): StateViewConfig {
  const defaults = DEFAULTS[variant];
  return {
    variant,
    emoji: overrides?.emoji ?? defaults.emoji,
    title: overrides?.title ?? defaults.title,
    subtitle: (overrides?.subtitle ?? defaults.subtitle) || undefined,
  };
}
