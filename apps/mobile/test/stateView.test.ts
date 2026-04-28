import { resolveStateView } from '../src/lib/stateView';
import type { TFunction } from 'i18next';

const t = ((key: string) => key) as TFunction;

describe('resolveStateView', () => {
  it('loading defaults', () => {
    const cfg = resolveStateView('loading', t);
    expect(cfg.variant).toBe('loading');
    expect(cfg.emoji).toBe('⏳');
    expect(cfg.title).toBe('stateView.loading');
  });

  it('empty defaults', () => {
    const cfg = resolveStateView('empty', t);
    expect(cfg.variant).toBe('empty');
    expect(cfg.emoji).toBe('📭');
    expect(cfg.title).toBe('stateView.empty');
  });

  it('error defaults', () => {
    const cfg = resolveStateView('error', t);
    expect(cfg.variant).toBe('error');
    expect(cfg.title).toBe('stateView.error');
    expect(cfg.subtitle).toBe('stateView.errorSubtitle');
  });

  it('overrides title', () => {
    const cfg = resolveStateView('empty', t, { title: '알람이 없어요' });
    expect(cfg.title).toBe('알람이 없어요');
  });

  it('overrides emoji and subtitle', () => {
    const cfg = resolveStateView('error', t, { emoji: '❌', subtitle: '네트워크 확인' });
    expect(cfg.emoji).toBe('❌');
    expect(cfg.subtitle).toBe('네트워크 확인');
  });
});
