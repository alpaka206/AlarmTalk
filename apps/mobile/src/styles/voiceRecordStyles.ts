import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createVoiceRecordStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
    },
    permissionText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    guideSection: {
      padding: Spacing.lg,
    },
    guideTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    guideSentence: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: Spacing.sm,
    },
    guideNumber: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.primaryLight,
      color: colors.primaryDark,
      textAlign: 'center',
      lineHeight: 24,
      fontSize: FontSize.sm,
      fontFamily: FontFamily.bold,
      marginRight: Spacing.sm,
    },
    guideText: {
      flex: 1,
      fontSize: FontSize.md,
      color: colors.text,
      lineHeight: 22,
    },
    guideTip: {
      fontSize: FontSize.sm,
      color: colors.primary,
      marginTop: Spacing.md,
    },
    recordSection: {
      alignItems: 'center',
      paddingVertical: Spacing.xl,
    },
    timer: {
      fontSize: 48,
      fontFamily: FontFamily.regular,
      color: colors.text,
      marginBottom: Spacing.lg,
    },
    recordButtonOuter: {
      marginBottom: Spacing.md,
    },
    recordButton: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 12,
      elevation: 8,
    },
    recordButtonActive: {
      backgroundColor: colors.error,
    },
    stopIcon: {
      width: 24,
      height: 24,
      borderRadius: 4,
      backgroundColor: colors.surface,
    },
    micIcon: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    levelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 44,
      gap: 2,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.lg,
    },
    levelBar: {
      width: 3,
      borderRadius: 1.5,
      minHeight: 3,
    },
    recordHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    resultSection: {
      padding: Spacing.lg,
    },
    resultTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.success,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
    nameInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.md,
    },
    submitButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
  });
}
