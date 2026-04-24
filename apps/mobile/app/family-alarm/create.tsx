import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getFamilyGroupCurrent,
  createFamilyAlarmText,
  getUserProfile,
} from '../../src/services/api';
import type { FamilyGroupMember } from '../../src/services/api';
import {
  filterFamilyAlarmRecipients,
  validateFamilyAlarmForm,
  buildMemberDisplayName,
} from '../../src/lib/familyAlarmForm';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAppStore } from '../../src/stores/useAppStore';
import { useNetworkStatus } from '../../src/hooks/useNetworkStatus';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { DAY_KEYS } from '../../src/constants/presets';

export default function FamilyAlarmCreateScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const isConnected = useNetworkStatus();

  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
  const [wakeAt, setWakeAt] = useState('07:00');
  const [messageText, setMessageText] = useState('');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);

  const { data: profile } = useQuery({
    queryKey: ['userProfile'],
    queryFn: getUserProfile,
    enabled: isAuthenticated && isConnected,
  });

  const { data: familyData, isLoading } = useQuery({
    queryKey: ['family-group'],
    queryFn: getFamilyGroupCurrent,
    enabled: isAuthenticated && isConnected,
  });

  const selfUserId = profile?.id ?? '';
  const members = familyData?.members;
  const allowedRecipients = useMemo(
    () => (members ? filterFamilyAlarmRecipients(members, selfUserId) : []),
    [members, selfUserId],
  );

  const createMutation = useMutation({
    mutationFn: createFamilyAlarmText,
    onSuccess: () => {
      Alert.alert(t('familyAlarm.successTitle'), t('familyAlarm.successDesc'), [
        { text: t('common.confirm'), onPress: () => router.back() },
      ]);
    },
    onError: () => {
      toast.show(t('familyAlarm.createError'));
    },
  });

  const toggleDay = (day: number) => {
    setRepeatDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleSubmit = () => {
    const result = validateFamilyAlarmForm({
      recipientUserId: selectedRecipient,
      wakeAt,
      messageText,
      repeatDays,
    }, t);
    if (!result.ok) {
      toast.show(result.error);
      return;
    }
    createMutation.mutate(result.payload);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!familyData?.group) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyContainer} accessibilityLabel={t('people.noGroup')}>
          <Text style={styles.emptyEmoji} accessibilityElementsHidden>👨‍👩‍👧</Text>
          <Text style={styles.emptyText}>{t('people.noGroup')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (allowedRecipients.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.emptyContainer} accessibilityLabel={t('familyAlarm.noRecipients')}>
          <Text style={styles.emptyEmoji} accessibilityElementsHidden>🔇</Text>
          <Text style={styles.emptyText}>{t('familyAlarm.noRecipients')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel} accessibilityRole="header">{t('familyAlarm.recipient')}</Text>
        <View style={styles.recipientRow}>
          {allowedRecipients.map((m: FamilyGroupMember) => {
            const selected = selectedRecipient === m.user_id;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.recipientChip, selected && styles.recipientChipActive]}
                onPress={() => setSelectedRecipient(m.user_id)}
                accessibilityLabel={t('familyAlarm.a11yRecipient', { name: buildMemberDisplayName(m, t) })}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.recipientText, selected && styles.recipientTextActive]}>
                  {buildMemberDisplayName(m, t)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('familyAlarm.wakeTime')}</Text>
        <TextInput
          style={styles.timeInput}
          value={wakeAt}
          onChangeText={setWakeAt}
          placeholder="07:00"
          placeholderTextColor={colors.textTertiary}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          accessibilityLabel={t('familyAlarm.wakeTime')}
        />

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('familyAlarm.message')}</Text>
        <TextInput
          style={styles.messageInput}
          value={messageText}
          onChangeText={setMessageText}
          placeholder={t('familyAlarm.messagePlaceholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          maxLength={500}
          textAlignVertical="top"
          accessibilityLabel={t('familyAlarm.messagePlaceholder')}
        />
        <Text style={styles.charCount}>{messageText.length}/500</Text>

        <Text style={styles.sectionLabel} accessibilityRole="header">{t('familyAlarm.repeat')}</Text>
        <View style={styles.daysRow}>
          {DAY_KEYS.map((key, idx) => {
            const label = t(key);
            const active = repeatDays.includes(idx);
            return (
              <TouchableOpacity
                key={idx}
                style={[styles.dayChip, active && styles.dayChipActive]}
                onPress={() => toggleDay(idx)}
                accessibilityLabel={t('familyAlarm.a11yDay', { day: label })}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                <Text style={[styles.dayText, active && styles.dayTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {repeatDays.length === 0 && (
          <Text style={styles.repeatHint}>{t('familyAlarm.onceHint')}</Text>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, createMutation.isPending && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={createMutation.isPending}
          accessibilityLabel={createMutation.isPending ? t('familyAlarm.sending') : t('familyAlarm.submit')}
          accessibilityRole="button"
          accessibilityState={{ disabled: createMutation.isPending, busy: createMutation.isPending }}
        >
          <Text style={styles.submitBtnText}>
            {createMutation.isPending ? t('familyAlarm.sending') : t('familyAlarm.submit')}
          </Text>
        </TouchableOpacity>
      </ScrollView>
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 120,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    fontFamily: FontFamily.semibold,
    color: colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  recipientRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  recipientChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  recipientChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  recipientText: {
    fontSize: FontSize.md,
    color: colors.text,
  },
  recipientTextActive: {
    color: '#FFF',
    fontFamily: FontFamily.semibold,
  },
  timeInput: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.xl,
    color: colors.text,
    textAlign: 'center',
    minHeight: 56,
  },
  messageInput: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
    color: colors.text,
    minHeight: 100,
    lineHeight: 22,
  },
  charCount: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    textAlign: 'right',
    marginTop: Spacing.xs,
  },
  daysRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  dayChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayText: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    fontFamily: FontFamily.medium,
  },
  dayTextActive: {
    color: '#FFF',
    fontFamily: FontFamily.semibold,
  },
  repeatHint: {
    fontSize: FontSize.xs,
    color: colors.textTertiary,
    marginTop: Spacing.xs,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xl,
    minHeight: 52,
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#FFF',
    fontSize: FontSize.lg,
    fontFamily: FontFamily.semibold,
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
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
