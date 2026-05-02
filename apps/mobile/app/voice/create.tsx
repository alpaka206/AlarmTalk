import { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';

/**
 * Unified entry point for creating a voice profile.
 * Two paths: live recording, or file upload (with optional diarization for
 * multi-speaker recordings such as call recordings).
 */
export default function CreateVoiceScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{t('voiceCreate.intro')}</Text>

      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push('/voice/record')}
        accessibilityRole="button"
        accessibilityLabel={t('voiceCreate.recordTitle')}
      >
        <Text style={styles.cardEmoji}>🎙️</Text>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{t('voiceCreate.recordTitle')}</Text>
          <Text style={styles.cardDesc}>{t('voiceCreate.recordDesc')}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push('/voice/upload')}
        accessibilityRole="button"
        accessibilityLabel={t('voiceCreate.uploadTitle')}
      >
        <Text style={styles.cardEmoji}>📁</Text>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{t('voiceCreate.uploadTitle')}</Text>
          <Text style={styles.cardDesc}>{t('voiceCreate.uploadDesc')}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    intro: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: Spacing.sm,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    cardEmoji: {
      fontSize: 36,
    },
    cardBody: {
      flex: 1,
    },
    cardTitle: {
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: 4,
    },
    cardDesc: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    chevron: {
      fontSize: 28,
      color: colors.textTertiary,
    },
  });
}
