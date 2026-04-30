import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../../src/constants/theme';
import { useTheme, type ThemeColors } from '../../src/hooks/useTheme';
import { useToast } from '../../src/hooks/useToast';
import { Toast } from '../../src/components/Toast';
import { registerCode, ApiError } from '../../src/services/api';
import { AppIcon } from '../../src/components/AppIcon';

const VOUCHER_RE = /^VA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const INVITE_RE = /^[0-9]{6}$/;

type DetectedType = 'voucher' | 'invite' | null;

function detectCodeType(code: string): DetectedType {
  const trimmed = code.trim().toUpperCase();
  if (VOUCHER_RE.test(trimmed)) return 'voucher';
  if (INVITE_RE.test(code.trim())) return 'invite';
  return null;
}

export default function CodeRegisterScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [successType, setSuccessType] = useState<DetectedType>(null);

  const detectedType = detectCodeType(code);

  const mutation = useMutation({
    mutationFn: (codeValue: string) => registerCode(codeValue.trim()),
    onSuccess: (data) => {
      setSuccessType(data.type);
      setCode('');
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      if (data.type === 'voucher') {
        toast.show(t('codeRegister.voucherSuccess'));
      } else {
        toast.show(t('codeRegister.inviteSuccess'));
      }
    },
  });

  const handleRegister = useCallback(() => {
    if (!code.trim()) return;
    setSuccessType(null);
    mutation.mutate(code);
  }, [code, mutation]);

  const errorMessage = useMemo(() => {
    if (!mutation.isError) return null;
    const err = mutation.error;
    if (err instanceof ApiError) {
      const data = err.responseData as { error?: string };
      return data?.error ?? t('codeRegister.unknownError');
    }
    return t('codeRegister.unknownError');
  }, [mutation.isError, mutation.error, t]);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.heroSection}>
            <View style={{ marginBottom: 12 }}>
              <AppIcon name="gift" size={56} />
            </View>
            <Text style={styles.heroTitle}>{t('codeRegister.title')}</Text>
            <Text style={styles.heroSubtitle}>{t('codeRegister.subtitle')}</Text>
          </View>

          <View style={styles.inputSection}>
            <Text style={styles.label}>{t('codeRegister.inputLabel')}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              placeholder={t('codeRegister.placeholder')}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!mutation.isPending}
              accessibilityLabel={t('codeRegister.inputLabel')}
            />

            {detectedType && (
              <View style={[styles.typeBadge, detectedType === 'voucher' ? styles.voucherBadge : styles.inviteBadge]}>
                <Text style={styles.typeBadgeText}>
                  {detectedType === 'voucher'
                    ? t('codeRegister.typeVoucher')
                    : t('codeRegister.typeInvite')}
                </Text>
              </View>
            )}
          </View>

          {errorMessage && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {successType && !mutation.isPending && (
            <View style={styles.successBox}>
              <Text style={styles.successText}>
                {successType === 'voucher'
                  ? t('codeRegister.voucherSuccessDetail')
                  : t('codeRegister.inviteSuccessDetail')}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.registerButton, (!code.trim() || mutation.isPending) && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={!code.trim() || mutation.isPending}
            accessibilityRole="button"
            accessibilityLabel={t('codeRegister.register')}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.registerButtonText}>{t('codeRegister.register')}</Text>
            )}
          </TouchableOpacity>

          <View style={styles.helpSection}>
            <Text style={styles.helpTitle}>{t('codeRegister.helpTitle')}</Text>
            <View style={styles.helpCard}>
              <Text style={styles.helpCardTitle}>{t('codeRegister.helpVoucherTitle')}</Text>
              <Text style={styles.helpCardDesc}>{t('codeRegister.helpVoucherDesc')}</Text>
              <Text style={styles.helpCardFormat}>VA-XXXX-XXXX-XXXX</Text>
            </View>
            <View style={styles.helpCard}>
              <Text style={styles.helpCardTitle}>{t('codeRegister.helpInviteTitle')}</Text>
              <Text style={styles.helpCardDesc}>{t('codeRegister.helpInviteDesc')}</Text>
              <Text style={styles.helpCardFormat}>000000</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <Toast message={toast.message} opacity={toast.opacity} />
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: 100,
    },
    heroSection: {
      alignItems: 'center',
      marginBottom: Spacing.xl,
    },
    heroEmoji: {
      fontSize: 48,
      marginBottom: Spacing.sm,
    },
    heroTitle: {
      fontSize: FontSize.xl,
      fontFamily: FontFamily.bold,
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    heroSubtitle: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    inputSection: {
      marginBottom: Spacing.md,
    },
    label: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.lg,
      fontFamily: FontFamily.medium,
      color: colors.text,
      letterSpacing: 1,
      textAlign: 'center',
    },
    typeBadge: {
      alignSelf: 'flex-start',
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 4,
      marginTop: Spacing.xs,
    },
    voucherBadge: {
      backgroundColor: colors.primaryLight,
    },
    inviteBadge: {
      backgroundColor: colors.surfaceVariant,
    },
    typeBadgeText: {
      fontSize: FontSize.xs,
      fontFamily: FontFamily.semibold,
      color: colors.primaryDark,
    },
    errorBox: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    errorText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.error,
      lineHeight: 20,
    },
    successBox: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    successText: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.success,
      lineHeight: 20,
    },
    registerButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 52,
      marginBottom: Spacing.xl,
    },
    registerButtonDisabled: {
      opacity: 0.5,
    },
    registerButtonText: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.bold,
      color: colors.textOnPrimary,
    },
    helpSection: {
      marginTop: Spacing.sm,
    },
    helpTitle: {
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginBottom: Spacing.sm,
    },
    helpCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    helpCardTitle: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.semibold,
      color: colors.text,
      marginBottom: 4,
    },
    helpCardDesc: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.xs,
    },
    helpCardFormat: {
      fontSize: FontSize.sm,
      fontFamily: FontFamily.medium,
      color: colors.primary,
      letterSpacing: 1,
    },
  });
}
