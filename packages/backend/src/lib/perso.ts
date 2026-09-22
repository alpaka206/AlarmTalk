/**
 * Perso(ESTsoft) 영상 번역기 API — 랜딩 이벤트의 **메시지 클립** 생성.
 *
 * 인물의 목소리는 Perso 더빙 프로젝트의 화자로 살아 있다. 그 프로젝트의 문장(audio-sentence)
 * 하나를 **슬롯**으로 빌려, 문장 글자를 우리 메시지로 바꾼 뒤 다시 생성하면 그 인물 목소리로
 * 읽은 mp3 가 나온다. 문서: https://developers.perso.ai/llms.txt (헤더 `XP-API-KEY`, 파일은
 * `https://portal-media.perso.ai` + 상대 경로).
 *
 * 2026-09-16 실측으로 잡은 순서 — 문서만 보고는 알 수 없었다:
 *   1. `POST …/match-rewrite { targetText }` 가 문장 글자를 **저장**한다(응답의 matchingRate 는 무시).
 *   2. `PATCH …/generate-audio { targetText }` 는 **저장된 글자**로 소리를 만든다 — 보낸 targetText
 *      는 무시된다(1 없이 부르면 옛 글자가 읽힌다). 응답 `translatedText` 가 읽힌 글자다.
 *   ⚠ `PATCH …/audio-sentence/{seq}` (Translate Sentence) 는 AI 재번역이라 글자를 **짧게 고쳐
 *      버린다** — 쓰지 않는다.
 *   생성은 문장 길이에 따라 10~30초 걸리고 쿼터를 차감하지 않았다(1982 → 1982). 만든 파일은
 *   생성마다 새 이름(`…_AudioClip_<ms>.mp3`)이다. 우리는 그 파일을 곧바로 받아 응답으로
 *   돌려주고 어디에도 두지 않는다(`routes/event.ts`).
 *
 * 같은 슬롯에 두 요청이 겹치면 1 이 서로 덮어써서 남의 글자가 읽힐 수 있다. 그래서 응답
 * `translatedText` 가 보낸 글자와 다르면 `PersoSlotRace` 를 던지고, 호출자는 다른 슬롯으로 다시
 * 시도한다.
 */
export const PERSO_API_BASE = 'https://api.perso.ai';
export const PERSO_MEDIA_BASE = 'https://portal-media.perso.ai';

export type PersoSlot = { project: number; sentence: number };

export class PersoSlotRace extends Error {
  constructor(public readonly slot: PersoSlot) {
    super(`Perso slot ${slot.project}/${slot.sentence} was overwritten by another request`);
  }
}

/**
 * Perso 가 비정상 상태로 답했다. `status` 로 호출자가 원인 갈래를 태그한다(`routes/event.ts`).
 * 본문은 로그에만 — 키·내부 정보가 섞일 수 있다.
 */
export class PersoHttpError extends Error {
  constructor(
    public readonly status: number,
    method: string,
    path: string,
    detail: string,
  ) {
    super(`Perso ${method} ${path} → ${status}: ${detail}`);
  }
}

/** 5xx·연결 실패 한 번은 다시 보낸다 — 상태를 바꾸는 요청도 슬롯 하나에 같은 글자를 다시 쓰는 것이라 멱등이다. */
const PERSO_RETRY_DELAY_MS = 1_500;

/**
 * 이 요청에 남은 시간(epoch ms). 호출자가 준다 — 랜딩은 150초 뒤 요청을 끊으므로
 * (`event-api.ts` 의 `CLIP_TIMEOUT_MS`), **그 안에 못 끝낼 재시도는 하지 않는다**(코덱스 #796).
 * 예: 생성이 60초 만에 5xx 로 실패하면 남은 시간이 90초 상한보다 적어 다시 보내지 않는다 —
 * 보내 봐야 브라우저는 이미 끊은 뒤다.
 */
export type PersoDeadline = { readonly at: number } | undefined;

/** 마감을 넘겼다 — 더 기다려 봐야 받을 사람이 없다. */
export class PersoDeadlineExceeded extends Error {
  constructor() {
    super('clip budget exhausted');
  }
}

