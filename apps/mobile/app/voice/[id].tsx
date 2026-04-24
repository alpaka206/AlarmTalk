import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { getVoiceProfiles, getMessages, getAlarms, updateVoiceProfile } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { sanitizeVoiceName } from '../../src/lib/voiceName';
import type { Message, Alarm, VoiceProfile } from '../../src/types';

export default function VoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { data: profiles } = useQuery({
    queryKey: ['voiceProfiles'],
    queryFn: getVoiceProfiles,
    enabled: isAuthenticated,
  });

  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');

  const renameMutation = useMutation({
    mutationFn: (name: string) => updateVoiceProfile(id!, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voiceProfiles'] });
      setIsEditingName(false);
      setDraftName('');
    },
    onError: (err) => {
      Alert.alert(t('voiceDetail.renameFailed'), err instanceof Error ? err.message : t('voiceDetail.renameNetworkError'));
    },
  });

  const beginEdit = (currentName: string) => {
    setDraftName(currentName);
    setIsEditingName(true);
  };

  const commitEdit = (currentName: string) => {
    const sanitized = sanitizeVoiceName(draftName, t);
    if (!sanitized.ok) {
      Alert.alert(t('common.error'), sanitized.error ?? t('voiceDetail.renameInputError'));
      return;
    }
    if (sanitized.value === currentName) {
      setIsEditingName(false);
      setDraftName('');
      return;
    }
    renameMutation.mutate(sanitized.value);
  };

  const { data: messages, isLoading: loadingMessages } = useQuery({
    queryKey: ['messages'],
    queryFn: () => getMessages(),
    enabled: isAuthenticated,
  });

  const { data: alarms, isLoading: loadingAlarms } = useQuery({
    queryKey: ['alarms'],
    queryFn: getAlarms,
    enabled: isAuthenticated,
  });

  const profile = profiles?.find((p: VoiceProfile) => p.id === id);
  const voiceMessages = messages?.filter((m: Message) => m.voice_profile_id === id) ?? [];
  const voiceAlarms = alarms?.filter((a: Alarm) => a.voice_name === profile?.name) ?? [];

  const isLoading = loadingMessages || loadingAlarms;

  type SectionItem = { type: 'section'; title: string };
  type MessageItem = { type: 'message'; data: Message };
  type AlarmItem = { type: 'alarm'; data: Alarm };
  type ListItem = SectionItem | MessageItem | AlarmItem;

  const listData = useMemo<ListItem[]>(() => [
    ...(voiceMessages.length > 0
      ? [{ type: 'section' as const, title: t('voiceDetail.messageList') }]
      : []),
    ...voiceMessages.map((m) => ({ type: 'message' as const, data: m })),
    ...(voiceAlarms.length > 0
      ? [{ type: 'section' as const, title: t('voiceDetail.alarmList') }]
      : []),
    ...voiceAlarms.map((a) => ({ type: 'alarm' as const, data: a })),
  ], [voiceMessages, voiceAlarms, t]);

  const renderListItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'section') {
      return <Text style={styles.sectionTitle}>{item.title}</Text>;
    }
    if (item.type === 'message') {
      const m = item.data as Message;
      return (
        <View style={styles.itemCard}>
          <Text style={styles.itemCategory}>{m.category}</Text>
          <Text style={styles.itemText} numberOfLines={2}>{m.text}</Text>
          <Text style={styles.itemDate}>{new Date(m.created_at).toLocaleDateString('ko-KR')}</Text>
        </View>
      );
    }
    const a = item.data as Alarm;
    return (
      <View style={styles.itemCard}>
        <Text style={styles.alarmTime}>{a.time}</Text>
        <Text style={styles.itemText} numberOfLines={1}>{a.message_text}</Text>
        <Text style={[styles.itemDate, !a.is_active && styles.inactive]}>
          {a.is_active ? t('voiceDetail.active') : t('voiceDetail.inactive')}
        </Text>
      </View>
    );
  }, [styles, t]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {profile && (
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge} accessibilityLabel={t('voiceDetail.a11yAvatar', { name: profile.name })}>
            <Text style={styles.avatarText}>{profile.name.charAt(0)}</Text>
          </View>
          {isEditingName ? (
            <View style={styles.renameRow}>
              <TextInput
                autoFocus
                value={draftName}
                onChangeText={setDraftName}
                onSubmitEditing={() => commitEdit(profile.name)}
                maxLength={60}
                style={styles.renameInput}
                accessibilityLabel={t('voiceDetail.a11yRenameInput')}
              />
              <TouchableOpacity
                accessibilityLabel={t('voiceDetail.a11yRenameSave')}
                accessibilityRole="button"
                onPress={() => commitEdit(profile.name)}
                disabled={renameMutation.isPending}
                style={styles.renameSaveBtn}
              >
                <Text style={styles.renameSaveText}>
                  {renameMutation.isPending ? t('voiceDetail.renameSaving') : t('voiceDetail.renameSave')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel={t('voiceDetail.a11yRenameCancel')}
                accessibilityRole="button"
                onPress={() => {
                  setIsEditingName(false);
                  setDraftName('');
                }}
                style={styles.renameCancelBtn}
              >
                <Text style={styles.renameCancelText}>{t('voiceDetail.renameCancel')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.profileName}>{profile.name}</Text>
              <TouchableOpacity
                accessibilityLabel={t('voiceDetail.a11yRename')}
                accessibilityRole="button"
                onPress={() => beginEdit(profile.name)}
                style={styles.renameBtn}
              >
                <Text style={styles.renameText}>{t('voiceDetail.rename')}</Text>
              </TouchableOpacity>
            </>
          )}
          <Text style={styles.profileDate}>
            {new Date(profile.created_at).toLocaleDateString('ko-KR')}
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem} accessibilityLabel={t('voiceDetail.a11yStat', { label: t('voiceDetail.messages'), count: voiceMessages.length })}>
              <Text style={styles.statValue}>{voiceMessages.length}</Text>
              <Text style={styles.statLabel}>{t('voiceDetail.messages')}</Text>
            </View>
            <View style={styles.statItem} accessibilityLabel={t('voiceDetail.a11yStat', { label: t('voiceDetail.alarms'), count: voiceAlarms.length })}>
              <Text style={styles.statValue}>{voiceAlarms.length}</Text>
              <Text style={styles.statLabel}>{t('voiceDetail.alarms')}</Text>
            </View>
          </View>
          {profile.status === 'ready' && (
            <TouchableOpacity
              style={styles.createMessageBtn}
              onPress={() => router.push(`/message/create?voice_id=${id}`)}
              accessibilityRole="button"
              accessibilityLabel={t('voiceDetail.a11yCreateMessage')}
            >
              <Text style={styles.createMessageText}>{t('voiceDetail.createMessage')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item, index) =>
            item.type === 'section' ? `section-${index}` : item.data.id
          }
          contentContainerStyle={styles.list}
          renderItem={renderListItem}
          initialNumToRender={10}
          maxToRenderPerBatch={5}
          windowSize={5}
          removeClippedSubviews
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('voiceDetail.empty')}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  avatarText: {
    fontSize: 32,
    fontFamily: FontFamily.bold,
    color: colors.primaryDark,
  },
  profileName: {
    fontSize: FontSize.xxl,
    fontFamily: FontFamily.bold,
    color: colors.text,
  },
  profileDate: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    marginTop: Spacing.xs,
  },
  renameBtn: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  renameText: {
    fontSize: FontSize.sm,
    color: colors.primary,
    fontFamily: FontFamily.semibold,
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.xs,
  },
  renameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    fontSize: FontSize.md,
    color: colors.text,
  },
  renameSaveBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.sm,
  },
  renameSaveText: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontFamily: FontFamily.bold,
  },
  renameCancelBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  renameCancelText: {
    color: colors.textSecondary,
    fontSize: FontSize.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.xl,
    marginTop: Spacing.md,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: FontSize.xxl,
    fontFamily: FontFamily.bold,
    color: colors.primary,
  },
  statLabel: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  list: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
    color: colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  itemCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  itemCategory: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  itemText: {
    fontSize: FontSize.md,
    color: colors.text,
    lineHeight: 22,
  },
  itemDate: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginTop: 4,
  },
  alarmTime: {
    fontSize: FontSize.xl,
    fontFamily: FontFamily.regular,
    color: colors.text,
    marginBottom: 4,
  },
  inactive: {
    color: colors.error,
  },
  createMessageBtn: {
    marginTop: Spacing.md,
    backgroundColor: colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  createMessageText: {
    color: '#fff',
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
});
