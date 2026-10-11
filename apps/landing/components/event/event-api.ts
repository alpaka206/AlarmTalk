import { API_BASE } from "@/lib/site";
import type { Locale } from "@/i18n/routing";
import { EVENT_ID, type Celebrity, type MessageKind } from "./event-catalog";

/**
 * 이벤트 1 의 바깥 세계 — **생성**과 **좋아요**. 화면(카드·버튼·입력)은 이 파일만 안다.
 *
 * 생성(2026-09-16 결정: 문장 전체를 인물 목소리로): 서버(`POST /api/event/:id/clips`)가 Perso 로
 * 문장 하나를 만들어 **mp3 바이트를 그 응답으로** 준다. 어디에도 남지 않는다 — 이 탭의 메모리에
 * Blob 으로만 있고 나가면 사라진다(지시). 문장은 서버가 정한다 — 클라는 {인물, 이름, 언어, 종류}만
 * 보낸다. 만드는 데 10~30초 걸리므로 종류마다 따로 부르고 오는 대로 보여 준다.
 *
 * 좋아요: 백엔드의 공개 카운터(`packages/backend/src/routes/event.ts`)에 누른 횟수만큼
 * 더한다. 숫자는 서버가 준 것만 보여 준다 — 서버에 못 닿으면 숫자를 지어내지 않고 하트만 남긴다.
 */
export type Clip = {
  kind: MessageKind;
  locale: Locale;
  /** 받은 mp3. 재생·다운로드는 이걸로 만든 Blob URL(`src`)을 쓴다. */
  blob: Blob;
  /** `URL.createObjectURL(blob)`. 다 쓰면 `releaseClip` 으로 돌려준다. */
  src: string;
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

/**
 * 배포 창 자동 재시도의 간격(ms) — 순서대로 한 번씩, 다 쓰면 그만둔다.
 *
 * 왜 있나: 릴리스 머지 한 번에 랜딩(Vercel)과 백엔드(Workers)가 **따로** 올라가고 랜딩이 먼저 끝난다.
 * 그 뒤 워커가 올라오기까지 1분쯤은 옛 prod 워커가 이 번들의 새 종류(`love`)를 400 `INVALID_BODY` 로
 * 거절한다(`event-catalog.ts` 의 `MESSAGE_KINDS` ⚠). 그 창을 화면이 스스로 넘기려고 둔다 — 카드를
 * '생성 중' 으로 둔 채 3·6·12·24초 뒤에 다시 부르고(첫 거절부터 45초), 그래도 안 되면 원래대로
 * 실패 + '다시 시도' 다(`event-studio.tsx` 의 `request`).
 *
 * ⚠ 늘릴 때는 한도를 같이 본다. 거절(400)도 클립 한도(IP 당 분당 30 — 백엔드 `eventClipRateLimitMiddleware`)
 * 에 들어간다. 지금은 생성하기 한 번이 여섯 요청 + 다시 부르기 최대 세 언어 × 4 = 18 이다.
 *
 * 모든 prod 워커가 `love` 를 알게 되면(이 릴리스의 Deploy Backend(main)가 초록) 이 상수와
 * `deployWindowRetryDelayMs`, `event-studio.tsx` 의 `generate`·`retryTimersRef` 를 함께 지워도 된다
 * (`generate(0)` 은 도로 `generateClip(...)` 이 된다).
 */
export const DEPLOY_WINDOW_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000] as const;

/**
 * 실패한 생성을 자동으로 다시 부를지 — 기다릴 시간(ms), 다시 부르지 않으면 null.
 * `retried` 는 그 카드를 이미 자동으로 다시 부른 횟수(처음 실패면 0).
 *
 * `INVALID_BODY` **하나뿐**이다. 이 화면이 보내는 몸통에서 서버가 모를 수 있는 것은 종류뿐이라
 * (인물·언어는 카탈로그 값이고 이름은 서버와 같은 규칙으로 이미 걸렀다) 그 코드는 곧 '아직 옛 워커' 다.
 * 한도(`RATE_LIMITED`)·없는 목소리(`VOICE_NOT_AVAILABLE`)·망 오류는 기다린다고 달라지지 않거나 더
 * 나빠지니(한도) 곧바로 실패로 보여 준다.
 */
export function deployWindowRetryDelayMs(code: string, retried: number): number | null {
  if (code !== "INVALID_BODY") return null;
  return DEPLOY_WINDOW_RETRY_DELAYS_MS[retried] ?? null;
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
    const blob = await res.blob();
    if (!blob.type.startsWith("audio/") || blob.size === 0) {
      throw new ClipError("BAD_RESPONSE", res.status);
    }
    return { kind: req.kind, locale: req.locale, blob, src: URL.createObjectURL(blob) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Blob URL 을 돌려준다 — 페이지를 떠날 때(언마운트) 부른다. */
export function releaseClip(clip: Clip): void {
  URL.revokeObjectURL(clip.src);
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
