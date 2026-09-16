import { API_BASE } from "@/lib/site";
import type { Locale } from "@/i18n/routing";
import { EVENT_ID, type Celebrity, type MessageKind } from "./event-catalog";

/**
 * 이벤트 1 의 바깥 세계 — **생성**과 **좋아요**. 화면(카드·버튼·입력)은 이 파일만 안다.
 *
 * 생성(2026-09-16 결정: 문장 전체를 인물 목소리로): 서버(`POST /api/event/:id/clips`)가 Perso 로
 * 문장 하나를 만들어 R2 에 두고 그 파일의 경로와 **읽힌 문장**을 돌려준다. 문장은 서버가 정한다
 * — 클라는 {인물, 이름, 언어, 종류}만 보낸다. 같은 이름은 서버가 캐시해 두 번째부터는 곧바로
 * 온다. 처음 만들 때는 10~30초 걸리므로 종류마다 따로 부르고 오는 대로 보여 준다.
 *
 * 좋아요: 백엔드의 공개 카운터(`packages/backend/src/routes/event.ts`)에 누른 횟수만큼
 * 더한다. 숫자는 서버가 준 것만 보여 준다 — 서버에 못 닿으면 숫자를 지어내지 않고 하트만 남긴다.
 */
export type Clip = {
  kind: MessageKind;
  locale: Locale;
  /** 재생·다운로드용 절대 URL(서버가 내용 해시로 영구 캐시한다). */
  src: string;
  /** 화면에 보일 문장(감정 태그 없음, 줄바꿈은 문단). */
  text: string;
  /** 문장 안에서 이름이 실제로 읽히는 꼴(지민→지민아). 화면이 이 글자를 굵게 표시한다. */
  spoken: string;
};

export type ClipRequest = {
  celebrity: Celebrity;
  name: string;
  locale: Locale;
  kind: MessageKind;
};

/** 서버가 준 실패 이유. 화면 문구를 고르는 데 쓴다(`studio.errors.*`). */
export class ClipError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(`clip ${status} ${code}`);
  }
}

/** 생성 한 번의 상한. 서버가 슬롯 겹침을 만나면 최대 세 번 만든다(한 번에 ~30초). */
const CLIP_TIMEOUT_MS = 150_000;

export async function generateClip(req: ClipRequest, signal?: AbortSignal): Promise<Clip> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLIP_TIMEOUT_MS);
  const onOuterAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const res = await fetch(`${API_BASE}/api/event/${encodeURIComponent(EVENT_ID)}/clips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        celebrity: req.celebrity.id,
        name: req.name,
        locale: req.locale,
        kind: req.kind,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error_code?: unknown } | null;
      throw new ClipError(
        typeof body?.error_code === "string" ? body.error_code : "HTTP_ERROR",
        res.status,
      );
    }
    const body = (await res.json()) as { clip?: Record<string, unknown> };
    const c = body.clip;
    if (
      !c ||
      typeof c.path !== "string" ||
      typeof c.text !== "string" ||
      typeof c.spoken !== "string"
    ) {
      throw new ClipError("BAD_RESPONSE", res.status);
    }
    return {
      kind: req.kind,
      locale: req.locale,
      src: `${API_BASE}${c.path}`,
      text: c.text,
      spoken: c.spoken,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * 저장용 주소. 서버가 `download=` 를 보면 첨부 파일로 내려준다 — 다른 출처의 `<a download>` 는
 * 브라우저가 무시하므로 파일명은 서버가 헤더로 정한다(글자·숫자·공백만 남기고 60자).
 */
export function clipDownloadUrl(clip: Clip, fileName: string): string {
  return `${clip.src}?download=${encodeURIComponent(fileName)}`;
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
