export type RawCall = {
  status: number;
  finishReason: string | null;
  text: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  error: string | null;
  /** 'auth' = OAuth 토큰 발급 실패(생성 요청까지 가지 못했다). */
  stage?: 'auth';
};

/** fetch와 본문 읽기를 같은 시도로 기록한다. 인증 본문은 기록하지 않는다. */
export function createEvaluationFetch(realFetch: typeof fetch, options: {
  calls: () => RawCall[] | undefined;
  operationalModel: string;
  model: () => string;
  clientTimeoutMs: number | null;
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('oauth2.googleapis.com/token')) {
      // 토큰 발급 **실패**도 시도 하나로 센다(Codex #801) — 안 세면 인증 장애 중 시도 수·지연이 0 으로 잡힌다.
      // 성공한 발급은 생성 시도가 아니라서 남기지 않는다.
      const started = Date.now();
      const fail = (status: number, error: string) =>
        options.calls()?.push({
          status,
          finishReason: null,
          text: '',
          latencyMs: Date.now() - started,
          inputTokens: null,
          outputTokens: null,
          thoughtTokens: null,
          error,
          stage: 'auth',
        });
      try {
        const res = await realFetch(input, init);
        await res.clone().text(); // 본문 실패도 기록하되 토큰 값은 보관하지 않는다.
        if (!res.ok) fail(res.status, `auth ${res.status}`);
        return res;
      } catch (err) {
        fail(0, String(err).slice(0, 200));
        throw err;
      }
    }
    if (!url.includes(':generateContent')) return realFetch(input, init);
    const operational = `/models/${options.operationalModel}:generateContent`;
    // 운영 주소가 아니면 갈아 끼우지 않고 멈춘다 — 조용히 운영 모델로 평가하면 비교표가 거짓이 된다.
    if (!url.includes(operational)) throw new Error(`예상하지 못한 생성 주소다: ${url}`);
    const target = url.replace(operational, `/models/${options.model()}:generateContent`);
    const started = Date.now();
    const bucket = options.calls();
    let res: Response;
    let body = '';
    try {
      res = await realFetch(target, options.clientTimeoutMs ? { ...init, signal: AbortSignal.timeout(options.clientTimeoutMs) } : init);
      if (bucket) body = await res.clone().text();
    } catch (err) {
      // 타임아웃(운영 클라이언트의 15초 abort)·네트워크 실패도 **시도 하나**로 남긴다(Codex #801) —
      // 안 남기면 재시도 끝에 성공한 문구가 1회차 통과로 잡히고 지연 요약도 느린 쪽에 유리해진다.
      bucket?.push({
        status: 0,
        finishReason: null,
        text: '',
        latencyMs: Date.now() - started,
        inputTokens: null,
        outputTokens: null,
        thoughtTokens: null,
        error: String(err).slice(0, 200),
      });
      throw err;
    }
    if (bucket) {
      let j: {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        error?: { message?: string };
      } = {};
      try {
        j = JSON.parse(body);
      } catch {
        /* 비 JSON */
      }
      const cand = j.candidates?.[0];
      bucket.push({
        status: res.status,
        finishReason: cand?.finishReason ?? null,
        text: (cand?.content?.parts ?? [])
          .filter((p) => p.thought !== true)
          .map((p) => p.text ?? '')
          .join(''),
        latencyMs: Date.now() - started,
        inputTokens: j.usageMetadata?.promptTokenCount ?? null,
        outputTokens: j.usageMetadata?.candidatesTokenCount ?? null,
        thoughtTokens: j.usageMetadata?.thoughtsTokenCount ?? null,
        error: res.ok ? null : String(j.error?.message ?? res.status).slice(0, 200),
      });
    }
    return res;
  }) as typeof fetch;
}

/** 등록 첫 미리듣기는 인사 #0을 본보기 없이 생성한다. 크론과 별도 회차로 남긴다. */
export function evaluationPaths(category: string, index: number): ('stock_clip' | 'registration_preview')[] {
  return category === 'greeting' && index === 0 ? ['stock_clip', 'registration_preview'] : ['stock_clip'];
}
