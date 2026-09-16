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
 *   생성은 문장 길이에 따라 10~30초 걸리고 쿼터를 차감하지 않았다(1982 → 1982).
 *
 * 같은 슬롯에 두 요청이 겹치면 1 이 서로 덮어써서 남의 글자가 읽힐 수 있다. 그래서 응답
 * `translatedText` 가 보낸 글자와 다르면 `PersoSlotRace` 를 던지고, 호출자는 다른 슬롯으로 다시
 * 시도한다(`routes/event.ts`).
 */
export const PERSO_API_BASE = 'https://api.perso.ai';
export const PERSO_MEDIA_BASE = 'https://portal-media.perso.ai';

export type PersoSlot = { project: number; sentence: number };

export class PersoSlotRace extends Error {
  constructor(public readonly slot: PersoSlot) {
    super(`Perso slot ${slot.project}/${slot.sentence} was overwritten by another request`);
  }
}

export type GeneratedClip = { bytes: Uint8Array; mimeType: string };

const STORE_TIMEOUT_MS = 20_000;
const GENERATE_TIMEOUT_MS = 90_000;
const MEDIA_TIMEOUT_MS = 30_000;

async function persoJson(
  apiKey: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${PERSO_API_BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'XP-API-KEY': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // 본문은 로그에만(키·내부 정보가 섞일 수 있다). 호출자는 502 로 닫는다.
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Perso ${method} ${path} → ${res.status}: ${detail}`);
  }
  const json = (await res.json()) as { result?: unknown };
  return (json.result ?? {}) as Record<string, unknown>;
}

/** 슬롯에 글자를 넣고 그 인물 목소리로 읽은 mp3 를 받는다. */
export async function generateSentenceAudio(
  apiKey: string,
  slot: PersoSlot,
  text: string,
): Promise<GeneratedClip> {
  const base = `/video-translator/api/v1/project/${slot.project}/audio-sentence/${slot.sentence}`;
  await persoJson(apiKey, 'POST', `${base}/match-rewrite`, { targetText: text }, STORE_TIMEOUT_MS);
  const generated = await persoJson(
    apiKey,
    'PATCH',
    `${base}/generate-audio`,
    { targetText: text },
    GENERATE_TIMEOUT_MS,
  );
  if (typeof generated.translatedText !== 'string') {
    throw new Error('Perso generate-audio returned no translatedText');
  }
  if (generated.translatedText !== text) throw new PersoSlotRace(slot);
  const path = generated.generateAudioFilePath;
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error('Perso generate-audio returned no file path');
  }
  // 경로에 한글·공백이 그대로 들어 있어 인코딩해야 한다(문서 규칙 5).
  const media = await fetch(`${PERSO_MEDIA_BASE}${encodeURI(path)}`, {
    signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
  });
  if (!media.ok) throw new Error(`Perso media ${media.status}`);
  // 저장소는 application/octet-stream 으로 준다 — 확장자가 mp3 이니 그렇게 표시한다.
  const bytes = new Uint8Array(await media.arrayBuffer());
  // 캐시는 영구다(내용 해시 키 + immutable). 빈 몸통이나 오류 페이지를 mp3 로 박아 두면 그 이름은
  // 영영 깨진다 — 크기와 mp3 서명(ID3 태그 또는 프레임 동기 0xFFEx)을 보고 나서 받아들인다.
  if (bytes.byteLength < MIN_CLIP_BYTES || !looksLikeMp3(bytes)) {
    throw new Error(`Perso media is not an mp3 (${bytes.byteLength} bytes)`);
  }
  return { bytes, mimeType: 'audio/mpeg' };
}

/** 한 마디 인사말도 이보다는 크다(실측: 0.9초 = 22KB). */
const MIN_CLIP_BYTES = 2048;

export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) return false;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const frameSync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  return id3 || frameSync;
}
