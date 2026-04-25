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

import { request, get, post, patch, del, ApiError } from '../src/services/api/core';

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetItem.mockResolvedValue(null);
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ApiError', () => {
  it('status와 responseData를 포함한다', () => {
    const err = new ApiError(422, { error: 'invalid' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(422);
    expect(err.responseData).toEqual({ error: 'invalid' });
    expect(err.message).toBe('API Error 422');
  });
});

describe('request()', () => {
  it('인증 토큰이 있으면 Authorization 헤더를 추가한다', async () => {
    mockGetItem.mockResolvedValue('my-jwt-token');
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));

    await request({ method: 'GET', path: '/test' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer my-jwt-token');
  });

  it('인증 토큰이 없으면 Authorization 헤더를 생략한다', async () => {
    mockGetItem.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));

    await request({ method: 'GET', path: '/test' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('JSON body를 직렬화하고 Content-Type을 설정한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { id: '1' }));

    await request({ method: 'POST', path: '/items', body: { name: 'test' } });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ name: 'test' }));
  });

  it('isFormData=true이면 body를 직렬화하지 않고 Content-Type을 생략한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));
    const formData = new FormData();

    await request({ method: 'POST', path: '/upload', body: formData, isFormData: true });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe(formData);
  });

  it('params를 쿼리스트링으로 추가한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, []));

    await request({ method: 'GET', path: '/search', params: { q: 'hello', page: '2' } });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('?q=hello&page=2');
  });

  it('빈 params는 쿼리스트링을 추가하지 않는다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, []));

    await request({ method: 'GET', path: '/items', params: {} });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).not.toContain('?');
  });

  it('body가 null이면 body를 전송하지 않는다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}));

    await request({ method: 'GET', path: '/items' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it('200 응답의 JSON을 파싱하여 반환한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { id: 'abc', name: 'test' }));

    const result = await request<{ id: string; name: string }>({ method: 'GET', path: '/items/abc' });

    expect(result).toEqual({ id: 'abc', name: 'test' });
  });

  it('204 응답은 undefined를 반환한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(emptyResponse(204));

    const result = await request({ method: 'DELETE', path: '/items/1' });

    expect(result).toBeUndefined();
  });

  it('401 응답은 auth_token을 삭제하고 ApiError를 던진다', async () => {
    mockGetItem.mockResolvedValue('expired-token');
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(401, { error: 'unauthorized' }),
    );

    await expect(request({ method: 'GET', path: '/me' })).rejects.toThrow(ApiError);
    expect(mockRemoveItem).toHaveBeenCalledWith('auth_token');
  });

  it('401 ApiError에 정확한 status와 responseData가 포함된다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(401, { error: 'token expired' }),
    );

    try {
      await request({ method: 'GET', path: '/me' });
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).responseData).toEqual({ error: 'token expired' });
    }
  });

  it('4xx 에러는 ApiError를 던진다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(422, { error: 'validation failed' }),
    );

    await expect(request({ method: 'POST', path: '/items' })).rejects.toThrow(ApiError);
  });

  it('5xx 에러는 ApiError를 던진다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      jsonResponse(500, { error: 'internal' }),
    );

    await expect(request({ method: 'GET', path: '/fail' })).rejects.toThrow(ApiError);
  });

  it('에러 응답의 body가 JSON이 아니면 responseData가 null이다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    try {
      await request({ method: 'GET', path: '/fail' });
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).responseData).toBeNull();
    }
  });

  it('커스텀 headers를 병합한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}));

    await request({
      method: 'GET',
      path: '/items',
      headers: { 'X-Custom': 'value' },
    });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-Custom']).toBe('value');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('AbortController signal을 fetch에 전달한다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, {}));

    await request({ method: 'GET', path: '/items' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('retry behavior', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    });
  });

  afterEach(() => {
    (global.setTimeout as unknown as jest.SpyInstance).mockRestore();
  });

  it('GET 요청은 5xx 에러 시 자동으로 재시도한다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await request<{ ok: boolean }>({ method: 'GET', path: '/flaky' });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('GET 요청은 네트워크 에러 시 재시도한다', async () => {
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await request<{ ok: boolean }>({ method: 'GET', path: '/flaky' });

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('GET 요청은 최대 3회(초기+재시도2) 시도 후 실패한다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValue(jsonResponse(500, { error: 'down' }));

    await expect(request({ method: 'GET', path: '/down' })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('4xx 에러는 재시도하지 않는다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(422, { error: 'validation' }));

    await expect(request({ method: 'GET', path: '/bad' })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('401 에러는 재시도하지 않는다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }));

    await expect(request({ method: 'GET', path: '/auth' })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('POST 요청은 기본적으로 재시도하지 않는다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }));

    await expect(request({ method: 'POST', path: '/create', body: {} })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('PATCH 요청은 기본적으로 재시도하지 않는다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }));

    await expect(request({ method: 'PATCH', path: '/update', body: {} })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('DELETE 요청은 기본적으로 재시도하지 않는다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }));

    await expect(request({ method: 'DELETE', path: '/remove' })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retry=0으로 GET 재시도를 비활성화할 수 있다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }));

    await expect(request({ method: 'GET', path: '/no-retry', retry: 0 })).rejects.toThrow(ApiError);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retry 옵션으로 POST 재시도를 활성화할 수 있다', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }))
      .mockResolvedValueOnce(jsonResponse(200, { id: '1' }));

    const result = await request<{ id: string }>({
      method: 'POST',
      path: '/create',
      body: {},
      retry: 1,
    });

    expect(result).toEqual({ id: '1' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('재시도 사이에 지수 백오프 딜레이가 적용된다', async () => {
    const sleepCalls: number[] = [];
    (global.setTimeout as unknown as jest.SpyInstance).mockRestore();
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
      if (ms != null && ms > 100 && ms < 10000) sleepCalls.push(ms);
      fn();
      return 0 as unknown as NodeJS.Timeout;
    });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }))
      .mockResolvedValueOnce(jsonResponse(500, { error: 'internal' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await request<{ ok: boolean }>({ method: 'GET', path: '/slow' });

    expect(sleepCalls.length).toBe(2);
    expect(sleepCalls[0]!).toBeGreaterThanOrEqual(500);
    expect(sleepCalls[0]!).toBeLessThanOrEqual(1500);
    expect(sleepCalls[1]!).toBeGreaterThanOrEqual(1000);
    expect(sleepCalls[1]!).toBeLessThanOrEqual(3000);
  });
});

describe('convenience methods', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse(200, { ok: true }));
  });

  it('get()은 GET 메서드와 params를 전달한다', async () => {
    await get('/items', { page: '1' });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('GET');
    expect(url).toContain('page=1');
  });

  it('post()는 POST 메서드와 body를 전달한다', async () => {
    await post('/items', { name: 'new' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'new' }));
  });

  it('post()는 isFormData 옵션을 전달한다', async () => {
    const fd = new FormData();
    await post('/upload', fd, { isFormData: true });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.body).toBe(fd);
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('patch()는 PATCH 메서드와 body를 전달한다', async () => {
    await patch('/items/1', { name: 'updated' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ name: 'updated' }));
  });

  it('del()은 DELETE 메서드를 전달한다', async () => {
    await del('/items/1');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('DELETE');
  });
});
