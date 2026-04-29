import * as AppleAuthentication from 'expo-apple-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

let googleConfigured = false;

function ensureGoogleConfigured() {
  if (googleConfigured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    scopes: ['profile', 'email'],
    offlineAccess: false,
  });
  googleConfigured = true;
}

export type GoogleSignInResult = {
  idToken: string;
  user: { id: string; email: string | null; name: string | null; photo: string | null };
} | null;

export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  ensureGoogleConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // 캐시된 계정으로 자동 로그인되지 않도록 먼저 세션 정리 →
    // 매번 시스템 계정 선택 다이얼로그가 뜬다.
    try {
      await GoogleSignin.signOut();
    } catch {
      // 로그인된 적 없으면 무시
    }
    const result = await GoogleSignin.signIn();

    if (result.type !== 'success') return null;

    const { idToken, user } = result.data;
    if (!idToken) return null;

    return {
      idToken,
      user: {
        id: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
        photo: user.photo ?? null,
      },
    };
  } catch (err: unknown) {
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (err.code === statusCodes.IN_PROGRESS) return null;
    }
    throw err;
  }
}

export async function signOutGoogle(): Promise<void> {
  ensureGoogleConfigured();
  try {
    await GoogleSignin.signOut();
  } catch {
    // ignore — sign-out failure shouldn't block local cleanup
  }
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
  await signOutGoogle();
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
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
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
