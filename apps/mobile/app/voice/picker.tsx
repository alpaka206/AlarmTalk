import { useCallback, useReducer } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { BorderRadius, FontFamily, FontSize, Spacing } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import {
  listSpeakers,
  renameSpeaker,
  separateUpload,
  uploadVoiceAudio,
  type SpeakerSegment,
} from '../../src/services/api';
import {
  INITIAL_STATE,
  sanitizeLabel,
  speakerPickerReducer,
} from '../../src/lib/speakerPickerState';
import { getApiErrorMessage } from '../../src/lib/apiErrors';

export default function SpeakerPickerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = createStyles(colors);
  const [state, dispatch] = useReducer(speakerPickerReducer, INITIAL_STATE);

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0]!;
      dispatch({
        type: 'PICK_FILE',
        file: { uri: asset.uri, name: asset.name, type: asset.mimeType || 'audio/wav' },
      });
    }
  }, []);

  const runFlow = useCallback(async () => {
    if (!state.file) return;
    dispatch({ type: 'UPLOAD_START' });
    try {
      const upload = await uploadVoiceAudio(state.file);
      dispatch({ type: 'UPLOAD_SUCCESS', upload });

      const existing = await listSpeakers(upload.id).catch(() => [] as SpeakerSegment[]);
      if (existing.length > 0) {
        dispatch({ type: 'READY', speakers: existing });
        return;
      }

      dispatch({ type: 'SEPARATE_START' });
      const detected = await separateUpload(upload.id);
      dispatch({ type: 'READY', speakers: detected });
    } catch (err) {
      dispatch({ type: 'FAIL', message: getApiErrorMessage(err, t, t('speakerPicker.uploadFailed')) });
    }
  }, [state.file]);

  const commitEdit = useCallback(
    async (speaker: SpeakerSegment) => {
      if (!state.upload) return;
      const sanitized = sanitizeLabel(state.draftLabel, t);
      if (!sanitized.ok) {
        dispatch({ type: 'FAIL', message: sanitized.error ?? t('speakerPicker.labelError') });
        return;
      }
      if (sanitized.value === speaker.label) {
        dispatch({ type: 'EDIT_CANCEL' });
        return;
      }
      try {
        await renameSpeaker(state.upload.id, speaker.id, sanitized.value);
        dispatch({ type: 'EDIT_COMMIT', speakerId: speaker.id, label: sanitized.value });
      } catch (err) {
        dispatch({
          type: 'FAIL',
          message: getApiErrorMessage(err, t, t('speakerPicker.labelEditFailed')),
        });
      }
    },
    [state.upload, state.draftLabel],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{t('speakerPicker.title')}</Text>
        <Text style={styles.desc}>{t('speakerPicker.desc')}</Text>
      </View>

      {state.phase === 'idle' && (
        <>
          <TouchableOpacity style={styles.pickButton} onPress={pickFile} accessibilityRole="button" accessibilityLabel={state.file ? state.file.name : t('speakerPicker.pickFile')}>
            <Text style={styles.pickEmoji} accessibilityElementsHidden>📁</Text>
            <Text style={styles.pickText}>
              {state.file ? state.file.name : t('speakerPicker.pickFile')}
            </Text>
          </TouchableOpacity>

          {state.file && (
            <TouchableOpacity style={styles.primaryButton} onPress={runFlow} accessibilityRole="button" accessibilityLabel={t('speakerPicker.uploadAndDetect')}>
              <Text style={styles.primaryText}>{t('speakerPicker.uploadAndDetect')}</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {(state.phase === 'uploading' || state.phase === 'separating') && (
        <View style={styles.statusRow} accessibilityLiveRegion="polite" accessibilityLabel={state.phase === 'uploading' ? t('speakerPicker.a11yUploading') : t('speakerPicker.a11ySeparating')}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.statusText}>
            {state.phase === 'uploading' ? t('speakerPicker.uploading') : t('speakerPicker.separating')}
          </Text>
        </View>
      )}

      {state.phase === 'error' && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{state.error ?? t('speakerPicker.unknownError')}</Text>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => dispatch({ type: 'RESET' })}
            accessibilityRole="button"
            accessibilityLabel={t('speakerPicker.retry')}
          >
            <Text style={styles.secondaryText}>{t('speakerPicker.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {state.phase === 'ready' && (
        <>
          {state.speakers.length === 0 ? (
            <Text style={styles.emptyText}>{t('speakerPicker.noSpeakers')}</Text>
          ) : (
            state.speakers.map((sp) => {
              const isSelected = state.selectedSpeakerId === sp.id;
              const isEditing = state.editingSpeakerId === sp.id;
              const durationSec = Math.max(0, (sp.end_ms - sp.start_ms) / 1000);
              return (
                <TouchableOpacity
                  key={sp.id}
                  style={[styles.speakerCard, isSelected && styles.speakerCardSelected]}
                  onPress={() => dispatch({ type: 'SELECT', speakerId: sp.id })}
                  accessibilityLabel={t('speakerPicker.a11ySpeaker', { label: sp.label, duration: durationSec.toFixed(1), confidence: (sp.confidence * 100).toFixed(0) })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.speakerRow}>
                    {isEditing ? (
                      <TextInput
                        autoFocus
                        value={state.draftLabel}
                        onChangeText={(txt) => dispatch({ type: 'EDIT_CHANGE', label: txt })}
                        onBlur={() => void commitEdit(sp)}
                        onSubmitEditing={() => void commitEdit(sp)}
                        style={styles.labelInput}
                        accessibilityLabel={t('speakerPicker.a11yEditLabel', { label: sp.label })}
                      />
                    ) : (
                      <Text style={styles.labelText}>{sp.label}</Text>
                    )}
                    <TouchableOpacity
                      onPress={() =>
                        dispatch({ type: 'EDIT_BEGIN', speakerId: sp.id, label: sp.label })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t('speakerPicker.a11yRename', { label: sp.label })}
                    >
                      <Text style={styles.renameText}>{t('speakerPicker.rename')}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.metaText}>
                    {t('speakerPicker.durationConfidence', { duration: durationSec.toFixed(1), confidence: (sp.confidence * 100).toFixed(0) })}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}

          <TouchableOpacity style={styles.secondaryButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('speakerPicker.close')}>
            <Text style={styles.secondaryText}>{t('speakerPicker.close')}</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  header: { marginBottom: Spacing.lg },
  title: {
    fontSize: FontSize.xxl,
    fontFamily: FontFamily.bold,
    color: colors.text,
    marginBottom: Spacing.sm,
  },
  desc: { fontSize: FontSize.md, color: colors.textSecondary, lineHeight: 22 },
  pickButton: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    marginBottom: Spacing.lg,
  },
  pickEmoji: { fontSize: 48, marginBottom: Spacing.sm },
  pickText: { fontSize: FontSize.md, color: colors.primary, fontFamily: FontFamily.semibold },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  primaryText: { color: '#FFF', fontSize: FontSize.lg, fontFamily: FontFamily.bold },
  secondaryButton: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  secondaryText: { color: colors.textSecondary, fontSize: FontSize.md },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  statusText: { marginLeft: Spacing.sm, color: colors.textSecondary },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: '#F87171',
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  errorText: { color: '#B91C1C', fontSize: FontSize.md },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    padding: Spacing.xl,
  },
  speakerCard: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  speakerCardSelected: { borderColor: colors.primary },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelText: { fontSize: FontSize.lg, fontFamily: FontFamily.semibold, color: colors.text },
  labelInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    marginRight: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
  },
  renameText: { color: colors.primary, fontSize: FontSize.sm, fontFamily: FontFamily.semibold },
  metaText: {
    marginTop: Spacing.sm,
    fontSize: FontSize.sm,
    color: colors.textTertiary,
  },
});
