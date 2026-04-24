import { useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Animated,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { getReceivedGifts, acceptGift, rejectGift } from '../../src/services/api';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { getApiErrorMessage } from '../../src/types';
import type { Gift } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

function SkeletonGiftCard({ dynStyles }: { dynStyles: ReturnType<typeof createStyles> }) {
  const opacity = useMemo(() => new Animated.Value(0.3), []);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <View style={dynStyles.card}>
      <View style={dynStyles.header}>
        <View style={dynStyles.senderInfo}>
          <Animated.View style={[dynStyles.skeletonLine, { width: 100, height: 14, opacity }]} />
          <Animated.View style={[dynStyles.skeletonLine, { width: 160, height: 11, marginTop: 4, opacity }]} />
        </View>
        <Animated.View style={[dynStyles.skeletonLine, { width: 50, height: 18, opacity }]} />
      </View>
      <Animated.View style={[dynStyles.skeletonBlock, { opacity }]} />
    </View>
  );
}

function SkeletonGiftList({ count = 3, dynStyles }: { count?: number; dynStyles: ReturnType<typeof createStyles> }) {
  return (
    <View style={dynStyles.list}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonGiftCard key={i} dynStyles={dynStyles} />
      ))}
    </View>
  );
}

export default function ReceivedGiftsScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['gifts-received'],
    queryFn: getReceivedGifts,
  });

  const accept = useMutation({
    mutationFn: acceptGift,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['gifts-received'] });
      const previous = queryClient.getQueryData<Gift[]>(['gifts-received']);
      queryClient.setQueryData<Gift[]>(['gifts-received'], (old) =>
        old?.map((g) => (g.id === id ? { ...g, status: 'accepted' as const } : g)),
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gifts-received'] });
      queryClient.invalidateQueries({ queryKey: ['library'] });
      toast.show(t('giftReceived.acceptSuccess'));
    },
    onError: (err: unknown, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['gifts-received'], context.previous);
      }
      toast.show(getApiErrorMessage(err, t('giftReceived.acceptError')));
    },
  });

  const reject = useMutation({
    mutationFn: rejectGift,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['gifts-received'] });
      const previous = queryClient.getQueryData<Gift[]>(['gifts-received']);
      queryClient.setQueryData<Gift[]>(['gifts-received'], (old) =>
        old?.map((g) => (g.id === id ? { ...g, status: 'rejected' as const } : g)),
      );
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gifts-received'] });
      toast.show(t('giftReceived.rejectSuccess'));
    },
    onError: (err: unknown, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['gifts-received'], context.previous);
      }
      toast.show(getApiErrorMessage(err, t('giftReceived.rejectError')));
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <SkeletonGiftList count={3} dynStyles={styles} />
      </SafeAreaView>
    );
  }

  const statusLabel = useCallback((status: string) => {
    if (status === 'accepted') return t('giftReceived.statusAccepted');
    if (status === 'rejected') return t('giftReceived.statusRejected');
    return t('giftReceived.statusPending');
  }, [t]);

  const renderGiftItem = useCallback(({ item }: { item: Gift }) => (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.senderInfo}>
          <Text style={styles.senderName}>
            {item.sender_name || t('giftReceived.unknown')}
          </Text>
          <Text style={styles.senderEmail}>{item.sender_email}</Text>
        </View>
        <Text
          style={[
            styles.status,
            item.status === 'accepted' && styles.statusAccepted,
            item.status === 'rejected' && styles.statusRejected,
          ]}
        >
          {statusLabel(item.status)}
        </Text>
      </View>

      <View style={styles.messageBox}>
        <Text style={styles.category}>{item.category}</Text>
        <Text style={styles.messageText} numberOfLines={2}>
          {item.message_text}
        </Text>
      </View>

      {item.note && <Text style={styles.note}>"{item.note}"</Text>}

      {item.status === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.acceptBtn}
            onPress={() => accept.mutate(item.id)}
            disabled={accept.isPending}
          >
            <Text style={styles.acceptBtnText}>{t('common.accept')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() =>
              Alert.alert(t('giftReceived.rejectTitle'), t('giftReceived.rejectConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.reject'),
                  style: 'destructive',
                  onPress: () => reject.mutate(item.id),
                },
              ])
            }
            disabled={reject.isPending}
          >
            <Text style={styles.rejectBtnText}>{t('common.reject')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {item.status === 'accepted' && (
        <TouchableOpacity
          style={styles.setAlarmBtn}
          onPress={() =>
            router.push({ pathname: '/alarm/create', params: { message_id: item.message_id } })
          }
        >
          <Text style={styles.setAlarmBtnText}>{t('giftReceived.setAsAlarm')}</Text>
        </TouchableOpacity>
      )}
    </View>
  ), [styles, t, statusLabel, accept, reject, router]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={[styles.listWrap, isRefetching && styles.listDimmed]}>
      <FlatList
        data={data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🎁</Text>
            <Text style={styles.emptyText}>{t('giftReceived.emptyText')}</Text>
          </View>
        }
        renderItem={renderGiftItem}
      />
      </View>
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listWrap: {
    flex: 1,
  },
  listDimmed: {
    opacity: 0.5,
  },
  skeletonLine: {
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.border,
  },
  skeletonBlock: {
    height: 60,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.border,
  },
  list: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  empty: {
    alignItems: 'center',
    paddingTop: Spacing.xxl * 2,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontSize: FontSize.lg,
    color: colors.text,
    fontFamily: FontFamily.semibold,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  senderInfo: {
    flex: 1,
  },
  senderName: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
    color: colors.text,
  },
  senderEmail: {
    fontSize: FontSize.xs,
    color: colors.textSecondary,
    marginTop: 1,
  },
  status: {
    fontSize: FontSize.xs,
    fontFamily: FontFamily.semibold,
    color: colors.warning,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    backgroundColor: colors.surfaceVariant,
    overflow: 'hidden',
  },
  statusAccepted: {
    color: colors.success,
  },
  statusRejected: {
    color: colors.error,
  },
  messageBox: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  category: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    fontFamily: FontFamily.medium,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  messageText: {
    fontSize: FontSize.md,
    color: colors.text,
    lineHeight: 22,
  },
  note: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: Spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  acceptBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  acceptBtnText: {
    color: '#FFF',
    fontFamily: FontFamily.semibold,
    fontSize: FontSize.md,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  rejectBtnText: {
    color: colors.textSecondary,
    fontFamily: FontFamily.semibold,
    fontSize: FontSize.md,
  },
  setAlarmBtn: {
    backgroundColor: colors.surfaceVariant,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  setAlarmBtnText: {
    color: colors.primary,
    fontFamily: FontFamily.semibold,
    fontSize: FontSize.sm,
  },
});
