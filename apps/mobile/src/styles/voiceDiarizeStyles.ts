import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createVoiceDiarizeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 120,
    },
    stepHeader: {
      marginBottom: Spacing.lg,
    },
    stepBadge: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      backgroundColor: colors.primaryLight + '40',
      alignSelf: 'flex-start',
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.sm,
      marginBottom: Spacing.sm,
    },
    stepTitle: {
      fontSize: FontSize.xxl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    stepDesc: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      lineHeight: 22,
    },
    pickButton: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.xl,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.primary,
      borderStyle: 'dashed',
      marginBottom: Spacing.lg,
    },
    pickEmoji: {
      fontSize: 48,
      marginBottom: Spacing.sm,
    },
    pickText: {
      fontSize: FontSize.md,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    analyzeButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    analyzeText: {
      color: '#FFF',
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    speakerCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    speakerCardSelected: {
      borderColor: colors.primary,
    },
    speakerAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.md,
    },
    speakerAvatarText: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    speakerInfo: {
      flex: 1,
    },
    speakerLabel: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    speakerDuration: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: 2,
    },
    speakerSegments: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
    },
    speakerPlay: {
      fontSize: FontSize.sm,
      color: colors.primary,
    },
    nameInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      fontSize: FontSize.lg,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.lg,
    },
    submitButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    disabled: {
      opacity: 0.5,
    },
    submitText: {
      color: '#FFF',
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    backButton: {
      alignItems: 'center',
      padding: Spacing.md,
    },
    backText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
    },
  });
}
