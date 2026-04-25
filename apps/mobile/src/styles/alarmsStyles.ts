import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createAlarmsStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    addButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
    },
    addButtonText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
    searchContainer: {
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    searchInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
    },
    countdownBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.primaryLight + '33',
    },
    countdownLabel: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    countdownValue: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    cachedBanner: {
      backgroundColor: colors.surfaceVariant,
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
    },
    cachedText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    list: {
      padding: Spacing.lg,
      paddingTop: 0,
      paddingBottom: 100,
    },
    alarmCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    alarmCardInactive: {
      opacity: 0.6,
    },
    alarmLeft: {
      flex: 1,
    },
    alarmTime: {
      fontSize: 36,
      fontFamily: FontFamily.regular,
      color: colors.text,
    },
    timeInactive: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through' as const,
    },
    textInactive: {
      color: colors.textTertiary,
    },
    alarmSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginTop: 2,
    },
    alarmRepeat: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    alarmCountdown: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    alarmMeta: {
      marginTop: Spacing.sm,
    },
    alarmVoice: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    alarmMessage: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    modeBadge: {
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surfaceVariant,
    },
    modeBadgeText: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    familyBadge: {
      alignSelf: 'flex-start',
      marginTop: 4,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.primaryLight,
    },
    familyBadgeText: {
      fontSize: FontSize.xs,
      color: colors.textOnPrimary,
      fontFamily: FontFamily.bold,
    },
    alarmActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    previewButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewIcon: {
      fontSize: 18,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
    },
    emptyEmoji: {
      fontSize: 64,
      marginBottom: Spacing.lg,
    },
    emptyTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    emptyDesc: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: Spacing.lg,
    },
    emptyButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.full,
    },
    emptyButtonText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    swipeDeleteContainer: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingHorizontal: Spacing.xl,
      borderRadius: BorderRadius.lg,
      marginBottom: Spacing.md,
    },
    swipeDeleteText: {
      color: colors.textOnPrimary,
      fontFamily: FontFamily.bold,
      fontSize: FontSize.md,
    },
  });
}
