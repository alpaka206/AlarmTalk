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
import { DAY_KEYS } from '../../src/constants/presets';
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
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { parseRepeatDays, validateAlarmForm, getTimeUntilAlarm } from '../../src/lib/alarmForm';
import { createAlarmFormStyles } from '../../src/styles/alarmFormStyles';
import * as Haptics from 'expo-haptics';

export default function EditAlarmScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { isAuthenticated, plan } = useAppStore();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const formStyles = useMemo(() => createAlarmFormStyles(colors), [colors]);
  const localStyles = useMemo(() => createLocalStyles(colors), [colors]);

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
      const [h, m] = alarm.time.split(':').map(Number) as [number, number];
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
      toast.show(getApiErrorMessage(err, t, t('alarmEdit.editError')));
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
      <View style={localStyles.loadingContainer}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={formStyles.container} contentContainerStyle={formStyles.content}>
      <Text style={localStyles.screenTitle}>{t('alarmEdit.title')}</Text>

      {/* 시간 선택 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.time')}</Text>
      <View style={formStyles.timePickerContainer}>
        <Text style={formStyles.ampmLabel}>
          {hour < 12 ? t('alarmCreate.am') : t('alarmCreate.pm')}
        </Text>
        <View style={formStyles.timePicker}>
          <View style={formStyles.timeColumn}>
            <TouchableOpacity
              style={formStyles.timeArrow}
              onPress={() => setHour((h) => (h + 1) % 24)}
              accessibilityLabel={t('alarmCreate.hourUp')}
              accessibilityRole="button"
            >
              <Text style={formStyles.arrowText}>▲</Text>
            </TouchableOpacity>
            <Text style={formStyles.timeValue}>{hour.toString().padStart(2, '0')}</Text>
            <TouchableOpacity
              style={formStyles.timeArrow}
              onPress={() => setHour((h) => (h - 1 + 24) % 24)}
              accessibilityLabel={t('alarmCreate.hourDown')}
              accessibilityRole="button"
            >
              <Text style={formStyles.arrowText}>▼</Text>
            </TouchableOpacity>
          </View>

          <Text style={formStyles.timeSeparator}>:</Text>

          <View style={formStyles.timeColumn}>
            <TouchableOpacity
              style={formStyles.timeArrow}
              onPress={() => setMinute((m) => (m + 5) % 60)}
              accessibilityLabel={t('alarmCreate.minuteUp')}
              accessibilityRole="button"
            >
              <Text style={formStyles.arrowText}>▲</Text>
            </TouchableOpacity>
            <Text style={formStyles.timeValue}>{minute.toString().padStart(2, '0')}</Text>
            <TouchableOpacity
              style={formStyles.timeArrow}
              onPress={() => setMinute((m) => (m - 5 + 60) % 60)}
              accessibilityLabel={t('alarmCreate.minuteDown')}
              accessibilityRole="button"
            >
              <Text style={formStyles.arrowText}>▼</Text>
            </TouchableOpacity>
          </View>
        </View>
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

      {/* 재생 모드 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.playMode')}</Text>
      <View style={formStyles.modeRow}>
        <TouchableOpacity
          style={[formStyles.modeChip, mode === 'tts' && formStyles.modeChipActive]}
          onPress={() => setMode('tts')}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'tts' }}
        >
          <Text style={[formStyles.modeText, mode === 'tts' && formStyles.modeTextActive]}>
            🗣️ {t('alarmCreate.ttsMode')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[formStyles.modeChip, mode === 'sound-only' && formStyles.modeChipActive]}
          onPress={() => setMode('sound-only')}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === 'sound-only' }}
        >
          <Text style={[formStyles.modeText, mode === 'sound-only' && formStyles.modeTextActive]}>
            🔊 {t('alarmCreate.soundOnlyMode')}
          </Text>
        </TouchableOpacity>
      </View>

      {mode === 'sound-only' && (
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
                {readyVoices.map((v) => {
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
          {soundOnlyInvalid && (
            <Text style={formStyles.voiceHint}>
              {t('alarmCreate.voiceProfileHint')}
            </Text>
          )}
        </>
      )}

      {/* 깨우기 방식 */}
      {mode === 'tts' && (
        <>
          <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.wakeMode')}</Text>
          <View style={formStyles.modeRow}>
            <TouchableOpacity
              style={[formStyles.modeChip, wakeMode === 'sound_then_voice' && formStyles.modeChipActive]}
              onPress={() => setWakeMode('sound_then_voice')}
              accessibilityRole="radio"
              accessibilityState={{ selected: wakeMode === 'sound_then_voice' }}
            >
              <Text style={[formStyles.modeText, wakeMode === 'sound_then_voice' && formStyles.modeTextActive]}>
                {t('alarmCreate.soundThenVoice')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[formStyles.modeChip, wakeMode === 'voice_only' && formStyles.modeChipActive]}
              onPress={() => setWakeMode('voice_only')}
              accessibilityRole="radio"
              accessibilityState={{ selected: wakeMode === 'voice_only' }}
            >
              <Text style={[formStyles.modeText, wakeMode === 'voice_only' && formStyles.modeTextActive]}>
                {t('alarmCreate.voiceOnly')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* 스누즈 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.snooze')}</Text>
      <View style={formStyles.snoozeRow}>
        {[5, 10, 15].map((min) => (
          <TouchableOpacity
            key={min}
            style={[formStyles.snoozeChip, snooze === min && formStyles.snoozeChipActive]}
            onPress={() => setSnooze(min)}
            accessibilityRole="radio"
            accessibilityState={{ selected: snooze === min }}
            accessibilityLabel={t('alarmCreate.snoozeMin', { min })}
          >
            <Text style={[formStyles.snoozeText, snooze === min && formStyles.snoozeTextActive]}>
              {t('alarmCreate.snoozeMin', { min })}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 진동 패턴 */}
      <Text style={formStyles.sectionTitle} accessibilityRole="header">{t('alarmCreate.vibration')}</Text>
      <View style={formStyles.snoozeRow}>
        {(['default', 'strong', 'none'] as const).map((pattern) => (
          <TouchableOpacity
            key={pattern}
            style={[formStyles.snoozeChip, vibrationPattern === pattern && formStyles.snoozeChipActive]}
            onPress={() => selectVibration(pattern)}
            accessibilityRole="radio"
            accessibilityState={{ selected: vibrationPattern === pattern }}
            accessibilityLabel={t(`alarmCreate.vibration${pattern.charAt(0).toUpperCase() + pattern.slice(1)}`)}
          >
            <Text style={[formStyles.snoozeText, vibrationPattern === pattern && formStyles.snoozeTextActive]}>
              {t(`alarmCreate.vibration${pattern.charAt(0).toUpperCase() + pattern.slice(1)}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 메시지 선택 */}
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
          <Text style={formStyles.emptyMessageDesc}>{t('alarmCreate.noMessagesDesc')}</Text>
        </View>
      )}

      {/* 저장 버튼 */}
      <TouchableOpacity
        style={[
          localStyles.saveButton,
          (!selectedMessageId || soundOnlyInvalid || editMutation.isPending) && formStyles.disabled,
        ]}
        onPress={handleSubmit}
        disabled={!selectedMessageId || soundOnlyInvalid || editMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={t('alarmEdit.save')}
        accessibilityState={{ disabled: !selectedMessageId || soundOnlyInvalid || editMutation.isPending }}
      >
        {editMutation.isPending ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={localStyles.saveText}>{t('alarmEdit.save')}</Text>
        )}
      </TouchableOpacity>
      <Toast message={toast.message} opacity={toast.opacity} />
    </ScrollView>
  );
}

function createLocalStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
    saveButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
      marginTop: Spacing.xl,
    },
    saveText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
  });
}
