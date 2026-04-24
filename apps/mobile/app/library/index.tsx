import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Animated as RNAnimated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { getLibrary, toggleFavorite, deleteLibraryItem } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { cacheLibrary, getCachedLibrary } from '../../src/services/offlineCache';
import { ErrorView } from '../../src/components/QueryStateView';
import { MiniWaveformPlayer } from '../../src/components/MiniWaveformPlayer';
import { Audio } from 'expo-av';
import type { LibraryItem } from '../../src/types';
import { getApiErrorMessage } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

type FilterType = 'all' | 'favorite';

const CATEGORIES = [
  { key: 'all', emoji: '📋' },
  { key: 'morning', emoji: '🌅' },
  { key: 'lunch', emoji: '🍽️' },
  { key: 'afternoon', emoji: '☕' },
  { key: 'evening', emoji: '🌙' },
  { key: 'night', emoji: '😴' },
  { key: 'cheer', emoji: '💪' },
  { key: 'love', emoji: '❤️' },
  { key: 'health', emoji: '🏥' },
  { key: 'custom', emoji: '✏️' },
] as const;

export default function LibraryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { setPlaying, currentPlayingId } = useAppStore();
  const [filter, setFilter] = useState<FilterType>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const { t } = useTranslation();
  const toast = useToast();
  const isConnected = useNetworkStatus();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  const [cachedItems, setCachedItems] = useState<LibraryItem[] | null>(null);

  useEffect(() => {
    getCachedLibrary().then(setCachedItems);
  }, []);

  const {
    data: items,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['library', filter],
    queryFn: () => getLibrary(filter === 'favorite' ? 'favorite' : undefined),
    enabled: isAuthenticated && isConnected,
  });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (items && items.length > 0 && filter === 'all') {
      cacheLibrary(items);
      setCachedItems(items);
    }
  }, [items, filter]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const baseItems = items ?? (filter === 'all' ? cachedItems : null);
  const displayItems = useMemo(() => {
    const filtered = categoryFilter === 'all'
      ? baseItems
      : baseItems?.filter((item: LibraryItem) => item.category === categoryFilter) ?? null;
    if (!filtered) return filtered;
    return [...filtered].sort((a, b) => {
      if (a.is_favorite && !b.is_favorite) return -1;
      if (!a.is_favorite && b.is_favorite) return 1;
      return new Date(b.received_at).getTime() - new Date(a.received_at).getTime();
    });
  }, [baseItems, categoryFilter]);
  const showingCached = !items && !!cachedItems && !isConnected && filter === 'all';

  const favoriteMutation = useMutation({
    mutationFn: toggleFavorite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: () => {
      toast.show(t('library.favoriteError'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLibraryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('library.deleteError')));
    },
  });

  const handleDelete = (id: string) => {
    Alert.alert(t('library.deleteTitle'), t('library.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
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
      <View style={dynStyles.swipeDeleteContainer}>
        <RNAnimated.Text style={[dynStyles.swipeDeleteText, { transform: [{ scale }] }]}>
          {t('common.delete')}
        </RNAnimated.Text>
      </View>
    );
  };

  const handleMiniPlay = (messageId: string, sound: Audio.Sound) => {
    if (currentSound) {
      currentSound.unloadAsync();
    }
    setCurrentSound(sound);
    setPlaying(messageId);
  };

  const handleMiniStop = () => {
    setPlaying(null);
    setCurrentSound(null);
  };

  const getCategoryEmoji = (category: string) => {
    const map: Record<string, string> = {
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
    return map[category] || '💌';
  };

  const CATEGORY_I18N: Record<string, string> = {
    morning: 'library.categoryMorning',
    lunch: 'library.categoryLunch',
    afternoon: 'library.categoryAfternoon',
    evening: 'library.categoryEvening',
    night: 'library.categoryNight',
    cheer: 'library.categoryCheer',
    love: 'library.categoryLove',
    health: 'library.categoryHealth',
    custom: 'library.categoryCustom',
  };

  const getCategoryLabel = useCallback(
    (key: string) => (CATEGORY_I18N[key] ? t(CATEGORY_I18N[key]) : key),
    [t],
  );

  const renderCategoryItem = useCallback(
    ({ item: cat }: { item: (typeof CATEGORIES)[number] }) => (
      <TouchableOpacity
        style={[dynStyles.categoryChip, categoryFilter === cat.key && dynStyles.categoryChipActive]}
        onPress={() => setCategoryFilter(cat.key)}
        accessibilityRole="radio"
        accessibilityState={{ selected: categoryFilter === cat.key }}
        accessibilityLabel={cat.key === 'all' ? t('library.all') : getCategoryLabel(cat.key)}
      >
        <Text style={dynStyles.categoryChipText}>
          {cat.emoji} {cat.key === 'all' ? t('library.all') : getCategoryLabel(cat.key)}
        </Text>
      </TouchableOpacity>
    ),
    [dynStyles, categoryFilter, t, getCategoryLabel],
  );

  const renderItem = ({ item }: { item: LibraryItem }) => {
    const isActive = currentPlayingId === item.message_id;
    return (
      <Swipeable
        renderRightActions={renderDeleteAction}
        onSwipeableOpen={() => handleDelete(item.id)}
        overshootRight={false}
      >
        <TouchableOpacity
          style={dynStyles.messageCard}
          onPress={() => router.push(`/message/${item.message_id}`)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${item.voice_name}, ${getCategoryLabel(item.category)}: ${item.text}`}
        >
          <View style={dynStyles.messageLeft}>
            <View style={dynStyles.avatarSmall}>
              <Text style={dynStyles.avatarLetter}>{item.voice_name?.charAt(0) || '?'}</Text>
            </View>
            <View style={dynStyles.messageContent}>
              <View style={dynStyles.messageHeader}>
                <Text style={dynStyles.voiceName}>{item.voice_name}</Text>
                <Text
                  style={dynStyles.categoryBadge}
                  accessibilityLabel={t('library.a11yCategoryBadge', { category: getCategoryLabel(item.category) })}
                >{getCategoryEmoji(item.category)}</Text>
              </View>
              <Text style={dynStyles.messageText} numberOfLines={2}>
                &quot;{item.text}&quot;
              </Text>
              <View style={dynStyles.miniPlayerRow}>
                <MiniWaveformPlayer
                  messageId={item.message_id}
                  isActive={isActive}
                  onPlay={handleMiniPlay}
                  onStop={handleMiniStop}
                />
              </View>
              <Text style={dynStyles.messageDate}>
                {new Date(item.received_at).toLocaleDateString('ko-KR', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </View>

          <View style={dynStyles.messageActions}>
            <TouchableOpacity
              onPress={() => favoriteMutation.mutate(item.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={item.is_favorite ? t('library.removeFavorite') : t('library.addFavorite')}
            >
              <Text style={dynStyles.favoriteIcon}>{item.is_favorite ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  return (
    <SafeAreaView style={dynStyles.container} edges={['bottom']}>
      <View style={dynStyles.filterRow}>
        <TouchableOpacity
          style={[dynStyles.filterChip, filter === 'all' && dynStyles.filterChipActive]}
          onPress={() => setFilter('all')}
          accessibilityRole="radio"
          accessibilityState={{ selected: filter === 'all' }}
          accessibilityLabel={t('library.all')}
        >
          <Text style={[dynStyles.filterText, filter === 'all' && dynStyles.filterTextActive]}>
            {t('library.all')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[dynStyles.filterChip, filter === 'favorite' && dynStyles.filterChipActive]}
          onPress={() => setFilter('favorite')}
          accessibilityRole="radio"
          accessibilityState={{ selected: filter === 'favorite' }}
          accessibilityLabel={t('library.favorites')}
        >
          <Text style={[dynStyles.filterText, filter === 'favorite' && dynStyles.filterTextActive]}>
            ❤️ {t('library.favorites')}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={CATEGORIES}
        keyExtractor={(item) => item.key}
        contentContainerStyle={dynStyles.categoryRow}
        renderItem={renderCategoryItem}
      />

      {showingCached && (
        <View style={dynStyles.cachedBanner}>
          <Text style={dynStyles.cachedText}>{t('offline.cachedData')}</Text>
        </View>
      )}

      {isLoading && !cachedItems ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      ) : isError && !cachedItems ? (
        <ErrorView onRetry={refetch} />
      ) : displayItems?.length === 0 ? (
        <View style={dynStyles.emptyState}>
          <Text style={dynStyles.emptyEmoji}>📭</Text>
          <Text style={dynStyles.emptyText}>
            {filter === 'favorite' ? t('library.emptyFavorites') : t('library.emptyAll')}
          </Text>
          {filter !== 'favorite' && (
            <TouchableOpacity
              style={dynStyles.emptyCta}
              onPress={() => router.push('/message/create')}
              accessibilityRole="button"
              accessibilityLabel={t('library.createMessage')}
            >
              <Text style={dynStyles.emptyCtaText}>{t('library.createMessage')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={displayItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={dynStyles.list}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={5}
          windowSize={5}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
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
    filterRow: {
      flexDirection: 'row',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
    },
    categoryRow: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
      gap: Spacing.xs,
    },
    categoryChip: {
      paddingHorizontal: Spacing.sm + 4,
      paddingVertical: Spacing.xs + 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: Spacing.xs,
    },
    categoryChipActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    categoryChipText: {
      fontSize: FontSize.xs,
      color: colors.text,
      fontFamily: FontFamily.medium,
    },
    filterChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
    filterTextActive: {
      color: '#FFF',
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
    },
    messageCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    messageLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarSmall: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.md,
    },
    avatarLetter: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    messageContent: {
      flex: 1,
    },
    messageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    voiceName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    categoryBadge: {
      fontSize: 14,
    },
    messageText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
      lineHeight: 18,
    },
    miniPlayerRow: {
      marginTop: Spacing.xs,
    },
    messageDate: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 4,
    },
    messageActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    favoriteIcon: {
      fontSize: 20,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyEmoji: {
      fontSize: 64,
      marginBottom: Spacing.md,
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    emptyCta: {
      marginTop: Spacing.lg,
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.sm + 4,
      borderRadius: BorderRadius.full,
      minHeight: 44,
      justifyContent: 'center',
    },
    emptyCtaText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.surface,
    },
    swipeDeleteContainer: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingHorizontal: Spacing.xl,
      borderRadius: BorderRadius.lg,
      marginBottom: Spacing.sm,
    },
    swipeDeleteText: {
      color: '#FFF',
      fontFamily: FontFamily.bold,
      fontSize: FontSize.md,
    },
  });
}
