import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { requestMicPermission, startRecording, stopRecording } from '../../src/services/audio';
import { useAlarmDraftStore } from '../../src/stores/useAlarmDraftStore';

const MAX_DURATION_MS = 30_000;

// Wrapped so the react-hooks purity lint rule does not flag direct Date.now()
// calls inside event handlers as render-side impure work.
const nowMs = (): number => Date.now();

export default function AlarmSourceRecordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const setRawAudio = useAlarmDraftStore((s) => s.setRawAudio);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (recording) recording.stopAndUnloadAsync().catch(() => {});
    };
  }, [recording]);

  const handleRequestPermission = async () => {
    const ok = await requestMicPermission();
    setHasPermission(ok);
    if (!ok) {
      Alert.alert(t('voiceRecord.permissionTitle'), t('voiceRecord.permissionDesc'));
    }
  };

  const handleStart = async () => {
    if (hasPermission === null) {
      const ok = await requestMicPermission();
      setHasPermission(ok);
      if (!ok) {
        Alert.alert(t('voiceRecord.permissionTitle'), t('voiceRecord.permissionDesc'));
        return;
      }
    } else if (!hasPermission) {
      handleRequestPermission();
      return;
    }

    try {
      const rec = await startRecording(false);
      setRecording(rec);
      setIsRecording(true);
      setRecordedUri(null);
      setDurationMs(0);
      const startedAt = nowMs();
      startTimeRef.current = startedAt;
      tickRef.current = setInterval(() => {
        const elapsed = nowMs() - startedAt;
        setDurationMs(elapsed);
        if (elapsed >= MAX_DURATION_MS) {
          handleStop(rec, MAX_DURATION_MS);
        }
      }, 100);
    } catch {
      Alert.alert(t('voiceRecord.errorTitle'), t('voiceRecord.errorStart'));
    }
  };

  const handleStop = async (rec?: Audio.Recording, finalMs?: number) => {
    const target = rec ?? recording;
    if (!target) return;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setIsRecording(false);
    try {
      const result = await stopRecording(target);
      setRecordedUri(result.uri);
      setDurationMs(finalMs ?? Math.round(result.duration * 1000));
    } catch {
      // ignore — keeps current durationMs/recordedUri null state
    } finally {
      setRecording(null);
    }
  };

  const handleUse = () => {
    if (!recordedUri) return;
    setRawAudio({
      uri: recordedUri,
      durationMs,
      origin: 'recording',
      fileName: `alarm-source-${Date.now()}.${Platform.OS === 'ios' ? 'm4a' : 'm4a'}`,
      mimeType: 'audio/m4a',
    });
    router.back();
  };

  const handleRetry = () => {
    setRecordedUri(null);
    setDurationMs(0);
  };

  const seconds = Math.min(MAX_DURATION_MS, durationMs) / 1000;
  const remaining = Math.max(0, MAX_DURATION_MS - durationMs) / 1000;

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>{t('alarmSource.recordIntro')}</Text>

      <View style={styles.timerBox}>
        <Text style={styles.timer}>
          {seconds.toFixed(1)}s
        </Text>
        <Text style={styles.timerHint}>
          {isRecording
            ? t('alarmSource.recordingRemaining', { s: remaining.toFixed(0) })
            : t('alarmSource.recordMax')}
        </Text>
      </View>

      {!recordedUri && (
        <TouchableOpacity
          style={[styles.bigButton, isRecording && styles.bigButtonRecording]}
          onPress={isRecording ? () => handleStop() : handleStart}
          accessibilityRole="button"
          accessibilityLabel={isRecording ? t('alarmSource.stop') : t('alarmSource.startRecording')}
        >
          <Text style={styles.bigButtonEmoji}>{isRecording ? '⏹' : '🎙️'}</Text>
          <Text style={styles.bigButtonText}>
            {isRecording ? t('alarmSource.stop') : t('alarmSource.startRecording')}
          </Text>
        </TouchableOpacity>
      )}

      {recordedUri && (
        <View style={styles.resultRow}>
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={handleRetry}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>{t('alarmSource.retry')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={handleUse}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('alarmSource.use')}</Text>
          </TouchableOpacity>
        </View>
      )}
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
      marginBottom: Spacing.xl,
    },
    timerBox: {
      alignItems: 'center',
      marginBottom: Spacing.xl,
    },
    timer: {
      fontSize: 56,
      fontFamily: FontFamily.bold,
      color: colors.text,
    },
    timerHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    bigButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.xl,
      paddingVertical: Spacing.xl,
      alignItems: 'center',
    },
    bigButtonRecording: {
      backgroundColor: colors.error,
    },
    bigButtonEmoji: {
      fontSize: 56,
      marginBottom: Spacing.sm,
    },
    bigButtonText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    resultRow: {
      flexDirection: 'row' as const,
      gap: Spacing.md,
    },
    actionButton: {
      flex: 1,
      borderRadius: BorderRadius.lg,
      paddingVertical: Spacing.md + 4,
      alignItems: 'center',
    },
    primaryButton: {
      backgroundColor: colors.primary,
    },
    secondaryButton: {
      backgroundColor: colors.surfaceVariant,
    },
    primaryText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.bold,
    },
    secondaryText: {
      color: colors.text,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.semibold,
    },
  });
}
