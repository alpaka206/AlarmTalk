import { useMemo } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

// ============================
// Google Cloud Console에서 OAuth 2.0 Client ID를 생성하세요:
// 1. https://console.cloud.google.com/apis/credentials
// 2. "Create Credentials" → "OAuth client ID"
// 3. Application type: "Web application"
// 4. Authorized redirect URIs에 추가:
//    - Expo Go: https://auth.expo.io/@your-username/voice-alarm
//    - 프로덕션: voicealarm://redirect
// 5. 생성된 Client ID를 아래에 입력
// ============================
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';

// ===== Google 로그인 =====

export function useGoogleAuth() {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'voicealarm',
    path: 'redirect',
  });


  const nonce = useMemo(
    () => Math.random().toString(36).substring(2) + Date.now().toString(36),
    [],
  );

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_CLIENT_ID,
      scopes: ['openid', 'profile', 'email'],
      responseType: 'id_token',
      usePKCE: false,
      extraParams: { nonce },
      redirectUri,
    },
    {
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
    },
  );

  return { request, response, promptAsync, redirectUri };
}

// ===== Apple 로그인 (iOS only) =====

export async function signInWithApple(): Promise<{
  idToken: string;
  user: { id: string; email: string | null; name: string | null };
} | null> {
  if (Platform.OS !== 'ios') return null;

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });

    if (!credential.identityToken) return null;

    const name = credential.fullName
      ? `${credential.fullName.givenName ?? ''} ${credential.fullName.familyName ?? ''}`.trim()
      : null;

    return {
      idToken: credential.identityToken,
      user: {
        id: credential.user,
        email: credential.email,
        name,
      },
    };
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'ERR_REQUEST_CANCELED'
    )
      return null;
    throw err;
  }
}

export function isAppleAuthAvailable(): boolean {
  return Platform.OS === 'ios';
}

// ===== 공통 =====

export async function saveAuthToken(idToken: string, provider: 'google' | 'apple') {
  await AsyncStorage.setItem('auth_token', idToken);
  await AsyncStorage.setItem('auth_provider', provider);
}

export async function getAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem('auth_token');
}

export async function getAuthProvider(): Promise<'google' | 'apple' | null> {
  return AsyncStorage.getItem('auth_provider') as Promise<'google' | 'apple' | null>;
}

export async function signOut() {
  await AsyncStorage.removeItem('auth_token');
  await AsyncStorage.removeItem('auth_provider');
  await AsyncStorage.removeItem('user_id');
}

/** ID Token에서 사용자 정보 디코딩 (JWT payload) */
export function decodeIdToken(idToken: string): {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
} | null {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };
  } catch {
    return null;
  }
}
