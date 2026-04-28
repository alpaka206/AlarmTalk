const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: [string]) => mockGetItem(...args),
    setItem: (...args: [string, string]) => mockSetItem(...args),
    removeItem: (...args: [string]) => mockRemoveItem(...args),
  },
}));

jest.mock('expo-auth-session', () => ({
  __esModule: true,
  makeRedirectUri: jest.fn().mockReturnValue('voicealarm://redirect'),
  useAuthRequest: jest.fn().mockReturnValue([null, null, jest.fn()]),
}));

jest.mock('expo-web-browser', () => ({
  __esModule: true,
  maybeCompleteAuthSession: jest.fn(),
}));

jest.mock('expo-apple-authentication', () => ({
  __esModule: true,
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  decodeIdToken,
  saveAuthToken,
  getAuthToken,
  getAuthProvider,
  signOut,
  isAppleAuthAvailable,
  signInWithApple,
} from '../src/services/auth';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
});

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.fake-signature`;
}

describe('decodeIdToken', () => {
  it('유효한 JWT에서 sub/email/name/picture를 추출한다', () => {
    const token = makeJwt({
      sub: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
    });

    const result = decodeIdToken(token);

    expect(result).toEqual({
      sub: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      picture: 'https://example.com/avatar.jpg',
    });
  });

  it('선택적 필드가 없으면 undefined로 반환한다', () => {
    const token = makeJwt({ sub: 'user-123' });

    const result = decodeIdToken(token);

    expect(result).toEqual({
      sub: 'user-123',
      email: undefined,
      name: undefined,
      picture: undefined,
    });
  });

  it('base64url 인코딩된 토큰을 처리한다', () => {
    const payload = { sub: 'user+special/chars==' };
    const b64 = btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `header.${b64}.sig`;

    const result = decodeIdToken(token);

    expect(result?.sub).toBe('user+special/chars==');
  });

  it('3파트가 아닌 토큰은 null을 반환한다', () => {
    expect(decodeIdToken('only-one-part')).toBeNull();
    expect(decodeIdToken('two.parts')).toBeNull();
    expect(decodeIdToken('')).toBeNull();
  });

  it('유효하지 않은 base64는 null을 반환한다', () => {
    expect(decodeIdToken('a.!!!invalid!!!.c')).toBeNull();
  });

  it('유효하지 않은 JSON은 null을 반환한다', () => {
    const invalidJson = btoa('not json');
    expect(decodeIdToken(`a.${invalidJson}.c`)).toBeNull();
  });
});

describe('saveAuthToken', () => {
  it('auth_token과 auth_provider를 AsyncStorage에 저장한다', async () => {
    await saveAuthToken('my-token', 'google');

    expect(mockSetItem).toHaveBeenCalledWith('auth_token', 'my-token');
    expect(mockSetItem).toHaveBeenCalledWith('auth_provider', 'google');
  });

  it('apple provider도 정상 저장한다', async () => {
    await saveAuthToken('apple-token', 'apple');

    expect(mockSetItem).toHaveBeenCalledWith('auth_provider', 'apple');
  });
});

describe('getAuthToken', () => {
  it('AsyncStorage에서 auth_token을 조회한다', async () => {
    mockGetItem.mockResolvedValue('stored-token');

    const token = await getAuthToken();

    expect(mockGetItem).toHaveBeenCalledWith('auth_token');
    expect(token).toBe('stored-token');
  });

  it('토큰이 없으면 null을 반환한다', async () => {
    mockGetItem.mockResolvedValue(null);

    const token = await getAuthToken();

    expect(token).toBeNull();
  });
});

describe('getAuthProvider', () => {
  it('AsyncStorage에서 auth_provider를 조회한다', async () => {
    mockGetItem.mockResolvedValue('google');

    const provider = await getAuthProvider();

    expect(mockGetItem).toHaveBeenCalledWith('auth_provider');
    expect(provider).toBe('google');
  });
});

describe('signOut', () => {
  it('auth_token, auth_provider, user_id를 모두 삭제한다', async () => {
    await signOut();

    expect(mockRemoveItem).toHaveBeenCalledWith('auth_token');
    expect(mockRemoveItem).toHaveBeenCalledWith('auth_provider');
    expect(mockRemoveItem).toHaveBeenCalledWith('user_id');
    expect(mockRemoveItem).toHaveBeenCalledTimes(3);
  });
});

describe('isAppleAuthAvailable', () => {
  it('iOS에서 true를 반환한다', () => {
    (Platform as { OS: string }).OS = 'ios';
    expect(isAppleAuthAvailable()).toBe(true);
  });

  it('Android에서 false를 반환한다', () => {
    (Platform as { OS: string }).OS = 'android';
    expect(isAppleAuthAvailable()).toBe(false);
  });
});

describe('signInWithApple', () => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'ios';
  });

  afterEach(() => {
    (Platform as { OS: string }).OS = 'ios';
  });

  it('iOS가 아니면 null을 반환한다', async () => {
    (Platform as { OS: string }).OS = 'android';

    const result = await signInWithApple();

    expect(result).toBeNull();
  });

  it('성공 시 idToken과 user 정보를 반환한다', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
      identityToken: 'apple-id-token',
      user: 'apple-user-id',
      email: 'test@icloud.com',
      fullName: { givenName: '테스트', familyName: '김' },
    });

    const result = await signInWithApple();

    expect(result).toEqual({
      idToken: 'apple-id-token',
      user: {
        id: 'apple-user-id',
        email: 'test@icloud.com',
        name: '테스트 김',
      },
    });
  });

  it('identityToken이 없으면 null을 반환한다', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
      identityToken: null,
      user: 'id',
    });

    const result = await signInWithApple();

    expect(result).toBeNull();
  });

  it('fullName이 없으면 name이 null이다', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockResolvedValue({
      identityToken: 'token',
      user: 'id',
      email: null,
      fullName: null,
    });

    const result = await signInWithApple();

    expect(result?.user.name).toBeNull();
  });

  it('사용자 취소(ERR_REQUEST_CANCELED)는 null을 반환한다', async () => {
    const cancelErr = new Error('canceled');
    Object.assign(cancelErr, { code: 'ERR_REQUEST_CANCELED' });
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue(cancelErr);

    const result = await signInWithApple();

    expect(result).toBeNull();
  });

  it('그 외 에러는 throw한다', async () => {
    (AppleAuthentication.signInAsync as jest.Mock).mockRejectedValue(
      new Error('network error'),
    );

    await expect(signInWithApple()).rejects.toThrow('network error');
  });
});
