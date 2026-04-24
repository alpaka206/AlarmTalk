import { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { withErrorBoundary } from '../../src/components/ErrorBoundary';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { getReceivedNotes, markNoteRead, type ReceivedNote } from '../../src/services/api';

function ComposeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const plan = useAppStore((s) => s.plan);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const isConnected = useNetworkStatus();

  const isFamilyOrCouple = plan === 'family';

  const queryClient = useQueryClient();

  const { data: receivedNotes, isLoading: notesLoading } = useQuery({
    queryKey: ['notes-received'],
    queryFn: () => getReceivedNotes(10),
    enabled: isAuthenticated && isFamilyOrCouple && isConnected,
  });

  const readMutation = useMutation({
    mutationFn: markNoteRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-received'] });
    },
  });

  const handleNotePress = useCallback(
    (note: ReceivedNote) => {
      if (!note.read_at) {
        readMutation.mutate(note.id);
      }
      router.push(`/note/${note.id}`);
    },
    [readMutation, router],
  );

  const handleSendAlarm = useCallback(() => {
    router.push('/family-alarm/create');
  }, [router]);

  const handleSendNote = useCallback(() => {
    router.push('/note/create');
  }, [router]);

  const renderNoteItem = useCallback(
    ({ item }: { item: ReceivedNote }) => {
      const isUnread = !item.read_at;
      return (
        <TouchableOpacity
          style={[styles.noteCard, isUnread && styles.noteCardUnread]}
          activeOpacity={0.7}
          onPress={() => handleNotePress(item)}
          accessibilityRole="button"
          accessibilityLabel={`${t('compose.noteFrom', { name: item.sender_name || item.sender_email })}: ${item.text}`}
          accessibilityState={{ selected: !isUnread }}
        >
          <View style={styles.noteHeader}>
            <View style={styles.noteAvatar}>
              <Text style={styles.noteAvatarText}>
                {(item.sender_name || item.sender_email).charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.noteInfo}>
              <Text style={styles.noteSender} numberOfLines={1}>
                {item.sender_name || item.sender_email}
              </Text>
              <Text style={styles.noteTime}>
                {new Date(item.created_at).toLocaleDateString()}
              </Text>
            </View>
            {isUnread && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.noteText}>
            {item.text}
          </Text>
        </TouchableOpacity>
      );
    },
    [styles, handleNotePress, t],
  );

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💌</Text>
          <Text style={styles.emptyText}>{t('compose.loginRequired')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isFamilyOrCouple) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('compose.title')}</Text>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>💌</Text>
          <Text style={styles.emptyText}>{t('compose.familyOnly')}</Text>
          <Text style={styles.emptyHint}>{t('compose.familyOnlyHint')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const unreadCount = receivedNotes?.filter((n) => !n.read_at).length ?? 0;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={receivedNotes ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderNoteItem}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={5}
        windowSize={5}
        removeClippedSubviews
        ListHeaderComponent={
          <>
            <View style={styles.header}>
              <Text style={styles.title}>{t('compose.title')}</Text>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionCard}
                activeOpacity={0.7}
                onPress={handleSendAlarm}
                accessibilityRole="button"
                accessibilityLabel={t('compose.sendAlarm')}
              >
                <Text style={styles.actionEmoji}>⏰</Text>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>{t('compose.sendAlarm')}</Text>
                  <Text style={styles.actionDesc}>{t('compose.sendAlarmDesc')}</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionCard}
                activeOpacity={0.7}
                onPress={handleSendNote}
                accessibilityRole="button"
                accessibilityLabel={t('compose.sendNote')}
              >
                <Text style={styles.actionEmoji}>✉️</Text>
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>{t('compose.sendNote')}</Text>
                  <Text style={styles.actionDesc}>{t('compose.sendNoteDesc')}</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('compose.inbox')}</Text>
              {unreadCount > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>{unreadCount}</Text>
                </View>
              )}
            </View>

            {notesLoading && (
              <ActivityIndicator
                color={colors.primary}
                style={styles.loader}
              />
            )}
          </>
        }
        ListEmptyComponent={
          notesLoading ? null : (
            <View style={styles.emptyNotes}>
              <Text style={styles.emptyNotesEmoji}>📭</Text>
              <Text style={styles.emptyNotesText}>{t('compose.noNotes')}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingBottom: 100,
    },
    header: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    actionsRow: {
      paddingHorizontal: Spacing.lg,
      gap: Spacing.md,
      marginBottom: Spacing.lg,
    },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    actionEmoji: {
      fontSize: 32,
      marginRight: Spacing.md,
    },
    actionInfo: {
      flex: 1,
    },
    actionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    actionDesc: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    unreadBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: Spacing.xs,
      paddingHorizontal: 6,
    },
    unreadBadgeText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.bold,
      color: '#fff',
    },
    loader: {
      marginTop: Spacing.lg,
    },
    noteCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    noteCardUnread: {
      borderColor: colors.primary,
      borderWidth: 1.5,
    },
    noteHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    noteAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.sm,
    },
    noteAvatarText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    noteInfo: {
      flex: 1,
    },
    noteSender: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    noteTime: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    noteText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.regular,
      color: colors.text,
      lineHeight: 22,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
    },
    emptyEmoji: {
      fontSize: 48,
      marginBottom: Spacing.md,
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    emptyHint: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: Spacing.xs,
    },
    emptyNotes: {
      alignItems: 'center',
      paddingVertical: Spacing.xl,
    },
    emptyNotesEmoji: {
      fontSize: 36,
      marginBottom: Spacing.sm,
    },
    emptyNotesText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
  });
}

export default withErrorBoundary(ComposeScreen);
