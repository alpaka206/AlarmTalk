import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createDubTranslateStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: Spacing.lg,
      paddingBottom: 100,
    },
    description: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: Spacing.lg,
    },
    messagePreview: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    messagePreviewLabel: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
      marginBottom: Spacing.xs,
    },
    messagePreviewText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontStyle: 'italic',
      lineHeight: 24,
    },
    sectionTitle: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
      marginTop: Spacing.sm,
    },
    sourceRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginBottom: Spacing.lg,
      flexWrap: 'wrap',
    },
    sourceChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sourceChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    sourceChipText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
    sourceChipTextActive: {
      color: colors.textOnPrimary,
    },
    loader: {
      marginVertical: Spacing.lg,
    },
    langRow: {
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    langItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    langItemActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    langText: {
      fontSize: FontSize.sm,
      color: colors.text,
      fontFamily: FontFamily.medium,
    },
    langTextActive: {
      color: colors.textOnPrimary,
      fontFamily: FontFamily.bold,
    },
    experimentBadge: {
      fontSize: 10,
      color: colors.textTertiary,
      backgroundColor: colors.surfaceVariant,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      overflow: 'hidden',
    },
    progressSection: {
      alignItems: 'center',
      paddingVertical: Spacing.xl,
      gap: Spacing.sm,
    },
    progressText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.primary,
    },
    remainingText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    resultSection: {
      alignItems: 'center',
      paddingVertical: Spacing.xl,
      gap: Spacing.md,
    },
    completeText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.success,
    },
    playResultButton: {
      backgroundColor: colors.primary,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.xl,
      borderRadius: BorderRadius.lg,
    },
    playResultText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
    savedText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    failedText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.error,
    },
    retryButton: {
      borderWidth: 1,
      borderColor: colors.primary,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      borderRadius: BorderRadius.lg,
    },
    retryText: {
      color: colors.primary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
    footer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: Spacing.lg,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    startButton: {
      backgroundColor: colors.primary,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.lg,
      alignItems: 'center',
    },
    startButtonDisabled: {
      opacity: 0.5,
    },
    startButtonText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
  });
}
