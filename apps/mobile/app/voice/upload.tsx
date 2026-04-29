import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { createVoiceClone } from '../../src/services/api';
import { getApiErrorMessage } from '../../src/lib/apiErrors';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';

export default function UploadScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [name, setName] = useState('');
  const [speakerCount, setSpeakerCount] = useState<1 | 2 | 3 | 4>(1);

  const cloneMutation = useMutation({
    mutationFn: (params: { file: DocumentPicker.DocumentPickerAsset; name: string }) =>
      createVoiceClone(
        {
          uri: params.file.uri,
          name: params.file.name,
          type: params.file.mimeType || 'audio/wav',
        },
        params.name,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voiceProfiles'] });
      Alert.alert(t('voiceUpload.successTitle'), t('voiceUpload.successDesc'), [
        { text: t('common.confirm'), onPress: () => router.back() },
      ]);
    },
    onError: (err: unknown) => {
      toast.show(getApiErrorMessage(err, t, t('voiceUpload.uploadError')));
    },
  });

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/*'],
      copyToCacheDirectory: true,
    });

    if (!result.canceled && result.assets.length > 0) {
      setSelectedFile(result.assets[0]!);
    }
  };

  const handleSubmit = () => {
    if (!selectedFile) {
      toast.show(t('voiceUpload.inputRequired'));
      return;
    }
    // Multi-speaker file → diarization flow (file is the only thing we can pass
    // through the router; diarize screen prompts for per-speaker names there).
    if (speakerCount > 1) {
      router.push({
        pathname: '/voice/diarize',
        params: {
          uri: selectedFile.uri,
          fileName: selectedFile.name,
          mimeType: selectedFile.mimeType ?? 'audio/wav',
          speakerCount: String(speakerCount),
        },
      });
      return;
    }
    if (!name.trim()) {
      toast.show(t('voiceUpload.inputRequired'));
      return;
    }
    cloneMutation.mutate({ file: selectedFile, name: name.trim() });
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.description}>{t('voiceUpload.description')}</Text>

        {/* 파일 선택 */}
        <TouchableOpacity
          style={styles.pickButton}
          onPress={handlePickFile}
          accessibilityRole="button"
          accessibilityLabel={selectedFile ? t('voiceUpload.a11yFileInfo', { name: selectedFile.name }) : t('voiceUpload.a11yPickFile')}
        >
          <Text style={styles.pickEmoji}>📁</Text>
          <Text style={styles.pickText}>
            {selectedFile ? selectedFile.name : t('voiceUpload.pickFile')}
          </Text>
        </TouchableOpacity>

        {selectedFile && (
          <View style={styles.fileInfo}>
            <Text style={styles.fileInfoText}>
              📎 {selectedFile.name}
              {selectedFile.size && ` (${(selectedFile.size / 1024).toFixed(0)} KB)`}
            </Text>
          </View>
        )}

        {/* 화자 수 */}
        <Text style={styles.sectionLabel}>{t('voiceUpload.speakerCount')}</Text>
        <View style={styles.speakerRow}>
          {([1, 2, 3, 4] as const).map((n) => {
            const selected = speakerCount === n;
            return (
              <TouchableOpacity
                key={n}
                style={[styles.speakerChip, selected && styles.speakerChipActive]}
                onPress={() => setSpeakerCount(n)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t('voiceUpload.speakerN', { n })}
              >
                <Text style={[styles.speakerChipText, selected && styles.speakerChipTextActive]}>
                  {n === 1 ? t('voiceUpload.singleSpeaker') : t('voiceUpload.speakerN', { n })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 이름 입력 (1인 화자만) */}
        {speakerCount === 1 && (
          <TextInput
            style={styles.nameInput}
            placeholder={t('voiceUpload.namePlaceholder')}
            value={name}
            onChangeText={setName}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('voiceUpload.a11yNameInput')}
          />
        )}

        {/* 제출 */}
        {(() => {
          const submitDisabled =
            !selectedFile ||
            (speakerCount === 1 && !name.trim()) ||
            cloneMutation.isPending;
          const label =
            speakerCount === 1
              ? t('voiceUpload.submit')
              : t('voiceUpload.submitDiarize');
          return (
        <TouchableOpacity
          style={[
            styles.submitButton,
            submitDisabled && styles.disabled,
          ]}
          onPress={handleSubmit}
          disabled={submitDisabled}
          accessibilityRole="button"
          accessibilityLabel={t('voiceUpload.a11ySubmit')}
          accessibilityState={{ disabled: submitDisabled }}
        >
          {cloneMutation.isPending ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.submitText}>{label}</Text>
          )}
        </TouchableOpacity>
          );
        })()}
      </View>
      <Toast message={toast.message} opacity={toast.opacity} />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: Spacing.lg,
  },
  description: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.lg,
  },
  pickButton: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    marginBottom: Spacing.md,
  },
  pickEmoji: {
    fontSize: 48,
    marginBottom: Spacing.sm,
  },
  pickText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
    fontFamily: FontFamily.semibold,
  },
  fileInfo: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  fileInfoText: {
    fontSize: FontSize.sm,
    color: colors.text,
  },
  nameInput: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    fontSize: FontSize.sm,
    fontFamily: FontFamily.semibold,
    color: colors.textSecondary,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  speakerRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  speakerChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  speakerChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  speakerChipText: {
    fontSize: FontSize.sm,
    color: colors.text,
    fontFamily: FontFamily.semibold,
  },
  speakerChipTextActive: {
    color: colors.textOnPrimary,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
  submitText: {
    color: colors.textOnPrimary,
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
  },
});
