import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useAlarmDraftStore } from '../../src/stores/useAlarmDraftStore';

const MAX_DURATION_MS = 30_000;

export default function AlarmSourceUploadScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setRawAudio = useAlarmDraftStore((s) => s.setRawAudio);

  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const probeDuration = async (uri: string): Promise<number> => {
    const { sound, status } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
    try {
      if (status.isLoaded && typeof status.durationMillis === 'number') {
        return status.durationMillis;
      }
      return 0;
    } finally {
      await sound.unloadAsync();
    }
  };

  const handlePick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*', 'video/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const file = result.assets[0]!;
    setChecking(true);
    setPicked(file);
    setDurationMs(null);
    try {
      const ms = await probeDuration(file.uri);
      setDurationMs(ms);
      if (ms > MAX_DURATION_MS) {
        Alert.alert(
          t('alarmSource.tooLongTitle'),
          t('alarmSource.tooLongDesc', { sec: Math.round(ms / 1000) }),
        );
      }
    } catch {
      // length probe failed; allow user to retry but disable Use until known
    } finally {
      setChecking(false);
    }
  };

  const handleUse = () => {
    if (!picked || durationMs == null) return;
    if (durationMs > MAX_DURATION_MS) {
      Alert.alert(
        t('alarmSource.tooLongTitle'),
        t('alarmSource.tooLongDesc', { sec: Math.round(durationMs / 1000) }),
      );
      return;
    }
    setRawAudio({
      uri: picked.uri,
      durationMs,
      origin: 'upload',
      fileName: picked.name,
      mimeType: picked.mimeType ?? 'audio/m4a',
    });
    router.back();
  };

  const overLimit = durationMs != null && durationMs > MAX_DURATION_MS;
  const useDisabled = !picked || durationMs == null || overLimit || checking;

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>{t('alarmSource.uploadIntro')}</Text>

      <TouchableOpacity
        style={styles.pickBox}
        onPress={handlePick}
        accessibilityRole="button"
        accessibilityLabel={t('alarmSource.pickFile')}
      >
        <Text style={styles.pickEmoji}>📁</Text>
        <Text style={styles.pickText}>{picked ? picked.name : t('alarmSource.pickFile')}</Text>
        {durationMs != null && (
          <Text style={[styles.pickHint, overLimit && styles.pickHintError]}>
            {(durationMs / 1000).toFixed(1)}s {overLimit ? `(>${MAX_DURATION_MS / 1000}s)` : ''}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.useButton, useDisabled && styles.disabled]}
        onPress={handleUse}
        disabled={useDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: useDisabled }}
      >
        <Text style={styles.useButtonText}>{t('alarmSource.use')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
      padding: Spacing.lg,
    },
    intro: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: Spacing.lg,
    },
    pickBox: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.xl,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: colors.border,
      borderStyle: 'dashed',
      marginBottom: Spacing.lg,
    },
    pickEmoji: {
      fontSize: 48,
      marginBottom: Spacing.sm,
    },
    pickText: {
      fontSize: FontSize.md,
      color: colors.text,
      fontFamily: FontFamily.semibold,
      textAlign: 'center',
    },
    pickHint: {
      marginTop: Spacing.xs,
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    pickHintError: {
      color: colors.error,
    },
    useButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md,
      alignItems: 'center',
    },
    useButtonText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
