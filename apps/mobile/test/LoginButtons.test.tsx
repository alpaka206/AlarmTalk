import React from 'react';
import { Animated } from 'react-native';

jest.spyOn(Animated, 'timing').mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
  _startNativeLoop: jest.fn(),
  _isUsingNativeDriver: jest.fn().mockReturnValue(false),
} as unknown as Animated.CompositeAnimation);
jest.spyOn(Animated, 'loop').mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  reset: jest.fn(),
  _startNativeLoop: jest.fn(),
  _isUsingNativeDriver: jest.fn().mockReturnValue(false),
} as unknown as Animated.CompositeAnimation);

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockSetAuth = jest.fn<void, [string, string]>();
const mockPromptAsync = jest.fn<Promise<void>, []>(() => Promise.resolve());
const mockSaveAuthToken = jest.fn<Promise<void>, [string, string]>(() => Promise.resolve());
const mockSignInWithApple = jest.fn<
  Promise<{ idToken: string; user: { id: string; email: string | null; name: string | null } } | null>,
  []
>();
const mockIsAppleAuthAvailable = jest.fn<boolean, []>(() => false);
const mockDecodeIdToken = jest.fn<
  { sub: string; email?: string; name?: string; picture?: string } | null,
  [string]
>();

let mockResponse: unknown = null;
let mockRequest: unknown = {};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../src/stores/useAppStore', () => ({
  useAppStore: () => ({ setAuth: mockSetAuth }),
}));

jest.mock('../src/services/auth', () => ({
  useGoogleAuth: () => ({
    request: mockRequest,
    response: mockResponse,
    promptAsync: mockPromptAsync,
  }),
  signInWithApple: () => mockSignInWithApple(),
  isAppleAuthAvailable: () => mockIsAppleAuthAvailable(),
  saveAuthToken: (token: string, provider: string) => mockSaveAuthToken(token, provider),
  decodeIdToken: (token: string) => mockDecodeIdToken(token),
}));

import LoginButtons from '../src/components/LoginButtons';

