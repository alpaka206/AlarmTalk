import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Spacing, BorderRadius, FontSize, FontFamily } from '../constants/theme';
import {
  signInWithGoogle,
  signInWithApple,
  isAppleAuthAvailable,
  saveAuthToken,
  decodeIdToken,
} from '../services/auth';
import { useAppStore } from '../stores/useAppStore';

// Official Google "G" logo paths (4-color), per
// https://developers.google.com/identity/branding-guidelines#logo
function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18">
      <Path
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"
        fill="#4285F4"
      />
      <Path
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.806.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5832-5.0364-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"
        fill="#34A853"
      />
      <Path
        d="M3.9636 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9636 10.71z"
        fill="#FBBC05"
      />
      <Path
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9636 7.29C4.6718 5.1627 6.6559 3.5795 9 3.5795z"
        fill="#EA4335"
      />
    </Svg>
  );
}

export default function LoginButtons() {
  const { setAuth } = useAppStore();
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

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const result = await signInWithGoogle();
      if (result) {
        await handleLoginSuccess(result.idToken, 'google');
      } else {
        setLoading(false);
      }
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
      {/* Custom Google sign-in button — follows the branding guideline
          (white surface, 1pt #DADCE0 stroke, 4-color G logo, label centered
          as a unit with the logo). https://developers.google.com/identity/branding-guidelines */}
      <TouchableOpacity
        style={[styles.googleButton, loading && styles.disabledButton]}
        onPress={handleGoogleLogin}
        disabled={loading}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t('login.google')}
      >
        <GoogleLogo size={20} />
        <Text style={styles.googleText}>{t('login.google')}</Text>
      </TouchableOpacity>

      {isAppleAuthAvailable() && Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={BorderRadius.lg}
          style={styles.appleSignInButton}
          onPress={handleAppleLogin}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
    width: '100%',
    alignItems: 'stretch',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: '#FFFFFF',
    borderRadius: BorderRadius.lg,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: '#DADCE0',
    minHeight: 48,
  },
  googleText: {
    fontSize: FontSize.md,
    fontFamily: FontFamily.semibold,
    color: '#3C4043',
  },
  appleSignInButton: {
    height: 48,
    width: '100%',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
