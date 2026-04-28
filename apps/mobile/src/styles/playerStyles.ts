import { StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import type { ThemeColors } from '../hooks/useTheme';

export const WAVEFORM_BAR_COUNT = 48;
export const WAVEFORM_BAR_WIDTH = 3;
export const WAVEFORM_BAR_GAP = 2;
export const WAVEFORM_HEIGHT = 56;
export const WAVEFORM_TOTAL_WIDTH = WAVEFORM_BAR_COUNT * (WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP);
export const ACTIVE_PULSE_RANGE = 3;

export function createPlayerStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    closeButton: {
      position: 'absolute',
      top: 60,
      right: Spacing.lg,
      zIndex: 10,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.1)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    closeText: {
      fontSize: 18,
      color: colors.text,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: Spacing.xl,
    },
    categoryEmoji: {
      fontSize: 64,
      marginBottom: Spacing.xl,
    },
    profileSection: {
      alignItems: 'center',
      marginBottom: Spacing.xl,
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.md,
      shadowColor: colors.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 8,
    },
    avatarText: {
      fontSize: 32,
      fontFamily: FontFamily.bold,
      color: colors.textOnPrimary,
    },
    voiceName: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    messageText: {
      fontSize: FontSize.xxl,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      textAlign: 'center',
      lineHeight: 38,
      marginBottom: Spacing.xxl,
    },
    waveformContainer: {
      width: '100%',
      marginBottom: Spacing.lg,
      paddingHorizontal: Spacing.md,
    },
    waveformBars: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: WAVEFORM_HEIGHT,
      position: 'relative',
    },
    waveformBarTouch: {
      width: WAVEFORM_BAR_WIDTH + WAVEFORM_BAR_GAP,
      height: WAVEFORM_HEIGHT,
      justifyContent: 'center',
      alignItems: 'center',
    },
    waveformBar: {
      width: WAVEFORM_BAR_WIDTH,
      borderRadius: WAVEFORM_BAR_WIDTH / 2,
    },
    playhead: {
      position: 'absolute',
      left: 0,
      top: -2,
      width: 2,
      height: WAVEFORM_HEIGHT + 4,
      backgroundColor: colors.primaryDark,
      borderRadius: 1,
    },
    timeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: Spacing.xs,
    },
    timeText: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    playButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.xl,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    playIcon: {
      fontSize: 28,
    },
    reactionButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.xl,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.full,
    },
    reactionText: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
      color: colors.textOnPrimary,
    },
    reactedText: {
      fontSize: FontSize.md,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
  });
}
