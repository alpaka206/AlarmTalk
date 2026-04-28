jest.mock('expo-web-browser', () => ({
  __esModule: true,
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock('expo-auth-session', () => ({
  __esModule: true,
  makeRedirectUri: jest.fn(() => 'https://redirect.test'),
  useAuthRequest: jest.fn(() => [null, null, jest.fn()]),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      setItem: jest.fn((k: string, v: string) => {
        store[k] = v;
        return Promise.resolve();
      }),
      getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
      removeItem: jest.fn((k: string) => {
        delete store[k];
        return Promise.resolve();
      }),
      _store: store,
      _reset: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
    },
  };
});

jest.mock('expo-apple-authentication', () => ({
  __esModule: true,
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import {
  signInWithApple,
  isAppleAuthAvailable,
  saveAuthToken,
  getAuthToken,
  getAuthProvider,
  signOut,
  decodeIdToken,
} from '../src/services/auth';

const mockSignIn = AppleAuthentication.signInAsync as jest.Mock;
const storage = AsyncStorage as unknown as {
  setItem: jest.Mock;
  getItem: jest.Mock;
  removeItem: jest.Mock;
  _store: Record<string, string>;
  _reset: () => void;
};

beforeEach(() => {
  jest.clearAllMocks();
  storage._reset();
});

// ===== decodeIdToken =====

describe('decodeIdToken', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.signature`;
  }

  it('decodes a valid JWT with all fields', () => {
    const token = makeJwt({
      sub: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
    });
    const result = decodeIdToken(token);
    expect(result).toEqual({
      sub: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/photo.jpg',
    });
  });

  it('returns partial fields when some are missing', () => {
    const token = makeJwt({ sub: 'user-456' });
    const result = decodeIdToken(token);
    expect(result).toEqual({
      sub: 'user-456',
      email: undefined,
      name: undefined,
      picture: undefined,
    });
  });

  it('handles base64url encoded characters', () => {
    const payload = { sub: 'abc+/=', email: 'a@b.com', name: 'N', picture: 'P' };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const token = `header.${b64}.sig`;
    const result = decodeIdToken(token);
    expect(result?.sub).toBe('abc+/=');
  });

  it('returns null for malformed token (not 3 parts)', () => {
    expect(decodeIdToken('abc.def')).toBeNull();
    expect(decodeIdToken('single')).toBeNull();
    expect(decodeIdToken('')).toBeNull();
  });

  it('returns null for invalid base64 payload', () => {
    expect(decodeIdToken('a.!!!invalid!!!.c')).toBeNull();
  });

  it('returns null for non-JSON payload', () => {
    const notJson = btoa('this is not json');
    expect(decodeIdToken(`a.${notJson}.c`)).toBeNull();
  });
});

// ===== saveAuthToken / getAuthToken / getAuthProvider =====

describe('saveAuthToken', () => {
  it('saves token and provider to AsyncStorage', async () => {
    await saveAuthToken('my-id-token', 'google');
    expect(storage.setItem).toHaveBeenCalledWith('auth_token', 'my-id-token');
    expect(storage.setItem).toHaveBeenCalledWith('auth_provider', 'google');
  });

  it('saves apple provider', async () => {
    await saveAuthToken('apple-token', 'apple');
    expect(storage.setItem).toHaveBeenCalledWith('auth_provider', 'apple');
  });
});

describe('getAuthToken', () => {
  it('returns token when set', async () => {
    await saveAuthToken('stored-token', 'google');
    const token = await getAuthToken();
    expect(token).toBe('stored-token');
  });

  it('returns null when not set', async () => {
    const token = await getAuthToken();
    expect(token).toBeNull();
  });
});

describe('getAuthProvider', () => {
  it('returns provider when set', async () => {
    await saveAuthToken('t', 'apple');
    const provider = await getAuthProvider();
    expect(provider).toBe('apple');
  });

  it('returns null when not set', async () => {
    const provider = await getAuthProvider();
    expect(provider).toBeNull();
  });
});

// ===== signOut =====

describe('signOut', () => {
  it('removes auth_token, auth_provider, and user_id', async () => {
    await saveAuthToken('token', 'google');
    storage._store['user_id'] = 'u1';

    await signOut();

    expect(storage.removeItem).toHaveBeenCalledWith('auth_token');
    expect(storage.removeItem).toHaveBeenCalledWith('auth_provider');
    expect(storage.removeItem).toHaveBeenCalledWith('user_id');
    expect(await getAuthToken()).toBeNull();
    expect(await getAuthProvider()).toBeNull();
  });
});

// ===== isAppleAuthAvailable =====

describe('isAppleAuthAvailable', () => {
  it('returns true on iOS', () => {
    (Platform as { OS: string }).OS = 'ios';
    expect(isAppleAuthAvailable()).toBe(true);
  });

  it('returns false on Android', () => {
    (Platform as { OS: string }).OS = 'android';
    expect(isAppleAuthAvailable()).toBe(false);
    (Platform as { OS: string }).OS = 'ios';
  });
});

// ===== signInWithApple =====

describe('signInWithApple', () => {
  it('returns idToken and user on success', async () => {
    mockSignIn.mockResolvedValueOnce({
      identityToken: 'apple-id-token',
      user: 'apple-user-123',
      email: 'user@icloud.com',
      fullName: { givenName: '길동', familyName: '홍' },
    });

    const result = await signInWithApple();
    expect(result).toEqual({
      idToken: 'apple-id-token',
      user: {
        id: 'apple-user-123',
        email: 'user@icloud.com',
        name: '길동 홍',
      },
    });
  });

  it('returns null name when fullName is null', async () => {
    mockSignIn.mockResolvedValueOnce({
      identityToken: 'token',
      user: 'u1',
      email: null,
      fullName: null,
    });

    const result = await signInWithApple();
    expect(result?.user.name).toBeNull();
    expect(result?.user.email).toBeNull();
  });

  it('trims name when givenName or familyName is null', async () => {
    mockSignIn.mockResolvedValueOnce({
      identityToken: 'token',
      user: 'u1',
      email: null,
      fullName: { givenName: '길동', familyName: null },
    });

    const result = await signInWithApple();
    expect(result?.user.name).toBe('길동');
  });

  it('returns null when identityToken is missing', async () => {
    mockSignIn.mockResolvedValueOnce({
      identityToken: null,
      user: 'u1',
      email: null,
      fullName: null,
    });

    const result = await signInWithApple();
    expect(result).toBeNull();
  });

  it('returns null when user cancels (ERR_REQUEST_CANCELED)', async () => {
    const err = new Error('User canceled');
    (err as Error & { code: string }).code = 'ERR_REQUEST_CANCELED';
    mockSignIn.mockRejectedValueOnce(err);

    const result = await signInWithApple();
    expect(result).toBeNull();
  });

  it('throws on other errors', async () => {
    const err = new Error('Network failure');
    mockSignIn.mockRejectedValueOnce(err);

    await expect(signInWithApple()).rejects.toThrow('Network failure');
  });

  it('returns null on Android', async () => {
    (Platform as { OS: string }).OS = 'android';
    const result = await signInWithApple();
    expect(result).toBeNull();
    (Platform as { OS: string }).OS = 'ios';
  });
});
