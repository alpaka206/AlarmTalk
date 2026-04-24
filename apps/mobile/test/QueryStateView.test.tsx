import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

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

import { ErrorView } from '../src/components/QueryStateView';

describe('ErrorView', () => {
  it('기본 에러 제목과 이모지를 표시한다', () => {
    render(<ErrorView />);
    expect(screen.getByText('common.loadError')).toBeTruthy();
    expect(screen.getByText('⚠️')).toBeTruthy();
  });

  it('message가 있으면 부제목으로 표시한다', () => {
    render(<ErrorView message="네트워크 오류" />);
    expect(screen.getByText('네트워크 오류')).toBeTruthy();
  });

  it('message가 없으면 부제목을 표시하지 않는다', () => {
    render(<ErrorView />);
    expect(screen.queryByText('네트워크 오류')).toBeNull();
  });

  it('onRetry가 있으면 재시도 버튼을 표시한다', () => {
    const onRetry = jest.fn();
    render(<ErrorView onRetry={onRetry} />);
    const retryBtn = screen.getByRole('button', { name: 'common.retry' });
    expect(retryBtn).toBeTruthy();
  });

  it('onRetry가 없으면 재시도 버튼을 표시하지 않는다', () => {
    render(<ErrorView />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('재시도 버튼 탭 시 onRetry 콜백이 호출된다', () => {
    const onRetry = jest.fn();
    render(<ErrorView onRetry={onRetry} />);
    const retryBtn = screen.getByRole('button', { name: 'common.retry' });
    fireEvent.press(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('message + onRetry 조합 시 모두 표시한다', () => {
    const onRetry = jest.fn();
    render(<ErrorView message="서버 에러" onRetry={onRetry} />);
    expect(screen.getByText('common.loadError')).toBeTruthy();
    expect(screen.getByText('서버 에러')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
  });

  it('재시도 버튼에 접근성 라벨이 설정되어 있다', () => {
    render(<ErrorView onRetry={() => {}} />);
    const retryBtn = screen.getByLabelText('common.retry');
    expect(retryBtn).toBeTruthy();
  });
});
