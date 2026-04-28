import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createCharacterStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: Spacing.lg,
      paddingBottom: 100,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.lg,
    },
    errorText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    characterCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.xl,
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    emoji: {
      fontSize: 72,
      marginBottom: Spacing.md,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    characterName: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    badge: {
      backgroundColor: `${colors.primary}20`,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
    },
    badgeText: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    dialogue: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    streakCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      alignItems: 'center',
    },
    streakMain: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: Spacing.xs,
    },
    streakFire: {
      fontSize: 28,
    },
    streakCount: {
      fontSize: 36,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    streakLabel: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.medium,
      color: colors.textSecondary,
    },
    streakMeta: {
      marginTop: Spacing.xs,
    },
    streakBest: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    milestoneRow: {
      flexDirection: 'row',
      gap: Spacing.lg,
      marginTop: Spacing.md,
    },
    milestoneBadge: {
      alignItems: 'center',
      opacity: 0.35,
    },
    milestoneBadgeAchieved: {
      opacity: 1,
    },
    milestoneEmoji: {
      fontSize: 28,
    },
    milestoneDay: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.textTertiary,
      marginTop: 2,
    },
    milestoneDayAchieved: {
      color: colors.primary,
    },
    section: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    progressHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: Spacing.sm,
    },
    progressText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    progressBarBg: {
      height: 10,
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.full,
      overflow: 'hidden',
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.full,
    },
    xpStatsRow: {
      flexDirection: 'row',
      marginTop: Spacing.md,
    },
    xpStatItem: {
      flex: 1,
      alignItems: 'center',
    },
    xpStatLabel: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginBottom: 2,
    },
    xpStatValue: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    statBarsContainer: {
      marginTop: Spacing.md,
      gap: Spacing.sm,
    },
    statBarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    statBarLabel: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      width: 80,
    },
    statBarTrack: {
      flex: 1,
      height: 8,
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.full,
      overflow: 'hidden',
    },
    statBarFill: {
      height: '100%',
      borderRadius: BorderRadius.full,
    },
    statBarValue: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      width: 30,
      textAlign: 'right',
    },
    devHint: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: Spacing.xs,
      marginBottom: Spacing.md,
    },
    devButtonsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    devButton: {
      backgroundColor: `${colors.primary}15`,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.sm,
      minHeight: 44,
      justifyContent: 'center',
    },
    devButtonDisabled: {
      opacity: 0.5,
    },
    devButtonText: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    grantNotice: {
      marginTop: Spacing.md,
      fontSize: FontSize.xs,
      color: colors.textSecondary,
    },
  });
}
