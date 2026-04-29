import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthUnauthorizedError,
  fetchAuthLogin,
  fetchAuthMe,
  fetchAuthRegister,
  type AuthUser,
} from '../services/authApi';

export type { AuthUser } from '../services/authApi';

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, password: string, name: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'auth_token';

const PRODUCTION_API_URL = 'https://voice-alarm-api.voicealarm.workers.dev';

function resolveApiBase(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return `${explicit}/api`;
  const base = __DEV__ ? 'http://localhost:8787' : PRODUCTION_API_URL;
  return `${base}/api`;
}

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type FetchImpl = typeof fetch;

export interface AuthProviderProps {
  children: ReactNode;
  apiBase?: string;
  storage?: AsyncStorageLike;
  fetchImpl?: FetchImpl;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children, apiBase, storage, fetchImpl }: AuthProviderProps) {
  const base = apiBase ?? resolveApiBase();
  const store: AsyncStorageLike = storage ?? AsyncStorage;
  const config = useMemo(() => ({ apiBase: base, fetchImpl }), [base, fetchImpl]);

  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const bootedRef = useRef(false);

  const persistToken = useCallback(
    async (next: string | null) => {
      if (next) await store.setItem(STORAGE_KEY, next);
      else await store.removeItem(STORAGE_KEY);
    },
    [store],
  );

  const logout = useCallback(async () => {
    await persistToken(null);
    setToken(null);
    setUser(null);
    setError(null);
  }, [persistToken]);

  const refresh = useCallback(
    async (explicitToken?: string) => {
      const t = explicitToken ?? token;
      if (!t || refreshingRef.current) return;
      refreshingRef.current = true;
      setIsLoading(true);
      try {
        const fresh = await fetchAuthMe(config, t);
        setUser(fresh);
      } catch (err) {
        if (err instanceof AuthUnauthorizedError) {
          await logout();
          return;
        }
        setError(err instanceof Error ? err.message : 'refresh failed');
      } finally {
        refreshingRef.current = false;
        setIsLoading(false);
      }
    },
    [config, logout, token],
  );

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      try {
        const stored = await store.getItem(STORAGE_KEY);
        if (stored) {
          setToken(stored);
          await refresh(stored);
        } else {
          setIsLoading(false);
        }
      } catch {
        setIsLoading(false);
      }
    })();
    // boot은 마운트 시 1회만 실행. refresh/store 변경에도 재실행 금지.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      setError(null);
      setIsLoading(true);
      try {
        const body = await fetchAuthLogin(config, email, password);
        await persistToken(body.token);
        setToken(body.token);
        setUser(body.user);
        return body.user;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'login failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [config, persistToken],
  );

  const register = useCallback(
    async (email: string, password: string, name: string): Promise<AuthUser> => {
      setError(null);
      setIsLoading(true);
      try {
        const body = await fetchAuthRegister(config, email, password, name);
        await persistToken(body.token);
        setToken(body.token);
        setUser(body.user);
        return body.user;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'register failed';
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [config, persistToken],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      isAuthenticated: !!user,
      isLoading,
      error,
      login,
      register,
      logout,
      refresh: () => refresh(),
    }),
    [user, token, isLoading, error, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
