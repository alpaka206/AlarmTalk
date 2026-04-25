import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Animated as RNAnimated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/hooks/useTheme';
import { createLibraryStyles } from '../../src/styles/libraryStyles';
import { getLibrary, toggleFavorite, deleteLibraryItem } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { cacheLibrary, getCachedLibrary } from '../../src/services/offlineCache';
import { ErrorView } from '../../src/components/QueryStateView';
import { LibraryListItem } from '../../src/components/LibraryListItem';
import { Audio } from 'expo-av';
import type { LibraryItem } from '../../src/types';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
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
  const dynStyles = useMemo(() => createLibraryStyles(colors), [colors]);
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
      toast.show(getApiErrorMessage(err, t, t('library.deleteError')));
    },
  });

  const handleDelete = useCallback((id: string) => {
    Alert.alert(t('library.deleteTitle'), t('library.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
  }, [t, deleteMutation]);

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
      <View style={dynStyles.swipeDeleteContainer}>
        <RNAnimated.Text style={[dynStyles.swipeDeleteText, { transform: [{ scale }] }]}>
          {t('common.delete')}
        </RNAnimated.Text>
      </View>
    );
  }, [dynStyles, t]);

  const handleMiniPlay = useCallback((messageId: string, sound: Audio.Sound) => {
    if (currentSound) {
      currentSound.unloadAsync();
    }
    setCurrentSound(sound);
    setPlaying(messageId);
  }, [currentSound, setPlaying]);

  const handleMiniStop = useCallback(() => {
    setPlaying(null);
    setCurrentSound(null);
  }, [setPlaying]);

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

  const handleItemPress = useCallback((messageId: string) => {
    router.push(`/message/${messageId}`);
  }, [router]);

  const handleFavorite = useCallback((id: string) => {
    favoriteMutation.mutate(id);
  }, [favoriteMutation]);

  const renderItem = useCallback(({ item }: { item: LibraryItem }) => (
    <LibraryListItem
      item={item}
      styles={dynStyles}
      isActive={currentPlayingId === item.message_id}
      t={t}
      getCategoryLabel={getCategoryLabel}
      onPress={handleItemPress}
      onDelete={handleDelete}
      onFavorite={handleFavorite}
      onPlay={handleMiniPlay}
      onStop={handleMiniStop}
      renderDeleteAction={renderDeleteAction}
    />
  ), [dynStyles, currentPlayingId, t, getCategoryLabel, handleItemPress, handleDelete, handleFavorite, handleMiniPlay, handleMiniStop, renderDeleteAction]);

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
