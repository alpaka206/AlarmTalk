/**
 * **응원·기상 인사 묶음의 합성량 dry-run** — 목소리 × 언어 × 문구의 실제 글자 수와 합성 요청 수를 낸다(스펙
 * `docs/spec/voice-and-message.md` §5-4 「공개 순서」 ②).
 *
 * ⚠ **합성하지 않는다.** 이 스크립트에는 합성·업로드·DB 경로가 없다 — 네트워크도 비밀값도 읽지 않는다. 굽기는
 *   `npm run preview:stock -- --category <카테고리>`, 게시는 `npm run publish:stock` 이 따로 한다.
 *
 * 글자는 **제공자에게 보내는 그 글자**로 센다(`systemStockTexts(...).synthesisText` — 서버·시청본·게시가 쓰는 같은 함수).
 * 셈은 코드 포인트다(검수표 `docs/product/stock-content-review.md` 와 같은 셈). 단가는 모른다 — 넘기면(`--credits-per-char`)
 * 곱해서 보여 줄 뿐, 값을 지어내지 않는다. 클론 보충은 문구를 그 목소리로 **생성**하므로 글자 수는 기본 목소리 문장
 * 길이로 어림한다(생성 문구는 그보다 조금 길거나 짧다). 클론 보충은 고른 사람만 굽는다(§5-4) — `--clones` 에는 그 수를 넣는다.
 *
 * 사용 (packages/backend 에서):
 *   npm run cost:stock                              # 공개 전 묶음 전부(cheer_v2·wake_v1)
 *   npm run cost:stock -- --set cheer_v2
 *   npm run cost:stock -- --set cheer_v2 --clones 120 --clone-language ko --credits-per-char 0.5
 */
import { STOCK_CONTENT_LANGUAGES, STOCK_CONTENT_SETS, type StockContentSet } from '@alarmtalk/shared';
import { CLONE_CONTENT_SUPPLEMENTS, systemStockTexts } from '../src/lib/stock-clips.ts';

/** 기본 목소리 4종 — `publish-stock-clips.ts`·`prerender-stock-preview.ts` 의 `VOICES` 와 같은 목록이다(이름만 쓴다). */
export const SYSTEM_VOICE_NAMES = ['시우', '미나', '도현', '애니'] as const;

export interface LanguageCost {
  language: string;
  phrases: number;
  /** 문구 하나를 한 목소리로 합성할 때의 글자 수 합(언어별). */
  chars: number;
  minChars: number;
  maxChars: number;
  /** 기본 목소리 전부로 구울 때 — 글자 × 목소리 수. */
  synthesisChars: number;
  requests: number;
}

export interface SetCost {
  setId: string;
  category: string;
  phrases: number;
  languages: LanguageCost[];
  synthesisChars: number;
  requests: number;
  /** 클론 보충 대상이면 그 시드 수(목소리 1개·언어 1개당 생성·합성 요청 수). 기본 목소리 전용이면 0. */
  cloneSupplementPhrases: number;
}

export function countChars(text: string): number {
  return [...systemStockTexts(text).synthesisText].length;
}

export function stockContentCost(set: StockContentSet, voiceCount: number = SYSTEM_VOICE_NAMES.length): SetCost {
  const languages = STOCK_CONTENT_LANGUAGES.map((language): LanguageCost => {
    const counts = set.items.map((item) => countChars(item.texts[language]));
    const chars = counts.reduce((sum, n) => sum + n, 0);
    return {
      language,
      phrases: counts.length,
      chars,
      minChars: Math.min(...counts),
      maxChars: Math.max(...counts),
      synthesisChars: chars * voiceCount,
      requests: counts.length * voiceCount,
    };
  });
  const supplement = CLONE_CONTENT_SUPPLEMENTS.find((s) => s.setId === set.id);
  return {
    setId: set.id,
    category: set.category,
    phrases: set.items.length,
    languages,
    synthesisChars: languages.reduce((sum, l) => sum + l.synthesisChars, 0),
    requests: languages.reduce((sum, l) => sum + l.requests, 0),
    cloneSupplementPhrases: supplement?.seeds.length ?? 0,
  };
}

