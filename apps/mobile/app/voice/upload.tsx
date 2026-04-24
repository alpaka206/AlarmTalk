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
      setSelectedFile(result.assets[0]);
    }
  };

  const handleSubmit = () => {
    if (!selectedFile || !name.trim()) {
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

        {/* 이름 입력 */}
        <TextInput
          style={styles.nameInput}
          placeholder={t('voiceUpload.namePlaceholder')}
          value={name}
          onChangeText={setName}
          placeholderTextColor={colors.textTertiary}
          accessibilityLabel={t('voiceUpload.a11yNameInput')}
        />

        {/* 제출 */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            (!selectedFile || !name.trim() || cloneMutation.isPending) && styles.disabled,
          ]}
          onPress={handleSubmit}
          disabled={!selectedFile || !name.trim() || cloneMutation.isPending}
          accessibilityRole="button"
          accessibilityLabel={t('voiceUpload.a11ySubmit')}
          accessibilityState={{ disabled: !selectedFile || !name.trim() || cloneMutation.isPending }}
        >
          {cloneMutation.isPending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.submitText}>{t('voiceUpload.submit')}</Text>
          )}
        </TouchableOpacity>
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
    color: '#FFF',
    fontSize: FontSize.lg,
    fontFamily: FontFamily.bold,
  },
});
