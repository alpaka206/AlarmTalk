import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createComposeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingBottom: 100,
    },
    header: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    actionsRow: {
      paddingHorizontal: Spacing.lg,
      gap: Spacing.md,
      marginBottom: Spacing.lg,
    },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    actionEmoji: {
      fontSize: 32,
      marginRight: Spacing.md,
    },
    actionInfo: {
      flex: 1,
    },
    actionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    actionDesc: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    unreadBadge: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      minWidth: 20,
      height: 20,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: Spacing.xs,
      paddingHorizontal: 6,
    },
    unreadBadgeText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.bold,
      color: '#fff',
    },
    loader: {
      marginTop: Spacing.lg,
    },
    noteCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginHorizontal: Spacing.lg,
      marginBottom: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    noteCardUnread: {
      borderColor: colors.primary,
      borderWidth: 1.5,
    },
    noteHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.xs,
    },
    noteAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.sm,
    },
    noteAvatarText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    noteInfo: {
      flex: 1,
    },
    noteSender: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    noteTime: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    noteText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.regular,
      color: colors.text,
      lineHeight: 22,
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
    emptyHint: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: Spacing.xs,
    },
    emptyNotes: {
      alignItems: 'center',
      paddingVertical: Spacing.xl,
    },
    emptyNotesEmoji: {
      fontSize: 36,
      marginBottom: Spacing.sm,
    },
    emptyNotesText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
  });
}
