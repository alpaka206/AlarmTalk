import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createVoiceDetailStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    profileHeader: {
      alignItems: 'center',
      paddingVertical: Spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    avatarLarge: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    avatarText: {
      fontSize: 32,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    profileName: {
      fontSize: FontSize.xxl,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    profileDate: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      marginTop: Spacing.xs,
    },
    renameBtn: {
      marginTop: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
    },
    renameText: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    renameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      marginTop: Spacing.xs,
    },
    renameInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 6,
      fontSize: FontSize.md,
      color: colors.text,
    },
    renameSaveBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: 6,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.sm,
    },
    renameSaveText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.sm,
      fontFamily: FontFamily.bold,
    },
    renameCancelBtn: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 6,
    },
    renameCancelText: {
      color: colors.textSecondary,
      fontSize: FontSize.sm,
    },
    statsRow: {
      flexDirection: 'row',
      gap: Spacing.xl,
      marginTop: Spacing.md,
    },
    statItem: {
      alignItems: 'center',
    },
    statValue: {
      fontSize: FontSize.xxl,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    statLabel: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    list: {
      padding: Spacing.lg,
    },
    sectionTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    itemCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    itemCategory: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    itemText: {
      fontSize: FontSize.md,
      color: colors.text,
      lineHeight: 22,
    },
    itemDate: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 4,
    },
    alarmTime: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.regular,
      color: colors.text,
      marginBottom: 4,
    },
    inactive: {
      color: colors.error,
    },
    createMessageBtn: {
      marginTop: Spacing.md,
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.lg,
    },
    createMessageText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
    empty: {
      alignItems: 'center',
      paddingVertical: Spacing.xxl,
    },
    emptyText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
    },
  });
}
