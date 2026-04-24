import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Animated as RNAnimated,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getDateLocale } from '../../src/i18n';
import { withErrorBoundary } from '../../src/components/ErrorBoundary';
import { useTheme } from '../../src/hooks/useTheme';
import { createVoicesStyles } from '../../src/styles/voicesStyles';
import {
  getVoiceProfiles,
  deleteVoiceProfile,
  getFamilyVoiceProfiles,
} from '../../src/services/api';
import type { FamilyVoiceProfile } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { ErrorView } from '../../src/components/QueryStateView';
import type { VoiceProfile } from '../../src/types';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { cacheVoices, getCachedVoices } from '../../src/services/offlineCache';

const MAX_VOICE_PROFILES = 2;

function VoicesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const plan = useAppStore((s) => s.plan);
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const isConnected = useNetworkStatus();
  const [cachedProfiles, setCachedProfiles] = useState<VoiceProfile[] | null>(null);
  const [showAddOptions, setShowAddOptions] = useState(false);
  const styles = useMemo(() => createVoicesStyles(colors), [colors]);

  const isFamilyPlan = plan === 'family';

  useEffect(() => {
    getCachedVoices().then(setCachedProfiles);
  }, []);

  const {
    data: profiles,
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['voiceProfiles'],
    queryFn: getVoiceProfiles,
    enabled: isAuthenticated && isConnected,
  });

  const { data: familyProfiles } = useQuery({
    queryKey: ['familyVoiceProfiles'],
    queryFn: getFamilyVoiceProfiles,
    enabled: isAuthenticated && isConnected && isFamilyPlan,
  });

  useEffect(() => {
    if (profiles && profiles.length > 0) {
      cacheVoices(profiles);
      setCachedProfiles(profiles);
    }
  }, [profiles]);

  const displayProfiles = profiles ?? cachedProfiles;
  const profileCount = displayProfiles?.length ?? 0;
  const isLimitReached = profileCount >= MAX_VOICE_PROFILES;

  const deleteMutation = useMutation({
    mutationFn: deleteVoiceProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voiceProfiles'] });
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('voices.deleteError')));
    },
  });

  const handleDelete = useCallback((id: string, name: string) => {
    Alert.alert(t('voices.deleteTitle'), t('voices.deleteConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteMutation.mutate(id),
      },
    ]);
  }, [t, deleteMutation]);

  const handleAdd = useCallback(() => {
    if (isLimitReached) {
      toast.show(t('voices.limitReached', { max: MAX_VOICE_PROFILES }));
      return;
    }
    setShowAddOptions(true);
  }, [isLimitReached, toast, t]);

  const getStatusBadge = useCallback((status: string) => {
    switch (status) {
      case 'ready':
        return { label: t('voices.statusReady'), color: colors.success };
      case 'processing':
        return { label: t('voices.statusProcessing'), color: colors.warning };
      case 'failed':
        return { label: t('voices.statusFailed'), color: colors.error };
      default:
        return { label: status, color: colors.textTertiary };
    }
  }, [t, colors]);

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

  const renderProfile = ({ item }: { item: VoiceProfile }) => {
    const badge = getStatusBadge(item.status);
    return (
      <Swipeable
        renderRightActions={renderDeleteAction}
        onSwipeableOpen={() => handleDelete(item.id, item.name)}
        overshootRight={false}
      >
        <TouchableOpacity
          style={styles.profileCard}
          activeOpacity={0.7}
          onPress={() => router.push({ pathname: '/voice/[id]', params: { id: item.id } })}
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
            onPress={() => handleDelete(item.id, item.name)}
            accessibilityRole="button"
            accessibilityLabel={`${t('common.delete')} ${item.name}`}
          >
            <Text style={styles.deleteText}>{t('common.delete')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </Swipeable>
    );
  };

  const renderFamilyProfile = ({ item }: { item: FamilyVoiceProfile }) => (
    <View style={styles.familyCard}>
      <View style={styles.familyAvatar}>
        <Text style={styles.familyAvatarText}>{item.name.charAt(0)}</Text>
      </View>
      <View style={styles.profileInfo}>
        <Text style={styles.profileName}>{item.name}</Text>
        {item.owner_name && (
          <Text style={styles.familyOwnerLabel}>{item.owner_name}</Text>
        )}
      </View>
      <Text style={styles.familyBadge}>{t('voices.familyReadOnly')}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t('voices.title')}</Text>
          <Text style={styles.subtitle}>{t('voices.subtitle')}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('voices.myVoices')} ({profileCount}/{MAX_VOICE_PROFILES})
            </Text>
            <TouchableOpacity
              style={[styles.addButton, isLimitReached && styles.addButtonDisabled]}
              onPress={handleAdd}
              disabled={isLimitReached}
              accessibilityRole="button"
              accessibilityLabel={t('voices.addVoice')}
              accessibilityState={{ disabled: isLimitReached }}
            >
              <Text style={[styles.addButtonText, isLimitReached && styles.addButtonTextDisabled]}>
                + {t('voices.addVoice')}
              </Text>
            </TouchableOpacity>
          </View>

          {isLimitReached && (
            <Text style={styles.limitMessage}>
              {t('voices.limitReached', { max: MAX_VOICE_PROFILES })}
            </Text>
          )}

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : isError ? (
            <ErrorView onRetry={refetch} />
          ) : !displayProfiles || displayProfiles.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🎵</Text>
              <Text style={styles.emptyText}>{t('voices.emptyTitle')}</Text>
              <Text style={styles.emptyHint}>{t('voices.emptyDesc')}</Text>
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={handleAdd}
                accessibilityRole="button"
                accessibilityLabel={t('voices.addVoice')}
              >
                <Text style={styles.emptyCtaText}>{t('voices.addVoice')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={displayProfiles}
              keyExtractor={(item) => item.id}
              renderItem={renderProfile}
              scrollEnabled={false}
            />
          )}
        </View>

        {isFamilyPlan && familyProfiles && familyProfiles.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{t('voices.familyVoices')}</Text>
            <FlatList
              data={familyProfiles}
              keyExtractor={(item) => item.id}
              renderItem={renderFamilyProfile}
              scrollEnabled={false}
            />
          </View>
        )}

        {showAddOptions && (
          <View style={styles.addOptionsOverlay}>
            <View style={styles.addOptionsCard}>
              <Text style={styles.addOptionsTitle}>{t('voices.chooseMethod')}</Text>
              <TouchableOpacity
                style={styles.addOptionItem}
                onPress={() => { setShowAddOptions(false); router.push('/voice/record'); }}
                accessibilityRole="button"
                accessibilityLabel={t('voices.record')}
              >
                <Text style={styles.addOptionEmoji}>🎙️</Text>
                <View style={styles.addOptionInfo}>
                  <Text style={styles.addOptionTitle}>{t('voices.record')}</Text>
                  <Text style={styles.addOptionDesc}>{t('voices.recordDesc')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addOptionItem}
                onPress={() => { setShowAddOptions(false); router.push('/voice/upload'); }}
                accessibilityRole="button"
                accessibilityLabel={t('voices.upload')}
              >
                <Text style={styles.addOptionEmoji}>📁</Text>
                <View style={styles.addOptionInfo}>
                  <Text style={styles.addOptionTitle}>{t('voices.upload')}</Text>
                  <Text style={styles.addOptionDesc}>{t('voices.uploadDesc')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addOptionItem}
                onPress={() => { setShowAddOptions(false); router.push('/voice/diarize'); }}
                accessibilityRole="button"
                accessibilityLabel={t('voices.diarize')}
              >
                <Text style={styles.addOptionEmoji}>📞</Text>
                <View style={styles.addOptionInfo}>
                  <Text style={styles.addOptionTitle}>{t('voices.diarize')}</Text>
                  <Text style={styles.addOptionDesc}>{t('voices.diarizeDesc')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addOptionItem}
                onPress={() => { setShowAddOptions(false); router.push('/voice/picker'); }}
                accessibilityRole="button"
                accessibilityLabel={t('voices.speakerPicker')}
              >
                <Text style={styles.addOptionEmoji}>👥</Text>
                <View style={styles.addOptionInfo}>
                  <Text style={styles.addOptionTitle}>{t('voices.speakerPicker')}</Text>
                  <Text style={styles.addOptionDesc}>{t('voices.speakerPickerDesc')}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addOptionCancel}
                onPress={() => setShowAddOptions(false)}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={styles.addOptionCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

export default withErrorBoundary(VoicesScreen);
