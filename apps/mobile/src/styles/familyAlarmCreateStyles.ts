import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createFamilyAlarmCreateStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
      color: colors.textOnPrimary,
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
      color: colors.textOnPrimary,
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
      color: colors.textOnPrimary,
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
}
