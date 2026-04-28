import React from 'react';
import { render, screen } from '@testing-library/react-native';

let mockIsConnected = true;

jest.mock('../src/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockIsConnected,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../src/hooks/useTheme', () => {
  const { Colors } = jest.requireActual('../src/constants/theme');
  return {
    useTheme: () => ({ colors: Colors.light, isDark: false }),
  };
});

import { OfflineBanner } from '../src/components/OfflineBanner';

beforeEach(() => {
  mockIsConnected = true;
});

describe('OfflineBanner', () => {
  it('온라인일 때 아무것도 렌더하지 않는다', () => {
    mockIsConnected = true;
    const { toJSON } = render(<OfflineBanner />);
    expect(toJSON()).toBeNull();
  });

  it('오프라인일 때 배너를 표시한다', () => {
    mockIsConnected = false;
    render(<OfflineBanner />);
    expect(screen.getByText('offline.banner')).toBeTruthy();
  });

  it('오프라인 배너에 경고 색상 텍스트가 포함된다', () => {
    mockIsConnected = false;
    const { toJSON } = render(<OfflineBanner />);
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('#FF9500');
    expect(tree).toContain('#FFFFFF');
  });

  it('오프라인 배너에 alert 접근성 역할이 적용된다', () => {
    mockIsConnected = false;
    const { toJSON } = render(<OfflineBanner />);
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('"accessibilityRole":"alert"');
    expect(tree).toContain('"accessibilityLiveRegion":"assertive"');
  });

  it('연결 상태 변경 시 재렌더에 반응한다', () => {
    mockIsConnected = false;
    const { toJSON, rerender } = render(<OfflineBanner />);
    expect(toJSON()).not.toBeNull();

    mockIsConnected = true;
    rerender(<OfflineBanner />);
    expect(toJSON()).toBeNull();
  });
});
