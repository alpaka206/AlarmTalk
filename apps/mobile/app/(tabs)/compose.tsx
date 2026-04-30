import { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { withErrorBoundary } from '../../src/components/ErrorBoundary';
import { useTheme } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { getReceivedNotes, markNoteRead, type ReceivedNote } from '../../src/services/api';
import { getDateLocale } from '../../src/i18n';
import { createComposeStyles } from '../../src/styles/composeStyles';
import { AppIcon } from '../../src/components/AppIcon';

function ComposeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createComposeStyles(colors), [colors]);
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
                {new Date(item.created_at).toLocaleDateString(getDateLocale())}
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
              <Text style={styles.title} accessibilityRole="header">{t('compose.title')}</Text>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionCard}
                activeOpacity={0.7}
                onPress={handleSendAlarm}
                accessibilityRole="button"
                accessibilityLabel={t('compose.sendAlarm')}
              >
                <AppIcon name="alarm" size={28} />
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
                <AppIcon name="message" size={28} />
                <View style={styles.actionInfo}>
                  <Text style={styles.actionTitle}>{t('compose.sendNote')}</Text>
                  <Text style={styles.actionDesc}>{t('compose.sendNoteDesc')}</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle} accessibilityRole="header">{t('compose.inbox')}</Text>
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

export default withErrorBoundary(ComposeScreen);
