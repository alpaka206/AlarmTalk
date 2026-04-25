import React from 'react';
import { View, Animated } from 'react-native';

const mockStart = jest.fn();
const mockStop = jest.fn();
jest.spyOn(Animated, 'loop').mockReturnValue({
  start: mockStart,
  stop: mockStop,
  reset: jest.fn(),
  _startNativeLoop: jest.fn(),
  _isUsingNativeDriver: jest.fn().mockReturnValue(false),
} as unknown as Animated.CompositeAnimation);
jest.spyOn(Animated, 'sequence').mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
  _startNativeLoop: jest.fn(),
  _isUsingNativeDriver: jest.fn().mockReturnValue(false),
} as unknown as Animated.CompositeAnimation);
jest.spyOn(Animated, 'timing').mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
  _startNativeLoop: jest.fn(),
  _isUsingNativeDriver: jest.fn().mockReturnValue(false),
} as unknown as Animated.CompositeAnimation);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../src/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      primary: '#FF7F6B',
      primaryLight: '#FFB4A8',
      primaryDark: '#E05A47',
      secondary: '#FFCBA4',
      accent: '#FF6B8A',
      background: '#FFF5F3',
      surface: '#FFFFFF',
      surfaceVariant: '#FFF0ED',
      text: '#2D2D2D',
      textSecondary: '#6B7280',
      textTertiary: '#AEAEB2',
      border: '#F2E8E5',
      success: '#34C759',
      warning: '#FF9500',
      error: '#FF3B30',
      shadow: 'rgba(255, 127, 107, 0.15)',
    },
    isDark: false,
  }),
}));

import { render } from '@testing-library/react-native';
import { PeopleSkeletonCard } from '../src/components/PeopleSkeletonCard';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PeopleSkeletonCard', () => {
  it('기본값 3개의 스켈레톤 행을 렌더한다', () => {
    const { toJSON } = render(<PeopleSkeletonCard />);
    const tree = toJSON() as { children: unknown[] };
    expect(tree.children).toHaveLength(3);
  });

  it('count prop으로 행 수를 지정할 수 있다', () => {
    const { toJSON } = render(<PeopleSkeletonCard count={5} />);
    const tree = toJSON() as { children: unknown[] };
    expect(tree.children).toHaveLength(5);
  });

  it('count=1일 때 단일 행을 렌더한다', () => {
    const { toJSON } = render(<PeopleSkeletonCard count={1} />);
    const tree = toJSON() as { children: unknown[] };
    expect(tree.children).toHaveLength(1);
  });

  it('count=0일 때 빈 컨테이너를 렌더한다', () => {
    const { toJSON } = render(<PeopleSkeletonCard count={0} />);
    const tree = toJSON() as { children: unknown[] | null };
    expect(tree.children).toBeNull();
  });

  it('pulse 애니메이션 루프가 시작된다', () => {
    render(<PeopleSkeletonCard count={1} />);
    expect(Animated.loop).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
  });

  it('각 행에 3개 이상의 플레이스홀더 자식이 있다', () => {
    const { toJSON } = render(<PeopleSkeletonCard count={1} />);
    const tree = toJSON() as { children: Array<{ children: unknown[] }> };
    const card = tree.children[0]!;
    expect(card.children.length).toBeGreaterThanOrEqual(3);
  });

  it('memo 래핑이 적용되어 있다', () => {
    expect(typeof PeopleSkeletonCard).toBe('object');
    expect((PeopleSkeletonCard as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });

  it('progressbar 접근성 역할과 로딩 라벨이 적용된다', () => {
    const { toJSON } = render(<PeopleSkeletonCard count={2} />);
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('"accessibilityRole":"progressbar"');
    expect(tree).toContain('"accessibilityLabel":"common.loading"');
  });
});
