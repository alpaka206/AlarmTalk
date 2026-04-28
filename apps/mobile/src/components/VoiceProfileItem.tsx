import React from 'react';
import { View, Text, TouchableOpacity, Animated as RNAnimated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import type { TFunction } from 'i18next';
import { getDateLocale } from '../i18n';
import type { VoiceProfile } from '../types';
import type { createVoicesStyles } from '../styles/voicesStyles';

interface StatusBadge {
  label: string;
  color: string;
}

interface Props {
  item: VoiceProfile;
  styles: ReturnType<typeof createVoicesStyles>;
  t: TFunction;
  getStatusBadge: (status: string) => StatusBadge;
  onPress: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  renderDeleteAction: (
    progress: RNAnimated.AnimatedInterpolation<number>,
    dragX: RNAnimated.AnimatedInterpolation<number>,
  ) => React.ReactNode;
}

function VoiceProfileItemInner({
  item,
  styles,
  t,
  getStatusBadge,
  onPress,
  onDelete,
  renderDeleteAction,
}: Props) {
  const badge = getStatusBadge(item.status);

  return (
    <Swipeable
      renderRightActions={renderDeleteAction}
      onSwipeableOpen={() => onDelete(item.id, item.name)}
      overshootRight={false}
    >
      <TouchableOpacity
        style={styles.profileCard}
        activeOpacity={0.7}
        onPress={() => onPress(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} ${badge.label}`}
      >
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{item.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: badge.color + '20' }]}>
            <View style={[styles.statusDot, { backgroundColor: badge.color }]} />
            <Text style={[styles.statusText, { color: badge.color }]}>{badge.label}</Text>
          </View>
          <Text style={styles.profileDate}>
            {new Date(item.created_at).toLocaleDateString(getDateLocale())}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => onDelete(item.id, item.name)}
          accessibilityRole="button"
          accessibilityLabel={`${t('common.delete')} ${item.name}`}
        >
          <Text style={styles.deleteText}>{t('common.delete')}</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Swipeable>
  );
}

export const VoiceProfileItem = React.memo(VoiceProfileItemInner);
