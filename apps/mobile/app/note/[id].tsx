import { useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';
import { getReceivedNotes, markNoteRead, type ReceivedNote } from '../../src/services/api';

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();

  const { data: notes } = useQuery({
    queryKey: ['notes-received'],
    queryFn: () => getReceivedNotes(50),
    enabled: isAuthenticated,
  });

  const note: ReceivedNote | undefined = notes?.find((n) => n.id === id);

  const readMutation = useMutation({
    mutationFn: markNoteRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-received'] });
    },
  });

  useEffect(() => {
    if (note && !note.read_at) {
      readMutation.mutate(note.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  if (!note) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>📭</Text>
          <Text style={styles.emptyText}>{t('noteDetail.notFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const senderDisplay = note.sender_name || note.sender_email;
  const sentDate = new Date(note.created_at);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.senderSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {senderDisplay.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.senderInfo}>
            <Text
              style={styles.senderName}
              numberOfLines={1}
              accessibilityRole="text"
            >
              {senderDisplay}
            </Text>
            <Text style={styles.senderEmail} numberOfLines={1}>
              {note.sender_email}
            </Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.dateText}>
            {sentDate.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </Text>
          <Text style={styles.timeText}>
            {sentDate.toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>

        <View style={styles.divider} />

        <Text
          style={styles.messageText}
          accessibilityRole="text"
          accessibilityLabel={t('noteDetail.messageLabel', { text: note.text })}
        >
          {note.text}
        </Text>

        {note.audio_url && (
          <View style={styles.audioSection}>
            <Text style={styles.audioLabel}>{t('noteDetail.audioAvailable')}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 100,
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
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    senderSection: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.md,
    },
    avatarText: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    senderInfo: {
      flex: 1,
    },
    senderName: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    senderEmail: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      marginTop: 2,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    dateText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.textSecondary,
    },
    timeText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.regular,
      color: colors.textTertiary,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginBottom: Spacing.lg,
    },
    messageText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.regular,
      color: colors.text,
      lineHeight: 28,
    },
    audioSection: {
      marginTop: Spacing.lg,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    audioLabel: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.textSecondary,
    },
  });
}
