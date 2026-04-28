import { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useAppStore } from '../stores/useAppStore';
import { BorderRadius, FontSize, Spacing, FontFamily } from '../constants/theme';
import { useTheme, type ThemeColors } from '../hooks/useTheme';
import { validateEmailPasswordForm, type AuthMode } from '../lib/authFormValidation';
import { getApiErrorMessage } from '../lib/apiErrors';

export type Mode = AuthMode;

export interface EmailPasswordFormProps {
  defaultMode?: Mode;
  onSuccess?: () => void;
}

export default function EmailPasswordForm({
  defaultMode = 'login',
  onSuccess,
}: EmailPasswordFormProps) {
  const { t } = useTranslation();
  const { login, register, isLoading, token, user: authUser } = useAuth();
  const setAppAuth = useAppStore((s) => s.setAuth);
  const { colors } = useTheme();
  const dynStyles = useMemo(() => createStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isRegister = mode === 'register';

  useEffect(() => {
    if (token && authUser) {
      setAppAuth(token, authUser.id);
    }
  }, [token, authUser, setAppAuth]);

  async function handleSubmit() {
    setSubmitError(null);
    const err = validateEmailPasswordForm({ mode, email, password, name }, t);
    if (err) {
      setSubmitError(err);
      return;
    }
    try {
      if (isRegister) await register(email, password, name);
      else await login(email, password);
      onSuccess?.();
    } catch (e) {
      setSubmitError(getApiErrorMessage(e, t, t('authForm.requestError')));
    }
  }

  return (
    <View style={dynStyles.container} accessibilityLabel={t('authForm.emailLogin')}>
      <View style={dynStyles.tabRow}>
        <TouchableOpacity
          accessibilityRole="tab"
          accessibilityLabel={t('authForm.login')}
          accessibilityState={{ selected: mode === 'login' }}
          onPress={() => setMode('login')}
          style={[dynStyles.tab, mode === 'login' && dynStyles.tabActive]}
        >
          <Text style={[dynStyles.tabText, mode === 'login' && dynStyles.tabTextActive]}>{t('authForm.login')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="tab"
          accessibilityLabel={t('authForm.register')}
          accessibilityState={{ selected: mode === 'register' }}
          onPress={() => setMode('register')}
          style={[dynStyles.tab, mode === 'register' && dynStyles.tabActive]}
        >
          <Text style={[dynStyles.tabText, mode === 'register' && dynStyles.tabTextActive]}>
            {t('authForm.register')}
          </Text>
        </TouchableOpacity>
      </View>

      {isRegister && (
        <View style={dynStyles.field}>
          <Text style={dynStyles.label}>{t('authForm.name')}</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('authForm.namePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            autoComplete="name"
            style={dynStyles.input}
            accessibilityLabel={t('authForm.name')}
          />
        </View>
      )}

      <View style={dynStyles.field}>
        <Text style={dynStyles.label}>{t('authForm.email')}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t('authForm.emailPlaceholder')}
          placeholderTextColor={colors.textTertiary}
          autoComplete="email"
          autoCapitalize="none"
          keyboardType="email-address"
          style={dynStyles.input}
          accessibilityLabel={t('authForm.email')}
        />
      </View>

      <View style={dynStyles.field}>
        <Text style={dynStyles.label}>{t('authForm.password')}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={isRegister ? t('authForm.passwordPlaceholder') : t('authForm.password')}
          placeholderTextColor={colors.textTertiary}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          secureTextEntry
          style={dynStyles.input}
          accessibilityLabel={t('authForm.password')}
        />
      </View>

      {submitError && (
        <Text style={dynStyles.errorText} accessibilityRole="alert">
          {submitError}
        </Text>
      )}

      <TouchableOpacity
        onPress={handleSubmit}
        disabled={isLoading}
        style={[dynStyles.submitButton, isLoading && dynStyles.submitButtonDisabled]}
        accessibilityRole="button"
        accessibilityLabel={isRegister ? t('authForm.register') : t('authForm.login')}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={dynStyles.submitText}>{isRegister ? t('authForm.register') : t('authForm.login')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      width: '100%',
      gap: Spacing.sm,
    },
    tabRow: {
      flexDirection: 'row',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    tab: {
      flex: 1,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      alignItems: 'center',
    },
    tabActive: {
      backgroundColor: colors.surfaceVariant,
    },
    tabText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
    },
    tabTextActive: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
    field: {
      gap: 4,
    },
    label: {
      fontSize: FontSize.xs,
      color: colors.textSecondary,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      color: colors.text,
      backgroundColor: colors.surface,
      fontSize: FontSize.md,
    },
    errorText: {
      color: colors.error,
      fontSize: FontSize.sm,
    },
    submitButton: {
      marginTop: Spacing.xs,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    submitButtonDisabled: {
      opacity: 0.6,
    },
    submitText: {
      color: colors.textOnPrimary,
      fontSize: FontSize.md,
      fontFamily: FontFamily.semibold,
    },
  });
}