/** 이 상한으로 한 번 더 보낼 시간이 남았는가. 마감이 없으면(스크립트 등) 언제나 그렇다. */
function hasTimeForRetry(deadline: PersoDeadline, timeoutMs: number): boolean {
  if (!deadline) return true;
  return Date.now() + PERSO_RETRY_DELAY_MS + timeoutMs <= deadline.at;
}

/**
 * **한 번의 호출에 줄 상한** — 그 단계의 기본값과 남은 시간 중 작은 쪽이다(코덱스 #796 2차).
 *
 * 재시도 여부만 마감으로 가르면 부족하다: 앞 단계가 늦게 끝나도 **다음 단계는 자기 기본 상한을
 * 통째로** 받아(생성 90초·미디어 120초) 마감을 훌쩍 넘길 수 있다. 남은 시간이 없으면 부르지 않고
 * [PersoDeadlineExceeded] 를 던진다 — 이미 끊긴 요청을 위해 Perso 를 더 부르지 않는다.
 */
function budgetedTimeout(deadline: PersoDeadline, timeoutMs: number): number {
  if (!deadline) return timeoutMs;
  const left = deadline.at - Date.now();
  if (left <= 0) throw new PersoDeadlineExceeded();
  return Math.min(timeoutMs, left);
}

const STORE_TIMEOUT_MS = 20_000;
const GENERATE_TIMEOUT_MS = 90_000;
const LIST_TIMEOUT_MS = 20_000;
// 재생·다운로드는 이 응답을 그대로 흘려보내므로 느린 폰이 다 받을 때까지 넉넉히.
const MEDIA_TIMEOUT_MS = 120_000;

/**
 * Perso 호출 한 번. **5xx 와 연결 실패는 한 번 다시 보낸다**(2026-09-22, BACKEND-A — 여섯 클립이 22초
 * 안에 전부 502 로 끝났는데 몇 분 뒤에는 전부 됐다). 시간초과는 다시 보내지 않는다 — 생성은 90초
 * 상한이라 한 번 더 기다리면 클라의 150초를 넘긴다. 4xx 는 다시 보내도 같다.
 * 세 요청 다 멱등이다: 목록 읽기, 슬롯에 같은 글자 저장, 저장된 글자로 생성.
 */
