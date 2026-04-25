import React from 'react';
import { View, Text, TouchableOpacity, Animated as RNAnimated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import type { TFunction } from 'i18next';
import { getDateLocale } from '../i18n';
import { MiniWaveformPlayer } from './MiniWaveformPlayer';
import type { Audio } from 'expo-av';
import type { LibraryItem } from '../types';
import type { createLibraryStyles } from '../styles/libraryStyles';

const CATEGORY_EMOJI: Record<string, string> = {
  morning: '🌅',
  lunch: '🍽️',
  afternoon: '☕',
  evening: '🌙',
  night: '😴',
  cheer: '💪',
  love: '❤️',
  health: '🏥',
  custom: '✏️',
};

interface Props {
  item: LibraryItem;
  styles: ReturnType<typeof createLibraryStyles>;
  isActive: boolean;
  t: TFunction;
  getCategoryLabel: (key: string) => string;
  onPress: (messageId: string) => void;
  onDelete: (id: string) => void;
  onFavorite: (id: string) => void;
  onPlay: (messageId: string, sound: Audio.Sound) => void;
  onStop: () => void;
  renderDeleteAction: (
    progress: RNAnimated.AnimatedInterpolation<number>,
    dragX: RNAnimated.AnimatedInterpolation<number>,
  ) => React.ReactNode;
}

function LibraryListItemInner({
  item,
  styles,
  isActive,
  t,
  getCategoryLabel,
  onPress,
  onDelete,
  onFavorite,
  onPlay,
  onStop,
  renderDeleteAction,
}: Props) {
  const emoji = CATEGORY_EMOJI[item.category] || '💌';

  return (
    <Swipeable
      renderRightActions={renderDeleteAction}
      onSwipeableOpen={() => onDelete(item.id)}
      overshootRight={false}
    >
      <TouchableOpacity
        style={styles.messageCard}
        onPress={() => onPress(item.message_id)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.voice_name}, ${getCategoryLabel(item.category)}: ${item.text}`}
      >
        <View style={styles.messageLeft}>
          <View style={styles.avatarSmall}>
            <Text style={styles.avatarLetter}>{item.voice_name?.charAt(0) || '?'}</Text>
          </View>
          <View style={styles.messageContent}>
            <View style={styles.messageHeader}>
              <Text style={styles.voiceName}>{item.voice_name}</Text>
              <Text
                style={styles.categoryBadge}
                accessibilityLabel={t('library.a11yCategoryBadge', { category: getCategoryLabel(item.category) })}
              >{emoji}</Text>
            </View>
            <Text style={styles.messageText} numberOfLines={2}>
              &quot;{item.text}&quot;
            </Text>
            <View style={styles.miniPlayerRow}>
              <MiniWaveformPlayer
                messageId={item.message_id}
                isActive={isActive}
                onPlay={onPlay}
                onStop={onStop}
              />
            </View>
            <Text style={styles.messageDate}>
              {new Date(item.received_at).toLocaleDateString(getDateLocale(), {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>

        <View style={styles.messageActions}>
          <TouchableOpacity
            onPress={() => onFavorite(item.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={item.is_favorite ? t('library.removeFavorite') : t('library.addFavorite')}
          >
            <Text style={styles.favoriteIcon}>{item.is_favorite ? '❤️' : '🤍'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

export const LibraryListItem = React.memo(LibraryListItemInner);
