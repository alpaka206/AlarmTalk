import { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/hooks/useTheme';
import { requestMicPermission, startRecording, stopRecording } from '../../src/services/audio';
import { createVoiceClone } from '../../src/services/api';
import { getApiErrorMessage } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { createVoiceRecordStyles } from '../../src/styles/voiceRecordStyles';

const LEVEL_HISTORY_SIZE = 20;

function dbToNormalized(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
}

export default function RecordScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = createVoiceRecordStyles(colors);
  const guideSentences = t('voiceRecord.sentences', { returnObjects: true }) as string[];
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [name, setName] = useState('');
  const [levelHistory, setLevelHistory] = useState<number[]>(
    () => new Array(LEVEL_HISTORY_SIZE).fill(0),
  );

  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meteringRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    requestMicPermission().then(setHasPermission);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (meteringRef.current) clearInterval(meteringRef.current);
    };
  }, []);

  const cloneMutation = useMutation({
    mutationFn: (params: { uri: string; name: string }) =>
      createVoiceClone(
        { uri: params.uri, name: 'recording.wav', type: 'audio/wav' },
        params.name,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voiceProfiles'] });
      Alert.alert(t('voiceRecord.successTitle'), t('voiceRecord.successDesc'), [
        { text: t('common.confirm'), onPress: () => router.back() },
      ]);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('voiceRecord.cloneError')));
    },
  });

  const handleStartRecording = async () => {
    try {
      const rec = await startRecording(true);
      setRecording(rec);
      setIsRecording(true);
      setDuration(0);
      setLevelHistory(new Array(LEVEL_HISTORY_SIZE).fill(0));

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

      meteringRef.current = setInterval(async () => {
        try {
          const status = await rec.getStatusAsync();
          if (status.isRecording && status.metering != null) {
            const level = dbToNormalized(status.metering);
            setLevelHistory((prev) => [...prev.slice(1), level]);
          }
        } catch {
          // recording may have stopped
        }
      }, 100);

      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } catch {
      toast.show(t('voiceRecord.recordError'));
    }
  };

  const handleStopRecording = async () => {
    if (!recording) return;
    if (timerRef.current) clearInterval(timerRef.current);
    if (meteringRef.current) clearInterval(meteringRef.current);
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);

    const result = await stopRecording(recording);
    setRecording(null);
    setIsRecording(false);
    setRecordedUri(result.uri);
  };

  const handleSubmit = () => {
    if (!recordedUri || !name.trim()) {
      toast.show(t('voiceRecord.inputRequired'));
      return;
    }
    if (duration < 10) {
      toast.show(t('voiceRecord.tooShort'));
      return;
    }
    cloneMutation.mutate({ uri: recordedUri, name: name.trim() });
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>{t('voiceRecord.permissionRequired')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.guideSection}>
        <Text style={styles.guideTitle} accessibilityRole="header">{t('voiceRecord.guideTitle')}</Text>
        {guideSentences.map((sentence, i) => (
          <View key={i} style={styles.guideSentence} accessibilityLabel={`${i + 1}. ${sentence}`}>
            <Text style={styles.guideNumber}>{i + 1}</Text>
            <Text style={styles.guideText}>{sentence}</Text>
          </View>
        ))}
        <Text style={styles.guideTip}>{t('voiceRecord.guideTip')}</Text>
      </View>

      <View style={styles.recordSection}>
        <Text style={styles.timer} accessibilityLabel={t('voiceRecord.a11yDuration', { time: formatTime(duration) })} accessibilityRole="timer">{formatTime(duration)}</Text>

        <Animated.View style={[styles.recordButtonOuter, { transform: [{ scale: pulseAnim }] }]}>
          <TouchableOpacity
            style={[styles.recordButton, isRecording && styles.recordButtonActive]}
            onPress={isRecording ? handleStopRecording : handleStartRecording}
            accessibilityLabel={isRecording ? t('voiceRecord.a11yStopRecording') : t('voiceRecord.a11yStartRecording')}
            accessibilityRole="button"
          >
            {isRecording ? (
              <View style={styles.stopIcon} />
            ) : (
              <View style={styles.micIcon}>
                <Text style={{ fontSize: 32 }}>🎙️</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {isRecording && (
          <View style={styles.levelContainer} accessibilityLabel={t('voiceRecord.a11yAudioLevel')}>
            {levelHistory.map((level, i) => (
              <View
                key={i}
                style={[
                  styles.levelBar,
                  {
                    height: Math.max(3, level * 40),
                    backgroundColor:
                      level > 0.7
                        ? colors.primary
                        : level > 0.3
                          ? colors.primaryLight
                          : colors.border,
                  },
                ]}
              />
            ))}
          </View>
        )}

        <Text style={styles.recordHint}>
          {isRecording ? t('voiceRecord.recording') : t('voiceRecord.tapToRecord')}
        </Text>
      </View>

      {recordedUri && !isRecording && (
        <View style={styles.resultSection}>
          <Text style={styles.resultTitle}>
            {t('voiceRecord.resultTitle', { time: formatTime(duration) })}
          </Text>

          <TextInput
            style={styles.nameInput}
            placeholder={t('voiceRecord.namePlaceholder')}
            value={name}
            onChangeText={setName}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('voiceRecord.namePlaceholder')}
          />

          <TouchableOpacity
            style={[styles.submitButton, cloneMutation.isPending && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={cloneMutation.isPending}
            accessibilityLabel={t('voiceRecord.submit')}
            accessibilityRole="button"
            accessibilityState={{ disabled: cloneMutation.isPending, busy: cloneMutation.isPending }}
          >
            {cloneMutation.isPending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitText}>{t('voiceRecord.submit')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
      <Toast message={toast.message} opacity={toast.opacity} />
    </View>
  );
}
