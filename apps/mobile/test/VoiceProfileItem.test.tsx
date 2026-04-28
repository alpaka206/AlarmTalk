import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    Swipeable: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('../src/i18n', () => ({
  getDateLocale: () => 'ko-KR',
}));

import { VoiceProfileItem } from '../src/components/VoiceProfileItem';
import { createVoicesStyles } from '../src/styles/voicesStyles';
import type { VoiceProfile } from '../src/types';

const { Colors } = jest.requireActual('../src/constants/theme') as typeof import('../src/constants/theme');
const styles = createVoicesStyles(Colors.light);

const t = ((key: string) => key) as unknown as import('i18next').TFunction;

const getStatusBadge = (status: string) => {
  const map: Record<string, { label: string; color: string }> = {
    ready: { label: '준비 완료', color: '#34C759' },
    processing: { label: '처리 중', color: '#FF9500' },
    failed: { label: '실패', color: '#FF3B30' },
  };
  return map[status] ?? { label: status, color: '#999' };
};

const makeVoiceProfile = (overrides: Partial<VoiceProfile> = {}): VoiceProfile => ({
  id: 'v1',
  user_id: 'u1',
  name: '엄마',
  perso_voice_id: null,
  elevenlabs_voice_id: null,
  avatar_url: null,
  status: 'ready',
  created_at: '2026-01-15T10:30:00Z',
  updated_at: '2026-01-15T10:30:00Z',
  ...overrides,
});

const renderDeleteAction = () => null;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('VoiceProfileItem', () => {
  it('음성 프로필 이름을 표시한다', () => {
    render(
      <VoiceProfileItem
        item={makeVoiceProfile()}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('엄마')).toBeTruthy();
  });

  it('이름 첫 글자를 아바타에 표시한다', () => {
    render(
      <VoiceProfileItem
        item={makeVoiceProfile({ name: 'Dad' })}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('D')).toBeTruthy();
  });

  it('상태 뱃지 라벨을 표시한다', () => {
    render(
      <VoiceProfileItem
        item={makeVoiceProfile({ status: 'processing' })}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('처리 중')).toBeTruthy();
  });

  it('삭제 버튼 텍스트를 표시한다', () => {
    render(
      <VoiceProfileItem
        item={makeVoiceProfile()}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('common.delete')).toBeTruthy();
  });

  it('카드 탭 시 onPress에 id를 전달한다', () => {
    const onPress = jest.fn();
    render(
      <VoiceProfileItem
        item={makeVoiceProfile({ id: 'voice-42' })}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={onPress}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    fireEvent.press(screen.getByRole('button', { name: '엄마 준비 완료' }));
    expect(onPress).toHaveBeenCalledWith('voice-42');
  });

  it('삭제 버튼 탭 시 onDelete에 id와 name을 전달한다', () => {
    const onDelete = jest.fn();
    render(
      <VoiceProfileItem
        item={makeVoiceProfile({ id: 'v-del', name: '아빠' })}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={onDelete}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const deleteButtons = screen.getAllByRole('button', { name: 'common.delete 아빠' });
    fireEvent.press(deleteButtons[deleteButtons.length - 1]!);
    expect(onDelete).toHaveBeenCalledWith('v-del', '아빠');
  });

  it('접근성 라벨에 이름과 상태가 포함된다', () => {
    render(
      <VoiceProfileItem
        item={makeVoiceProfile({ name: 'Test', status: 'failed' })}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByRole('button', { name: 'Test 실패' })).toBeTruthy();
  });

  it('생성 날짜를 표시한다', () => {
    const { toJSON } = render(
      <VoiceProfileItem
        item={makeVoiceProfile({ created_at: '2026-03-20T00:00:00Z' })}
        styles={styles}
        t={t}
        getStatusBadge={getStatusBadge}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('2026');
  });

  it('React.memo로 래핑되어 있다', () => {
    expect(VoiceProfileItem).toHaveProperty('$$typeof');
    expect((VoiceProfileItem as unknown as { type: unknown }).type).toBeDefined();
  });
});
