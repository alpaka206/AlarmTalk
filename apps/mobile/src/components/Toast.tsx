import { memo, useMemo } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

interface ToastProps {
  message: string | null;
  opacity: Animated.Value;
}

export const Toast = memo(function Toast({ message, opacity }: ToastProps) {
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  if (!message) return null;
  return (
    <Animated.View
      style={[dynStyles.toast, { opacity }]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={dynStyles.toastText}>{message}</Text>
    </Animated.View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    toast: {
      position: 'absolute',
      bottom: 40,
      left: Spacing.lg,
      right: Spacing.lg,
      backgroundColor: colors.primaryDark,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
    },
    toastText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
  });
}