export interface CostOptions {
  setIds?: readonly string[];
  clones?: number;
  cloneLanguage?: string;
  creditsPerChar?: number;
}

/** 사람이 읽을 표. 테스트가 같은 함수를 부른다. */
export function formatStockContentCost(options: CostOptions = {}): string {
  const sets = STOCK_CONTENT_SETS.filter((set) =>
    options.setIds && options.setIds.length > 0 ? options.setIds.includes(set.id) : !set.baseline,
  );
  const lines: string[] = [];
  lines.push('응원·기상 인사 합성량 dry-run — 합성하지 않는다.');
  lines.push(`기본 목소리 ${SYSTEM_VOICE_NAMES.length}종(${SYSTEM_VOICE_NAMES.join('·')}) × 언어 ${STOCK_CONTENT_LANGUAGES.length}개`);
  let totalChars = 0;
  let totalRequests = 0;
  for (const set of sets) {
    const cost = stockContentCost(set);
    totalChars += cost.synthesisChars;
    totalRequests += cost.requests;
    lines.push('');
    lines.push(`■ ${cost.setId} (카테고리 ${cost.category}) — 문구 ${cost.phrases}개`);
    lines.push('  언어  문구  글자 합(최소~최대)  × 목소리 = 합성 글자  요청');
    for (const l of cost.languages) {
      lines.push(
        `  ${l.language}    ${l.phrases}    ${l.chars}(${l.minChars}~${l.maxChars})    × ${SYSTEM_VOICE_NAMES.length} = ${l.synthesisChars}    ${l.requests}`,
      );
    }
    lines.push(`  소계: 합성 글자 ${cost.synthesisChars} · 요청 ${cost.requests}`);
    if (cost.cloneSupplementPhrases > 0) {
      const perVoice = cost.languages
        .map((l) => `${l.language} ≈${l.chars}자`)
        .join(' / ');
      lines.push(`  클론 보충(고른 클론 하나 · 앱 언어 하나): 생성·합성 요청 ${cost.cloneSupplementPhrases}개, 글자 ${perVoice}`);
      if (options.clones && options.clones > 0) {
        const lang = options.cloneLanguage ?? 'ko';
        const per = cost.languages.find((l) => l.language === lang)?.chars ?? 0;
        lines.push(
          `  클론 ${options.clones}개 × ${lang}: 합성 글자 ≈${per * options.clones} · 요청 ${cost.cloneSupplementPhrases * options.clones}`,
        );
      }
    } else {
      lines.push('  클론 보충: 없음(기본 목소리 전용)');
    }
  }
  lines.push('');
  lines.push(`합계(기본 목소리): 합성 글자 ${totalChars} · 요청 ${totalRequests}`);
  if (options.creditsPerChar !== undefined && Number.isFinite(options.creditsPerChar)) {
    lines.push(`  넘긴 단가 ${options.creditsPerChar}/자 → 약 ${Math.ceil(totalChars * options.creditsPerChar)}`);
  } else {
    lines.push('  단가는 넣지 않았다(--credits-per-char 로 넘기면 곱해 보여 준다).');
  }
  return lines.join('\n');
}

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

// 번들(`node_modules/.cache/stock-content-cost.mjs`)로 직접 돌릴 때만 출력한다 — 테스트가 불러올 때는 조용하다.
if (process.argv[1]?.endsWith('stock-content-cost.mjs')) {
  const setArg = argValue('--set');
  const clones = argValue('--clones');
  const credits = argValue('--credits-per-char');
  console.log(
    formatStockContentCost({
      setIds: setArg ? setArg.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
      clones: clones ? Number(clones) : undefined,
      cloneLanguage: argValue('--clone-language'),
      creditsPerChar: credits ? Number(credits) : undefined,
    }),
  );
}
