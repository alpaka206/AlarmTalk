// **전송 실패와 내용 위반은 다른 사고다** — 회귀 방지(ALARMTALK-BACKEND-9).
//
// `generatePrerenderClipText` 는 3회 재시도 뒤 실패하는데, 예전에는 마지막에 무조건
// `AlarmTextPreparationInvalidError` 를 **새로 만들어** 던졌다. 그래서 세 회차가 전부
// fetch 실패(타임아웃·상류 5xx·서브리퀘스트 소진)여도 "모델이 금지 문장을 냈다" 와
// 똑같이 보였다 — 전자는 쿼터·자격증명을, 후자는 프롬프트·가드를 봐야 하는,
// **대응이 정반대인** 두 문제다.
//
// 덤으로 `runPrerenderBatch` 의 `String(genErr).includes('Too many subrequests')` 단축로가
// 구조적으로 맞을 수 없었다 — 그 문자열이 덮여 사라진 뒤였다.
//
// 그리고 거절 사유(길이/언어/지문/…)가 에러에 하나도 실리지 않아, Sentry 한 줄만 보고는
// 무엇을 고쳐야 하는지 알 수 없었다.
//
// ⚠ 사유는 **식별자만** 싣는다. 낭독 문구 원문은 개인 목소리 콘텐츠라 로그·태그로
//   흘려보내지 않는다 — 아래 마지막 테스트가 그것을 고정한다.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  AlarmTextPreparationInvalidError,
  alarmTextRejectionReasonOf,
  generatePrerenderClipText,
} from '../src/lib/vertex-translate';

const TOKEN_URI = 'https://oauth2.example.com/token';
const mockFetch = vi.fn();

const ENV: Env = {
  ELEVENLABS_API_KEY: 'x',
  TURSO_DATABASE_URL: 'x',
  TURSO_AUTH_TOKEN: 'x',
  GOOGLE_CLIENT_ID: 'x',
  GOOGLE_VERTEX_CREDENTIALS_JSON: '',
  JWT_SECRET: 'test-secret-32-chars-or-longer!',
  PASSWORD_PEPPER: 'pepper',
  ENVIRONMENT: 'test',
};

function okJson(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function geminiText(text: string) {
  return okJson({ candidates: [{ content: { parts: [{ text }] } }] });
}

function toPem(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  const base64 = btoa(binary).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  ENV.GOOGLE_VERTEX_CREDENTIALS_JSON = JSON.stringify({
    client_email: 'svc@test.iam.gserviceaccount.com',
    private_key: toPem(pkcs8),
    project_id: 'test-project',
    token_uri: TOKEN_URI,
  });
});

/**
 * 토큰 교환은 항상 성공시키고, 본문 생성만 시나리오대로 답한다.
 * 회차(3회)마다 fetch 가 두 번(토큰 → 본문) 나가므로 본문 응답은 따로 큐에 쌓는다.
 */
let contentResponses: Array<Response | Error>;

function queueContent(next: Response | Error) {
  contentResponses.push(next);
}

/** 세 회차 모두 같은 답을 받게 한다(재시도해도 결과가 같은 결정적 실패). */
function queueContentThrice(make: () => Response | Error) {
  for (let i = 0; i < 3; i += 1) queueContent(make());
}

beforeEach(() => {
  contentResponses = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: unknown) => {
    if (String(url) === TOKEN_URI) return okJson({ access_token: 'test-access-token' });
    const next = contentResponses.shift();
    if (!next) throw new Error('no content response queued');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', mockFetch);
});

/** 던져진 것을 그대로 받는다 — `rejects` 매처는 타입을 좁혀 주지 않는다. */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('실패할 줄 알았는데 성공했다');
}

