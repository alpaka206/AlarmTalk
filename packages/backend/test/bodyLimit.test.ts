import { afterEach, describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { bodyLimitMiddleware } from '../src/middleware/bodyLimit';
import { authMiddleware } from '../src/middleware/auth';
import { errorCodeMiddleware } from '../src/middleware/errorCode';
import { logRouteError } from '../src/lib/logger';
import type { AppEnv, Env } from '../src/types';

const MIB = 1024 * 1024;

function streamRequest(stream: ReadableStream<Uint8Array>, headers: HeadersInit = {}) {
  return new Request('http://localhost/upload', {
    method: 'POST',
    body: stream,
    duplex: 'half',
    headers,
  } as RequestInit);
}

function trackedStream(chunkCount = 26, bytesPerChunk = MIB, prefix?: Uint8Array) {
  let pulls = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        ++pulls;
        if (prefix && pulls === 1) controller.enqueue(prefix);
        else if (pulls <= chunkCount + (prefix ? 1 : 0))
          controller.enqueue(new Uint8Array(bytesPerChunk));
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { stream, cancel, pulls: () => pulls };
}

function buildApp() {
  const app = new Hono();
  app.use('*', bodyLimitMiddleware);
  app.post('/upload', (c) => c.json({ ok: true }));
  return app;
}

describe('bodyLimitMiddleware', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, '1'])(
    'Content-Length=%s 여도 실제 25 MiB 초과는 거절한다',
    async (length) => {
      let reached = false;
      const input = trackedStream();
      const app = new Hono();
      app.use('*', bodyLimitMiddleware);
      app.post('/upload', async (c) => {
        await c.req.arrayBuffer();
        // 본문을 성공적으로 읽은 뒤에만 저장·외부 호출로 넘어갈 수 있다.
        reached = true;
        return c.json({ ok: true });
      });
      const res = await app.request(
        streamRequest(input.stream, length ? { 'Content-Length': length } : {}),
      );
      expect(res.status).toBe(413);
      expect((await res.json()).error_code).toBe('REQUEST_BODY_TOO_LARGE');
      expect(reached).toBe(false);
      expect(input.cancel).toHaveBeenCalledOnce();
      expect(input.pulls()).toBe(26);
    },
  );
  it('크기 검사 후에도 JSON 바이트와 요청 헤더를 그대로 라우트에 전달한다', async () => {
    const app = new Hono();
    app.use('*', bodyLimitMiddleware);
    app.post('/upload', async (c) =>
      c.json({ body: await c.req.json(), header: c.req.header('x-test') }),
    );
    const res = await app.request('/upload', {
      method: 'POST',
      body: '{"name":"한글"}',
      headers: { 'Content-Type': 'application/json', 'x-test': 'kept' },
    });
    expect(await res.json()).toEqual({ body: { name: '한글' }, header: 'kept' });
  });
  it('Content-Length 미포함 시 통과', async () => {
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/upload', { method: 'POST' }));
    expect(res.status).toBe(200);
  });

  it('25MB 이하 요청 통과', async () => {
    const app = buildApp();
    const res = await app.request(
      new Request('http://localhost/upload', {
        method: 'POST',
        headers: { 'Content-Length': String(25 * 1024 * 1024) },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('25MB 초과 시 413', async () => {
    const app = buildApp();
    const input = trackedStream();
    const res = await app.request(
      streamRequest(input.stream, { 'Content-Length': String(25 * MIB + 1) }),
    );
    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error).toContain('too large');
    expect(input.pulls()).toBe(0);
    expect(input.cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'Bearer not-a-jwt'])(
    'Authorization=%s 인증 거절은 본문을 한 청크도 읽지 않는다',
    async (authorization) => {
      const input = trackedStream();
      const app = new Hono<AppEnv>();
      app.use('*', bodyLimitMiddleware);
      // index.ts와 같은 전역 제한 → 하위 라우터 인증 순서다.
      const api = new Hono<AppEnv>();
      api.use('*', authMiddleware);
      const reached = vi.fn();
      api.post('/upload', (c) => {
        reached();
        return c.json({ ok: true });
      });
      app.route('/', api);
      const res = await app.request(
        streamRequest(input.stream, authorization ? { Authorization: authorization } : {}),
        undefined,
        { JWT_SECRET: 'body-limit-test-secret' } as Env,
      );
      expect(res.status).toBe(401);
      expect(input.pulls()).toBe(0);
      expect(input.cancel).toHaveBeenCalledOnce();
      expect(reached).not.toHaveBeenCalled();
    },
  );

  it.each(['pending', 'rejected'])(
    '입력 취소가 %s여도 인증 거절 응답을 기다리게 하지 않는다',
    async (cancellation) => {
      const pull = vi.fn();
      const cancel = vi.fn(() =>
        cancellation === 'pending'
          ? new Promise<void>(() => {})
          : Promise.reject(new Error('cancel failed')),
      );
      const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
      const app = new Hono<AppEnv>();
      app.use('*', bodyLimitMiddleware);
      app.use('*', authMiddleware);
      app.post('/upload', (c) => c.json({ ok: true }));
      const res = await app.request(streamRequest(stream));
      expect(res.status).toBe(401);
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it('라우트가 본문을 안 쓰면 용량 검사만을 위해 읽거나 비우지 않는다', async () => {
    const input = trackedStream();
    const res = await buildApp().request(streamRequest(input.stream));
    expect(res.status).toBe(200);
    expect(input.pulls()).toBe(0);
    expect(input.cancel).toHaveBeenCalledOnce();
  });

  it('소비자가 청크 하나를 요구하면 하나만 읽고 남은 입력은 응답 후 취소한다', async () => {
    const input = trackedStream(26, 8);
    const app = new Hono();
    app.use('*', bodyLimitMiddleware);
    app.post('/upload', async (c) => {
      expect(input.pulls()).toBe(0);
      const reader = c.req.raw.body!.getReader();
      const first = await reader.read();
      expect(input.pulls()).toBe(1);
      reader.releaseLock();
      return c.json({ bytes: Array.from(first.value!) });
    });
    const res = await app.request(streamRequest(input.stream));
    expect(await res.json()).toEqual({ bytes: Array(8).fill(0) });
    expect(input.pulls()).toBe(1);
    expect(input.cancel).toHaveBeenCalledOnce();
  });

  it('실제 25 MiB 경계의 바이너리 본문은 전부 전달한다', async () => {
    const input = trackedStream(25);
    const app = new Hono();
    app.use('*', bodyLimitMiddleware);
    app.post('/upload', async (c) => c.json({ size: (await c.req.arrayBuffer()).byteLength }));
    const res = await app.request(streamRequest(input.stream));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: 25 * MIB });
    expect(input.cancel).not.toHaveBeenCalled();
  });

  it('multipart 필드·파일 바이트도 별도 본문 사본 없이 파서에 전달한다', async () => {
    const app = new Hono();
    app.use('*', bodyLimitMiddleware);
    app.post('/upload', async (c) => {
      const form = await c.req.formData();
      const file = form.get('audio') as File;
      return c.json({
        name: form.get('name'),
        fileName: file.name,
        type: file.type,
        bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
      });
    });
    const form = new FormData();
    form.set('name', '목소리');
    form.set('audio', new File([new Uint8Array([0, 1, 255])], 'voice.wav', { type: 'audio/wav' }));
    const res = await app.request('/upload', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: '목소리',
      fileName: 'voice.wav',
      type: 'audio/wav',
      bytes: [0, 1, 255],
    });
  });

  it.each(['route-catch', 'on-error'])(
    '크기 초과가 %s에서 400/500으로 바뀌어도 최종 413만 기록한다',
    async (handling) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const captureException = vi.fn();
      // 정상 multipart 헤더 뒤의 파일 데이터에서 상한을 넘긴다. 잘못된 경계를 써서
      // 파서가 본문을 읽기도 전에 거절하는 경우와 크기 초과를 혼동하지 않는다.
      const prefix = new TextEncoder().encode(
        '--body-limit-test\r\nContent-Disposition: form-data; name="audio"; filename="voice.wav"\r\n' +
          'Content-Type: audio/wav\r\n\r\n',
      );
      const input = trackedStream(26, MIB, prefix);
      const app = new Hono<AppEnv>();
      app.use('*', async (c, next) => {
        c.set('sentry', { captureException });
        await next();
      });
      app.use('*', errorCodeMiddleware);
      app.use('*', bodyLimitMiddleware);
      app.post('/upload', async (c) => {
        if (handling === 'on-error') {
          await c.req.formData();
        } else {
          try {
            await c.req.formData();
          } catch {
            // 네이티브 파서/라우트가 원래 예외를 감싸도 요청별 초과 표시는 남는다.
            logRouteError(c, new Error('multipart parsing failed'));
            return c.json({ error: 'bad multipart', error_code: 'MULTIPART_BODY_REQUIRED' }, 400);
          }
        }
        return c.json({ ok: true });
      });
      app.onError((error, c) => {
        logRouteError(c, error);
        return c.json({ error: 'Internal server error', error_code: 'INTERNAL_ERROR' }, 500);
      });
      const res = await app.request(
        streamRequest(input.stream, {
          'Content-Type': 'multipart/form-data; boundary=body-limit-test',
        }),
      );
      expect(res.status).toBe(413);
      expect((await res.json()).error_code).toBe('REQUEST_BODY_TOO_LARGE');
      expect(input.cancel).toHaveBeenCalledOnce();
      expect(errorLog).not.toHaveBeenCalled();
      expect(captureException).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledOnce();
      expect(JSON.parse(String(warn.mock.calls[0]![0]))).toMatchObject({
        at: 'api_error',
        status: 413,
        code: 'REQUEST_BODY_TOO_LARGE',
      });
    },
  );

  it('크기 초과가 아닌 원본 스트림 오류는 서버 오류로 보존한다', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = new Hono();
    app.use('*', bodyLimitMiddleware);
    app.post('/upload', async (c) => c.json({ text: await c.req.text() }));
    const original = new Error('input stream failed');
    app.onError((error, c) => {
      expect(error).toBe(original);
      expect(c.get('requestBodyLimitExceeded')).not.toBe(true);
      logRouteError(c, error);
      return c.json({ error: 'Internal server error', error_code: 'INTERNAL_ERROR' }, 500);
    });
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.error(original);
        },
      },
      { highWaterMark: 0 },
    );
    const res = await app.request(streamRequest(stream));
    expect(res.status).toBe(500);
    expect(errorLog).toHaveBeenCalledOnce();
  });
});
