import AsyncStorage from '@react-native-async-storage/async-storage';

const PRODUCTION_API_URL = 'https://voice-alarm-api.voicealarm.workers.dev';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (__DEV__ ? 'http://localhost:8787' : PRODUCTION_API_URL);

const BASE = `${API_BASE_URL}/api`;
const TIMEOUT_MS = 60000;

interface RequestConfig {
  method: string;
  path: string;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  isFormData?: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public responseData: unknown,
  ) {
    super(`API Error ${status}`);
    this.name = 'ApiError';
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

    if (res.status === 401) {
      await AsyncStorage.removeItem('auth_token');
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      throw new ApiError(res.status, errData);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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
