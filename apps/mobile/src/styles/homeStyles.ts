import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createHomeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 120,
    },
    header: {
      marginBottom: Spacing.xl,
    },
    statsRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginBottom: Spacing.lg,
    },
    statItem: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      alignItems: 'center',
    },
    statCount: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.primary,
    },
    statLabel: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    greeting: {
      fontSize: FontSize.hero,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    subtitle: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
    },
    nextAlarmCard: {
      borderRadius: BorderRadius.xl,
      overflow: 'hidden',
      marginBottom: Spacing.md,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 6,
    },
    nextAlarmGradient: {
      backgroundColor: colors.primary,
      padding: Spacing.lg,
      borderRadius: BorderRadius.xl,
    },
    nextAlarmLabel: {
      fontSize: FontSize.sm,
      color: 'rgba(255,255,255,0.8)',
      fontFamily: FontFamily.semibold,
      marginBottom: Spacing.xs,
    },
    nextAlarmTime: {
      fontSize: 48,
      fontFamily: FontFamily.bold,
      color: colors.textOnPrimary,
      marginBottom: Spacing.sm,
    },
    nextAlarmMessage: {
      fontSize: FontSize.md,
      color: 'rgba(255,255,255,0.9)',
    },
    cheerCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 8,
      elevation: 3,
    },
    cheerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    cheerEmoji: {
      fontSize: 24,
      marginRight: Spacing.sm,
    },
    cheerTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    cheerText: {
      fontSize: FontSize.lg,
      color: colors.text,
      lineHeight: 26,
      marginBottom: Spacing.md,
    },
    cheerFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    cheerVoice: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    playButton: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    quickActions: {
      marginBottom: Spacing.lg,
    },
    sectionTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    actionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.md,
    },
    actionCard: {
      width: '47%',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      alignItems: 'center',
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 2,
    },
    actionEmoji: {
      fontSize: 32,
      marginBottom: Spacing.sm,
    },
    actionLabel: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    loginPrompt: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.xl,
      padding: Spacing.xl,
      alignItems: 'center',
    },
    loginEmoji: {
      fontSize: 48,
      marginBottom: Spacing.md,
    },
    loginTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    loginDesc: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: Spacing.lg,
    },
    loginDivider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginVertical: Spacing.md,
      width: '100%',
    },
    loginDividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: colors.border,
    },
    loginDividerText: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
    },
    statsErrorCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.error + '33',
    },
    statsErrorText: {
      fontSize: FontSize.sm,
      color: colors.error,
      fontFamily: FontFamily.semibold,
    },
    statsErrorRetry: {
      fontSize: FontSize.xs,
      color: colors.primary,
      marginTop: 4,
    },
    characterWidget: {
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
    widgetEmoji: {
      fontSize: 36,
      marginRight: Spacing.md,
    },
    widgetInfo: {
      flex: 1,
    },
    widgetNameRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    widgetName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    widgetLevel: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    widgetStreak: {
      fontSize: FontSize.xs,
      color: colors.warning,
      fontFamily: FontFamily.semibold,
    },
    widgetProgressBg: {
      height: 6,
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.full,
      overflow: 'hidden',
    },
    widgetProgressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.full,
    },
    widgetArrow: {
      fontSize: FontSize.xl,
      color: colors.textTertiary,
      marginLeft: Spacing.sm,
    },
    sectionDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: Spacing.sm,
    },
    recentSection: {
      marginBottom: Spacing.lg,
    },
    recentHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.md,
    },
    viewAllLink: {
      fontSize: FontSize.sm,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    recentItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    recentAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: Spacing.md,
    },
    recentAvatarText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    recentContent: {
      flex: 1,
    },
    recentVoiceName: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    recentText: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      marginTop: 2,
    },
    recentDate: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginLeft: Spacing.sm,
    },
    recentEmpty: {
      paddingVertical: Spacing.xl,
      alignItems: 'center',
    },
    recentEmptyText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    activitySection: {
      marginBottom: Spacing.lg,
    },
    activityItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    activityEmoji: {
      fontSize: 20,
      width: 32,
      textAlign: 'center',
      marginRight: Spacing.sm,
    },
    activityContent: {
      flex: 1,
    },
    activityTypeLabel: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.primary,
      marginBottom: 2,
    },
    activityDesc: {
      fontSize: FontSize.sm,
      color: colors.text,
    },
    activityTime: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginLeft: Spacing.sm,
    },
    activityEmpty: {
      paddingVertical: Spacing.xl,
      alignItems: 'center',
    },
    activityEmptyText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    loginButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.full,
    },
    loginButtonText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
  });
}

export type HomeStyles = ReturnType<typeof createHomeStyles>;
