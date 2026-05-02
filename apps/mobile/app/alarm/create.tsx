import { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { DAY_KEYS } from '../../src/constants/presets';
import {
  getMessages,
  getAlarms,
  createAlarm,
  uploadAlarmSource,
  getFriendList,
  getVoiceProfiles,
  getFamilyVoiceProfiles,
  generateTTS,
} from '../../src/services/api';
import type { FamilyVoiceProfile } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { syncNotifeeAlarms } from '../../src/services/notifeeAlarms';
import { setMonitoredAlarms } from '../../src/services/alarmRinger';
import type { AlarmPlayMode, Friend, Message, VoiceProfile } from '../../src/types';
import { playModeToBackend } from '../../src/types';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { PresetMessageSection } from '../../src/components/PresetMessageSection';
import { WheelTimePicker } from '../../src/components/WheelTimePicker';
import { useAlarmDraftStore } from '../../src/stores/useAlarmDraftStore';
import { validateAlarmForm, getTimeUntilAlarm } from '../../src/lib/alarmForm';
import { addRecentPresetMessage } from '../../src/services/offlineCache';
import { createAlarmFormStyles } from '../../src/styles/alarmFormStyles';

export default function CreateAlarmScreen() {
  const router = useRouter();
  const { message_id: paramMessageId } = useLocalSearchParams<{ message_id?: string }>();
  const queryClient = useQueryClient();
  const { isAuthenticated, userId, defaultSnoozeMinutes, plan } = useAppStore();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const formStyles = useMemo(() => createAlarmFormStyles(colors), [colors]);
  const localStyles = useMemo(() => createLocalStyles(colors), [colors]);

  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(paramMessageId ?? null);
  const snooze = useAlarmDraftStore((s) => s.snoozeMinutes);
  const vibrationPattern = useAlarmDraftStore((s) => s.vibrationPattern);
  const rawAudio = useAlarmDraftStore((s) => s.rawAudio);
  const setRawAudio = useAlarmDraftStore((s) => s.setRawAudio);
  const resetAlarmDraft = useAlarmDraftStore((s) => s.reset);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [showPreset, setShowPreset] = useState(false);
  const [presetCategory, setPresetCategory] = useState<string>('morning');
  const [presetVoiceId, setPresetVoiceId] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<AlarmPlayMode>('alarm_voice');
  const [voiceProfileId, setVoiceProfileId] = useState<string | null>(null);

  // Initialize draft store with defaults; values set inside snooze/vibration
  // sub-screens persist through this store and are read on submit.
  useEffect(() => {
    resetAlarmDraft({ snoozeMinutes: defaultSnoozeMinutes, vibrationPattern: 'default' });
  }, [defaultSnoozeMinutes, resetAlarmDraft]);

  // Compute play-mode flags before queries so each fetch can gate on the
  // section that actually needs the data. alarm_only mode skips both
  // message and voice queries entirely; voice picker queries also wait
  // until the user reaches a play mode that needs them.
  const { mode, wakeMode } = playModeToBackend(playMode);
  const requiresMessage = playMode !== 'alarm_only';
  const requiresVoice = playMode !== 'alarm_only';

  const { data: messages } = useQuery({
    queryKey: ['messages'],
    queryFn: () => getMessages(),
    enabled: isAuthenticated && requiresMessage,
  });

  const { data: voices } = useQuery({
    queryKey: ['voiceProfiles'],
    queryFn: getVoiceProfiles,
    enabled: isAuthenticated && requiresVoice,
  });

  const readyVoices = voices?.filter((v: VoiceProfile) => v.status === 'ready') ?? [];

  const { data: familyVoices } = useQuery({
    queryKey: ['familyVoiceProfiles'],
    queryFn: getFamilyVoiceProfiles,
    enabled: isAuthenticated && plan === 'family' && requiresVoice,
  });
  const readyFamilyVoices: FamilyVoiceProfile[] =
    familyVoices?.filter((v: FamilyVoiceProfile) => v.status === 'ready') ?? [];

  const { data: friends } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriendList,
    enabled: isAuthenticated,
  });

  const ttsMutation = useMutation({
    mutationFn: generateTTS,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      setSelectedMessageId(data.message_id);
      setShowPreset(false);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('alarmCreate.ttsError')));
    },
  });

  const handlePresetGenerate = (text: string) => {
    if (!presetVoiceId) return;
    addRecentPresetMessage(text).catch(() => {/* best-effort cache */});

    const cached = messages?.find(
      (m: Message) => m.voice_profile_id === presetVoiceId && m.text === text,
    );
    if (cached) {
      setSelectedMessageId(cached.id);
      setShowPreset(false);
      toast.show(t('alarmCreate.reusedMessage'));
      return;
    }

    ttsMutation.mutate({
      voice_profile_id: presetVoiceId,
      text,
      category: presetCategory,
    });
  };

  const createMutation = useMutation({
    mutationFn: createAlarm,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      const alarms = await getAlarms();
      setMonitoredAlarms(alarms);
      void syncNotifeeAlarms(alarms, t);
      Alert.alert(t('alarmCreate.successTitle'), t('alarmCreate.successDesc'), [
        { text: t('common.confirm'), onPress: () => router.back() },
      ]);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('alarmCreate.createError')));
    },
  });

  const toggleDay = (day: number) => {
    setRepeatDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const handleSubmit = async () => {
    const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const validated = validateAlarmForm({
      messageId: requiresMessage ? selectedMessageId : null,
      time,
      repeatDays,
      mode,
      vibrationPattern,
      wakeMode,
      voiceProfileId: requiresVoice ? voiceProfileId : null,
      snoozeMinutes: snooze,
      targetUserId,
    }, t);
    if (!validated.ok) {
      toast.show(validated.error);
      return;
    }

    let payload: typeof validated.payload & {
      raw_audio_url?: string;
      raw_audio_duration_ms?: number;
    } = validated.payload;

    if (rawAudio) {
      try {
        const uploaded = await uploadAlarmSource({
          uri: rawAudio.uri,
          name: rawAudio.fileName,
          type: rawAudio.mimeType,
          durationMs: rawAudio.durationMs,
        });
        payload = {
          ...payload,
          raw_audio_url: uploaded.raw_audio_url,
          raw_audio_duration_ms: uploaded.duration_ms,
        };
      } catch (err) {
        toast.show(getApiErrorMessage(err, t, t('alarmCreate.createError')));
        return;
      }
    }

    createMutation.mutate(payload);
  };

  const voiceProfileMissing = requiresVoice && !voiceProfileId;

  const quickSetDays = (type: 'daily' | 'weekday' | 'weekend') => {
    if (type === 'daily') setRepeatDays([0, 1, 2, 3, 4, 5, 6]);
    else if (type === 'weekday') setRepeatDays([1, 2, 3, 4, 5]);
    else setRepeatDays([0, 6]);
  };

  return (
    <ScrollView style={formStyles.container} contentContainerStyle={formStyles.content}>
      {/* 누구에게? */}
      {friends && friends.length > 0 && (
        <>
          <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.forWho')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={localStyles.targetRow}>
            <TouchableOpacity
              style={[localStyles.targetChip, !targetUserId && localStyles.targetChipActive]}
              onPress={() => {
                setTargetUserId(null);
                setTargetName(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: !targetUserId }}
              accessibilityLabel={t('alarmCreate.forMe')}
            >
              <Text style={[localStyles.targetText, !targetUserId && localStyles.targetTextActive]}>
                {t('alarmCreate.forMe')}
              </Text>
            </TouchableOpacity>
            {friends.map((f: Friend) => {
              const friendId = f.user_a === userId ? f.user_b : f.user_a;
              const isSelected = targetUserId === friendId;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[localStyles.targetChip, isSelected && localStyles.targetChipActive]}
                  onPress={() => {
                    setTargetUserId(isSelected ? null : friendId);
                    setTargetName(isSelected ? null : f.friend_name || f.friend_email || null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={f.friend_name || f.friend_email?.split('@')[0] || '?'}
                >
                  <Text style={[localStyles.targetText, isSelected && localStyles.targetTextActive]}>
                    {f.friend_name || f.friend_email?.split('@')[0] || '?'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {targetName && (
            <Text style={localStyles.targetHint}>
              {t('alarmCreate.targetHint', { name: targetName })}
            </Text>
          )}
        </>
      )}

      {/* 시간 선택 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.time')}</Text>
      <View style={formStyles.timePickerContainer}>
        <WheelTimePicker
          hour={hour}
          minute={minute}
          onChange={(h, m) => {
            setHour(h);
            setMinute(m);
          }}
        />
        <Text style={formStyles.timeUntil}>
          {(() => {
            const { hours: h, minutes: m } = getTimeUntilAlarm(hour, minute);
            if (h === 0) return t('alarmCreate.alarmInMinutes', { minutes: m });
            if (m === 0) return t('alarmCreate.alarmInHours', { hours: h });
            return t('alarmCreate.alarmIn', { hours: h, minutes: m });
          })()}
        </Text>
      </View>

      {/* 반복 요일 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.repeat')}</Text>
      <View style={formStyles.daysRow}>
        {DAY_KEYS.map((key, index) => (
          <TouchableOpacity
            key={index}
            style={[formStyles.dayChip, repeatDays.includes(index) && formStyles.dayChipActive]}
            onPress={() => toggleDay(index)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: repeatDays.includes(index) }}
            accessibilityLabel={t(key)}
          >
            <Text style={[formStyles.dayText, repeatDays.includes(index) && formStyles.dayTextActive]}>
              {t(key)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={formStyles.quickDays}>
        <TouchableOpacity style={formStyles.quickChip} onPress={() => quickSetDays('daily')} accessibilityRole="button" accessibilityLabel={t('alarms.daily')}>
          <Text style={formStyles.quickText}>{t('alarms.daily')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={formStyles.quickChip} onPress={() => quickSetDays('weekday')} accessibilityRole="button" accessibilityLabel={t('alarms.weekday')}>
          <Text style={formStyles.quickText}>{t('alarms.weekday')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={formStyles.quickChip} onPress={() => quickSetDays('weekend')} accessibilityRole="button" accessibilityLabel={t('alarms.weekend')}>
          <Text style={formStyles.quickText}>{t('alarms.weekend')}</Text>
        </TouchableOpacity>
      </View>

      {/* 재생 모드: 알람만 / 음성만 / 알람+음성 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.playMode')}</Text>
      <View style={formStyles.modeRow}>
        {(['alarm_only', 'voice_only', 'alarm_voice'] as const).map((m) => {
          const labelKey =
            m === 'alarm_only'
              ? 'alarmCreate.modeAlarmOnly'
              : m === 'voice_only'
                ? 'alarmCreate.modeVoiceOnly'
                : 'alarmCreate.modeAlarmVoice';
          const selected = playMode === m;
          return (
            <TouchableOpacity
              key={m}
              style={[formStyles.modeChip, selected && formStyles.modeChipActive]}
              onPress={() => setPlayMode(m)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t(labelKey)}
            >
              <Text style={[formStyles.modeText, selected && formStyles.modeTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 음성 프로필 — TTS(=음성 사용) 모드일 때만 */}
      {requiresVoice && (
        <>
          <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.voiceProfile')}</Text>
          {readyVoices.length === 0 && readyFamilyVoices.length === 0 ? (
            <View style={formStyles.emptyVoiceBox}>
              <Text style={formStyles.emptyVoiceText}>
                {t('alarmCreate.voiceProfileRequired')}
              </Text>
            </View>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={formStyles.voiceRow}
              >
                {readyVoices.map((v: VoiceProfile) => {
                  const selected = voiceProfileId === v.id;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[formStyles.voiceChip, selected && formStyles.voiceChipActive]}
                      onPress={() => setVoiceProfileId(selected ? null : v.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={v.name}
                    >
                      <Text style={[formStyles.voiceText, selected && formStyles.voiceTextActive]}>
                        {v.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {readyFamilyVoices.length > 0 && (
                <>
                  <Text style={formStyles.voiceSubLabel}>{t('alarmCreate.familyVoices')}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={formStyles.voiceRow}
                  >
                    {readyFamilyVoices.map((v: FamilyVoiceProfile) => {
                      const selected = voiceProfileId === v.id;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          style={[formStyles.voiceChip, selected && formStyles.voiceChipActive]}
                          onPress={() => setVoiceProfileId(selected ? null : v.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`${v.name} (${v.owner_name ?? ''})`}
                        >
                          <Text style={[formStyles.voiceText, selected && formStyles.voiceTextActive]}>
                            {v.name}
                          </Text>
                          <Text style={formStyles.voiceOwnerText}>
                            {v.owner_name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}
            </>
          )}
          {voiceProfileMissing && (
            <Text style={formStyles.voiceHint}>
              {t('alarmCreate.voiceProfileHint')}
            </Text>
          )}
        </>
      )}

      {/* 원본 음성 (선택사항) — 음성을 사용하는 모드일 때만 */}
      {requiresVoice && (
        <>
          <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmSource.section')}</Text>
          <Text style={localStyles.sourceHint}>{t('alarmSource.sectionHint')}</Text>
          {rawAudio ? (
            <View style={localStyles.sourceCurrent}>
              <Text style={localStyles.sourceCurrentLabel}>
                {t('alarmSource.currentLabel')} · {rawAudio.fileName} ({(rawAudio.durationMs / 1000).toFixed(1)}s)
              </Text>
              <TouchableOpacity onPress={() => setRawAudio(null)} accessibilityRole="button">
                <Text style={localStyles.sourceRemove}>{t('alarmSource.remove')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={localStyles.sourceRow}>
              <TouchableOpacity
                style={localStyles.sourceCard}
                onPress={() => router.push('/alarm/source-record')}
                accessibilityRole="button"
              >
                <Text style={localStyles.sourceCardText}>{t('alarmSource.recordCard')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={localStyles.sourceCard}
                onPress={() => router.push('/alarm/source-upload')}
                accessibilityRole="button"
              >
                <Text style={localStyles.sourceCardText}>{t('alarmSource.uploadCard')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {/* 다시 울림 / 진동 — 갤럭시 스타일 sub-screen으로 이동 */}
      <View style={localStyles.settingsGroup}>
        <TouchableOpacity
          style={localStyles.settingsRow}
          onPress={() => router.push('/alarm/snooze')}
          accessibilityRole="button"
          accessibilityLabel={t('alarmCreate.snooze')}
        >
          <Text style={localStyles.settingsLabel}>{t('alarmCreate.snooze')}</Text>
          <View style={localStyles.settingsValueRow}>
            <Text style={localStyles.settingsValue}>
              {snooze === 0 ? t('alarmCreate.snoozeOff') : t('alarmCreate.snoozeMin', { min: snooze })}
            </Text>
            <Text style={localStyles.settingsChevron}>›</Text>
          </View>
        </TouchableOpacity>
        <View style={localStyles.settingsDivider} />
        <TouchableOpacity
          style={localStyles.settingsRow}
          onPress={() => router.push('/alarm/vibration')}
          accessibilityRole="button"
          accessibilityLabel={t('alarmCreate.vibration')}
        >
          <Text style={localStyles.settingsLabel}>{t('alarmCreate.vibration')}</Text>
          <View style={localStyles.settingsValueRow}>
            <Text style={localStyles.settingsValue}>
              {t(`alarmCreate.vibration${vibrationPattern.charAt(0).toUpperCase() + vibrationPattern.slice(1)}`)}
            </Text>
            <Text style={localStyles.settingsChevron}>›</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 메시지 선택 — 음성 사용 모드일 때만 */}
      {requiresMessage && (<>
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.message')}</Text>
      {messages && messages.length > 0 ? (
        <View style={formStyles.messageList}>
          {messages.map((msg: Message) => (
            <TouchableOpacity
              key={msg.id}
              style={[
                formStyles.messageItem,
                selectedMessageId === msg.id && formStyles.messageItemSelected,
              ]}
              onPress={() => setSelectedMessageId(msg.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedMessageId === msg.id }}
              accessibilityLabel={`${msg.voice_name}: ${msg.text}`}
            >
              <View style={formStyles.messageInfo}>
                <Text style={formStyles.messageVoice}>🗣️ {msg.voice_name}</Text>
                <Text style={formStyles.messageText} numberOfLines={1}>
                  "{msg.text}"
                </Text>
              </View>
              {selectedMessageId === msg.id && <Text style={formStyles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={formStyles.emptyMessageBox}>
          <Text style={formStyles.emptyMessageEmoji}>💬</Text>
          <Text style={formStyles.emptyMessageTitle}>{t('alarmCreate.noMessages')}</Text>
          <Text style={[formStyles.emptyMessageDesc, { marginBottom: Spacing.md }]}>{t('alarmCreate.noMessagesDesc')}</Text>
          <View style={localStyles.emptyMessageActions}>
            <TouchableOpacity
              style={localStyles.emptyMessageBtn}
              onPress={() => router.push('/message/create')}
              accessibilityRole="button"
              accessibilityLabel={t('alarmCreate.goCreate')}
            >
              <Text style={localStyles.emptyMessageBtnText}>{t('alarmCreate.goCreate')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 프리셋으로 빠르게 만들기 — 카테고리만 선택, 메시지는 랜덤 */}
      <PresetMessageSection
        showPreset={showPreset}
        onTogglePreset={() => setShowPreset((v) => !v)}
        readyVoices={readyVoices}
        presetVoiceId={presetVoiceId}
        onVoiceSelect={(id) => setPresetVoiceId(id)}
        presetCategory={presetCategory}
        onCategorySelect={setPresetCategory}
        isPending={ttsMutation.isPending}
        onGenerate={handlePresetGenerate}
        formStyles={formStyles}
      />
      </>)}

      {/* 생성 버튼 */}
      {(() => {
        const submitDisabled =
          (requiresMessage && !selectedMessageId) ||
          voiceProfileMissing ||
          createMutation.isPending;
        return (
      <TouchableOpacity
        style={[
          localStyles.createButton,
          submitDisabled && formStyles.disabled,
        ]}
        onPress={handleSubmit}
        disabled={submitDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('alarmCreate.submit')}
        accessibilityState={{ disabled: submitDisabled }}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={localStyles.createText}>{t('alarmCreate.submit')}</Text>
        )}
      </TouchableOpacity>
        );
      })()}
      <Toast message={toast.message} opacity={toast.opacity} />
    </ScrollView>
  );
}

function createLocalStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sourceHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    sourceRow: {
      flexDirection: 'row' as const,
      gap: Spacing.sm,
    },
    sourceCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md + 2,
      paddingHorizontal: Spacing.md,
      alignItems: 'center' as const,
    },
    sourceCardText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    sourceCurrent: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
    },
    sourceCurrentLabel: {
      flex: 1,
      fontSize: FontSize.sm,
      color: colors.text,
      fontFamily: FontFamily.medium,
    },
    sourceRemove: {
      fontSize: FontSize.sm,
      color: colors.error,
      fontFamily: FontFamily.semibold,
      marginLeft: Spacing.sm,
    },
    settingsGroup: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      marginTop: Spacing.lg,
      overflow: 'hidden' as const,
    },
    settingsRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md + 4,
    },
    settingsLabel: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    settingsValueRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Spacing.xs,
    },
    settingsValue: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
    },
    settingsChevron: {
      fontSize: 22,
      color: colors.textTertiary,
      fontFamily: FontFamily.regular,
    },
    settingsDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: Spacing.md,
    },
    targetRow: {
      marginBottom: Spacing.sm,
    },
    targetChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: Spacing.sm,
    },
    targetChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    targetText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    targetTextActive: {
      color: colors.textOnPrimary,
    },
    targetHint: {
      fontSize: FontSize.sm,
      color: colors.accent,
      fontFamily: FontFamily.medium,
      marginBottom: Spacing.sm,
    },
    emptyMessageActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    emptyMessageBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
    },
    emptyMessageBtnText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
    },
    createButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
      marginTop: Spacing.xl,
    },
    createText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
  });
}
