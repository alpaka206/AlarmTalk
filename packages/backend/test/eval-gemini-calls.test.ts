import { describe, expect, it, vi } from 'vitest';
import { createEvaluationFetch, evaluationPaths, type RawCall } from '../scripts/eval-gemini-calls';

const GENERATE = 'https://us-aiplatform.googleapis.com/v1/models/operational:generateContent';
const TOKEN = 'https://oauth2.googleapis.com/token';

function recording(fetch: typeof globalThis.fetch, calls: RawCall[]) {
  return createEvaluationFetch(fetch, {
    calls: () => calls, operationalModel: 'operational', model: () => 'evaluation', clientTimeoutMs: null,
  });
}

function brokenBody(error: Error) {
  return new Response(new ReadableStream({ start(controller) { controller.error(error); } }));
}

describe('평가 호출 기록', () => {
  it.each([GENERATE, TOKEN])('헤더 뒤 본문 실패도 한 시도로 남기고 원래 오류를 다시 던진다: %s', async (url) => {
    const failure = new Error('connection lost after headers');
    const calls: RawCall[] = [];
    const fetch = recording(vi.fn().mockResolvedValue(brokenBody(failure)), calls);
    await expect(fetch(url)).rejects.toThrow('connection lost after headers');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ status: 0, text: '', error: 'Error: connection lost after headers' });
    expect(calls[0]?.stage).toBe(url === TOKEN ? 'auth' : undefined);
  });

  it('실패 뒤 성공하면 두 시도를 남기고 호출자도 성공 본문을 읽을 수 있다', async () => {
    const calls: RawCall[] = [];
    const body = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'result' }] } }] };
    const upstream = vi.fn().mockResolvedValueOnce(brokenBody(new Error('timeout'))).mockResolvedValueOnce(Response.json(body));
    const fetch = recording(upstream, calls);
    await expect(fetch(GENERATE)).rejects.toThrow('timeout');
    const response = await fetch(GENERATE);
    expect(await response.json()).toEqual(body);
    expect(calls.map((call) => call.status)).toEqual([0, 200]);
    expect(calls[1]).toMatchObject({ text: 'result', finishReason: 'STOP', error: null });
    expect(upstream.mock.calls[0]?.[0]).toContain('/models/evaluation:generateContent');
  });

  it('성공한 인증 토큰 본문은 기록에 남기지 않는다', async () => {
    const calls: RawCall[] = [];
    const fetch = recording(vi.fn().mockResolvedValue(Response.json({ access_token: 'test-only-token' })), calls);
    const response = await fetch(TOKEN);
    expect(await response.json()).toEqual({ access_token: 'test-only-token' });
    expect(calls).toEqual([]);
  });

  it('인사 첫 시드는 크론과 등록 미리듣기를 별도로 평가한다', () => {
    expect(evaluationPaths('greeting', 0)).toEqual(['stock_clip', 'registration_preview']);
    expect(evaluationPaths('greeting', 1)).toEqual(['stock_clip']);
    expect(evaluationPaths('medication', 0)).toEqual(['stock_clip']);
  });
});
