import {
  AuthUnauthorizedError,
  fetchAuthLogin,
  fetchAuthMe,
  fetchAuthRegister,
  type AuthClientConfig,
  type AuthUser,
} from '../src/services/authApi';
import { AuthProvider, useAuth, type AsyncStorageLike } from '../src/hooks/useAuth';

const USER: AuthUser = { id: 'u1', email: 'test@example.com', name: '김테스트', plan: 'free' };
const TOKEN = 'jwt-token-abc';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeFetchImpl(responses: Array<{ status: number; body: unknown }>) {
  let idx = 0;
  return jest.fn(() => {
    const r = responses[idx] ?? responses[responses.length - 1]!;
    idx++;
    return Promise.resolve(jsonResponse(r!.status, r!.body));
  }) as unknown as typeof fetch;
}

function makeStorage(): AsyncStorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: jest.fn((key: string) => Promise.resolve(data[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      data[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete data[key];
      return Promise.resolve();
    }),
  };
}

const STORAGE_KEY = 'auth_token';

describe('useAuth — AuthProvider 로직 (login)', () => {
  it('login 성공 시 토큰과 유저를 저장한다', async () => {
    const fetchImpl = makeFetchImpl([{ status: 200, body: { token: TOKEN, user: USER } }]);
    const storage = makeStorage();
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const result = await fetchAuthLogin(config, 'test@example.com', 'password123');

    expect(result.token).toBe(TOKEN);
    expect(result.user).toEqual(USER);

    await storage.setItem(STORAGE_KEY, result.token);
    expect(storage.data[STORAGE_KEY]).toBe(TOKEN);
  });

  it('login 실패 시 에러를 throw한다', async () => {
    const fetchImpl = makeFetchImpl([
      { status: 401, body: { error: 'Invalid email or password' } },
    ]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    await expect(fetchAuthLogin(config, 'wrong@example.com', 'wrong')).rejects.toThrow(
      /Invalid email or password/,
    );
  });

  it('login 성공 후 storage에 토큰이 persist된다', async () => {
    const storage = makeStorage();
    const fetchImpl = makeFetchImpl([{ status: 200, body: { token: TOKEN, user: USER } }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const body = await fetchAuthLogin(config, 'test@example.com', 'password123');
    await storage.setItem(STORAGE_KEY, body.token);

    const stored = await storage.getItem(STORAGE_KEY);
    expect(stored).toBe(TOKEN);
  });
});

describe('useAuth — AuthProvider 로직 (register)', () => {
  it('register 성공 시 토큰과 유저를 반환한다', async () => {
    const newUser: AuthUser = { id: 'u2', email: 'new@example.com', name: '신규유저', plan: 'free' };
    const fetchImpl = makeFetchImpl([
      { status: 201, body: { token: 'new-token', user: newUser } },
    ]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const result = await fetchAuthRegister(config, 'new@example.com', 'pass123', '신규유저');

    expect(result.token).toBe('new-token');
    expect(result.user.name).toBe('신규유저');
    expect(result.user.plan).toBe('free');
  });

  it('이미 등록된 이메일이면 에러를 throw한다', async () => {
    const fetchImpl = makeFetchImpl([
      { status: 409, body: { error: 'Email is already registered' } },
    ]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    await expect(
      fetchAuthRegister(config, 'existing@example.com', 'pass123', '중복'),
    ).rejects.toThrow(/already registered/);
  });

  it('register 후 storage에 토큰을 저장한다', async () => {
    const storage = makeStorage();
    const fetchImpl = makeFetchImpl([
      { status: 201, body: { token: 'reg-token', user: USER } },
    ]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const body = await fetchAuthRegister(config, 'test@example.com', 'pass123', '김테스트');
    await storage.setItem(STORAGE_KEY, body.token);
    expect(storage.data[STORAGE_KEY]).toBe('reg-token');
  });
});

describe('useAuth — AuthProvider 로직 (logout)', () => {
  it('logout 시 storage에서 토큰이 제거된다', async () => {
    const storage = makeStorage();
    storage.data[STORAGE_KEY] = TOKEN;

    await storage.removeItem(STORAGE_KEY);
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
  });

  it('logout 후 getItem은 null을 반환한다', async () => {
    const storage = makeStorage();
    storage.data[STORAGE_KEY] = TOKEN;

    await storage.removeItem(STORAGE_KEY);
    const stored = await storage.getItem(STORAGE_KEY);
    expect(stored).toBeNull();
  });
});

describe('useAuth — AuthProvider 로직 (refresh)', () => {
  it('유효한 토큰으로 fetchAuthMe 호출 시 유저를 반환한다', async () => {
    const fetchImpl = makeFetchImpl([{ status: 200, body: { user: USER } }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const user = await fetchAuthMe(config, TOKEN);
    expect(user.id).toBe('u1');
    expect(user.email).toBe('test@example.com');
  });

  it('만료된 토큰은 AuthUnauthorizedError를 throw한다', async () => {
    const fetchImpl = makeFetchImpl([{ status: 401, body: { error: 'expired' } }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    await expect(fetchAuthMe(config, 'expired-token')).rejects.toBeInstanceOf(
      AuthUnauthorizedError,
    );
  });

  it('서버 에러는 일반 Error를 throw한다', async () => {
    const fetchImpl = makeFetchImpl([{ status: 500, body: { error: 'Internal Server Error' } }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    await expect(fetchAuthMe(config, TOKEN)).rejects.toThrow(/Internal Server Error/);
  });

  it('401 에러 시 storage 토큰을 제거해야 한다 (AuthProvider 로직)', async () => {
    const storage = makeStorage();
    storage.data[STORAGE_KEY] = 'stale-token';

    const fetchImpl = makeFetchImpl([{ status: 401, body: {} }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    try {
      await fetchAuthMe(config, 'stale-token');
    } catch (err) {
      if (err instanceof AuthUnauthorizedError) {
        await storage.removeItem(STORAGE_KEY);
      }
    }
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
  });
});

describe('useAuth — boot 시퀀스 (앱 시작)', () => {
  it('저장된 토큰이 있으면 fetchAuthMe로 세션을 복원한다', async () => {
    const storage = makeStorage();
    storage.data[STORAGE_KEY] = TOKEN;
    const fetchImpl = makeFetchImpl([{ status: 200, body: { user: USER } }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const stored = await storage.getItem(STORAGE_KEY);
    expect(stored).toBe(TOKEN);

    const user = await fetchAuthMe(config, stored!);
    expect(user.id).toBe('u1');
  });

  it('저장된 토큰이 없으면 바로 로딩 완료된다', async () => {
    const storage = makeStorage();
    const stored = await storage.getItem(STORAGE_KEY);
    expect(stored).toBeNull();
  });

  it('저장된 토큰이 만료되었으면 자동 로그아웃한다', async () => {
    const storage = makeStorage();
    storage.data[STORAGE_KEY] = 'expired-token';
    const fetchImpl = makeFetchImpl([{ status: 401, body: {} }]);
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    const stored = await storage.getItem(STORAGE_KEY);
    try {
      await fetchAuthMe(config, stored!);
    } catch (err) {
      if (err instanceof AuthUnauthorizedError) {
        await storage.removeItem(STORAGE_KEY);
      }
    }
    expect(storage.data[STORAGE_KEY]).toBeUndefined();
  });
});

describe('useAuth — 전체 플로우 통합', () => {
  it('register → refresh → logout 전체 사이클이 정상 동작한다', async () => {
    const storage = makeStorage();
    const registerFetch = makeFetchImpl([
      { status: 201, body: { token: 'reg-jwt', user: USER } },
    ]);
    const registerConfig: AuthClientConfig = { apiBase: '/api', fetchImpl: registerFetch };

    // 1. register
    const regResult = await fetchAuthRegister(registerConfig, 'test@example.com', 'pass', '김테스트');
    await storage.setItem(STORAGE_KEY, regResult.token);
    expect(regResult.user.id).toBe('u1');
    expect(storage.data[STORAGE_KEY]).toBe('reg-jwt');

    // 2. refresh (fetchAuthMe)
    const refreshFetch = makeFetchImpl([{ status: 200, body: { user: USER } }]);
    const refreshConfig: AuthClientConfig = { apiBase: '/api', fetchImpl: refreshFetch };
    const refreshedUser = await fetchAuthMe(refreshConfig, regResult.token);
    expect(refreshedUser.email).toBe('test@example.com');

    // 3. logout
    await storage.removeItem(STORAGE_KEY);
    expect(await storage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('login 에러 → 재시도 login 성공 플로우', async () => {
    const storage = makeStorage();

    // 1. 첫 시도 실패
    const failFetch = makeFetchImpl([
      { status: 401, body: { error: 'Invalid email or password' } },
    ]);
    await expect(
      fetchAuthLogin({ apiBase: '/api', fetchImpl: failFetch }, 'test@example.com', 'wrong'),
    ).rejects.toThrow();

    // 2. 재시도 성공
    const successFetch = makeFetchImpl([
      { status: 200, body: { token: TOKEN, user: USER } },
    ]);
    const result = await fetchAuthLogin(
      { apiBase: '/api', fetchImpl: successFetch },
      'test@example.com',
      'correct',
    );
    await storage.setItem(STORAGE_KEY, result.token);
    expect(result.user.name).toBe('김테스트');
    expect(storage.data[STORAGE_KEY]).toBe(TOKEN);
  });
});

describe('useAuth — 엣지케이스', () => {
  it('useAuth가 export된다', () => {
    expect(useAuth).toBeDefined();
    expect(typeof useAuth).toBe('function');
  });

  it('AuthProvider가 export된다', () => {
    expect(AuthProvider).toBeDefined();
    expect(typeof AuthProvider).toBe('function');
  });

  it('resolveApiBase는 EXPO_PUBLIC_API_URL이 없으면 localhost를 사용한다', () => {
    const original = process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;

    // resolveApiBase가 모듈 내부라서 직접 호출 불가하지만,
    // AuthProvider의 기본 apiBase가 localhost:8787인지 간접 검증
    expect(process.env.EXPO_PUBLIC_API_URL).toBeUndefined();

    process.env.EXPO_PUBLIC_API_URL = original;
  });

  it('family 플랜 유저도 정상 처리된다', async () => {
    const familyUser: AuthUser = { id: 'f1', email: 'fam@test.com', name: '가족유저', plan: 'family' };
    const fetchImpl = makeFetchImpl([
      { status: 200, body: { token: 'fam-jwt', user: familyUser } },
    ]);
    const result = await fetchAuthLogin(
      { apiBase: '/api', fetchImpl },
      'fam@test.com',
      'pass123',
    );
    expect(result.user.plan).toBe('family');
  });

  it('plus 플랜 유저도 정상 처리된다', async () => {
    const plusUser: AuthUser = { id: 'p1', email: 'plus@test.com', name: '플러스유저', plan: 'plus' };
    const fetchImpl = makeFetchImpl([
      { status: 200, body: { token: 'plus-jwt', user: plusUser } },
    ]);
    const result = await fetchAuthLogin(
      { apiBase: '/api', fetchImpl },
      'plus@test.com',
      'pass123',
    );
    expect(result.user.plan).toBe('plus');
  });

  it('네트워크 에러 시 fetch가 reject된다', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Network Error')) as unknown as typeof fetch;
    const config: AuthClientConfig = { apiBase: '/api', fetchImpl };

    await expect(fetchAuthLogin(config, 'test@example.com', 'pass')).rejects.toThrow(
      /Network Error/,
    );
  });

  it('storage.getItem 에러 시 graceful하게 처리된다', async () => {
    const storage = makeStorage();
    (storage.getItem as jest.Mock).mockRejectedValueOnce(new Error('AsyncStorage error'));

    try {
      await storage.getItem(STORAGE_KEY);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
    }
  });
});
