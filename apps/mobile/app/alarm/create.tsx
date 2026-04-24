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
import { DAYS_OF_WEEK, PRESET_CATEGORIES, getCategoryLabel } from '../../src/constants/presets';
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
import { getApiErrorMessage } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { validateAlarmForm, getTimeUntilAlarm } from '../../src/lib/alarmForm';
import { getRecentPresetMessages, addRecentPresetMessage } from '../../src/services/offlineCache';
import * as Haptics from 'expo-haptics';

export default function CreateAlarmScreen() {
  const router = useRouter();
  const { message_id: paramMessageId } = useLocalSearchParams<{ message_id?: string }>();
  const queryClient = useQueryClient();
  const { isAuthenticated, userId, defaultSnoozeMinutes, plan } = useAppStore();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);

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
  const [mode, setMode] = useState<AlarmMode>('tts');
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
      toast.show(getApiErrorMessage(err, t('alarmCreate.ttsError')));
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
      toast.show(getApiErrorMessage(err, t('alarmCreate.createError')));
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
    <ScrollView style={dynStyles.container} contentContainerStyle={dynStyles.content}>
      {/* 누구에게? */}
      {friends && friends.length > 0 && (
        <>
          <Text style={dynStyles.sectionTitle}>{t('alarmCreate.forWho')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={dynStyles.targetRow}>
            <TouchableOpacity
              style={[dynStyles.targetChip, !targetUserId && dynStyles.targetChipActive]}
              onPress={() => {
                setTargetUserId(null);
                setTargetName(null);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: !targetUserId }}
              accessibilityLabel={t('alarmCreate.forMe')}
            >
              <Text style={[dynStyles.targetText, !targetUserId && dynStyles.targetTextActive]}>
                {t('alarmCreate.forMe')}
              </Text>
            </TouchableOpacity>
            {friends.map((f: Friend) => {
              const friendId = f.user_a === userId ? f.user_b : f.user_a;
              const isSelected = targetUserId === friendId;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[dynStyles.targetChip, isSelected && dynStyles.targetChipActive]}
                  onPress={() => {
                    setTargetUserId(isSelected ? null : friendId);
                    setTargetName(isSelected ? null : f.friend_name || f.friend_email || null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={f.friend_name || f.friend_email?.split('@')[0] || '?'}
                >
                  <Text style={[dynStyles.targetText, isSelected && dynStyles.targetTextActive]}>
                    {f.friend_name || f.friend_email?.split('@')[0] || '?'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {targetName && (
            <Text style={dynStyles.targetHint}>
              {t('alarmCreate.targetHint', { name: targetName })}
            </Text>
          )}
        </>
      )}

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
                {readyVoices.map((v: VoiceProfile) => {
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
                🔔 {t('alarmCreate.soundThenVoice')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dynStyles.modeChip, wakeMode === 'voice_only' && dynStyles.modeChipActive]}
              onPress={() => setWakeMode('voice_only')}
              accessibilityRole="radio"
              accessibilityState={{ selected: wakeMode === 'voice_only' }}
            >
              <Text style={[dynStyles.modeText, wakeMode === 'voice_only' && dynStyles.modeTextActive]}>
                🗣️ {t('alarmCreate.voiceOnly')}
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
          <View style={dynStyles.emptyMessageActions}>
            <TouchableOpacity
              style={dynStyles.emptyMessageBtn}
              onPress={() => router.push('/message/create')}
              accessibilityRole="button"
              accessibilityLabel={t('alarmCreate.goCreate')}
            >
              <Text style={dynStyles.emptyMessageBtnText}>{t('alarmCreate.goCreate')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 프리셋으로 빠르게 만들기 */}
      <TouchableOpacity
        style={dynStyles.presetToggle}
        onPress={() => setShowPreset((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showPreset }}
        accessibilityLabel={t('alarmCreate.quickCreate')}
      >
        <Text style={dynStyles.presetToggleText}>
          {showPreset ? '▲' : '▼'} {t('alarmCreate.quickCreate')}
        </Text>
      </TouchableOpacity>

      {showPreset && (
        <View style={dynStyles.presetSection}>
          {/* 음성 선택 */}
          <Text style={dynStyles.presetLabel}>{t('alarmCreate.selectVoice')}</Text>
          {readyVoices.length === 0 ? (
            <TouchableOpacity
              style={dynStyles.emptyMessage}
              onPress={() => router.push('/voice/record')}
              accessibilityRole="button"
              accessibilityLabel={t('alarmCreate.emptyVoice')}
            >
              <Text style={dynStyles.emptyMessageText}>{t('alarmCreate.emptyVoice')}</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={dynStyles.presetRow}>
              {readyVoices.map((v: VoiceProfile) => (
                <TouchableOpacity
                  key={v.id}
                  style={[dynStyles.targetChip, presetVoiceId === v.id && dynStyles.targetChipActive]}
                  onPress={() => setPresetVoiceId(v.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: presetVoiceId === v.id }}
                  accessibilityLabel={v.name}
                >
                  <Text style={[dynStyles.targetText, presetVoiceId === v.id && dynStyles.targetTextActive]}>
                    {v.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* 최근 사용 메시지 */}
          {recentPresets.length > 0 && (
            <>
              <Text style={dynStyles.presetLabel}>{t('alarmCreate.recentMessages')}</Text>
              <View style={dynStyles.messageList}>
                {recentPresets.map((msg, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[dynStyles.messageItem, presetText === msg && dynStyles.messageItemSelected]}
                    onPress={() => setPresetText(msg)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: presetText === msg }}
                    accessibilityLabel={msg}
                  >
                    <View style={dynStyles.messageInfo}>
                      <Text style={dynStyles.messageText} numberOfLines={2}>"{msg}"</Text>
                    </View>
                    {presetText === msg && <Text style={dynStyles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* 카테고리 선택 — 2열 그리드 */}
          <Text style={dynStyles.presetLabel}>{t('alarmCreate.presetCategory')}</Text>
          <View style={dynStyles.categoryGrid}>
            {PRESET_CATEGORIES.map((cat) => {
              const selected = presetCategory === cat.key;
              const label = getCategoryLabel(cat, t);
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[dynStyles.categoryCard, selected && dynStyles.categoryCardActive]}
                  onPress={() => {
                    setPresetCategory(cat.key);
                    setPresetText(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                >
                  <Text style={dynStyles.categoryEmoji}>{cat.emoji}</Text>
                  <Text style={[dynStyles.categoryLabel, selected && dynStyles.categoryLabelActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 프리셋 메시지 목록 + 랜덤 선택 */}
          <View style={dynStyles.presetMsgHeader}>
            <Text style={[dynStyles.presetLabel, { marginBottom: 0 }]}>{t('alarmCreate.presetMessages')}</Text>
            <TouchableOpacity
              style={dynStyles.randomBtn}
              onPress={() => {
                const msgs = PRESET_CATEGORIES.find((c) => c.key === presetCategory)?.messages;
                if (msgs && msgs.length > 0) {
                  setPresetText(msgs[Math.floor(Math.random() * msgs.length)]);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={t('alarmCreate.randomMessage')}
            >
              <Text style={dynStyles.randomBtnText}>{t('alarmCreate.randomMessage')}</Text>
            </TouchableOpacity>
          </View>
          <View style={dynStyles.messageList}>
            {PRESET_CATEGORIES.find((c) => c.key === presetCategory)?.messages.map((msg, i) => (
              <TouchableOpacity
                key={i}
                style={[dynStyles.messageItem, presetText === msg && dynStyles.messageItemSelected]}
                onPress={() => setPresetText(msg)}
                accessibilityRole="radio"
                accessibilityState={{ selected: presetText === msg }}
                accessibilityLabel={msg}
              >
                <View style={dynStyles.messageInfo}>
                  <Text style={dynStyles.messageText} numberOfLines={2}>"{msg}"</Text>
                </View>
                {presetText === msg && <Text style={dynStyles.checkmark}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          {/* 생성 버튼 */}
          <TouchableOpacity
            style={[
              dynStyles.presetGenerateBtn,
              (!presetVoiceId || !presetText || ttsMutation.isPending) && dynStyles.disabled,
            ]}
            onPress={handlePresetGenerate}
            disabled={!presetVoiceId || !presetText || ttsMutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('alarmCreate.generatePreset')}
            accessibilityState={{ disabled: !presetVoiceId || !presetText || ttsMutation.isPending }}
          >
            {ttsMutation.isPending ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={dynStyles.presetGenerateText}>{t('alarmCreate.generatePreset')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* 생성 버튼 */}
      <TouchableOpacity
        style={[
          dynStyles.createButton,
          (!selectedMessageId || soundOnlyInvalid || createMutation.isPending) && dynStyles.disabled,
        ]}
        onPress={handleSubmit}
        disabled={!selectedMessageId || soundOnlyInvalid || createMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={t('alarmCreate.submit')}
        accessibilityState={{ disabled: !selectedMessageId || soundOnlyInvalid || createMutation.isPending }}
      >
        {createMutation.isPending ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={dynStyles.createText}>{t('alarmCreate.submit')}</Text>
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
  emptyMessage: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: 'center',
  },
  emptyMessageText: {
    color: colors.primary,
    fontFamily: FontFamily.semibold,
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
    marginBottom: Spacing.md,
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
    color: '#FFF',
    fontSize: FontSize.sm,
    fontFamily: FontFamily.semibold,
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
  createButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  disabled: {
    opacity: 0.5,
  },
  createText: {
    color: '#FFF',
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
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
    color: '#FFF',
  },
  targetHint: {
    fontSize: FontSize.sm,
    color: colors.accent,
    fontFamily: FontFamily.medium,
    marginBottom: Spacing.sm,
  },
  presetToggle: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  presetToggleText: {
    fontSize: FontSize.md,
    color: colors.primary,
    fontFamily: FontFamily.semibold,
  },
  presetSection: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  presetLabel: {
    fontSize: FontSize.sm,
    fontFamily: FontFamily.semibold,
    color: colors.textSecondary,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  presetRow: {
    marginBottom: Spacing.sm,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  categoryCard: {
    width: '48%' as unknown as number,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: Spacing.sm,
  },
  categoryCardActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryEmoji: {
    fontSize: 24,
  },
  categoryLabel: {
    fontSize: FontSize.sm,
    fontFamily: FontFamily.semibold,
    color: colors.text,
  },
  categoryLabelActive: {
    color: '#FFF',
  },
  presetMsgHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  randomBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  randomBtnText: {
    fontSize: FontSize.xs,
    fontFamily: FontFamily.semibold,
    color: colors.primary,
  },
  presetGenerateBtn: {
    backgroundColor: colors.accent,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  presetGenerateText: {
    color: '#FFF',
    fontSize: FontSize.md,
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
