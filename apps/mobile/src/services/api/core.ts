import AsyncStorage from '@react-native-async-storage/async-storage';

const PRODUCTION_API_URL = 'https://voice-alarm-api.voicealarm.workers.dev';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'http://localhost:8787' : PRODUCTION_API_URL);

const BASE = `${API_BASE_URL}/api`;
const TIMEOUT_MS = 60000;
const DEFAULT_GET_RETRIES = 2;
const RETRY_BASE_MS = 1000;

interface RequestConfig {
  method: string;
  path: string;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  isFormData?: boolean;
  retry?: number;
}

function retryDelay(attempt: number): number {
  return RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= 500;
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ApiError extends Error {
  public errorCode: string | null;

  constructor(
    public status: number,
    public responseData: unknown,
  ) {
    super(`API Error ${status}`);
    this.name = 'ApiError';
    this.errorCode =
      responseData != null &&
      typeof responseData === 'object' &&
      'error_code' in responseData &&
      typeof (responseData as Record<string, unknown>).error_code === 'string'
        ? (responseData as Record<string, unknown>).error_code as string
        : null;
  }
}

export async function request<T>(config: RequestConfig): Promise<T> {
  const token = await AsyncStorage.getItem('auth_token');

  const headers: Record<string, string> = { ...config.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!config.isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  let url = `${BASE}${config.path}`;
  if (config.params) {
    const qs = new URLSearchParams(config.params).toString();
    if (qs) url += `?${qs}`;
  }

  const maxRetries =
    config.retry ?? (config.method === 'GET' ? DEFAULT_GET_RETRIES : 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: config.method,
        headers,
        body: config.isFormData
          ? (config.body as FormData)
          : config.body != null
            ? JSON.stringify(config.body)
            : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        if (__DEV__) {
          // eslint-disable-next-line no-console
          console.log(
            `[API ${res.status}] ${config.method} ${config.path}`,
            'hasToken=', !!token,
            'tokenLen=', token?.length ?? 0,
            'body=', JSON.stringify(errData),
          );
        }
        if (res.status === 401) {
          await AsyncStorage.removeItem('auth_token');
          await AsyncStorage.removeItem('auth_provider');
          await AsyncStorage.removeItem('user_id');
          // Also clear in-memory auth so screens stop refetching with a stale
          // token and the navigation tree falls back to the login screen.
          // Dynamic import keeps this file free of a hard dep on the store.
          try {
            const { useAppStore } = await import('../../stores/useAppStore');
            useAppStore.getState().clearAuth?.();
          } catch {
            // best-effort — store missing should never happen at runtime
          }
        }
        throw new ApiError(res.status, errData);
      }

      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryable(error)) {
        await sleep(retryDelay(attempt));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

export function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  return request({ method: 'GET', path, params });
}

export function post<T>(
  path: string,
  body?: unknown,
  opts?: { isFormData?: boolean; headers?: Record<string, string> },
): Promise<T> {
  return request({ method: 'POST', path, body, ...opts });
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return request({ method: 'PATCH', path, body });
}

export function del<T>(path: string): Promise<T> {
  return request({ method: 'DELETE', path });
}