async function persoRequest(
  apiKey: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown,
  timeoutMs: number,
  deadline?: PersoDeadline,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${PERSO_API_BASE}${path}`, {
        method,
        signal: AbortSignal.timeout(budgetedTimeout(deadline, timeoutMs)),
        headers: {
          'XP-API-KEY': apiKey,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // 시간초과(TimeoutError/AbortError)는 그대로 던진다. 연결 실패(`fetch failed`)만 한 번 더.
      if (attempt === 0 && !isAbort(err) && hasTimeForRetry(deadline, timeoutMs)) {
        await new Promise((r) => setTimeout(r, PERSO_RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
    if (res.ok) return (await res.json()) as Record<string, unknown>;
    // 본문은 로그에만(키·내부 정보가 섞일 수 있다). 호출자는 502 로 닫는다.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    if (attempt === 0 && res.status >= 500 && hasTimeForRetry(deadline, timeoutMs)) {
      console.warn(`[perso] ${method} ${path} → ${res.status}, retrying once`);
      await new Promise((r) => setTimeout(r, PERSO_RETRY_DELAY_MS));
      continue;
    }
    throw new PersoHttpError(res.status, method, path, detail);
  }
}

function isAbort(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * 실패를 Sentry 태그·로그용 갈래로 — 사용자 글자는 넣지 않는다. 2026-09-22 전에는 `console.error`
 * 한 줄뿐이라 BACKEND-A(502 ×7)가 왜 났는지 Sentry 에서 알 수 없었다.
 */
export function persoFailureReason(err: unknown): string {
  if (err instanceof PersoDeadlineExceeded) return 'deadline';
  if (err instanceof PersoSlotRace) return 'slot_race';
  if (err instanceof PersoHttpError) return `perso_http_${err.status}`;
  if (isAbort(err)) return 'timeout';
  const message = err instanceof Error ? err.message : String(err);
  if (/not an mp3/.test(message)) return 'bad_media';
  if (/no translatedText|no file path/.test(message)) return 'bad_response';
  if (/no slot succeeded/.test(message)) return 'no_slot';
  if (/fetch failed|ECONNRESET|ECONNREFUSED/i.test(message)) return 'network';
  return 'other';
}

/**
 * 프로젝트의 문장(슬롯) 번호 전부. 문장은 많다(voice1 ko 는 90개 넘게) — 커서로 끝까지 읽는다.
 * 호출자가 잠깐 들고 있다(`routes/event.ts` 의 isolate 캐시) — 요청마다 부르지 않는다.
 */
export async function listSentenceSeqs(
  apiKey: string,
  project: number,
  spaceSeq: number,
  deadline?: PersoDeadline,
): Promise<number[]> {
  const seqs: number[] = [];
  let cursor: number | null = null;
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ size: '10000' });
    if (cursor !== null) qs.set('cursorId', String(cursor));
    const json = await persoRequest(
      apiKey,
      'GET',
      `/video-translator/api/v1/projects/${project}/spaces/${spaceSeq}/script?${qs}`,
      undefined,
      LIST_TIMEOUT_MS,
      deadline,
    );
    const sentences = Array.isArray(json.sentences) ? (json.sentences as unknown[]) : [];
    for (const s of sentences) {
      const seq = (s as { seq?: unknown }).seq;
      if (typeof seq === 'number') seqs.push(seq);
    }
    if (json.hasNext !== true || typeof json.nextCursorId !== 'number') break;
    cursor = json.nextCursorId;
  }
  return seqs;
}

/** 슬롯에 글자를 넣고 그 인물 목소리로 읽게 한다. 돌려주는 값은 Perso 저장소의 파일 경로. */
export async function generateSentenceAudio(
  apiKey: string,
  slot: PersoSlot,
  text: string,
  deadline?: PersoDeadline,
): Promise<{ path: string }> {
  const base = `/video-translator/api/v1/project/${slot.project}/audio-sentence/${slot.sentence}`;
  await persoRequest(
    apiKey,
    'POST',
    `${base}/match-rewrite`,
    { targetText: text },
    STORE_TIMEOUT_MS,
    deadline,
  );
  const generated = (
    (await persoRequest(
      apiKey,
      'PATCH',
      `${base}/generate-audio`,
      { targetText: text },
      GENERATE_TIMEOUT_MS,
      deadline,
    )) as { result?: Record<string, unknown> }
  ).result;
  if (typeof generated?.translatedText !== 'string') {
    throw new Error('Perso generate-audio returned no translatedText');
  }
  if (generated.translatedText !== text) throw new PersoSlotRace(slot);
  const path = generated.generateAudioFilePath;
  if (typeof path !== 'string' || !path.startsWith('/perso-storage/')) {
    throw new Error('Perso generate-audio returned no file path');
  }
  return { path };
}

/** 저장소의 파일 주소. 경로에 한글·공백이 그대로 들어 있어 인코딩해야 한다(문서 규칙 5). */
export function persoMediaUrl(path: string): string {
  return `${PERSO_MEDIA_BASE}${encodeURI(path)}`;
}

/**
 * 저장소에서 파일을 받아 온다. `range` 를 주면 그대로 넘겨 206 을 받는다.
 * 저장소는 application/octet-stream 으로 주므로 호출자가 audio/mpeg 로 바꿔 단다.
 */
export async function fetchPersoMedia(
  path: string,
  range?: string,
  deadline?: PersoDeadline,
): Promise<Response> {
  const res = await fetch(persoMediaUrl(path), {
    signal: AbortSignal.timeout(budgetedTimeout(deadline, MEDIA_TIMEOUT_MS)),
    headers: range ? { range } : undefined,
  });
  // 상태를 실어 던진다 — 저장소의 일시 장애(503)와 **깨진 바이트**(bad_media)는 다른 사고다(코덱스 #796).
  if (!res.ok && res.status !== 206) {
    throw new PersoHttpError(res.status, 'GET', 'media', await res.text().catch(() => '').then((t) => t.slice(0, 300)));
  }
  return res;
}

/** 한 마디 인사말도 이보다는 크다(실측: 0.9초 = 22KB). */
export const MIN_CLIP_BYTES = 2048;

export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  return id3 || frameSync;
}
