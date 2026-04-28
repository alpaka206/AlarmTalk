import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getDateLocale } from '../../src/i18n';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { getFriendList, getSentGifts, getReceivedGifts, getAlarms } from '../../src/services/api';
import type { Friend, Gift, Alarm } from '../../src/types';

export default function FriendProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const { data: friends } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriendList,
  });

  const { data: sentGifts } = useQuery({
    queryKey: ['sentGifts'],
    queryFn: getSentGifts,
  });

  const { data: receivedGifts } = useQuery({
    queryKey: ['gifts-received'],
    queryFn: getReceivedGifts,
  });

  const { data: alarms } = useQuery({
    queryKey: ['alarms'],
    queryFn: getAlarms,
  });

  const friend = friends?.find((f: Friend) => f.id === id);

  if (!friend) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
      </View>
    );
  }

  const friendEmail = friend.friend_email ?? '';
  const friendName = friend.friend_name || friendEmail;
  const initial = (friendName || '?')[0]!.toUpperCase();

  const giftsToFriend = sentGifts?.filter((g: Gift) => g.recipient_id === friend.user_b || g.recipient_id === friend.user_a) ?? [];
  const giftsFromFriend = receivedGifts?.filter((g: Gift) => g.sender_email === friendEmail) ?? [];
  const alarmsForFriend = alarms?.filter((a: Alarm) => a.target_user_id && a.target_user_id !== a.user_id) ?? [];

  const since = new Date(friend.created_at).toLocaleDateString(getDateLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const statusText = (status: string) =>
    status === 'pending' ? t('friendProfile.pending') :
    status === 'accepted' ? t('friendProfile.accepted') :
    t('friendProfile.rejected');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileCard}>
          <View style={styles.avatar} accessibilityLabel={t('friendProfile.a11yAvatar', { name: friendName })}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <Text style={styles.name}>{friendName}</Text>
          <Text style={styles.email}>{friendEmail}</Text>
          <Text style={styles.since}>
            {t('friendProfile.since', { date: since })}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <StatCard
            label={t('friendProfile.giftsSent')}
            count={giftsToFriend.length}
            emoji="🎁"
            colors={colors}
            t={t}
          />
          <StatCard
            label={t('friendProfile.giftsReceived')}
            count={giftsFromFriend.length}
            emoji="📬"
            colors={colors}
            t={t}
          />
          <StatCard
            label={t('friendProfile.alarms')}
            count={alarmsForFriend.length}
            emoji="⏰"
            colors={colors}
            t={t}
          />
        </View>

        {giftsFromFriend.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('friendProfile.recentGiftsFrom', { name: friend.friend_name || t('friendProfile.friendFallback') })}
            </Text>
            {giftsFromFriend.slice(0, 5).map((g: Gift) => (
              <View
                key={g.id}
                style={styles.listItem}
                accessibilityLabel={t('friendProfile.a11yGiftItem', { text: g.message_text, status: statusText(g.status) })}
              >
                <Text style={styles.listItemText}>"{g.message_text}"</Text>
                <Text style={styles.listItemMeta}>{statusText(g.status)}</Text>
              </View>
            ))}
          </View>
        )}

        {giftsToFriend.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {t('friendProfile.recentGiftsTo')}
            </Text>
            {giftsToFriend.slice(0, 5).map((g: Gift) => (
              <View
                key={g.id}
                style={styles.listItem}
                accessibilityLabel={t('friendProfile.a11yGiftItem', { text: g.message_text, status: statusText(g.status) })}
              >
                <Text style={styles.listItemText}>"{g.message_text}"</Text>
                <Text style={styles.listItemMeta}>{statusText(g.status)}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => router.push({ pathname: '/alarm/create', params: { friendId: friend.user_b === friend.friend_email ? friend.user_b : friend.user_a } })}
          accessibilityRole="button"
          accessibilityLabel={t('friendProfile.a11ySetAlarm')}
        >
          <Text style={styles.actionButtonText}>{t('friendProfile.setAlarm')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.giftActionButton}
          onPress={() => router.push({ pathname: '/message/create', params: { giftTo: friendEmail } })}
          accessibilityRole="button"
          accessibilityLabel={t('friendProfile.a11ySendGift')}
        >
          <Text style={styles.giftActionButtonText}>
            {t('friendProfile.sendGift')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function StatCard({
  label,
  count,
  emoji,
  colors,
  t,
}: {
  label: string;
  count: number;
  emoji: string;
  colors: ThemeColors;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const styles = createStyles(colors);
  return (
    <View
      style={styles.statCard}
      accessibilityLabel={t('friendProfile.a11yStat', { label, count })}
    >
      <Text style={styles.statEmoji}>{emoji}</Text>
      <Text style={styles.statCount}>{count}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: Spacing.lg },
  profileCard: {
    alignItems: 'center',
    padding: Spacing.xl,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    marginBottom: Spacing.lg,
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    backgroundColor: colors.primaryLight,
  },
  avatarText: { fontSize: 32, fontFamily: FontFamily.bold, color: colors.primaryDark },
  name: { fontSize: FontSize.xl, fontFamily: FontFamily.bold, marginBottom: 4, color: colors.text },
  email: { fontSize: FontSize.sm, marginBottom: 8, color: colors.textSecondary },
  since: { fontSize: FontSize.xs, color: colors.textTertiary },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  statEmoji: { fontSize: 24, marginBottom: 4 },
  statCount: { fontSize: FontSize.xl, fontFamily: FontFamily.bold, color: colors.text },
  statLabel: { fontSize: FontSize.xs, marginTop: 2, color: colors.textSecondary },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.md, fontFamily: FontFamily.semibold, marginBottom: Spacing.sm, color: colors.text },
  listItem: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  listItemText: { fontSize: FontSize.sm, color: colors.text },
  listItemMeta: { fontSize: FontSize.xs, marginTop: 4, color: colors.textTertiary },
  actionButton: {
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
    marginTop: Spacing.sm,
    backgroundColor: colors.primary,
  },
  actionButtonText: { color: colors.textOnPrimary, fontSize: FontSize.md, fontFamily: FontFamily.bold },
  giftActionButton: {
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center' as const,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  giftActionButtonText: { fontSize: FontSize.md, fontFamily: FontFamily.bold, color: colors.primary },
});