describe('사전렌더 문구 생성 실패 — 전송 실패', () => {
  it('세 회차가 전부 전송 실패면 원본 에러가 그대로 올라온다', async () => {
    queueContentThrice(() => new Error('Vertex upstream unreachable (503)'));

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    );

    // ⚠ 여기가 뒤집히면 Sentry 에서 상류 장애와 프롬프트 사고가 한 그룹이 된다.
    expect(err).not.toBeInstanceOf(AlarmTextPreparationInvalidError);
    expect(String(err)).toContain('Vertex upstream unreachable (503)');
    expect(alarmTextRejectionReasonOf(err), '전송 실패에는 거절 사유가 없다').toBeNull();
  });

  it("서브리퀘스트 소진 문자열이 살아남는다 — 배치의 'Too many subrequests' 단축로가 이걸 본다", async () => {
    queueContentThrice(() => new Error('Too many subrequests.'));

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    );

    // `runPrerenderBatch` 는 문자열로 판정한다(stock-clips.ts). 에러를 덮어쓰면 그 판정이
    // 영영 거짓이 되고, 한도가 소진된 틱이 남은 대상마다 같은 오류를 반복한다.
    expect(String(err)).toContain('Too many subrequests');
  });

  it('앞 회차가 내용 위반이어도 마지막이 전송 실패면 전송 실패로 올린다', async () => {
    queueContent(geminiText(JSON.stringify({ text: '(다정하게) 일어나!', tag: '' })));
    queueContent(new Error('Vertex upstream unreachable (503)'));
    queueContent(new Error('Vertex upstream unreachable (503)'));

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    );

    expect(err).not.toBeInstanceOf(AlarmTextPreparationInvalidError);
    expect(String(err)).toContain('Vertex upstream unreachable (503)');
  });
});

describe('사전렌더 문구 생성 실패 — 거절 사유', () => {
  it('소괄호 지문은 stage_direction 으로 구분된다', async () => {
    queueContentThrice(() => geminiText(JSON.stringify({ text: '(다정하게) 일어나!', tag: '' })));

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    );

    expect(err).toBeInstanceOf(AlarmTextPreparationInvalidError);
    expect(alarmTextRejectionReasonOf(err)).toBe('stage_direction');
  });

  it('길이 초과는 too_long 으로 구분된다', async () => {
    // 200자를 넘기는 한 줄(태그를 벗긴 본문 기준).
    const tooLong = '좋은 아침이에요. '.repeat(30).trim();
    expect(tooLong.length).toBeGreaterThan(200);
    queueContentThrice(() => geminiText(JSON.stringify({ text: tooLong, tag: '' })));

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    );

    expect(alarmTextRejectionReasonOf(err)).toBe('too_long');
  });

  it('타깃 언어와 다른 글자는 language_mismatch 로 구분된다', async () => {
    queueContentThrice(() =>
      geminiText(JSON.stringify({ text: '좋은 아침이에요, 일어나세요.', tag: '' })),
    );

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: 'wake up', targetLanguage: 'ja' }),
    );

    expect(alarmTextRejectionReasonOf(err)).toBe('language_mismatch');
  });

  it('태그만 오면 empty_spoken 으로 구분된다', async () => {
    queueContentThrice(() => geminiText(JSON.stringify({ text: '[happy] [excited]', tag: '' })));

    const err = await caught(
      generatePrerenderClipText(ENV, { seed: '깨운다', targetLanguage: 'ko' }),
    );

    expect(alarmTextRejectionReasonOf(err)).toBe('empty_spoken');
  });

  it('Vertex 미설정은 내용 위반과 갈라 본다', async () => {
    const err = await caught(
      generatePrerenderClipText(
        { ...ENV, GOOGLE_VERTEX_CREDENTIALS_JSON: '' },
        { seed: '깨운다', targetLanguage: 'ko' },
      ),
    );

    expect(alarmTextRejectionReasonOf(err)).toBe('vertex_not_configured');
  });

  it('⚠ 낭독 문구 원문은 에러에 실리지 않는다 — 개인 목소리 콘텐츠다', async () => {
    const spoken = '(다정하게) 규원아, 약 먹을 시간이야.';
    queueContentThrice(() => geminiText(JSON.stringify({ text: spoken, tag: '' })));

    const err = await caught(
      generatePrerenderClipText(ENV, {
        seed: '약 먹을 시간이라고 알린다.',
        listenerTitle: '규원아',
        targetLanguage: 'ko',
      }),
    );

    // 사유 식별자는 싣되 문장·호칭은 싣지 않는다. 이 에러는 그대로 Sentry 태그가 된다.
    expect(alarmTextRejectionReasonOf(err)).toBe('stage_direction');
    expect(String(err)).not.toContain('규원아');
    expect(String(err)).not.toContain('약 먹을 시간');
  });
});
