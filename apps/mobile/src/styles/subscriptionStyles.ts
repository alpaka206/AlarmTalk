import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createSubscriptionStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 120,
    },
    currentPlanCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    currentPlanLabel: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: Spacing.xs,
    },
    currentPlanName: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    expiryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    expiryLabel: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    expiryDate: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    statusBadge: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.sm,
      alignSelf: 'flex-start',
      marginTop: Spacing.sm,
    },
    statusBadgeActive: {
      backgroundColor: colors.success + '20',
    },
    statusBadgeFree: {
      backgroundColor: colors.textSecondary + '20',
    },
    statusText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
    },
    statusTextActive: {
      color: colors.success,
    },
    statusTextFree: {
      color: colors.textSecondary,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: Spacing.sm,
      marginLeft: Spacing.xs,
    },
    planCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    planCardActive: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    planHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    planName: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    planPrice: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.primary,
    },
    planDescription: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    featureList: {
      gap: Spacing.xs,
      marginBottom: Spacing.md,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    featureCheck: {
      fontSize: FontSize.sm,
      color: colors.success,
    },
    featureText: {
      fontSize: FontSize.sm,
      color: colors.text,
      flex: 1,
    },
    checkoutButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm + 2,
      alignItems: 'center',
    },
    checkoutButtonDisabled: {
      opacity: 0.5,
    },
    checkoutButtonText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.surface,
    },
    currentBadge: {
      backgroundColor: colors.primary + '20',
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    currentBadgeText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.primary,
    },
    codeLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.md,
      marginTop: Spacing.sm,
      gap: Spacing.xs,
    },
    codeLinkText: {
      fontSize: FontSize.md,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
}
