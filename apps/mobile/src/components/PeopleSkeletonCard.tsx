import { memo, useEffect, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

function usePulse() {
  const opacity = useMemo(() => new Animated.Value(0.3), []);
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return opacity;
}

function SkeletonRow({ dynStyles }: { dynStyles: ReturnType<typeof createStyles> }) {
  const opacity = usePulse();
  return (
    <View style={dynStyles.card}>
      <Animated.View style={[dynStyles.avatar, { opacity }]} />
      <View style={dynStyles.info}>
        <Animated.View style={[dynStyles.namePlaceholder, { opacity }]} />
        <Animated.View style={[dynStyles.emailPlaceholder, { opacity }]} />
      </View>
      <Animated.View style={[dynStyles.actionPlaceholder, { opacity }]} />
    </View>
  );
}

interface Props {
  count?: number;
}

export const PeopleSkeletonCard = memo(function PeopleSkeletonCard({ count = 3 }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={dynStyles.container} accessibilityRole="progressbar" accessibilityLabel={t('common.loading')}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} dynStyles={dynStyles} />
      ))}
    </View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
    },
    card: {
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
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surfaceVariant,
      marginRight: Spacing.md,
    },
    info: {
      flex: 1,
      gap: Spacing.xs + 2,
    },
    namePlaceholder: {
      width: 100,
      height: 14,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surfaceVariant,
    },
    emailPlaceholder: {
      width: 150,
      height: 12,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.surfaceVariant,
    },
    actionPlaceholder: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceVariant,
    },
  });
}
