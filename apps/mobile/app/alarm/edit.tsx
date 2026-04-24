import { useState, useEffect, useMemo } from 'react';
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
import { DAYS_OF_WEEK } from '../../src/constants/presets';
import {
  getMessages,
  getAlarm,
  getAlarms,
  updateAlarm,
  getVoiceProfiles,
  getFamilyVoiceProfiles,
} from '../../src/services/api';
import type { FamilyVoiceProfile } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { syncAlarmNotifications } from '../../src/services/notifications';
import type { AlarmMode, VibrationPattern, WakeMode, Message, VoiceProfile } from '../../src/types';
import { getApiErrorMessage } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { parseRepeatDays, validateAlarmForm, getTimeUntilAlarm } from '../../src/lib/alarmForm';
import * as Haptics from 'expo-haptics';

export default function EditAlarmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isAuthenticated, plan } = useAppStore();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);

  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [snooze, setSnooze] = useState(5);
  const [mode, setMode] = useState<AlarmMode>('tts');
  const [vibrationPattern, setVibrationPattern] = useState<VibrationPattern>('default');
  const [voiceProfileId, setVoiceProfileId] = useState<string | null>(null);
  const [wakeMode, setWakeMode] = useState<WakeMode>('sound_then_voice');
  const [loaded, setLoaded] = useState(false);

  const { data: alarm } = useQuery({
    queryKey: ['alarm', id],
    queryFn: () => getAlarm(id!),
    enabled: isAuthenticated && !!id,
  });

  const { data: messages } = useQuery({
    queryKey: ['messages'],
    queryFn: () => getMessages(),
    enabled: isAuthenticated,
  });

  const { data: voices } = useQuery({
    queryKey: ['voiceProfiles'],
    queryFn: getVoiceProfiles,
    enabled: isAuthenticated,
  });

  const readyVoices: VoiceProfile[] =
    voices?.filter((v: VoiceProfile) => v.status === 'ready') ?? [];

  const { data: familyVoices } = useQuery({
    queryKey: ['familyVoiceProfiles'],
    queryFn: getFamilyVoiceProfiles,
    enabled: isAuthenticated && plan === 'family',
  });
  const readyFamilyVoices: FamilyVoiceProfile[] =
    familyVoices?.filter((v: FamilyVoiceProfile) => v.status === 'ready') ?? [];

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (alarm && !loaded) {
      const [h, m] = alarm.time.split(':').map(Number);
      setHour(h);
      setMinute(m);
      setRepeatDays(parseRepeatDays(alarm.repeat_days));
      setSelectedMessageId(alarm.message_id);
      setSnooze(alarm.snooze_minutes);
      setMode(alarm.mode === 'sound-only' ? 'sound-only' : 'tts');
      setVibrationPattern(alarm.vibration_pattern ?? 'default');
      setVoiceProfileId(alarm.voice_profile_id ?? null);
      setWakeMode(alarm.wake_mode === 'voice_only' ? 'voice_only' : 'sound_then_voice');
      setLoaded(true);
    }
  }, [alarm, loaded]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const editMutation = useMutation({
    mutationFn: (params: {
      time?: string;
      repeat_days?: number[];
      snooze_minutes?: number;
      message_id?: string;
      mode?: AlarmMode;
      vibration_pattern?: VibrationPattern;
      voice_profile_id?: string | null;
      wake_mode?: WakeMode;
    }) => updateAlarm(id!, params),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      const fresh = await getAlarms();
      syncAlarmNotifications(fresh);
      Alert.alert(t('alarmEdit.successTitle'), t('alarmEdit.successDesc'), [
        { text: t('common.confirm'), onPress: () => router.back() },
      ]);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('alarmEdit.editError')));
    },
  });

  const toggleDay = (day: number) => {
    setRepeatDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const selectVibration = (pattern: VibrationPattern) => {
    setVibrationPattern(pattern);
    if (pattern === 'default') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (pattern === 'strong') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  };

  const handleSubmit = () => {
    const time = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const validated = validateAlarmForm({
      messageId: selectedMessageId,
      time,
      repeatDays,
      mode,
      vibrationPattern,
      voiceProfileId,
      snoozeMinutes: snooze,
    }, t);
    if (!validated.ok) {
      toast.show(validated.error);
      return;
    }
    const { payload } = validated;
    editMutation.mutate({
      message_id: payload.message_id,
      time: payload.time,
      repeat_days: payload.repeat_days,
      snooze_minutes: payload.snooze_minutes,
      mode: payload.mode,
      vibration_pattern: payload.vibration_pattern,
      voice_profile_id: payload.voice_profile_id ?? null,
      wake_mode: mode === 'tts' ? wakeMode : 'sound_then_voice',
    });
  };

  const soundOnlyInvalid = mode === 'sound-only' && !voiceProfileId;

  const quickSetDays = (type: 'daily' | 'weekday' | 'weekend') => {
    if (type === 'daily') setRepeatDays([0, 1, 2, 3, 4, 5, 6]);
    else if (type === 'weekday') setRepeatDays([1, 2, 3, 4, 5]);
    else setRepeatDays([0, 6]);
  };

  if (!alarm && !loaded) {
    return (
      <View style={dynStyles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={dynStyles.container} contentContainerStyle={dynStyles.content}>
      <Text style={dynStyles.screenTitle}>{t('alarmEdit.title')}</Text>

      {/* 시간 선택 */}
      <Text style={dynStyles.sectionTitle}>{t('alarmCreate.time')}</Text>
      <View style={dynStyles.timePickerContainer}>
        <Text style={dynStyles.ampmLabel}>
          {hour < 12 ? t('alarmCreate.am') : t('alarmCreate.pm')}
        </Text>
        <View style={dynStyles.timePicker}>
          <View style={dynStyles.timeColumn}>
            <TouchableOpacity
              style={dynStyles.timeArrow}
              onPress={() => setHour((h) => (h + 1) % 24)}
              accessibilityLabel={t('alarmCreate.hourUp')}
              accessibilityRole="button"
            >
              <Text style={dynStyles.arrowText}>▲</Text>
            </TouchableOpacity>
            <Text style={dynStyles.timeValue}>{hour.toString().padStart(2, '0')}</Text>
            <TouchableOpacity
              style={dynStyles.timeArrow}
              onPress={() => setHour((h) => (h - 1 + 24) % 24)}
              accessibilityLabel={t('alarmCreate.hourDown')}
              accessibilityRole="button"
            >
              <Text style={dynStyles.arrowText}>▼</Text>
            </TouchableOpacity>
          </View>

          <Text style={dynStyles.timeSeparator}>:</Text>

          <View style={dynStyles.timeColumn}>
            <TouchableOpacity
              style={dynStyles.timeArrow}
              onPress={() => setMinute((m) => (m + 5) % 60)}
              accessibilityLabel={t('alarmCreate.minuteUp')}
              accessibilityRole="button"
            >
              <Text style={dynStyles.arrowText}>▲</Text>
            </TouchableOpacity>
            <Text style={dynStyles.timeValue}>{minute.toString().padStart(2, '0')}</Text>
            <TouchableOpacity
              style={dynStyles.timeArrow}
              onPress={() => setMinute((m) => (m - 5 + 60) % 60)}
              accessibilityLabel={t('alarmCreate.minuteDown')}
              accessibilityRole="button"
            >
              <Text style={dynStyles.arrowText}>▼</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={dynStyles.timeUntil}>
          {(() => {
            const { hours: h, minutes: m } = getTimeUntilAlarm(hour, minute);
            if (h === 0) return t('alarmCreate.alarmInMinutes', { minutes: m });
            if (m === 0) return t('alarmCreate.alarmInHours', { hours: h });
            return t('alarmCreate.alarmIn', { hours: h, minutes: m });
          })()}
        </Text>
      </View>

      {/* 반복 요일 */}
      <Text style={dynStyles.sectionTitle}>{t('alarmCreate.repeat')}</Text>
      <View style={dynStyles.daysRow}>
        {DAYS_OF_WEEK.map((day, index) => (
          <TouchableOpacity
            key={index}
            style={[dynStyles.dayChip, repeatDays.includes(index) && dynStyles.dayChipActive]}
            onPress={() => toggleDay(index)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: repeatDays.includes(index) }}
            accessibilityLabel={day}
          >
            <Text style={[dynStyles.dayText, repeatDays.includes(index) && dynStyles.dayTextActive]}>
              {day}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={dynStyles.quickDays}>
        <TouchableOpacity style={dynStyles.quickChip} onPress={() => quickSetDays('daily')} accessibilityRole="button" accessibilityLabel={t('alarms.daily')}>
          <Text style={dynStyles.quickText}>{t('alarms.daily')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={dynStyles.quickChip} onPress={() => quickSetDays('weekday')} accessibilityRole="button" accessibilityLabel={t('alarms.weekday')}>
          <Text style={dynStyles.quickText}>{t('alarms.weekday')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={dynStyles.quickChip} onPress={() => quickSetDays('weekend')} accessibilityRole="button" accessibilityLabel={t('alarms.weekend')}>
          <Text style={dynStyles.quickText}>{t('alarms.weekend')}</Text>
        </TouchableOpacity>
      </View>

      {/* 재생 모드 */}
      <Text style={dynStyles.sectionTitle}>{t('alarmCreate.playMode')}</Text>
      <View style={dynStyles.modeRow}>
        <TouchableOpacity
          style={[dynStyles.modeChip, mode === 'tts' && dynStyles.modeChipActive]}
          onPress={() => setMode('tts')}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'tts' }}
        >
          <Text style={[dynStyles.modeText, mode === 'tts' && dynStyles.modeTextActive]}>
            🗣️ {t('alarmCreate.ttsMode')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[dynStyles.modeChip, mode === 'sound-only' && dynStyles.modeChipActive]}
          onPress={() => setMode('sound-only')}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'sound-only' }}
        >
          <Text style={[dynStyles.modeText, mode === 'sound-only' && dynStyles.modeTextActive]}>
            🔊 {t('alarmCreate.soundOnlyMode')}
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'sound-only' && (
        <>
          <Text style={dynStyles.sectionTitle}>{t('alarmCreate.voiceProfile')}</Text>
          {readyVoices.length === 0 && readyFamilyVoices.length === 0 ? (
            <View style={dynStyles.emptyVoiceBox}>
              <Text style={dynStyles.emptyVoiceText}>
                {t('alarmCreate.voiceProfileRequired')}
              </Text>
            </View>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={dynStyles.voiceRow}
              >
                {readyVoices.map((v) => {
                  const selected = voiceProfileId === v.id;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[dynStyles.voiceChip, selected && dynStyles.voiceChipActive]}
                      onPress={() => setVoiceProfileId(selected ? null : v.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={v.name}
                    >
                      <Text style={[dynStyles.voiceText, selected && dynStyles.voiceTextActive]}>
                        {v.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              {readyFamilyVoices.length > 0 && (
                <>
                  <Text style={dynStyles.voiceSubLabel}>{t('alarmCreate.familyVoices')}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={dynStyles.voiceRow}
                  >
                    {readyFamilyVoices.map((v: FamilyVoiceProfile) => {
                      const selected = voiceProfileId === v.id;
                      return (
                        <TouchableOpacity
                          key={v.id}
                          style={[dynStyles.voiceChip, selected && dynStyles.voiceChipActive]}
                          onPress={() => setVoiceProfileId(selected ? null : v.id)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`${v.name} (${v.owner_name ?? ''})`}
                        >
                          <Text style={[dynStyles.voiceText, selected && dynStyles.voiceTextActive]}>
                            {v.name}
                          </Text>
                          <Text style={dynStyles.voiceOwnerText}>
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
          {soundOnlyInvalid && (
            <Text style={dynStyles.voiceHint}>
              {t('alarmCreate.voiceProfileHint')}
            </Text>
          )}
        </>
      )}

      {/* 깨우기 방식 */}
      {mode === 'tts' && (
        <>
          <Text style={dynStyles.sectionTitle}>{t('alarmCreate.wakeMode')}</Text>
          <View style={dynStyles.modeRow}>
            <TouchableOpacity
              style={[dynStyles.modeChip, wakeMode === 'sound_then_voice' && dynStyles.modeChipActive]}
              onPress={() => setWakeMode('sound_then_voice')}
              accessibilityRole="radio"
              accessibilityState={{ selected: wakeMode === 'sound_then_voice' }}
            >
              <Text style={[dynStyles.modeText, wakeMode === 'sound_then_voice' && dynStyles.modeTextActive]}>
                {t('alarmCreate.soundThenVoice')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dynStyles.modeChip, wakeMode === 'voice_only' && dynStyles.modeChipActive]}
              onPress={() => setWakeMode('voice_only')}
              accessibilityRole="radio"
              accessibilityState={{ selected: wakeMode === 'voice_only' }}
            >
              <Text style={[dynStyles.modeText, wakeMode === 'voice_only' && dynStyles.modeTextActive]}>
                {t('alarmCreate.voiceOnly')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 스누즈 */}
      <Text style={dynStyles.sectionTitle}>{t('alarmCreate.snooze')}</Text>
      <View style={dynStyles.snoozeRow}>
        {[5, 10, 15].map((min) => (
          <TouchableOpacity
            key={min}
            style={[dynStyles.snoozeChip, snooze === min && dynStyles.snoozeChipActive]}
            onPress={() => setSnooze(min)}
            accessibilityRole="radio"
            accessibilityState={{ selected: snooze === min }}
            accessibilityLabel={t('alarmCreate.snoozeMin', { min })}
          >
            <Text style={[dynStyles.snoozeText, snooze === min && dynStyles.snoozeTextActive]}>
              {t('alarmCreate.snoozeMin', { min })}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 진동 패턴 */}
      <Text style={dynStyles.sectionTitle}>{t('alarmCreate.vibration')}</Text>
      <View style={dynStyles.snoozeRow}>
        {(['default', 'strong', 'none'] as const).map((pattern) => (
          <TouchableOpacity
            key={pattern}
            style={[dynStyles.snoozeChip, vibrationPattern === pattern && dynStyles.snoozeChipActive]}
            onPress={() => selectVibration(pattern)}
            accessibilityRole="radio"
            accessibilityState={{ selected: vibrationPattern === pattern }}
            accessibilityLabel={t(`alarmCreate.vibration${pattern.charAt(0).toUpperCase() + pattern.slice(1)}`)}
          >
            <Text style={[dynStyles.snoozeText, vibrationPattern === pattern && dynStyles.snoozeTextActive]}>
              {t(`alarmCreate.vibration${pattern.charAt(0).toUpperCase() + pattern.slice(1)}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 메시지 선택 */}
      <Text style={dynStyles.sectionTitle}>{t('alarmCreate.message')}</Text>
      {messages && messages.length > 0 ? (
        <View style={dynStyles.messageList}>
          {messages.map((msg: Message) => (
            <TouchableOpacity
              key={msg.id}
              style={[
                dynStyles.messageItem,
                selectedMessageId === msg.id && dynStyles.messageItemSelected,
              ]}
              onPress={() => setSelectedMessageId(msg.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selectedMessageId === msg.id }}
              accessibilityLabel={`${msg.voice_name}: ${msg.text}`}
            >
              <View style={dynStyles.messageInfo}>
                <Text style={dynStyles.messageVoice}>🗣️ {msg.voice_name}</Text>
                <Text style={dynStyles.messageText} numberOfLines={1}>
                  "{msg.text}"
                </Text>
              </View>
              {selectedMessageId === msg.id && <Text style={dynStyles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={dynStyles.emptyMessageBox}>
          <Text style={dynStyles.emptyMessageEmoji}>💬</Text>
          <Text style={dynStyles.emptyMessageTitle}>{t('alarmCreate.noMessages')}</Text>
          <Text style={dynStyles.emptyMessageDesc}>{t('alarmCreate.noMessagesDesc')}</Text>
        </View>
      )}

      {/* 저장 버튼 */}
      <TouchableOpacity
        style={[
          dynStyles.saveButton,
          (!selectedMessageId || soundOnlyInvalid || editMutation.isPending) && dynStyles.disabled,
        ]}
        onPress={handleSubmit}
        disabled={!selectedMessageId || soundOnlyInvalid || editMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={t('alarmEdit.save')}
        accessibilityState={{ disabled: !selectedMessageId || soundOnlyInvalid || editMutation.isPending }}
      >
        {editMutation.isPending ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={dynStyles.saveText}>{t('alarmEdit.save')}</Text>
        )}
      </TouchableOpacity>
      <Toast message={toast.message} opacity={toast.opacity} />
    </ScrollView>
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
      paddingBottom: 120,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    screenTitle: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.md,
      marginTop: Spacing.lg,
    },
    timePickerContainer: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.xl,
      padding: Spacing.lg,
    },
    ampmLabel: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      marginBottom: Spacing.xs,
    },
    timeUntil: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.primary,
      marginTop: Spacing.sm,
    },
    timePicker: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    timeColumn: {
      alignItems: 'center',
    },
    timeArrow: {
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center' as const,
      alignItems: 'center' as const,
      padding: Spacing.sm,
    },
    arrowText: {
      fontSize: 22,
      color: colors.primary,
    },
    timeValue: {
      fontSize: 56,
      fontFamily: FontFamily.regular,
      color: colors.text,
      width: 80,
      textAlign: 'center',
    },
    timeSeparator: {
      fontSize: 48,
      fontFamily: FontFamily.regular,
      color: colors.text,
      marginHorizontal: Spacing.sm,
    },
    daysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    dayChip: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    dayTextActive: {
      color: '#FFF',
    },
    quickDays: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    quickChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surfaceVariant,
    },
    quickText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    snoozeRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    snoozeChip: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    snoozeChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    snoozeText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    snoozeTextActive: {
      color: '#FFF',
    },
    messageList: {
      gap: Spacing.sm,
    },
    messageItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    messageItemSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceVariant,
    },
    messageInfo: {
      flex: 1,
    },
    messageVoice: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    messageText: {
      fontSize: FontSize.md,
      color: colors.text,
      marginTop: 2,
    },
    checkmark: {
      fontSize: FontSize.lg,
      color: colors.primary,
      fontFamily: FontFamily.bold,
    },
    emptyMessageBox: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.xl,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    emptyMessageEmoji: {
      fontSize: 40,
      marginBottom: Spacing.sm,
    },
    emptyMessageTitle: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    emptyMessageDesc: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    saveButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
      marginTop: Spacing.xl,
    },
    disabled: {
      opacity: 0.5,
    },
    saveText: {
      color: '#FFF',
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    modeRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    modeChip: {
      flex: 1,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    modeChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    modeText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    modeTextActive: {
      color: '#FFF',
    },
    voiceRow: {
      flexDirection: 'row',
    },
    voiceChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: Spacing.sm,
    },
    voiceChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    voiceText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    voiceTextActive: {
      color: '#FFF',
    },
    voiceHint: {
      fontSize: FontSize.sm,
      color: colors.error,
      marginTop: Spacing.xs,
    },
    voiceSubLabel: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontFamily: FontFamily.medium,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
    },
    voiceOwnerText: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      fontFamily: FontFamily.regular,
      marginTop: 2,
    },
    emptyVoiceBox: {
      backgroundColor: colors.surface,
      padding: Spacing.md,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: 'dashed',
    },
    emptyVoiceText: {
      color: colors.textSecondary,
      fontSize: FontSize.sm,
    },
  });
}
