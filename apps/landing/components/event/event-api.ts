import { API_BASE } from "@/lib/site";
import { audioBufferToMp3, audioBufferToWav, loadClip, spliceNameAndBody } from "./audio-splice";
import { bodyClipSrc, EVENT_ID, MESSAGE_KINDS, type Celebrity, type MessageKind } from "./event-catalog";

/**
 * 이벤트 1 의 바깥 세계 — **생성**과 **좋아요**. 화면(카드·버튼·입력)은 이 파일만 안다.
 *
 * 생성(2026-09-15 결정: **이름만 더빙**): 문장 전체를 매번 만들지 않는다. 본문("생일 축하해! …")은
 * 인물마다 **미리 만든 파일**(`bodyClipSrc`)이고, 요청마다 새로 만드는 것은 앞에 붙는 이름
 * 한 마디뿐이다 — 서버(`POST /api/event/:id/name-clip`)가 Perso 로 그 인물 목소리의 이름
 * 클립을 돌려주면, 브라우저가 둘을 이어 붙인다(`audio-splice.ts`). 이름은 (인물, 이름) 당
 * 한 번만 받아 두 메시지에 같이 쓴다.
 *
 * 둘 중 하나라도 못 얻으면(서버 없음·파일 없음·Web Audio 없음) 브라우저 합성 음성으로
 * 문장 전체를 읽는다 — 흐름은 끊기지 않지만 파일이 없으니 다운로드는 닫힌다.
 *
 * 좋아요: 백엔드의 공개 카운터(`packages/backend/src/routes/event.ts`)에 누른 횟수만큼
 * 더한다. 숫자는 서버가 준 것만 보여 준다 — 서버에 못 닿으면 숫자를 지어내지 않고 하트만 남긴다.
 */
export type EventPlayback =
  | { kind: "speech"; text: string; lang: string; pitch: number; rate: number }
  | { kind: "url"; src: string; buffer: AudioBuffer };

const SPEECH_LANG: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
};

/**
 * 서버가 이름 클립을 못 줄 때 대신 쓸 **개발용** 파일(`.env.development`). 어떤 이름을 쳐도
 * 이 파일이 읽히므로 붙이는 동작만 확인하는 용도다. 운영 빌드에는 값이 없다.
 */
const NAME_CLIP_STUB = process.env.NEXT_PUBLIC_EVENT_NAME_CLIP_STUB;

const NAME_CLIP_TIMEOUT_MS = 15000;

export type GenerateRequest = {
  celebrity: Celebrity;
  /** 입력한 이름 그대로(조사 없이). 서버가 부르는 꼴을 정한다(`vocative`). */
  name: string;
  locale: string;
  /** 종류별 문장 — 태그를 벗긴 **문자열**(부르는 꼴이 이미 들어간 것). 합성 음성이 읽는다. */
  texts: Record<MessageKind, string>;
};

export type Bundle = Record<MessageKind, EventPlayback>;

/** 두 메시지를 한 번에. 이름 클립은 한 번만 받는다. */
export async function generateVoiceMessages(req: GenerateRequest): Promise<Bundle> {
  try {
    return await spliceBundle(req);
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.warn("[event] 합성 음성으로 대신합니다:", e);
    return Object.fromEntries(
      MESSAGE_KINDS.map((kind) => [kind, speechPlayback(req, kind)]),
    ) as Bundle;
  }
}

function speechPlayback(req: GenerateRequest, kind: MessageKind): EventPlayback {
  return {
    kind: "speech",
    text: req.texts[kind],
    lang: SPEECH_LANG[req.locale] ?? SPEECH_LANG.ko,
    pitch: req.celebrity.pitch,
    rate: req.celebrity.rate,
  };
}

/** 디코드·붙이기용 컨텍스트. 44.1kHz 로 고정해 두면 모든 클립이 같은 샘플레이트로 디코드된다. */
function decodeContext(): OfflineAudioContext {
  if (typeof OfflineAudioContext === "undefined") throw new Error("web audio unsupported");
  return new OfflineAudioContext(1, 1, 44100);
}

async function spliceBundle(req: GenerateRequest): Promise<Bundle> {
  const ctx = decodeContext();
  const [nameClip, ...bodies] = await Promise.all([
    fetchNameClip(ctx, req),
    ...MESSAGE_KINDS.map((kind) => loadClip(ctx, bodyClipSrc(req.celebrity.id, kind, req.locale))),
  ]);
  return Object.fromEntries(
    MESSAGE_KINDS.map((kind, i) => {
      const buffer = spliceNameAndBody(nameClip, bodies[i]);
      return [kind, { kind: "url", src: URL.createObjectURL(audioBufferToWav(buffer)), buffer }];
    }),
  ) as Bundle;
}

/**
 * 이름 클립. 서버가 `audio/*` 바이트를 돌려준다. 서버가 없거나 거절하면(503 = Perso 미설정,
 * 429 = 너무 잦음) 개발용 대체 파일이 있을 때만 그걸 쓰고, 아니면 던진다 → 합성 음성.
 */
async function fetchNameClip(ctx: OfflineAudioContext, req: GenerateRequest): Promise<AudioBuffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAME_CLIP_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/event/${encodeURIComponent(EVENT_ID)}/name-clip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ celebrity: req.celebrity.id, name: req.name, locale: req.locale }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`name clip ${res.status}`);
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch (e) {
    if (!NAME_CLIP_STUB) throw e;
    if (process.env.NODE_ENV !== "production") console.warn("[event] 이름 클립 대체 파일 사용:", e);
    return await loadClip(ctx, NAME_CLIP_STUB);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 다운로드할 파일 — 서버·브라우저가 만든 소리(url)일 때만. 저장은 mp3 로: 처음 누를 때
 * 인코더를 불러 만들고 같은 소리에 다시 누르면 그대로 준다. 합성 음성은 파일이 없다(null).
 */
const mp3Cache = new WeakMap<AudioBuffer, Promise<string>>();

export function downloadableSrc(playback: EventPlayback | undefined): Promise<string | null> {
  if (playback?.kind !== "url") return Promise.resolve(null);
  let hit = mp3Cache.get(playback.buffer);
  if (!hit) {
    hit = audioBufferToMp3(playback.buffer).then((blob) => URL.createObjectURL(blob));
    hit.catch(() => mp3Cache.delete(playback.buffer));
    mp3Cache.set(playback.buffer, hit);
  }
  return hit;
}

/** 좋아요 수. 서버가 모르는 대상은 키가 없다(= 숫자를 보여 주지 않는다). */
export type LikeCounts = Record<string, number>;

const LIKES_TIMEOUT_MS = 4000;

export async function fetchLikes(eventId: string): Promise<LikeCounts> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIKES_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/event/${encodeURIComponent(eventId)}/likes`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { likes?: Record<string, unknown> };
    const out: LikeCounts = {};
    for (const [id, n] of Object.entries(body.likes ?? {})) {
      if (typeof n === "number" && Number.isFinite(n)) out[id] = n;
    }
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** 누른 횟수만큼 더한다. 서버가 돌려준 새 수, 못 닿으면 null(화면은 낙관 값을 유지). */
export async function addLike(eventId: string, subjectId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${API_BASE}/api/event/${encodeURIComponent(eventId)}/likes/${encodeURIComponent(subjectId)}`,
      { method: "POST", cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { count?: unknown };
    return typeof body.count === "number" ? body.count : null;
  } catch {
    return null;
  }
}
