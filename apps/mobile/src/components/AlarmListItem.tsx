import React from 'react';
import { View, Text, TouchableOpacity, Switch, Animated as RNAnimated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import type { TFunction } from 'i18next';
import type { Alarm } from '../types';
import { parseRepeatDays } from '../lib/alarmForm';
import { getAlarmModeBadge } from '../lib/alarmPlayback';
import { buildFamilyAlarmLabel } from '../lib/familyAlarmLabel';
import type { createAlarmsStyles } from '../styles/alarmsStyles';
import type { ThemeColors } from '../hooks/useTheme';

interface Props {
  item: Alarm;
  styles: ReturnType<typeof createAlarmsStyles>;
  colors: ThemeColors;
  userId: string | null;
  tick: number;
  t: TFunction;
  formatRepeatDays: (days: number[]) => string;
  formatCountdown: (ms: number) => string;
  getNextFireMs: (alarm: Alarm) => number | null;
  onPress: (alarm: Alarm) => void;
  onDelete: (id: string) => void;
  onPreview: (alarm: Alarm) => void;
  onToggle: (id: string, isActive: boolean) => void;
  renderDeleteAction: (
    progress: RNAnimated.AnimatedInterpolation<number>,
    dragX: RNAnimated.AnimatedInterpolation<number>,
  ) => React.ReactNode;
}

function AlarmListItemInner({
  item,
  styles,
  colors,
  userId,
  tick,
  t,
  formatRepeatDays,
  formatCountdown,
  getNextFireMs,
  onPress,
  onDelete,
  onPreview,
  onToggle,
  renderDeleteAction,
}: Props) {
  const repeatDays = parseRepeatDays(item.repeat_days);
  void tick;
  const nextFireMs = getNextFireMs(item);
  const perAlarmCountdown = nextFireMs !== null ? formatCountdown(nextFireMs) : null;
  const modeBadge = getAlarmModeBadge(item.mode);
  const familyLabel = buildFamilyAlarmLabel(item, userId, t);

  return (
    <Swipeable
      renderRightActions={renderDeleteAction}
      onSwipeableOpen={() => onDelete(item.id)}
      overshootRight={false}
    >
      <TouchableOpacity
        style={[styles.alarmCard, !item.is_active && styles.alarmCardInactive]}
        onPress={() => onPress(item)}
        onLongPress={() => onDelete(item.id)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${t('alarms.title')} ${item.time} ${item.voice_name}`}
      >
        <View style={styles.alarmLeft}>
          <Text style={[styles.alarmTime, !item.is_active && styles.timeInactive]}>
            {item.time}
          </Text>
          <View style={styles.alarmSubRow}>
            <Text style={[styles.alarmRepeat, !item.is_active && styles.textInactive]}>
              {formatRepeatDays(repeatDays)}
            </Text>
            {item.is_active && perAlarmCountdown && (
              <Text style={styles.alarmCountdown}>{perAlarmCountdown}</Text>
            )}
          </View>
          <View style={styles.alarmMeta}>
            <Text style={[styles.alarmVoice, !item.is_active && styles.textInactive]}>🗣️ {item.voice_name}</Text>
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>
                {modeBadge.emoji} {t(modeBadge.labelKey)}
              </Text>
            </View>
            {familyLabel.visible && (
              <View style={styles.familyBadge}>
                <Text style={styles.familyBadgeText} accessibilityLabel={familyLabel.text}>
                  {familyLabel.text}
                </Text>
              </View>
            )}
            <Text style={[styles.alarmMessage, !item.is_active && styles.textInactive]} numberOfLines={1}>
              &quot;{item.message_text}&quot;
            </Text>
          </View>
        </View>
        <View style={styles.alarmActions}>
          <TouchableOpacity
            style={styles.previewButton}
            accessibilityRole="button"
            accessibilityLabel={t('alarms.a11yPreview')}
            onPress={(e) => {
              e.stopPropagation();
              onPreview(item);
            }}
          >
            <Text style={styles.previewIcon}>🔈</Text>
          </TouchableOpacity>
          <Switch
            value={!!item.is_active}
            onValueChange={(value) => onToggle(item.id, value)}
            trackColor={{
              false: colors.border,
              true: colors.primaryLight,
            }}
            thumbColor={item.is_active ? colors.primary : colors.surfaceVariant}
            accessibilityRole="switch"
            accessibilityLabel={t('alarms.toggleAlarm')}
            accessibilityState={{ checked: !!item.is_active }}
          />
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

export const AlarmListItem = React.memo(AlarmListItemInner);
