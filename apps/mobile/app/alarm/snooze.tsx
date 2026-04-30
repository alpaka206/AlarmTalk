import { useMemo } from 'react';
import { Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, FontSize, FontFamily, BorderRadius } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAlarmDraftStore } from '../../src/stores/useAlarmDraftStore';

const OPTIONS = [0, 5, 10, 15, 30] as const;

export default function SnoozeScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const snoozeMinutes = useAlarmDraftStore((s) => s.snoozeMinutes);
  const setSnoozeMinutes = useAlarmDraftStore((s) => s.setSnoozeMinutes);

  const handleSelect = (value: number) => {
    setSnoozeMinutes(value);
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {OPTIONS.map((value) => {
        const selected = snoozeMinutes === value;
        const label =
          value === 0 ? t('alarmCreate.snoozeOff') : t('alarmCreate.snoozeMin', { min: value });
        return (
          <TouchableOpacity
            key={value}
            style={styles.row}
            onPress={() => handleSelect(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
            {selected && <Text style={styles.check}>✓</Text>}
          </TouchableOpacity>
        );
      })}
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
      padding: Spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.md + 4,
      paddingHorizontal: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      marginBottom: Spacing.xs,
    },
    label: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.medium,
      color: colors.text,
    },
    labelSelected: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    check: {
      fontSize: FontSize.xl,
      color: colors.primary,
      fontFamily: FontFamily.bold,
    },
  });
}
