import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import { PRESET_CATEGORIES, getCategoryLabel } from '../constants/presets';
import type { VoiceProfile } from '../types';
import type { AlarmFormStyles } from '../styles/alarmFormStyles';
import { useMemo } from 'react';

interface Props {
  showPreset: boolean;
  onTogglePreset: () => void;
  readyVoices: VoiceProfile[];
  presetVoiceId: string | null;
  onVoiceSelect: (id: string) => void;
  presetCategory: string;
  onCategorySelect: (key: string) => void;
  isPending: boolean;
  /** Receives the randomly-picked text for the chosen category. */
  onGenerate: (text: string) => void;
  formStyles: AlarmFormStyles;
}

export function PresetMessageSection({
  showPreset,
  onTogglePreset,
  readyVoices,
  presetVoiceId,
  onVoiceSelect,
  presetCategory,
  onCategorySelect,
  isPending,
  onGenerate,
  formStyles,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createLocalStyles(colors), [colors]);

  const handleGenerateRandom = () => {
    const cat = PRESET_CATEGORIES.find((c) => c.key === presetCategory);
    if (!cat || cat.messageKeys.length === 0) return;
    const randomKey = cat.messageKeys[Math.floor(Math.random() * cat.messageKeys.length)]!;
    onGenerate(t(randomKey));
  };

  const canGenerate = !!presetVoiceId && !isPending;

  return (
    <>
      <TouchableOpacity
        style={styles.presetToggle}
        onPress={onTogglePreset}
        accessibilityRole="button"
        accessibilityState={{ expanded: showPreset }}
        accessibilityLabel={t('alarmCreate.quickCreate')}
      >
        <Text style={styles.presetToggleText}>
          {showPreset ? '▲' : '▼'} {t('alarmCreate.quickCreate')}
        </Text>
      </TouchableOpacity>

      {showPreset && (
        <View style={styles.presetSection}>
          <Text style={styles.presetLabel}>{t('alarmCreate.selectVoice')}</Text>
          {readyVoices.length === 0 ? (
            <TouchableOpacity
              style={styles.emptyVoice}
              onPress={() => router.push('/voice/create')}
              accessibilityRole="button"
              accessibilityLabel={t('alarmCreate.emptyVoice')}
            >
              <Text style={styles.emptyVoiceText}>{t('alarmCreate.emptyVoice')}</Text>
            </TouchableOpacity>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {readyVoices.map((v) => (
                <TouchableOpacity
                  key={v.id}
                  style={[formStyles.voiceChip, presetVoiceId === v.id && formStyles.voiceChipActive]}
                  onPress={() => onVoiceSelect(v.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: presetVoiceId === v.id }}
                  accessibilityLabel={v.name}
                >
                  <Text style={[formStyles.voiceText, presetVoiceId === v.id && formStyles.voiceTextActive]}>
                    {v.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <Text style={styles.presetLabel}>{t('alarmCreate.presetCategory')}</Text>
          <View style={styles.categoryGrid}>
            {PRESET_CATEGORIES.map((cat) => {
              const selected = presetCategory === cat.key;
              const label = getCategoryLabel(cat, t);
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[styles.categoryCard, selected && styles.categoryCardActive]}
                  onPress={() => onCategorySelect(cat.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                >
                  <Text style={styles.categoryEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.categoryLabel, selected && styles.categoryLabelActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[
              styles.presetGenerateBtn,
              !canGenerate && formStyles.disabled,
            ]}
            onPress={handleGenerateRandom}
            disabled={!canGenerate}
            accessibilityRole="button"
            accessibilityLabel={t('alarmCreate.generatePreset')}
            accessibilityState={{ disabled: !canGenerate }}
          >
            {isPending ? (
              <ActivityIndicator color={colors.textOnPrimary} size="small" />
            ) : (
              <Text style={styles.presetGenerateText}>{t('alarmCreate.generatePreset')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </>
  );
}

function createLocalStyles(colors: ThemeColors) {
  return StyleSheet.create({
    presetToggle: {
      marginTop: Spacing.md,
      paddingVertical: Spacing.sm,
      alignItems: 'center',
    },
    presetToggleText: {
      fontSize: FontSize.md,
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    presetSection: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginTop: Spacing.sm,
    },
    presetLabel: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
      marginTop: Spacing.sm,
    },
    presetRow: {
      marginBottom: Spacing.sm,
    },
    emptyVoice: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.lg,
      padding: Spacing.lg,
      alignItems: 'center',
    },
    emptyVoiceText: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    categoryGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    categoryCard: {
      width: '48%',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      gap: Spacing.sm,
    },
    categoryCardActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    categoryEmoji: {
      fontSize: 24,
    },
    categoryLabel: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
    },
    categoryLabelActive: {
      color: colors.textOnPrimary,
    },
    presetGenerateBtn: {
      backgroundColor: colors.accent,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      alignItems: 'center',
      marginTop: Spacing.md,
    },
    presetGenerateText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
    },
  });
}
