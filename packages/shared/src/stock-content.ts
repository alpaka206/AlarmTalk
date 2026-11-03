import { z } from 'zod';
import contentJson from './stock-content.json';

/**
 * 응원·기상 인사 문구 — **단일 출처는 옆의 `stock-content.json`** 이다.
 *
 * 규칙 전문은 `docs/spec/voice-and-message.md` §5-4. 요약:
 *
 * - **묶음(set)** 이 콘텐츠 버전이다(`cheer_v1` · `cheer_v2` · `wake_v1`). 묶음마다 저장 카테고리
 *   (`messages.category`)가 하나이고, 항목의 자리(`variant`)는 묶음 안의 순번이다 — **덧붙이기만 한다.**
 * - **ID 는 안정적이다.** 나간 ID 를 다른 뜻으로 쓰거나 지우지 않는다. 게시된 문장을 고치려면 새 묶음을 만든다.
 * - `baseline` 묶음은 공개 표식 없이도 살아 있다(이 파일 이전부터 게시돼 있던 옛 응원). 나머지는 환경마다
 *   `stock_content_releases` 에 표식이 있어야 매니페스트·`expected_variants`·클론 보충에 나온다.
 * - `legacy` 묶음은 옛 알람 참조용이라 새로 고르는 목록에서 뺀다(`selectable: false`).
 *
 * 서버는 이 파일로 스톡 프리셋(`STOCK_CLIP_PRESETS`)·클론 보충 시드·매니페스트 표지를 만들고, 검수표
 * (`docs/product/stock-content-review.md`)는 `scripts/gen-stock-content.py` 가 만든다(CI 가 `--check`).
 * 앱은 이 파일을 번들하지 않는다 — 매니페스트의 표지(`theme`·`content_id`·`selectable`)로 받는다.
 */
export const STOCK_CONTENT_LANGUAGES = ['ko', 'en', 'ja'] as const;
export type StockContentLanguage = (typeof STOCK_CONTENT_LANGUAGES)[number];

const ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const itemSchema = z.object({
  id: z.string().regex(ID_RE),
  texts: z.object({ ko: z.string().min(1), en: z.string().min(1), ja: z.string().min(1) }),
  /** 클론 사전렌더용 '의미 시드'(최종 문구가 아니라 생성 지시). 없으면 클론에는 굽지 않는다. */
  clone_seed: z.string().min(1).optional(),
});

const setSchema = z.object({
  id: z.string().regex(ID_RE),
  /** 이 묶음이 속한 테마(= 알람 `bucket_id`). */
  theme: z.string().regex(ID_RE),
  /** 저장 카테고리(`messages.category`). 묶음마다 하나 — 둘이 같은 카테고리를 쓰지 않는다. */
  category: z.string().regex(ID_RE),
  legacy: z.boolean(),
  baseline: z.boolean(),
  note: z.string(),
  items: z.array(itemSchema).min(1),
});

const fileSchema = z.object({
  $comment: z.string().optional(),
  sets: z.array(setSchema).min(1),
});

export type StockContentItem = z.infer<typeof itemSchema>;
export type StockContentSet = z.infer<typeof setSchema>;

const parsed = fileSchema.parse(contentJson);

/** 묶음 목록(파일 순서). */
export const STOCK_CONTENT_SETS: readonly StockContentSet[] = parsed.sets;

/** 공개 표식 없이도 살아 있는 묶음. */
export const STOCK_CONTENT_BASELINE_SET_IDS: ReadonlySet<string> = new Set(
  STOCK_CONTENT_SETS.filter((set) => set.baseline).map((set) => set.id),
);

/** 저장 카테고리 → 묶음. 묶음이 없는 카테고리(날씨·약·운세·greeting)는 undefined. */
export function stockContentSetForCategory(category: string | null | undefined): StockContentSet | undefined {
  if (!category) return undefined;
  return STOCK_CONTENT_SETS.find((set) => set.category === category);
}

/** 이 카테고리의 클립이 속한 테마. 묶음이 없는 카테고리는 카테고리 그대로다. */
export function stockThemeForCategory(category: string): string {
  return stockContentSetForCategory(category)?.theme ?? category;
}

export interface StockContentInfo {
  contentId: string;
  setId: string;
  theme: string;
  /** 새로 고를 수 있는가 — 옛 묶음(`legacy`)만 false. */
  selectable: boolean;
}

/** (카테고리, 자리) → 항목 표지. 묶음 밖이거나 자리가 범위를 넘으면 null. */
export function stockContentInfo(category: string | null | undefined, variant: number): StockContentInfo | null {
  const set = stockContentSetForCategory(category);
  if (!set) return null;
  const item = Number.isInteger(variant) && variant >= 0 ? set.items[variant] : undefined;
  if (!item) return null;
  return { contentId: item.id, setId: set.id, theme: set.theme, selectable: !set.legacy };
}

/** 묶음 ID → 묶음. */
export function stockContentSet(setId: string): StockContentSet | undefined {
  return STOCK_CONTENT_SETS.find((set) => set.id === setId);
}

/** 응원 테마의 모든 항목 ID(옛 묶음 포함). 알람의 고정 문구 검증에 쓴다. */
export const CHEER_CONTENT_IDS: ReadonlySet<string> = new Set(
  STOCK_CONTENT_SETS.filter((set) => set.theme === 'cheer').flatMap((set) => set.items.map((item) => item.id)),
);

/** 응원 테마의 선택 방식 — `alarms.cheer_mode`. 값이 없으면 `vary` 로 읽는다. */
export const CHEER_MODES = ['vary', 'pinned'] as const;
export type CheerMode = (typeof CHEER_MODES)[number];
