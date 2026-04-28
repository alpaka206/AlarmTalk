import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createSettingsStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 120,
    },
    title: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.lg,
    },
    section: {
      marginBottom: Spacing.lg,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      marginBottom: Spacing.sm,
      marginLeft: Spacing.xs,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      paddingHorizontal: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    settingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Spacing.md,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    settingLabel: {
      fontSize: FontSize.md,
      color: colors.text,
    },
    logoutButton: {
      alignItems: 'center',
      paddingVertical: Spacing.md,
      marginTop: Spacing.lg,
    },
    logoutText: {
      fontSize: FontSize.md,
      color: colors.error,
      fontFamily: FontFamily.semibold,
    },
    deleteAccountButton: {
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      marginTop: Spacing.xs,
    },
    deleteAccountText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    deleteDialog: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginTop: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.error,
    },
    deleteDialogTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.error,
      marginBottom: Spacing.sm,
    },
    deleteDialogWarning: {
      fontSize: FontSize.sm,
      color: colors.text,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    deleteDialogPrompt: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    deleteDialogInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    deleteDialogButtons: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    deleteDialogCancel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceVariant,
    },
    deleteDialogCancelText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    deleteDialogConfirm: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.error,
    },
    deleteDialogConfirmText: {
      fontSize: FontSize.md,
      color: colors.surface,
      fontFamily: FontFamily.semibold,
    },
    disabled: {
      opacity: 0.5,
    },
    appFooter: {
      alignItems: 'center',
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.md,
    },
    footerAppName: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      marginBottom: Spacing.xs,
    },
    footerDescription: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      marginBottom: Spacing.xs,
    },
    footerCopyright: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
  });
}
