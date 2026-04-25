import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createVoicesStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      padding: Spacing.lg,
      paddingBottom: Spacing.sm,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    subtitle: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    section: {
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    addButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      minHeight: 36,
      justifyContent: 'center',
    },
    addButtonDisabled: {
      backgroundColor: colors.surfaceVariant,
    },
    addButtonText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.textOnPrimary,
    },
    addButtonTextDisabled: {
      color: colors.textTertiary,
    },
    limitMessage: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.md,
      fontFamily: FontFamily.regular,
    },
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    avatarContainer: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    profileInfo: {
      flex: 1,
      marginLeft: Spacing.md,
    },
    profileName: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: BorderRadius.full,
      marginTop: 4,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginRight: 4,
    },
    statusText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
    },
    profileDate: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    deleteButton: {
      padding: Spacing.sm,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    deleteText: {
      fontSize: FontSize.sm,
      color: colors.error,
    },
    familyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.md,
      opacity: 0.85,
    },
    familyAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    familyAvatarText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.textSecondary,
    },
    familyOwnerLabel: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    familyBadge: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontFamily: FontFamily.medium,
    },
    emptyState: {
      alignItems: 'center',
      paddingVertical: Spacing.xxl,
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
    emptyHint: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: Spacing.xs,
    },
    emptyCta: {
      marginTop: Spacing.lg,
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.sm + 4,
      borderRadius: BorderRadius.full,
      minHeight: 44,
      justifyContent: 'center',
    },
    emptyCtaText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.textOnPrimary,
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
    addOptionsOverlay: {
      paddingHorizontal: Spacing.lg,
      marginTop: Spacing.md,
    },
    addOptionsCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 12,
      elevation: 4,
    },
    addOptionsTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    addOptionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
      minHeight: 56,
    },
    addOptionEmoji: {
      fontSize: 28,
      marginRight: Spacing.md,
      width: 36,
      textAlign: 'center',
    },
    addOptionInfo: {
      flex: 1,
    },
    addOptionTitle: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    addOptionDesc: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    addOptionCancel: {
      alignItems: 'center',
      paddingVertical: Spacing.md,
      marginTop: Spacing.xs,
      minHeight: 44,
      justifyContent: 'center',
    },
    addOptionCancelText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
  });
}
