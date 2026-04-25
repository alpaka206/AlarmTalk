import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { FontSize, Spacing, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';

export function OfflineBanner() {
  const isConnected = useNetworkStatus();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);

  if (isConnected) return null;

  return (
    <View
      style={dynStyles.banner}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={dynStyles.text}>{t('offline.banner')}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    banner: {
      backgroundColor: colors.warning,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
    },
    text: {
      color: '#FFFFFF',
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
    },
  });
}
