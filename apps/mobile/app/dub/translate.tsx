import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Audio } from 'expo-av';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import {
  getMessages,
  getDubLanguages,
  startDub,
  getDubStatus,
} from '../../src/services/api';
import {
  isAudioCached,
  getLocalAudioPath,
  saveAudioLocally,
  playAudio,
} from '../../src/services/audio';
import { getApiErrorMessage } from '../../src/types';
import type { Message, DubLanguage } from '../../src/types';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

export default function TranslateScreen() {
  const { message_id } = useLocalSearchParams<{ message_id: string }>();

  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = createStyles(colors);

  const [sourceLanguage, setSourceLanguage] = useState('ko');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [dubId, setDubId] = useState<string | null>(null);
  const [dubStatus, setDubStatus] = useState<string | null>(null);
  const [dubProgress, setDubProgress] = useState(0);
  const [remainingMinutes, setRemainingMinutes] = useState<number | undefined>();
  const [resultAudioSaved, setResultAudioSaved] = useState(false);
  const [currentSound, setCurrentSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: messages } = useQuery({
    queryKey: ['messages'],
    queryFn: () => getMessages(),
  });

  const { data: languages, isLoading: languagesLoading } = useQuery({
    queryKey: ['dubLanguages'],
    queryFn: getDubLanguages,
    staleTime: 1000 * 60 * 60,
  });

  const message = messages?.find((m: Message) => m.id === message_id);

  const targetLanguages = useMemo(
    () => languages?.filter((l: DubLanguage) => l.code !== sourceLanguage),
    [languages, sourceLanguage],
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
      if (currentSound) {
        currentSound.unloadAsync();
      }
    };
  }, [stopPolling, currentSound]);

  const pollDubStatus = useCallback(async (id: string) => {
    try {
      const result = await getDubStatus(id);
      setDubProgress(result.progress);
      setRemainingMinutes(result.expected_remaining_minutes);

      if (result.status === 'ready') {
        stopPolling();
        setDubStatus('ready');

        if (result.audio_base64 && result.result_message_id) {
          await saveAudioLocally(result.audio_base64, result.result_message_id, result.audio_format || 'mp3');
          setResultAudioSaved(true);
          queryClient.invalidateQueries({ queryKey: ['messages'] });
          queryClient.invalidateQueries({ queryKey: ['library'] });
        }
      } else if (result.status === 'failed') {
        stopPolling();
        setDubStatus('failed');
        toast.show(result.error_message || t('dub.failed'));
      }
    } catch {
      // polling 에러는 무시하고 다음 폴링에서 재시도
    }
  }, [stopPolling, queryClient, t, toast]);

  const dubMutation = useMutation({
    mutationFn: async () => {
      if (!message_id) throw new Error('No message');

      const audioPath = getLocalAudioPath(message_id);
      const cached = await isAudioCached(message_id);
      if (!cached) throw new Error(t('dub.noAudio'));

      return startDub(
        { uri: audioPath, name: 'audio.mp3', type: 'audio/mpeg' },
        sourceLanguage,
        targetLanguage,
        message_id,
      );
    },
    onSuccess: (data) => {
      setDubId(data.dub_id);
      setDubStatus('processing');
      setDubProgress(0);

      pollRef.current = setInterval(() => {
        pollDubStatus(data.dub_id);
      }, 5000);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t('dub.failed')));
    },
  });

  const handleStart = () => {
    if (!targetLanguage) {
      toast.show(t('dub.selectLanguage'));
      return;
    }
    if (sourceLanguage === targetLanguage) {
      toast.show(t('dub.sameLanguage'));
      return;
    }
    dubMutation.mutate();
  };

  const handlePlayResult = async () => {
    if (!dubId) return;

    if (currentSound) {
      await currentSound.unloadAsync();
      setCurrentSound(null);
      setIsPlaying(false);
      return;
    }

    try {
      const result = await getDubStatus(dubId);
      if (result.result_message_id) {
        const path = getLocalAudioPath(result.result_message_id);
        const sound = await playAudio(path);
        setCurrentSound(sound);
        setIsPlaying(true);
        sound.setOnPlaybackStatusUpdate((status) => {
          if ('didJustFinish' in status && status.didJustFinish) {
            setCurrentSound(null);
            setIsPlaying(false);
          }
        });
      }
    } catch {
      toast.show(t('dub.noAudio'));
    }
  };

  const renderLanguageItem = ({ item }: { item: DubLanguage }) => (
    <TouchableOpacity
      style={[styles.langItem, targetLanguage === item.code && styles.langItemActive]}
      onPress={() => setTargetLanguage(item.code)}
      accessibilityLabel={t('dub.a11yTargetLang', { name: item.name })}
      accessibilityRole="radio"
      accessibilityState={{ selected: targetLanguage === item.code }}
    >
      <Text style={[styles.langText, targetLanguage === item.code && styles.langTextActive]}>
        {item.name}
      </Text>
      {item.experiment && <Text style={styles.experimentBadge}>beta</Text>}
    </TouchableOpacity>
  );

  const isProcessing = dubStatus === 'processing' || dubMutation.isPending;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.description}>{t('dub.description')}</Text>

        {message && (
          <View style={styles.messagePreview} accessibilityLabel={`${message.voice_name || ''}: ${message.text}`}>
            <Text style={styles.messagePreviewLabel}>{message.voice_name || ''}</Text>
            <Text style={styles.messagePreviewText}>"{message.text}"</Text>
          </View>
        )}

        <Text style={styles.sectionTitle} accessibilityRole="header">{t('dub.sourceLanguage')}</Text>
        <View style={styles.sourceRow}>
          {[
            { code: 'ko', name: '한국어' },
            { code: 'en', name: 'English' },
            { code: 'ja', name: '日本語' },
            { code: 'zh', name: '中文' },
          ].map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.sourceChip, sourceLanguage === lang.code && styles.sourceChipActive]}
              onPress={() => setSourceLanguage(lang.code)}
              disabled={isProcessing}
              accessibilityLabel={t('dub.a11ySourceLang', { name: lang.name })}
              accessibilityRole="radio"
              accessibilityState={{ selected: sourceLanguage === lang.code, disabled: isProcessing }}
            >
              <Text style={[styles.sourceChipText, sourceLanguage === lang.code && styles.sourceChipTextActive]}>
                {lang.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle} accessibilityRole="header">{t('dub.targetLanguage')}</Text>
        {languagesLoading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : (
          <FlatList
            data={targetLanguages}
            renderItem={renderLanguageItem}
            keyExtractor={(item: DubLanguage) => item.code}
            scrollEnabled={false}
            numColumns={2}
            columnWrapperStyle={styles.langRow}
          />
        )}

        {dubStatus === 'processing' && (
          <View style={styles.progressSection} accessibilityLiveRegion="polite" accessibilityLabel={t('dub.a11yProgress', { progress: dubProgress })}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.progressText}>{t('dub.progress', { progress: dubProgress })}</Text>
            {remainingMinutes != null && (
              <Text style={styles.remainingText}>{t('dub.remainingTime', { minutes: remainingMinutes })}</Text>
            )}
          </View>
        )}

        {dubStatus === 'ready' && (
          <View style={styles.resultSection}>
            <Text style={styles.completeText}>{t('dub.complete')}</Text>
            {resultAudioSaved && (
              <>
                <TouchableOpacity style={styles.playResultButton} onPress={handlePlayResult} accessibilityRole="button" accessibilityLabel={isPlaying ? t('messageDetail.stop') : t('dub.playResult')}>
                  <Text style={styles.playResultText}>
                    {isPlaying ? t('messageDetail.stop') : t('dub.playResult')}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.savedText}>{t('dub.saveToLibrary')}</Text>
              </>
            )}
          </View>
        )}

        {dubStatus === 'failed' && (
          <View style={styles.resultSection}>
            <Text style={styles.failedText}>{t('dub.failed')}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleStart} accessibilityRole="button" accessibilityLabel={t('dub.retry')}>
              <Text style={styles.retryText}>{t('dub.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {!dubStatus && (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.startButton, (!targetLanguage || isProcessing) && styles.startButtonDisabled]}
            onPress={handleStart}
            disabled={!targetLanguage || isProcessing}
            accessibilityLabel={dubMutation.isPending ? t('dub.processing') : t('dub.start')}
            accessibilityRole="button"
            accessibilityState={{ disabled: !targetLanguage || isProcessing, busy: dubMutation.isPending }}
          >
            {dubMutation.isPending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.startButtonText}>{t('dub.start')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <Toast message={toast.message} opacity={toast.opacity} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: 100,
  },
  description: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  messagePreview: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  messagePreviewLabel: {
    fontSize: FontSize.sm,
    color: colors.primary,
    fontFamily: FontFamily.semibold,
    marginBottom: Spacing.xs,
  },
  messagePreviewText: {
    fontSize: FontSize.md,
    color: colors.text,
    fontStyle: 'italic',
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.bold,
    color: colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  sourceRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
    flexWrap: 'wrap',
  },
  sourceChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sourceChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sourceChipText: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    fontFamily: FontFamily.semibold,
  },
  sourceChipTextActive: {
    color: '#FFF',
  },
  loader: {
    marginVertical: Spacing.lg,
  },
  langRow: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  langItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  langItemActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  langText: {
    fontSize: FontSize.sm,
    color: colors.text,
    fontFamily: FontFamily.medium,
  },
  langTextActive: {
    color: '#FFF',
    fontFamily: FontFamily.bold,
  },
  experimentBadge: {
    fontSize: 10,
    color: colors.textTertiary,
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  progressText: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.semibold,
    color: colors.primary,
  },
  remainingText: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
  resultSection: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
  },
  completeText: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
    color: colors.success,
  },
  playResultButton: {
    backgroundColor: colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  playResultText: {
    color: '#FFF',
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
  },
  savedText: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
  failedText: {
    fontSize: FontSize.lg,
    fontFamily: FontFamily.semibold,
    color: colors.error,
  },
  retryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.lg,
  },
  retryText: {
    color: colors.primary,
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  startButton: {
    backgroundColor: colors.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    alignItems: 'center',
  },
  startButtonDisabled: {
    opacity: 0.5,
  },
  startButtonText: {
    color: '#FFF',
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
  },
});
