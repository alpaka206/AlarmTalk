import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createLibraryStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    filterRow: {
      flexDirection: 'row',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      gap: Spacing.sm,
    },
    categoryRow: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
      gap: Spacing.xs,
    },
    categoryChip: {
      paddingHorizontal: Spacing.sm + 4,
      paddingVertical: Spacing.xs + 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: Spacing.xs,
    },
    categoryChipActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    categoryChipText: {
      fontSize: FontSize.xs,
      color: colors.text,
      fontFamily: FontFamily.medium,
    },
    filterChip: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
    filterTextActive: {
      color: '#FFF',
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
    },
    messageCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    messageLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    avatarSmall: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.md,
    },
    avatarLetter: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    messageContent: {
      flex: 1,
    },
    messageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    voiceName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    categoryBadge: {
      fontSize: 14,
    },
    messageText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
      lineHeight: 18,
    },
    miniPlayerRow: {
      marginTop: Spacing.xs,
    },
    messageDate: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 4,
    },
    messageActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    favoriteIcon: {
      fontSize: 20,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyEmoji: {
      fontSize: 64,
      marginBottom: Spacing.md,
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
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
      color: colors.surface,
    },
    swipeDeleteContainer: {
      backgroundColor: colors.error,
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingHorizontal: Spacing.xl,
      borderRadius: BorderRadius.lg,
      marginBottom: Spacing.sm,
    },
    swipeDeleteText: {
      color: '#FFF',
      fontFamily: FontFamily.bold,
      fontSize: FontSize.md,
    },
  });
}
