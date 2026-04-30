import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Animated as RNAnimated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { withErrorBoundary } from '../../src/components/ErrorBoundary';
import { AlarmListItem } from '../../src/components/AlarmListItem';
import { BannerCountdown } from '../../src/components/BannerCountdown';
import { useTheme } from '../../src/hooks/useTheme';
import { createAlarmsStyles } from '../../src/styles/alarmsStyles';
import { getAlarms, updateAlarm, deleteAlarm, getMessages, getVoiceProfiles } from '../../src/services/api';
import { playAudio } from '../../src/services/audio';
import { useAppStore } from '../../src/stores/useAppStore';
import { DAY_KEYS } from '../../src/constants/presets';
import { ErrorView } from '../../src/components/QueryStateView';
import { AppIcon } from '../../src/components/AppIcon';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { cacheAlarms, getCachedAlarms } from '../../src/services/offlineCache';
import { syncAlarmNotifications } from '../../src/services/notifications';
import { setMonitoredAlarms } from '../../src/services/alarmRinger';
import { syncNotifeeAlarms } from '../../src/services/notifeeAlarms';
import type { Alarm } from '../../src/types';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import {
  buildAlarmPreviewAction,
  resolveAlarmPlayback,
} from '../../src/lib/alarmPlayback';
import { getNextFireMs } from '../../src/lib/alarmCountdown';
import type { Message, VoiceProfile } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

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
  const userId = useAppStore((s) => s.userId);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const toast = useToast();
  const isConnected = useNetworkStatus();
  const [cachedAlarms, setCachedAlarms] = useState<Alarm[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const styles = useMemo(() => createAlarmsStyles(colors), [colors]);

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

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Sync the offline cache + OS notifications whenever the live list
    // changes — including the empty case (last alarm deleted), so stale
    // cached rows don't stick around and the OS cancels old schedules.
    if (alarms) {
      cacheAlarms(alarms);
      setCachedAlarms(alarms);
      syncAlarmNotifications(alarms);
      // iOS: foreground keep-alive ticker (Alarmy-style background audio).
      setMonitoredAlarms(alarms);
      // Android: notifee schedules an exact-time, full-screen-intent
      // alarm so the ringing screen pops over the lock screen even if
      // the OS killed our process.
      void syncNotifeeAlarms(alarms);
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
  }, [displayAlarms, searchQuery]);

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
      toast.show(getApiErrorMessage(err, t, t('alarms.toggleError')));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAlarm,
    onSuccess: (_data, deletedId) => {
      // Drop the row from the cached query data immediately so the list
      // updates without waiting for the background refetch — invalidate
      // alone doesn't guarantee instant UI sync.
      queryClient.setQueryData<Alarm[] | undefined>(['alarms'], (prev) =>
        prev ? prev.filter((a) => a.id !== deletedId) : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      resyncNotifications();
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('alarms.deleteError')));
    },
  });

  const handleDelete = useCallback((id: string) => {
    Alert.alert(t('alarms.deleteTitle'), t('alarms.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
  }, [t, deleteMutation]);

  const formatRepeatDays = useCallback((days: number[]) => {
    if (days.length === 0) return t('alarms.once');
    if (days.length === 7) return t('alarms.daily');
    const sorted = [...days].sort();
    if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) return t('alarms.weekday');
    if (JSON.stringify(sorted) === JSON.stringify([0, 6])) return t('alarms.weekend');
    return days.map((d) => t(DAY_KEYS[d]!)).join(', ');
  }, [t]);

  const renderDeleteAction = useCallback((
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
  }, [styles, t]);

  const handleAlarmPress = useCallback((alarm: Alarm) => {
    router.push({ pathname: '/alarm/edit', params: { id: alarm.id } });
  }, [router]);

  const handleToggle = useCallback((id: string, isActive: boolean) => {
    toggleMutation.mutate({ id, is_active: isActive });
  }, [toggleMutation]);

  const renderAlarm = useCallback(({ item }: { item: Alarm }) => (
    <AlarmListItem
      item={item}
      styles={styles}
      colors={colors}
      userId={userId}
      t={t}
      formatRepeatDays={formatRepeatDays}
      onPress={handleAlarmPress}
      onDelete={handleDelete}
      onPreview={handlePreview}
      onToggle={handleToggle}
      renderDeleteAction={renderDeleteAction}
    />
  ), [styles, colors, t, userId, handleAlarmPress, handleDelete, handlePreview, handleToggle, formatRepeatDays, renderDeleteAction]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{t('alarms.title')}</Text>
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
            accessibilityLabel={t('alarms.searchPlaceholder')}
          />
        </View>
      )}

      {displayAlarms && displayAlarms.length > 0 && (
        <BannerCountdown
          alarms={displayAlarms}
          bannerStyle={styles.countdownBanner}
          labelStyle={styles.countdownLabel}
          valueStyle={styles.countdownValue}
        />
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
          <View style={{ marginBottom: 12 }}>
            <AppIcon name="alarm" size={56} />
          </View>
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

export default withErrorBoundary(AlarmsScreen);
