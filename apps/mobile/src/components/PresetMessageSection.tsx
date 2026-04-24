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
  recentPresets: string[];
  presetText: string | null;
  onPresetTextSelect: (text: string | null) => void;
  presetCategory: string;
  onCategorySelect: (key: string) => void;
  isPending: boolean;
  onGenerate: () => void;
  formStyles: AlarmFormStyles;
}

export function PresetMessageSection({
  showPreset,
  onTogglePreset,
  readyVoices,
  presetVoiceId,
  onVoiceSelect,
  recentPresets,
  presetText,
  onPresetTextSelect,
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
              onPress={() => router.push('/voice/record')}
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

          {recentPresets.length > 0 && (
            <>
              <Text style={styles.presetLabel}>{t('alarmCreate.recentMessages')}</Text>
              <View style={formStyles.messageList}>
                {recentPresets.map((msg, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[formStyles.messageItem, presetText === msg && formStyles.messageItemSelected]}
                    onPress={() => onPresetTextSelect(msg)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: presetText === msg }}
                    accessibilityLabel={msg}
                  >
                    <View style={formStyles.messageInfo}>
                      <Text style={formStyles.messageText} numberOfLines={2}>"{msg}"</Text>
                    </View>
                    {presetText === msg && <Text style={formStyles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </>
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
                  onPress={() => {
                    onCategorySelect(cat.key);
                    onPresetTextSelect(null);
                  }}
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

          <View style={styles.presetMsgHeader}>
            <Text style={[styles.presetLabel, { marginBottom: 0 }]}>{t('alarmCreate.presetMessages')}</Text>
            <TouchableOpacity
              style={styles.randomBtn}
              onPress={() => {
                const keys = PRESET_CATEGORIES.find((c) => c.key === presetCategory)?.messageKeys;
                if (keys && keys.length > 0) {
                  onPresetTextSelect(t(keys[Math.floor(Math.random() * keys.length)]!));
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={t('alarmCreate.randomMessage')}
            >
              <Text style={styles.randomBtnText}>{t('alarmCreate.randomMessage')}</Text>
            </TouchableOpacity>
          </View>
          <View style={formStyles.messageList}>
            {PRESET_CATEGORIES.find((c) => c.key === presetCategory)?.messageKeys.map((key, i) => {
              const msg = t(key);
              return (
                <TouchableOpacity
                  key={i}
                  style={[formStyles.messageItem, presetText === msg && formStyles.messageItemSelected]}
                  onPress={() => onPresetTextSelect(msg)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: presetText === msg }}
                  accessibilityLabel={msg}
                >
                  <View style={formStyles.messageInfo}>
                    <Text style={formStyles.messageText} numberOfLines={2}>"{msg}"</Text>
                  </View>
                  {presetText === msg && <Text style={formStyles.checkmark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[
              styles.presetGenerateBtn,
              (!presetVoiceId || !presetText || isPending) && formStyles.disabled,
            ]}
            onPress={onGenerate}
            disabled={!presetVoiceId || !presetText || isPending}
            accessibilityRole="button"
            accessibilityLabel={t('alarmCreate.generatePreset')}
            accessibilityState={{ disabled: !presetVoiceId || !presetText || isPending }}
          >
            {isPending ? (
              <ActivityIndicator color="#FFF" size="small" />
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
      width: '48%' as unknown as number,
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
      color: '#FFF',
    },
    presetMsgHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    randomBtn: {
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.xs,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surfaceVariant,
    },
    randomBtnText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.primary,
    },
    presetGenerateBtn: {
      backgroundColor: colors.accent,
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      alignItems: 'center',
      marginTop: Spacing.md,
    },
    presetGenerateText: {
      color: '#FFF',
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
    },
  });
}
