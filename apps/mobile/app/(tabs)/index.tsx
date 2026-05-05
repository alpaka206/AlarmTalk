import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getDateLocale } from '../../src/i18n';
import { Spacing } from '../../src/constants/theme';
import { withErrorBoundary } from '../../src/components/ErrorBoundary';
import { useTheme } from '../../src/hooks/useTheme';
import { createHomeStyles } from '../../src/styles/homeStyles';
import { getAlarms, getMessages, getStats, getCharacterMe, getLibrary, getActivity } from '../../src/services/api';
import type { Stats, ActivityItem } from '../../src/services/api';
import { stageToEmoji, progressBarWidthPct } from '../../src/lib/character';
import { playAudio, getLocalAudioPath, isAudioCached } from '../../src/services/audio';
import { activityEmoji, activityTypeLabel, activityDescription } from '../../src/lib/activityHelpers';
import { formatLastSeen } from '../../src/lib/formatLastSeen';
import type { LibraryItem } from '../../src/types';
import LoginButtons from '../../src/components/LoginButtons';
import EmailPasswordForm from '../../src/components/EmailPasswordForm';
import { AppIcon } from '../../src/components/AppIcon';
import { ProfileDropdown } from '../../src/components/ProfileDropdown';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import {
  cacheAlarms,
  getCachedAlarms,
  cacheMessages,
  getCachedMessages,
} from '../../src/services/offlineCache';
import { Audio } from 'expo-av';
import type { Alarm, Message } from '../../src/types';

function HomeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createHomeStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const { isAuthenticated, setPlaying, currentPlayingId } = useAppStore();
  const isConnected = useNetworkStatus();
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [cachedAlarmsList, setCachedAlarmsList] = useState<Alarm[] | null>(null);
  const [cachedMessagesList, setCachedMessagesList] = useState<Message[] | null>(null);

  useEffect(() => {
    getCachedAlarms().then(setCachedAlarmsList);
    getCachedMessages().then(setCachedMessagesList);
  }, []);

  const {
    data: alarms,
    isLoading: alarmsLoading,
    refetch: refetchAlarms,
  } = useQuery({
    queryKey: ['alarms'],
    queryFn: getAlarms,
    enabled: isAuthenticated && isConnected,
  });

  const {
    data: messages,
    isLoading: messagesLoading,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['messages'],
    queryFn: () => getMessages(),
    enabled: isAuthenticated && isConnected,
  });

  // Secondary widgets (stats / character / library / activity) load with
  // a longer staleTime + placeholderData so the first paint on the home
  // tab is alarms+messages only — the rest fill in asynchronously and
  // surface stale data instantly on revisit instead of refetching.
  const {
    data: stats,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery<Stats>({
    queryKey: ['stats'],
    queryFn: getStats,
    enabled: isAuthenticated && isConnected,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { data: characterData } = useQuery({
    queryKey: ['character-me'],
    queryFn: getCharacterMe,
    enabled: isAuthenticated && isConnected,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { data: libraryItems } = useQuery({
    queryKey: ['library', 'all'],
    queryFn: () => getLibrary(),
    enabled: isAuthenticated && isConnected,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const { data: activityItems } = useQuery({
    queryKey: ['activity'],
    queryFn: getActivity,
    enabled: isAuthenticated && isConnected,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (alarms && alarms.length > 0) {
      cacheAlarms(alarms);
      setCachedAlarmsList(alarms);
    }
  }, [alarms]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      cacheMessages(messages);
      setCachedMessagesList(messages);
    }
  }, [messages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displayAlarms = alarms ?? cachedAlarmsList;
  const displayMessages = messages ?? cachedMessagesList;

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    // Pull-to-refresh forces a full reload across every home widget. The
    // secondary widgets normally rely on a 10min staleTime, so without
    // explicit refetch here they wouldn't update on user-initiated pulls.
    await Promise.all([
      refetchAlarms(),
      refetchMessages(),
      refetchStats(),
      queryClient.refetchQueries({ queryKey: ['character-me'] }),
      queryClient.refetchQueries({ queryKey: ['library', 'all'] }),
      queryClient.refetchQueries({ queryKey: ['activity'] }),
    ]);
    setRefreshing(false);
  };

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return { icon: 'moon' as const, text: t('greeting.night') };
    if (hour < 12) return { icon: 'sun' as const, text: t('greeting.morning') };
    if (hour < 17) return { icon: 'sun' as const, text: t('greeting.afternoon') };
    if (hour < 21) return { icon: 'sun' as const, text: t('greeting.evening') };
    return { icon: 'moon' as const, text: t('greeting.night') };
  };

  const greeting = getTimeGreeting();
  const nextAlarm = displayAlarms?.find((a: Alarm) => a.is_active);
  const latestMessage = displayMessages?.[0];

  const handlePlayMessage = useCallback(async (messageId: string) => {
    if (currentSound) {
      await currentSound.unloadAsync();
      setCurrentSound(null);
    }

    if (currentPlayingId === messageId) {
      setPlaying(null);
      return;
    }

    const cached = await isAudioCached(messageId);
    if (cached) {
      const localPath = getLocalAudioPath(messageId);
      const sound = await playAudio(localPath);
      setCurrentSound(sound);
      setPlaying(messageId);

      sound.setOnPlaybackStatusUpdate((status) => {
        if ('didJustFinish' in status && status.didJustFinish) {
          setPlaying(null);
          setCurrentSound(null);
        }
      });
    }
  }, [currentSound, currentPlayingId, setPlaying]);

  return (
    // Tab bar already accounts for the bottom safe-area inset. Letting
    // SafeAreaView add its own bottom padding stacked a second navbar-sized
    // strip on top of the content, clipping the last quick-action cards.
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* 인사말 + 우상단 알림/프로필 — 한 라인 */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <AppIcon name={greeting.icon} size={26} />
              <Text style={styles.greeting} accessibilityRole="header" numberOfLines={1}>
                {greeting.text}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ProfileDropdown />
            </View>
          </View>
          <Text style={styles.subtitle}>{t('home.subtitle')}</Text>
        </View>

        {isAuthenticated && (alarmsLoading || messagesLoading) && !refreshing && (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.lg }} />
        )}

        {/* 요약 통계 */}
        {isAuthenticated && statsError && (
          <TouchableOpacity
            style={styles.statsErrorCard}
            onPress={() => refetchStats()}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.retry')}
          >
            <Text style={styles.statsErrorText}>{t('common.loadError')}</Text>
            <Text style={styles.statsErrorRetry}>{t('common.retry')}</Text>
          </TouchableOpacity>
        )}
        {isAuthenticated && stats && (
          <View style={styles.statsRow}>
            <View
              style={styles.statItem}
              accessible
              accessibilityLabel={`${t('home.activeAlarms')} ${stats.alarms.active}`}
            >
              <Text style={styles.statCount}>{stats.alarms.active}</Text>
              <Text style={styles.statLabel}>{t('home.activeAlarms')}</Text>
            </View>
            <View
              style={styles.statItem}
              accessible
              accessibilityLabel={`${t('home.messages')} ${stats.messages.total}`}
            >
              <Text style={styles.statCount}>{stats.messages.total}</Text>
              <Text style={styles.statLabel}>{t('home.messages')}</Text>
            </View>
            <View
              style={styles.statItem}
              accessible
              accessibilityLabel={`${t('home.friends')} ${stats.friends.total}`}
            >
              <Text style={styles.statCount}>{stats.friends.total}</Text>
              <Text style={styles.statLabel}>{t('home.friends')}</Text>
            </View>
            {stats.gifts.receivedPending > 0 && (
              <TouchableOpacity
                style={styles.statItem}
                onPress={() => router.push('/gift/received')}
                accessibilityRole="button"
                accessibilityLabel={`${t('home.pendingGifts')} ${stats.gifts.receivedPending}`}
              >
                <Text style={[styles.statCount, { color: colors.accent }]}>
                  {stats.gifts.receivedPending}
                </Text>
                <Text style={[styles.statLabel, { color: colors.accent }]}>
                  {t('home.pendingGifts')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 캐릭터 미니 위젯 */}
        {isAuthenticated && characterData && (
          <TouchableOpacity
            style={styles.characterWidget}
            onPress={() => router.push('/character')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('home.viewCharacter')}
          >
            <Text style={styles.widgetEmoji}>
              {stageToEmoji(characterData.character.stage)}
            </Text>
            <View style={styles.widgetInfo}>
              <View style={styles.widgetNameRow}>
                <Text style={styles.widgetName}>{characterData.character.name}</Text>
                <Text style={styles.widgetLevel}>{t('character.levelDisplay', { level: characterData.character.level })}</Text>
                {characterData.streak && characterData.streak.current > 0 && (
                  <Text style={styles.widgetStreak}>
                    🔥 {characterData.streak.current}
                  </Text>
                )}
              </View>
              <View style={styles.widgetProgressBg}>
                <View
                  style={[
                    styles.widgetProgressFill,
                    { width: `${progressBarWidthPct(characterData.progress)}%` },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.widgetArrow}>›</Text>
          </TouchableOpacity>
        )}

        {/* 다음 알람 카드 */}
        <TouchableOpacity
          style={styles.nextAlarmCard}
          onPress={() =>
            nextAlarm
              ? router.push({ pathname: '/alarm/edit', params: { id: nextAlarm.id } })
              : router.push('/alarm/create')
          }
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={nextAlarm ? `${t('home.nextAlarm')} ${nextAlarm.time}` : t('home.noAlarm')}
        >
          <View style={styles.nextAlarmGradient}>
            <Text style={styles.nextAlarmLabel}>{t('home.nextAlarm')}</Text>
            {nextAlarm ? (
              <>
                <Text style={styles.nextAlarmTime}>{nextAlarm.time}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <AppIcon name="speaker" size={16} color={colors.surface} duotoneColor={colors.surface} />
                  <Text style={styles.nextAlarmMessage}>
                    {nextAlarm.voice_name}: "{nextAlarm.message_text}"
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.nextAlarmTime}>--:--</Text>
                <Text style={styles.nextAlarmMessage}>{t('home.noAlarm')}</Text>
              </>
            )}
          </View>
        </TouchableOpacity>

        {/* 오늘의 응원 메시지 */}
        {latestMessage && (
          <TouchableOpacity
            style={styles.cheerCard}
            onPress={() => handlePlayMessage(latestMessage.id)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`${t('home.todayMessage')} ${latestMessage.voice_name}`}
          >
            <View style={styles.cheerHeader}>
              <AppIcon name="message" size={20} />
              <Text style={styles.cheerTitle}>{t('home.todayMessage')}</Text>
            </View>
            <Text style={styles.cheerText}>"{latestMessage.text}"</Text>
            <View style={styles.cheerFooter}>
              <Text style={styles.cheerVoice}>— {latestMessage.voice_name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AppIcon
                  name={currentPlayingId === latestMessage.id ? 'pause' : 'play'}
                  size={16}
                />
                <Text style={styles.playButton}>
                  {currentPlayingId === latestMessage.id ? t('home.pause') : t('home.play')}
                </Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* 섹션 구분선 */}
        {isAuthenticated && <View style={styles.sectionDivider} />}

        {/* 최근 메시지 */}
        {isAuthenticated && (
          <View style={styles.recentSection}>
            <View style={styles.recentHeader}>
              <Text style={styles.sectionTitle} accessibilityRole="header">{t('home.recentMessages')}</Text>
              {libraryItems && libraryItems.length > 0 && (
                <TouchableOpacity
                  onPress={() => router.push('/library')}
                  accessibilityRole="link"
                  accessibilityLabel={t('home.viewAll')}
                >
                  <Text style={styles.viewAllLink}>{t('home.viewAll')}</Text>
                </TouchableOpacity>
              )}
            </View>
            {libraryItems && libraryItems.length > 0 ? (
              libraryItems.slice(0, 3).map((item: LibraryItem) => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.recentItem}
                  onPress={() => router.push(`/message/${item.message_id}`)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.voice_name}: ${item.text}`}
                >
                  <View style={styles.recentAvatar}>
                    <Text style={styles.recentAvatarText}>
                      {(item.voice_name || '?').charAt(0)}
                    </Text>
                  </View>
                  <View style={styles.recentContent}>
                    <Text style={styles.recentVoiceName}>{item.voice_name}</Text>
                    <Text style={styles.recentText} numberOfLines={1}>
                      &quot;{item.text}&quot;
                    </Text>
                  </View>
                  <Text style={styles.recentDate}>
                    {new Date(item.received_at).toLocaleDateString(getDateLocale(), {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.recentEmpty}>
                <Text style={styles.recentEmptyText}>{t('home.noMessages')}</Text>
              </View>
            )}
          </View>
        )}

        {/* 섹션 구분선 */}
        {isAuthenticated && <View style={styles.sectionDivider} />}

        {/* 최근 활동 */}
        {isAuthenticated && (
          <View style={styles.activitySection}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('home.recentActivity')}
            </Text>
            {activityItems && activityItems.length > 0 ? (
              activityItems.slice(0, 5).map((item: ActivityItem) => (
                <View
                  key={`${item.type}-${item.id}`}
                  style={styles.activityItem}
                  accessible
                  accessibilityLabel={`${activityTypeLabel(item.type, t)}: ${activityDescription(item, t)}`}
                >
                  <Text style={styles.activityEmoji}>{activityEmoji(item.type)}</Text>
                  <View style={styles.activityContent}>
                    <Text style={styles.activityTypeLabel}>
                      {activityTypeLabel(item.type, t)}
                    </Text>
                    <Text style={styles.activityDesc} numberOfLines={1}>
                      {activityDescription(item, t)}
                    </Text>
                  </View>
                  <Text style={styles.activityTime}>
                    {formatLastSeen(item.created_at, t)}
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.activityEmpty}>
                <Text style={styles.activityEmptyText}>{t('home.noActivity')}</Text>
              </View>
            )}
          </View>
        )}

        {/* 섹션 구분선 */}
        {isAuthenticated && <View style={styles.sectionDivider} />}

        {/* 빠른 액션 */}
        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle} accessibilityRole="header">{t('home.quickStart')}</Text>
          <View style={styles.actionGrid}>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/voice/record')}
              accessibilityRole="button"
              accessibilityLabel={t('home.recordVoice')}
            >
              <AppIcon name="mic" size={28} />
              <Text style={styles.actionLabel}>{t('home.recordVoice')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/voice/upload')}
              accessibilityRole="button"
              accessibilityLabel={t('home.uploadFile')}
            >
              <AppIcon name="upload" size={28} />
              <Text style={styles.actionLabel}>{t('home.uploadFile')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/message/create')}
              accessibilityRole="button"
              accessibilityLabel={t('home.writeMessage')}
            >
              <AppIcon name="edit" size={28} />
              <Text style={styles.actionLabel}>{t('home.writeMessage')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/alarm/create')}
              accessibilityRole="button"
              accessibilityLabel={t('home.addAlarm')}
            >
              <AppIcon name="alarm" size={28} />
              <Text style={styles.actionLabel}>{t('home.addAlarm')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/code-register')}
              accessibilityRole="button"
              accessibilityLabel={t('home.codeRegister')}
            >
              <AppIcon name="gift" size={28} />
              <Text style={styles.actionLabel}>{t('home.codeRegister')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionCard}
              onPress={() => router.push('/people')}
              accessibilityRole="button"
              accessibilityLabel={t('home.manageFriends')}
            >
              <AppIcon name="friends" size={28} />
              <Text style={styles.actionLabel}>{t('home.manageFriends')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 비로그인 상태 안내 */}
        {!isAuthenticated && (
          <View style={styles.loginPrompt}>
            <View style={{ marginBottom: 12 }}>
              <AppIcon name="lock" size={56} />
            </View>
            <Text style={styles.loginTitle}>{t('home.loginTitle')}</Text>
            <Text style={styles.loginDesc}>{t('home.loginDesc')}</Text>
            <EmailPasswordForm />
            <View style={styles.loginDivider}>
              <View style={styles.loginDividerLine} />
              <Text style={styles.loginDividerText}>{t('common.or')}</Text>
              <View style={styles.loginDividerLine} />
            </View>
            <LoginButtons />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}


export default withErrorBoundary(HomeScreen);
