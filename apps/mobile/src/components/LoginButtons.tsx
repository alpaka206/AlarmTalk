import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import {
  useGoogleAuth,
  signInWithApple,
  isAppleAuthAvailable,
  saveAuthToken,
  decodeIdToken,
} from '../services/auth';
import { useAppStore } from '../stores/useAppStore';

export default function LoginButtons() {
  const { setAuth } = useAppStore();
  const { request, response, promptAsync } = useGoogleAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleLoginSuccess = useCallback(async (idToken: string, provider: 'google' | 'apple') => {
    try {
      await saveAuthToken(idToken, provider);
      const user = decodeIdToken(idToken);
      if (user) {
        setAuth(idToken, user.sub);
      }
    } catch {
      Alert.alert(t('login.error'), t('login.saveFailed'));
    } finally {
      setLoading(false);
    }
  }, [setAuth, t]);

  useEffect(() => {
    if (!response) return;

    if (response.type === 'success') {
      const idToken = response.params.id_token;
      if (idToken) {
        handleLoginSuccess(idToken, 'google');
      } else {
        Alert.alert(t('login.error'), t('login.noToken'));
      }
    } else if (response.type === 'error') {
      const msg = response.error?.message || t('login.unknownError');
      Alert.alert(t('login.error'), msg);
    }
    // 'dismiss' (사용자가 취소)는 무시
    setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [response, handleLoginSuccess, t]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await promptAsync();
    } catch {
      Alert.alert(t('login.error'), t('login.googleFailed'));
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setLoading(true);
    try {
      const result = await signInWithApple();
      if (result) {
        await handleLoginSuccess(result.idToken, 'apple');
      } else {
        setLoading(false);
      }
    } catch {
      Alert.alert(t('login.error'), t('login.appleFailed'));
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.googleButton, loading && styles.disabledButton]}
        onPress={handleGoogleLogin}
        disabled={!request || loading}
        accessibilityRole="button"
        accessibilityLabel={t('login.google')}
      >
        <Text style={styles.googleIcon}>G</Text>
        <Text style={styles.googleText}>{t('login.google')}</Text>
      </TouchableOpacity>

      {isAppleAuthAvailable() && (
        <TouchableOpacity
          style={[styles.appleButton, loading && styles.disabledButton]}
          onPress={handleAppleLogin}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={t('login.apple')}
        >
          <Text style={styles.appleIcon}></Text>
          <Text style={styles.appleText}>{t('login.apple')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
    width: '100%',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    borderWidth: 1,
    borderColor: '#DADCE0',
    gap: Spacing.sm,
  },
  googleIcon: {
    fontSize: 20,
    fontFamily: FontFamily.bold,
    color: '#4285F4',
  },
  googleText: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
    color: '#3C4043',
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  appleIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  appleText: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
    color: '#FFFFFF',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
