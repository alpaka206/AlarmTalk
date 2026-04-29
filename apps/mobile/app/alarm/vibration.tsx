import { useMemo } from 'react';
import { Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, FontSize, FontFamily, BorderRadius } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAlarmDraftStore } from '../../src/stores/useAlarmDraftStore';
import type { VibrationPattern } from '../../src/types';

const OPTIONS: VibrationPattern[] = ['none', 'default', 'strong'];

export default function VibrationScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const vibrationPattern = useAlarmDraftStore((s) => s.vibrationPattern);
  const setVibrationPattern = useAlarmDraftStore((s) => s.setVibrationPattern);

  const handleSelect = (value: VibrationPattern) => {
    setVibrationPattern(value);
    router.back();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {OPTIONS.map((pattern) => {
        const selected = vibrationPattern === pattern;
        const label = t(
          `alarmCreate.vibration${pattern.charAt(0).toUpperCase() + pattern.slice(1)}`,
        );
        return (
          <TouchableOpacity
            key={pattern}
            style={styles.row}
            onPress={() => handleSelect(pattern)}
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
