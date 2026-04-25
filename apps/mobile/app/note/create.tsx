import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import {
  getFamilyGroupCurrent,
  getUserProfile,
  sendNote,
  type FamilyGroupMember,
} from '../../src/services/api';

const MAX_TEXT_LENGTH = 500;

export default function NoteCreateScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toast = useToast();
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const isConnected = useNetworkStatus();

  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [text, setText] = useState('');

  const { data: profile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getUserProfile,
    enabled: isAuthenticated && isConnected,
  });

  const { data: familyData, isLoading: familyLoading } = useQuery({
    queryKey: ['family-group'],
    queryFn: getFamilyGroupCurrent,
    enabled: isAuthenticated && isConnected,
  });

  const selfUserId = profile?.id ?? '';
  const members = familyData?.members;
  const recipients = useMemo(() => {
    if (!members) return [];
    return members.filter(
      (m: FamilyGroupMember) => m.user_id !== selfUserId,
    );
  }, [members, selfUserId]);

  const mutation = useMutation({
    mutationFn: () => sendNote(selectedRecipient!, text.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes-received'] });
      queryClient.invalidateQueries({ queryKey: ['notes-sent'] });
      toast.show(t('note.sendSuccess'));
      setTimeout(() => router.back(), 1000);
    },
    onError: () => {
      toast.show(t('note.sendError'));
    },
  });

  const handleSend = useCallback(() => {
    if (!selectedRecipient || !text.trim()) return;
    mutation.mutate();
  }, [selectedRecipient, text, mutation]);

  const canSend = selectedRecipient && text.trim().length > 0 && !mutation.isPending;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>{t('note.recipient')}</Text>
          {familyLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : recipients.length === 0 ? (
            <Text style={styles.emptyText}>{t('note.noRecipients')}</Text>
          ) : (
            <View style={styles.recipientList}>
              {recipients.map((member: FamilyGroupMember) => {
                const selected = selectedRecipient === member.user_id;
                const displayName = member.name || member.email || '?';
                return (
                  <TouchableOpacity
                    key={member.user_id}
                    style={[styles.recipientChip, selected && styles.recipientChipSelected]}
                    onPress={() => setSelectedRecipient(member.user_id)}
                    accessibilityRole="button"
                    accessibilityLabel={displayName}
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.chipAvatar, selected && styles.chipAvatarSelected]}>
                      <Text style={[styles.chipAvatarText, selected && styles.chipAvatarTextSelected]}>
                        {displayName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <Text
                      style={[styles.chipName, selected && styles.chipNameSelected]}
                      numberOfLines={1}
                    >
                      {displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.label}>{t('note.message')}</Text>
          <TextInput
            style={styles.textInput}
            value={text}
            onChangeText={setText}
            placeholder={t('note.messagePlaceholder')}
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={MAX_TEXT_LENGTH}
            textAlignVertical="top"
            editable={!mutation.isPending}
            accessibilityLabel={t('note.message')}
          />
          <Text style={styles.charCount}>
            {text.length}/{MAX_TEXT_LENGTH}
          </Text>

          <TouchableOpacity
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={t('note.send')}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.sendButtonText}>{t('note.send')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 100,
    },
    label: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    loader: {
      marginVertical: Spacing.md,
    },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingVertical: Spacing.md,
    },
    recipientList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    recipientChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderWidth: 1.5,
      borderColor: colors.border,
    },
    recipientChipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceVariant,
    },
    chipAvatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.xs,
    },
    chipAvatarSelected: {
      backgroundColor: colors.primary,
    },
    chipAvatarText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    chipAvatarTextSelected: {
      color: colors.textOnPrimary,
    },
    chipName: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.text,
    },
    chipNameSelected: {
      fontFamily: FontFamily.semibold,
      color: colors.primary,
    },
    textInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      fontSize: FontSize.md,
      fontFamily: FontFamily.regular,
      color: colors.text,
      minHeight: 120,
      lineHeight: 22,
    },
    charCount: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      textAlign: 'right',
      marginTop: Spacing.xs,
    },
    sendButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52,
      marginTop: Spacing.lg,
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    sendButtonText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.textOnPrimary,
    },
  });
}
