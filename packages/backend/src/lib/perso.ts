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
 *   생성마다 새 이름(`…_AudioClip_<ms>.mp3`)이고, 문장을 다시 만들어도 앞 파일은 그대로 남아
 *   있었다 — 그래서 소리를 우리 쪽에 복사하지 않고 그 경로만 적어 둔다(`routes/event.ts`).
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

const STORE_TIMEOUT_MS = 20_000;
const GENERATE_TIMEOUT_MS = 90_000;
const LIST_TIMEOUT_MS = 20_000;
// 재생·다운로드는 이 응답을 그대로 흘려보내므로 느린 폰이 다 받을 때까지 넉넉히.
const MEDIA_TIMEOUT_MS = 120_000;

async function persoRequest(
  apiKey: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${PERSO_API_BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      'XP-API-KEY': apiKey,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // 본문은 로그에만(키·내부 정보가 섞일 수 있다). 호출자는 502 로 닫는다.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Perso ${method} ${path} → ${res.status}: ${detail}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * 프로젝트의 문장(슬롯) 번호 전부. 문장은 많다(윈터 ko 는 100개 넘게) — 커서로 끝까지 읽는다.
 * 호출자가 잠깐 들고 있다(`routes/event.ts` 의 isolate 캐시) — 요청마다 부르지 않는다.
 */
export async function listSentenceSeqs(
  apiKey: string,
  project: number,
  spaceSeq: number,
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
): Promise<{ path: string }> {
  const base = `/video-translator/api/v1/project/${slot.project}/audio-sentence/${slot.sentence}`;
  await persoRequest(apiKey, 'POST', `${base}/match-rewrite`, { targetText: text }, STORE_TIMEOUT_MS);
  const generated = (
    (await persoRequest(
      apiKey,
      'PATCH',
      `${base}/generate-audio`,
      { targetText: text },
      GENERATE_TIMEOUT_MS,
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
export async function fetchPersoMedia(path: string, range?: string): Promise<Response> {
  const res = await fetch(persoMediaUrl(path), {
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    headers: range ? { range } : undefined,
  });
  if (!res.ok && res.status !== 206) throw new Error(`Perso media ${res.status}`);
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
