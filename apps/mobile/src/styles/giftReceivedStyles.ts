import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createGiftReceivedStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listWrap: {
      flex: 1,
    },
    listDimmed: {
      opacity: 0.5,
    },
    skeletonLine: {
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.border,
    },
    skeletonBlock: {
      height: 60,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.border,
    },
    list: {
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    empty: {
      alignItems: 'center',
      paddingTop: Spacing.xxl * 2,
    },
    emptyEmoji: {
      fontSize: 48,
      marginBottom: Spacing.md,
    },
    emptyText: {
      fontSize: FontSize.lg,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 8,
      elevation: 2,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    senderInfo: {
      flex: 1,
    },
    senderName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    senderEmail: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginTop: 1,
    },
    status: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.warning,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surfaceVariant,
      overflow: 'hidden',
    },
    statusAccepted: {
      color: colors.success,
    },
    statusRejected: {
      color: colors.error,
    },
    messageBox: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    category: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontFamily: FontFamily.medium,
      marginBottom: 4,
      textTransform: 'uppercase',
    },
    messageText: {
      fontSize: FontSize.md,
      color: colors.text,
      lineHeight: 22,
    },
    note: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontStyle: 'italic',
      marginBottom: Spacing.sm,
    },
    actions: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    acceptBtn: {
      flex: 1,
      backgroundColor: colors.primary,
      paddingVertical: Spacing.sm + 2,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
    },
    acceptBtnText: {
      color: colors.textOnPrimary,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.md,
    },
    rejectBtn: {
      flex: 1,
      backgroundColor: colors.surfaceVariant,
      paddingVertical: Spacing.sm + 2,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
    },
    rejectBtnText: {
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.md,
    },
    setAlarmBtn: {
      backgroundColor: colors.surfaceVariant,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    setAlarmBtnText: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.sm,
    },
  });
}
