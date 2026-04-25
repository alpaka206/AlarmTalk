import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export function createMessageCreateStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 120,
    },
    sectionTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    emptyVoice: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    emptyVoiceText: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    voiceRow: {
      marginBottom: Spacing.lg,
    },
    voiceChip: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginRight: Spacing.sm,
      borderWidth: 2,
      borderColor: 'transparent',
      minWidth: 80,
    },
    voiceChipSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceVariant,
    },
    voiceChipAvatar: {
      fontSize: 24,
      fontFamily: FontFamily.bold,
      color: colors.primary,
      marginBottom: 4,
    },
    voiceChipName: {
      fontSize: FontSize.sm,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    voiceChipNameSelected: {
      color: colors.primary,
    },
    tabRow: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: 4,
      marginBottom: Spacing.lg,
    },
    tab: {
      flex: 1,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.sm,
      alignItems: 'center',
    },
    tabActive: {
      backgroundColor: colors.primary,
    },
    tabText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
    tabTextActive: {
      color: colors.textOnPrimary,
    },
    categoryRow: {
      marginBottom: Spacing.md,
    },
    categoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginRight: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    categoryChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    categoryEmoji: {
      fontSize: 16,
      marginRight: 4,
    },
    categoryLabel: {
      fontSize: FontSize.sm,
      color: colors.text,
      fontFamily: FontFamily.semibold,
    },
    categoryLabelActive: {
      color: colors.textOnPrimary,
    },
    presetList: {
      gap: Spacing.sm,
      marginBottom: Spacing.lg,
    },
    presetItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    presetItemSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceVariant,
    },
    presetText: {
      flex: 1,
      fontSize: FontSize.md,
      color: colors.text,
    },
    presetTextSelected: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    checkmark: {
      fontSize: FontSize.lg,
      color: colors.primary,
      fontFamily: FontFamily.bold,
    },
    customSection: {
      marginBottom: Spacing.lg,
    },
    customInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 120,
    },
    charCount: {
      textAlign: 'right',
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: Spacing.xs,
    },
    generateButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      alignItems: 'center',
      marginBottom: Spacing.lg,
    },
    disabled: {
      opacity: 0.5,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    generateText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    resultCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.success + '40',
    },
    resultTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.success,
      marginBottom: Spacing.sm,
    },
    resultMessage: {
      fontSize: FontSize.md,
      color: colors.text,
      marginBottom: Spacing.md,
    },
    resultActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    previewButton: {
      flex: 1,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      padding: Spacing.sm,
      alignItems: 'center',
    },
    previewText: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    useButton: {
      flex: 1,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.primary,
      padding: Spacing.sm,
      alignItems: 'center',
    },
    useText: {
      color: colors.textOnPrimary,
      fontFamily: FontFamily.semibold,
    },
    giftButton: {
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.accent,
      padding: Spacing.sm + 2,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    giftText: {
      color: colors.accent,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.md,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: colors.background,
      borderTopLeftRadius: BorderRadius.xl,
      borderTopRightRadius: BorderRadius.xl,
      padding: Spacing.lg,
      maxHeight: '70%',
    },
    modalTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    modalSubtitle: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      marginBottom: Spacing.md,
    },
    giftNoteInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.md,
    },
    friendList: {
      maxHeight: 300,
    },
    friendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
      marginBottom: Spacing.sm,
    },
    friendAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
    friendAvatarText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.primaryDark,
    },
    friendInfo: {
      marginLeft: Spacing.md,
      flex: 1,
    },
    friendName: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    friendEmail: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
    },
    modalCancel: {
      alignItems: 'center',
      paddingVertical: Spacing.md,
      marginTop: Spacing.sm,
    },
    modalCancelText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      fontFamily: FontFamily.semibold,
    },
  });
}
