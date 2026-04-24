import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Animated as RNAnimated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { withErrorBoundary } from '../../src/components/ErrorBoundary';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { getAlarms, updateAlarm, deleteAlarm, getMessages, getVoiceProfiles } from '../../src/services/api';
import { playAudio } from '../../src/services/audio';
import { useAppStore } from '../../src/stores/useAppStore';
import { DAYS_OF_WEEK } from '../../src/constants/presets';
import { ErrorView } from '../../src/components/QueryStateView';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { cacheAlarms, getCachedAlarms } from '../../src/services/offlineCache';
import { syncAlarmNotifications } from '../../src/services/notifications';
import type { Alarm } from '../../src/types';
import { getApiErrorMessage } from '../../src/types';
import { parseRepeatDays } from '../../src/lib/alarmForm';
import {
  buildAlarmPreviewAction,
  getAlarmModeBadge,
  resolveAlarmPlayback,
} from '../../src/lib/alarmPlayback';
import { buildFamilyAlarmLabel } from '../../src/lib/familyAlarmLabel';
import type { Message, VoiceProfile } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

function getNextFireMs(alarm: Alarm): number | null {
  if (!alarm.is_active) return null;
  const [h, m] = alarm.time.split(':').map(Number);
  const days = parseRepeatDays(alarm.repeat_days);
  const now = new Date();
  const todayMinutes = now.getHours() * 60 + now.getMinutes();
  const alarmMinutes = h * 60 + m;
  const todayDow = now.getDay();

  if (days.length === 0) {
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }

  for (let offset = 0; offset <= 7; offset++) {
    const dow = (todayDow + offset) % 7;
    if (!days.includes(dow)) continue;
    if (offset === 0 && alarmMinutes <= todayMinutes) continue;
    const target = new Date(now);
    target.setDate(target.getDate() + offset);
    target.setHours(h, m, 0, 0);
    return target.getTime() - now.getTime();
  }
  return null;
}

function formatCountdown(ms: number, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return t('alarms.countdownDaysHours', { days, hours: remHours });
  }
  if (hours > 0) return t('alarms.countdownHoursMinutes', { hours, minutes: mins });
  return t('alarms.countdownMinutes', { minutes: mins });
}

function compareAlarms(a: Alarm, b: Alarm): number {
  if (a.is_active && !b.is_active) return -1;
  if (!a.is_active && b.is_active) return 1;
  if (a.is_active && b.is_active) {
    const aMs = getNextFireMs(a);
    const bMs = getNextFireMs(b);
    if (aMs !== null && bMs !== null) return aMs - bMs;
    if (aMs !== null) return -1;
    if (bMs !== null) return 1;
  }
  return a.time.localeCompare(b.time);
}

function AlarmsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const toast = useToast();
  const isConnected = useNetworkStatus();
  const [cachedAlarms, setCachedAlarms] = useState<Alarm[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [countdownText, setCountdownText] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    getCachedAlarms().then(setCachedAlarms);
  }, []);

  const {
    data: alarms,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['alarms'],
    queryFn: getAlarms,
    enabled: isAuthenticated && isConnected,
  });

  const { data: messages } = useQuery({
    queryKey: ['messages'],
    queryFn: () => getMessages(),
    enabled: isAuthenticated && isConnected,
  });

  const { data: voices } = useQuery({
    queryKey: ['voiceProfiles'],
    queryFn: getVoiceProfiles,
    enabled: isAuthenticated && isConnected,
  });

  const handlePreview = useCallback(
    async (alarm: Alarm) => {
      const plan = resolveAlarmPlayback(
        alarm,
        (messages ?? []) as Message[],
        (voices ?? []) as VoiceProfile[],
      );
      const action = buildAlarmPreviewAction(plan);
      if (action.type === 'navigate') {
        router.push({ pathname: action.path, params: action.params });
      } else if (action.type === 'preview-audio') {
        toast.show(t(action.captionKey, action.captionParams) || t('alarms.previewPlay'));
        try {
          await playAudio(action.uri);
        } catch {
          toast.show(t('alarms.previewFailed'));
        }
      } else {
        toast.show(t(action.messageKey));
      }
    },
    [messages, voices, router, toast],
  );

  const computeCountdown = useCallback(() => {
    const all = alarms ?? cachedAlarms;
    if (!all || all.length === 0) { setCountdownText(null); return; }
    let nearest = Infinity;
    for (const a of all) {
      const ms = getNextFireMs(a);
      if (ms !== null && ms < nearest) nearest = ms;
    }
    setCountdownText(nearest < Infinity ? formatCountdown(nearest, t) : null);
  }, [alarms, cachedAlarms, t]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    computeCountdown();
    const id = setInterval(() => {
      computeCountdown();
      setTick((t) => t + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, [computeCountdown]);

  useEffect(() => {
    if (alarms && alarms.length > 0) {
      cacheAlarms(alarms);
      setCachedAlarms(alarms);
      syncAlarmNotifications(alarms);
    }
  }, [alarms]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayAlarms = alarms ?? cachedAlarms;
  const showingCached = !alarms && !!cachedAlarms && !isConnected;

  const filteredAlarms = useMemo(() => {
    if (!displayAlarms) return displayAlarms;
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? displayAlarms.filter((a) =>
          a.time.includes(q) ||
          (a.voice_name && a.voice_name.toLowerCase().includes(q)) ||
          (a.message_text && a.message_text.toLowerCase().includes(q))
        )
      : [...displayAlarms];
    return filtered.sort(compareAlarms);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayAlarms, searchQuery, tick]);

  const resyncNotifications = async () => {
    const fresh = await queryClient.fetchQuery({ queryKey: ['alarms'], queryFn: getAlarms });
    if (fresh) syncAlarmNotifications(fresh);
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateAlarm(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      resyncNotifications();
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('alarms.toggleError')));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAlarm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      resyncNotifications();
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('alarms.deleteError')));
    },
  });

  const handleDelete = (id: string) => {
    Alert.alert(t('alarms.deleteTitle'), t('alarms.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
  };

  const formatRepeatDays = (days: number[]) => {
    if (days.length === 0) return t('alarms.once');
    if (days.length === 7) return t('alarms.daily');
    const sorted = [...days].sort();
    if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) return t('alarms.weekday');
    if (JSON.stringify(sorted) === JSON.stringify([0, 6])) return t('alarms.weekend');
    return days.map((d) => DAYS_OF_WEEK[d]).join(', ');
  };

  const renderDeleteAction = (
    _progress: RNAnimated.AnimatedInterpolation<number>,
    dragX: RNAnimated.AnimatedInterpolation<number>,
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-100, -50, 0],
      outputRange: [1, 0.8, 0],
      extrapolate: 'clamp',
    });
    return (
      <View style={styles.swipeDeleteContainer}>
        <RNAnimated.Text style={[styles.swipeDeleteText, { transform: [{ scale }] }]}>
          {t('common.delete')}
        </RNAnimated.Text>
      </View>
    );
  };

  const renderAlarm = ({ item }: { item: Alarm }) => {
    const repeatDays = parseRepeatDays(item.repeat_days);
    void tick;
    const nextFireMs = getNextFireMs(item);
    const perAlarmCountdown = nextFireMs !== null ? formatCountdown(nextFireMs, t) : null;
    return (
      <Swipeable
        renderRightActions={renderDeleteAction}
        onSwipeableOpen={() => handleDelete(item.id)}
        overshootRight={false}
      >
        <TouchableOpacity
          style={[styles.alarmCard, !item.is_active && styles.alarmCardInactive]}
          onPress={() => router.push({ pathname: '/alarm/edit', params: { id: item.id } })}
          onLongPress={() => handleDelete(item.id)}
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
                  {getAlarmModeBadge(item.mode).emoji} {t(getAlarmModeBadge(item.mode).labelKey)}
                </Text>
              </View>
              {(() => {
                const familyLabel = buildFamilyAlarmLabel(item);
                return familyLabel.visible ? (
                  <View style={styles.familyBadge}>
                    <Text style={styles.familyBadgeText} accessibilityLabel={familyLabel.text}>
                      {familyLabel.text}
                    </Text>
                  </View>
                ) : null;
              })()}
              <Text style={[styles.alarmMessage, !item.is_active && styles.textInactive]} numberOfLines={1}>
                "{item.message_text}"
              </Text>
            </View>
          </View>
          <View style={styles.alarmActions}>
            <TouchableOpacity
              style={styles.previewButton}
              accessibilityLabel={t('alarms.a11yPreview')}
              onPress={(e) => {
                e.stopPropagation();
                handlePreview(item);
              }}
            >
              <Text style={styles.previewIcon}>🔈</Text>
            </TouchableOpacity>
            <Switch
              value={!!item.is_active}
              onValueChange={(value) => toggleMutation.mutate({ id: item.id, is_active: value })}
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
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('alarms.title')}</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/alarm/create')}
          accessibilityRole="button"
          accessibilityLabel={t('alarms.add')}
        >
          <Text style={styles.addButtonText}>{t('alarms.add')}</Text>
        </TouchableOpacity>
      </View>

      {displayAlarms && displayAlarms.length > 0 && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('alarms.searchPlaceholder')}
            placeholderTextColor={colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
      )}

      {countdownText && (
        <View style={styles.countdownBanner}>
          <Text style={styles.countdownLabel}>{t('alarms.nextIn')}</Text>
          <Text style={styles.countdownValue}>{countdownText}</Text>
        </View>
      )}

      {showingCached && (
        <View style={styles.cachedBanner}>
          <Text style={styles.cachedText}>{t('offline.cachedData')}</Text>
        </View>
      )}

      {isLoading && !cachedAlarms ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      ) : isError && !cachedAlarms ? (
        <ErrorView onRetry={refetch} />
      ) : filteredAlarms?.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>⏰</Text>
          <Text style={styles.emptyTitle}>{t('alarms.emptyTitle')}</Text>
          <Text style={styles.emptyDesc}>{t('alarms.emptyDesc')}</Text>
          <TouchableOpacity
            style={styles.emptyButton}
            onPress={() => router.push('/alarm/create')}
            accessibilityRole="button"
            accessibilityLabel={t('alarms.emptyButton')}
          >
            <Text style={styles.emptyButtonText}>{t('alarms.emptyButton')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredAlarms}
          keyExtractor={(item) => item.id}
          renderItem={renderAlarm}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          windowSize={5}
          removeClippedSubviews
        />
      )}
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    addButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
    },
    addButtonText: {
      color: '#FFF',
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
    searchContainer: {
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    searchInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
    },
    countdownBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.primaryLight + '33',
    },
    countdownLabel: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    countdownValue: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    cachedBanner: {
      backgroundColor: colors.surfaceVariant,
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
    },
    cachedText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    list: {
      padding: Spacing.lg,
      paddingTop: 0,
      paddingBottom: 100,
    },
    alarmCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    alarmCardInactive: {
      opacity: 0.6,
    },
    alarmLeft: {
      flex: 1,
    },
    alarmTime: {
      fontSize: 36,
      fontFamily: FontFamily.regular,
      color: colors.text,
    },
    timeInactive: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through' as const,
    },
    textInactive: {
      color: colors.textTertiary,
    },
    alarmSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginTop: 2,
    },
    alarmRepeat: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    alarmCountdown: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    alarmMeta: {
      marginTop: Spacing.sm,
    },
    alarmVoice: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    alarmMessage: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    modeBadge: {
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surfaceVariant,
    },
    modeBadgeText: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    familyBadge: {
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.primaryLight,
    },
    familyBadgeText: {
      fontSize: FontSize.xs,
      color: '#FFFFFF',
      fontFamily: FontFamily.bold,
    },
    alarmActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    previewButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewIcon: {
      fontSize: 18,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
    },
    emptyEmoji: {
      fontSize: 64,
      marginBottom: Spacing.lg,
    },
    emptyTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    emptyDesc: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: Spacing.lg,
    },
    emptyButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.full,
    },
    emptyButtonText: {
      color: '#FFF',
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    swipeDeleteContainer: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingHorizontal: Spacing.xl,
      borderRadius: BorderRadius.lg,
      marginBottom: Spacing.md,
    },
    swipeDeleteText: {
      color: '#FFF',
      fontFamily: FontFamily.bold,
      fontSize: FontSize.md,
    },
  });
}

export default withErrorBoundary(AlarmsScreen);
