import { useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { resolveStateView, type StateViewVariant } from '../lib/stateView';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

interface StateViewProps {
  variant: StateViewVariant;
  emoji?: string;
  title?: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
}

export function StateView({ variant, emoji, title, subtitle, action }: StateViewProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  const cfg = resolveStateView(variant, t, { emoji, title, subtitle });

  return (
    <View
      style={dynStyles.container}
      accessibilityRole={variant === 'error' ? 'alert' : 'none'}
    >
      {variant === 'loading' ? (
        <ActivityIndicator size="large" color={colors.primary} style={dynStyles.spinner} />
      ) : (
        <Text style={dynStyles.emoji}>{cfg.emoji}</Text>
      )}
      <Text style={dynStyles.title}>{cfg.title}</Text>
      {cfg.subtitle ? (
        <Text style={dynStyles.subtitle}>{cfg.subtitle}</Text>
      ) : null}
      {action && (
        <Pressable
          onPress={action.onPress}
          style={dynStyles.actionButton}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={dynStyles.actionText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 200,
      padding: Spacing.lg,
    },
    spinner: {
      marginBottom: Spacing.md,
    },
    emoji: {
      fontSize: 40,
      marginBottom: Spacing.md,
    },
    title: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginBottom: Spacing.xs,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.md,
      textAlign: 'center',
    },
    actionButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
      minHeight: 44,
      justifyContent: 'center',
    },
    actionText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
    },
  });
}
