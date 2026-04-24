import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createAlarmFormStyles(colors: ThemeColors) {
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
    disabled: {
      opacity: 0.5,
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

export type AlarmFormStyles = ReturnType<typeof createAlarmFormStyles>;
