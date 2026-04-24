import { useState, useMemo, useCallback } from 'react';
import {
  Alert,
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getDateLocale } from '../../src/i18n';
import { useTheme } from '../../src/hooks/useTheme';
import { getVoiceProfiles, getMessages, getAlarms, updateVoiceProfile } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { sanitizeVoiceName } from '../../src/lib/voiceName';
import type { Message, Alarm, VoiceProfile } from '../../src/types';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { createVoiceDetailStyles } from '../../src/styles/voiceDetailStyles';

export default function VoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createVoiceDetailStyles(colors), [colors]);

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
      Alert.alert(t('voiceDetail.renameFailed'), getApiErrorMessage(err, t, t('voiceDetail.renameNetworkError')));
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
          <Text style={styles.itemDate}>{new Date(m.created_at).toLocaleDateString(getDateLocale())}</Text>
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
            {new Date(profile.created_at).toLocaleDateString(getDateLocale())}
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
