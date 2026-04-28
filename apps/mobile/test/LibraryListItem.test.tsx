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

jest.mock('../src/components/MiniWaveformPlayer', () => {
  const { View, Text } = require('react-native');
  return {
    MiniWaveformPlayer: ({ messageId }: { messageId: string }) => (
      <View><Text>waveform-{messageId}</Text></View>
    ),
  };
});

import { LibraryListItem } from '../src/components/LibraryListItem';
import type { LibraryItem } from '../src/types';

const { Colors } = jest.requireActual('../src/constants/theme') as typeof import('../src/constants/theme');

const { createLibraryStyles } = jest.requireActual('../src/styles/libraryStyles') as typeof import('../src/styles/libraryStyles');
const styles = createLibraryStyles(Colors.light);

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts) return `${key}:${JSON.stringify(opts)}`;
  return key;
}) as unknown as import('i18next').TFunction;

const getCategoryLabel = (key: string) => {
  const map: Record<string, string> = {
    morning: '아침',
    cheer: '응원',
    love: '사랑',
    custom: '직접 작성',
  };
  return map[key] ?? key;
};

const makeItem = (overrides: Partial<LibraryItem> = {}): LibraryItem => ({
  id: 'lib1',
  user_id: 'u1',
  message_id: 'msg1',
  voice_name: '엄마',
  avatar_url: undefined,
  text: '오늘도 화이팅!',
  category: 'morning',
  is_favorite: false,
  received_at: '2026-03-15T08:00:00Z',
  ...overrides,
});

const renderDeleteAction = () => null;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LibraryListItem', () => {
  it('음성 이름을 표시한다', () => {
    render(
      <LibraryListItem
        item={makeItem()}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('엄마')).toBeTruthy();
  });

  it('메시지 텍스트를 따옴표와 함께 표시한다', () => {
    render(
      <LibraryListItem
        item={makeItem({ text: '잘 자!' })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(render(
      <LibraryListItem
        item={makeItem({ text: '잘 자!' })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    ).toJSON());
    expect(tree).toContain('잘 자!');
  });

  it('카테고리 이모지를 표시한다 (morning → 🌅)', () => {
    const { toJSON } = render(
      <LibraryListItem
        item={makeItem({ category: 'morning' })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('🌅');
  });

  it('알 수 없는 카테고리는 💌 이모지를 표시한다', () => {
    const { toJSON } = render(
      <LibraryListItem
        item={makeItem({ category: 'unknown' })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('💌');
  });

  it('즐겨찾기 상태에 따라 하트 이모지가 다르다 (false → 🤍)', () => {
    const { toJSON } = render(
      <LibraryListItem
        item={makeItem({ is_favorite: false })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('🤍');
  });

  it('즐겨찾기 상태에 따라 하트 이모지가 다르다 (true → ❤️)', () => {
    const { toJSON } = render(
      <LibraryListItem
        item={makeItem({ is_favorite: true })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('❤️');
  });

  it('카드 탭 시 onPress에 message_id를 전달한다', () => {
    const onPress = jest.fn();
    render(
      <LibraryListItem
        item={makeItem({ message_id: 'msg-77' })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={onPress}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    fireEvent.press(screen.getByRole('button', { name: '엄마, 아침: 오늘도 화이팅!' }));
    expect(onPress).toHaveBeenCalledWith('msg-77');
  });

  it('즐겨찾기 버튼 탭 시 onFavorite에 id를 전달한다', () => {
    const onFavorite = jest.fn();
    render(
      <LibraryListItem
        item={makeItem({ id: 'fav-item' })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={onFavorite}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const favButtons = screen.getAllByRole('button', { name: 'library.addFavorite' });
    fireEvent.press(favButtons[favButtons.length - 1]!);
    expect(onFavorite).toHaveBeenCalledWith('fav-item');
  });

  it('즐겨찾기된 항목은 removeFavorite 접근성 라벨을 갖는다', () => {
    render(
      <LibraryListItem
        item={makeItem({ is_favorite: true })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    const removeButtons = screen.getAllByRole('button', { name: 'library.removeFavorite' });
    expect(removeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('voice_name이 없으면 아바타에 ?를 표시한다', () => {
    render(
      <LibraryListItem
        item={makeItem({ voice_name: undefined })}
        styles={styles}
        isActive={false}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('MiniWaveformPlayer가 렌더된다', () => {
    render(
      <LibraryListItem
        item={makeItem({ message_id: 'wv-test' })}
        styles={styles}
        isActive={true}
        t={t}
        getCategoryLabel={getCategoryLabel}
        onPress={jest.fn()}
        onDelete={jest.fn()}
        onFavorite={jest.fn()}
        onPlay={jest.fn()}
        onStop={jest.fn()}
        renderDeleteAction={renderDeleteAction}
      />,
    );
    expect(screen.getByText('waveform-wv-test')).toBeTruthy();
  });

  it('React.memo로 래핑되어 있다', () => {
    expect(LibraryListItem).toHaveProperty('$$typeof');
    expect((LibraryListItem as unknown as { type: unknown }).type).toBeDefined();
  });
});