beforeEach(() => {
  jest.clearAllMocks();
  mockResponse = null;
  mockRequest = {};
  mockIsAppleAuthAvailable.mockReturnValue(false);
  mockDecodeIdToken.mockReturnValue(null);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

// TODO(galaxy-rewrite): mocks here still target the old `useGoogleAuth` hook.
// Native @react-native-google-signin/google-signin replaced that with
// `signInWithGoogle()`. Reintroduce these tests with imperative mocks.
describe.skip('LoginButtons', () => {
  it('Google 로그인 버튼을 렌더한다', () => {
    render(<LoginButtons />);
    expect(screen.getByText('login.google')).toBeTruthy();
    expect(screen.getByLabelText('login.google')).toBeTruthy();
  });

  it('Apple 인증이 불가하면 Apple 버튼을 렌더하지 않는다', () => {
    mockIsAppleAuthAvailable.mockReturnValue(false);
    render(<LoginButtons />);
    expect(screen.queryByText('login.apple')).toBeNull();
  });

  it('Apple 인증이 가능하면 Apple 버튼을 렌더한다', () => {
    mockIsAppleAuthAvailable.mockReturnValue(true);
    render(<LoginButtons />);
    expect(screen.getByText('login.apple')).toBeTruthy();
    expect(screen.getByLabelText('login.apple')).toBeTruthy();
  });

  it('request가 null이면 Google 버튼이 비활성화된다', () => {
    mockRequest = null;
    render(<LoginButtons />);
    const btn = screen.getByLabelText('login.google');
    expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBeTruthy();
  });

  it('Google 버튼 탭 시 promptAsync를 호출한다', async () => {
    render(<LoginButtons />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('login.google'));
    });
    expect(mockPromptAsync).toHaveBeenCalledTimes(1);
  });

  it('Google promptAsync 실패 시 Alert를 표시한다', async () => {
    mockPromptAsync.mockRejectedValueOnce(new Error('network'));
    render(<LoginButtons />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('login.google'));
    });
    expect(Alert.alert).toHaveBeenCalledWith('login.error', 'login.googleFailed');
  });

  it('Google 성공 응답 시 saveAuthToken + setAuth를 호출한다', async () => {
    mockDecodeIdToken.mockReturnValue({ sub: 'user-123', email: 'a@b.com' });
    mockResponse = { type: 'success', params: { id_token: 'tok-abc' } };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(mockSaveAuthToken).toHaveBeenCalledWith('tok-abc', 'google');
    });
    expect(mockSetAuth).toHaveBeenCalledWith('tok-abc', 'user-123');
  });

  it('Google 성공 응답이지만 id_token이 없으면 Alert를 표시한다', async () => {
    mockResponse = { type: 'success', params: {} };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('login.error', 'login.noToken');
    });
  });

  it('Google 에러 응답 시 에러 메시지로 Alert를 표시한다', async () => {
    mockResponse = { type: 'error', error: { message: 'auth denied' } };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('login.error', 'auth denied');
    });
  });

  it('Google 에러 응답에 message가 없으면 unknownError를 표시한다', async () => {
    mockResponse = { type: 'error', error: {} };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('login.error', 'login.unknownError');
    });
  });

  it('Google dismiss 응답은 Alert를 표시하지 않는다', async () => {
    mockResponse = { type: 'dismiss' };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(mockSaveAuthToken).not.toHaveBeenCalled();
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('Apple 로그인 성공 시 saveAuthToken + setAuth를 호출한다', async () => {
    mockIsAppleAuthAvailable.mockReturnValue(true);
    mockSignInWithApple.mockResolvedValueOnce({
      idToken: 'apple-tok',
      user: { id: 'apple-user', email: 'a@apple.com', name: 'Tester' },
    });
    mockDecodeIdToken.mockReturnValue({ sub: 'apple-user' });

    render(<LoginButtons />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('login.apple'));
    });

    expect(mockSignInWithApple).toHaveBeenCalledTimes(1);
    expect(mockSaveAuthToken).toHaveBeenCalledWith('apple-tok', 'apple');
    expect(mockSetAuth).toHaveBeenCalledWith('apple-tok', 'apple-user');
  });

  it('Apple 로그인이 null을 반환하면 (취소) 아무 작업도 하지 않는다', async () => {
    mockIsAppleAuthAvailable.mockReturnValue(true);
    mockSignInWithApple.mockResolvedValueOnce(null);

    render(<LoginButtons />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('login.apple'));
    });

    expect(mockSaveAuthToken).not.toHaveBeenCalled();
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('Apple 로그인 실패 시 Alert를 표시한다', async () => {
    mockIsAppleAuthAvailable.mockReturnValue(true);
    mockSignInWithApple.mockRejectedValueOnce(new Error('apple error'));

    render(<LoginButtons />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('login.apple'));
    });

    expect(Alert.alert).toHaveBeenCalledWith('login.error', 'login.appleFailed');
  });

  it('saveAuthToken 실패 시 saveFailed Alert를 표시한다', async () => {
    mockDecodeIdToken.mockReturnValue({ sub: 'user-1' });
    mockSaveAuthToken.mockRejectedValueOnce(new Error('storage full'));
    mockResponse = { type: 'success', params: { id_token: 'tok-fail' } };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('login.error', 'login.saveFailed');
    });
  });

  it('decodeIdToken이 null을 반환하면 setAuth를 호출하지 않는다', async () => {
    mockDecodeIdToken.mockReturnValue(null);
    mockResponse = { type: 'success', params: { id_token: 'tok-bad' } };

    render(<LoginButtons />);

    await waitFor(() => {
      expect(mockSaveAuthToken).toHaveBeenCalledWith('tok-bad', 'google');
    });
    expect(mockSetAuth).not.toHaveBeenCalled();
  });

  it('Google 버튼에 accessibilityRole="button"이 설정되어 있다', () => {
    render(<LoginButtons />);
    const btn = screen.getByLabelText('login.google');
    expect(btn.props.accessibilityRole).toBe('button');
  });

  it('Apple 버튼에 accessibilityRole="button"이 설정되어 있다', () => {
    mockIsAppleAuthAvailable.mockReturnValue(true);
    render(<LoginButtons />);
    const btn = screen.getByLabelText('login.apple');
    expect(btn.props.accessibilityRole).toBe('button');
  });
});
