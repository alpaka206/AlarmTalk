import { useState, useMemo, useEffect, useCallback } from 'react';
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
  getFriendList,
  getVoiceProfiles,
  getFamilyVoiceProfiles,
  generateTTS,
} from '../../src/services/api';
import type { FamilyVoiceProfile } from '../../src/services/api';
import { useAppStore } from '../../src/stores/useAppStore';
import { syncAlarmNotifications } from '../../src/services/notifications';
import type { AlarmMode, VibrationPattern, Friend, Message, VoiceProfile } from '../../src/types';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { PresetMessageSection } from '../../src/components/PresetMessageSection';
import { validateAlarmForm, getTimeUntilAlarm } from '../../src/lib/alarmForm';
import { getRecentPresetMessages, addRecentPresetMessage } from '../../src/services/offlineCache';
import { createAlarmFormStyles } from '../../src/styles/alarmFormStyles';
import * as Haptics from 'expo-haptics';

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
  const [snooze, setSnooze] = useState(defaultSnoozeMinutes);
  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [showPreset, setShowPreset] = useState(false);
  const [presetCategory, setPresetCategory] = useState<string>('morning');
  const [presetText, setPresetText] = useState<string | null>(null);
  const [presetVoiceId, setPresetVoiceId] = useState<string | null>(null);
  const [mode, setMode] = useState<AlarmMode>('sound-only');
  const [vibrationPattern, setVibrationPattern] = useState<VibrationPattern>('default');
  const [wakeMode, setWakeMode] = useState<'sound_then_voice' | 'voice_only'>('sound_then_voice');
  const [voiceProfileId, setVoiceProfileId] = useState<string | null>(null);
  const [recentPresets, setRecentPresets] = useState<string[]>([]);

  const loadRecentPresets = useCallback(async () => {
    const recent = await getRecentPresetMessages();
    setRecentPresets(recent);
  }, []);

  useEffect(() => { loadRecentPresets(); }, [loadRecentPresets]);

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

  const readyVoices = voices?.filter((v: VoiceProfile) => v.status === 'ready') ?? [];

  const { data: familyVoices } = useQuery({
    queryKey: ['familyVoiceProfiles'],
    queryFn: getFamilyVoiceProfiles,
    enabled: isAuthenticated && plan === 'family',
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
      setPresetText(null);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('alarmCreate.ttsError')));
    },
  });

  const handlePresetGenerate = () => {
    if (!presetVoiceId || !presetText) return;
    addRecentPresetMessage(presetText).then(() => loadRecentPresets());

    const cached = messages?.find(
      (m: Message) => m.voice_profile_id === presetVoiceId && m.text === presetText,
    );
    if (cached) {
      setSelectedMessageId(cached.id);
      setShowPreset(false);
      setPresetText(null);
      toast.show(t('alarmCreate.reusedMessage'));
      return;
    }

    ttsMutation.mutate({
      voice_profile_id: presetVoiceId,
      text: presetText,
      category: presetCategory,
    });
  };

  const createMutation = useMutation({
    mutationFn: createAlarm,
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['alarms'] });
      const alarms = await getAlarms();
      syncAlarmNotifications(alarms);
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
      wakeMode: mode === 'tts' ? wakeMode : undefined,
      voiceProfileId,
      snoozeMinutes: snooze,
      targetUserId,
    }, t);
    if (!validated.ok) {
      toast.show(validated.error);
      return;
    }
    createMutation.mutate(validated.payload);
  };

  const soundOnlyInvalid = mode === 'sound-only' && !voiceProfileId;

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

      {/* 시간 선�� */}
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
          accessibilityLabel={t('alarmCreate.ttsMode')}
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
          accessibilityLabel={t('alarmCreate.soundOnlyMode')}
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
              accessibilityLabel={t('alarmCreate.soundThenVoice')}
            >
              <Text style={[formStyles.modeText, wakeMode === 'sound_then_voice' && formStyles.modeTextActive]}>
                🔔 {t('alarmCreate.soundThenVoice')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[formStyles.modeChip, wakeMode === 'voice_only' && formStyles.modeChipActive]}
              onPress={() => setWakeMode('voice_only')}
              accessibilityRole="radio"
              accessibilityState={{ selected: wakeMode === 'voice_only' }}
              accessibilityLabel={t('alarmCreate.voiceOnly')}
            >
              <Text style={[formStyles.modeText, wakeMode === 'voice_only' && formStyles.modeTextActive]}>
                🗣️ {t('alarmCreate.voiceOnly')}
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

      {/* 프리셋으로 빠르게 만들기 */}
      <PresetMessageSection
        showPreset={showPreset}
        onTogglePreset={() => setShowPreset((v) => !v)}
        readyVoices={readyVoices}
        presetVoiceId={presetVoiceId}
        onVoiceSelect={(id) => setPresetVoiceId(id)}
        recentPresets={recentPresets}
        presetText={presetText}
        onPresetTextSelect={setPresetText}
        presetCategory={presetCategory}
        onCategorySelect={setPresetCategory}
        isPending={ttsMutation.isPending}
        onGenerate={handlePresetGenerate}
        formStyles={formStyles}
      />

      {/* 생성 버튼 */}
      <TouchableOpacity
        style={[
          localStyles.createButton,
          (!selectedMessageId || soundOnlyInvalid || createMutation.isPending) && formStyles.disabled,
        ]}
        onPress={handleSubmit}
        disabled={!selectedMessageId || soundOnlyInvalid || createMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={t('alarmCreate.submit')}
        accessibilityState={{ disabled: !selectedMessageId || soundOnlyInvalid || createMutation.isPending }}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={localStyles.createText}>{t('alarmCreate.submit')}</Text>
        )}
      </TouchableOpacity>
      <Toast message={toast.message} opacity={toast.opacity} />
    </ScrollView>
  );
}

function createLocalStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
