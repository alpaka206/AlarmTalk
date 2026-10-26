/**
 * 아침 소식 원천의 XML·HTML 을 **글자로만** 읽는 작은 도구들.
 *
 * XML 파서 라이브러리를 들이지 않는다 — 두 원천(OpenDART `CORPCODE.xml`, 정책브리핑 정책뉴스)은 평평한
 * `<항목><필드>값</필드>…</항목>` 모양이라 태그 하나씩 꺼내면 된다.
 *
 * ⚠ **외부 엔티티를 풀지 않는다.** 문서에 `<!DOCTYPE`·`<!ENTITY` 가 있으면 읽지 않고 거절한다
 * (`assertNoDoctype`). 우리가 푸는 엔티티는 XML 기본 다섯 개와 숫자 참조뿐이다.
 * ⚠ **HTML 을 그대로 내보내지 않는다.** 본문은 태그를 걷어 낸 글자로만 만들고(`htmlToText`), 화면은 그 글자를
 * 텍스트로만 그린다 — 원천의 HTML·이미지를 다시 싣지 않는다(`docs/spec/morning-briefing.md` §3).
 */

/** 원천 문서가 문서형 선언·엔티티 선언을 품고 있으면 읽지 않는다(XXE·엔티티 폭탄 차단). */
export function assertNoDoctype(xml: string): void {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error('briefing xml: DOCTYPE/ENTITY 가 있는 문서는 읽지 않는다');
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // HTML 본문(정책뉴스 DataContents)에 흔한 것 몇 개만. 모르는 이름은 그대로 둔다.
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/** 엔티티 참조를 푼다 — 기본 이름과 숫자 참조만. 범위를 벗어난 코드 포인트는 버린다. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

/**
 * 제어문자·제로폭·양방향 제어문자를 걷어 내고 공백을 하나로 접는다. 줄바꿈·탭은 공백이 된다
 * (CLAUDE.md 「입력 규칙은 한 곳에서만」의 글자 규칙과 같은 갈래 — 원천 글도 외부 입력이다).
 */
export function cleanText(text: string): string {
  return text
    .replace(/[\t\n\r\f\v]/g, ' ')
    // eslint-disable-next-line no-control-regex -- 제어문자를 **일부러** 매칭한다. 걸러내는 게 목적이다.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 태그 이름마다 정규식을 한 번만 만든다 — `CORPCODE.xml` 은 항목이 10만 개가 넘어 항목마다 만들면 그것만으로 CPU 를 쓴다.
 * 태그 이름은 우리 코드의 고정 문자열이다(사용자 입력 아님).
 */
const TAG_REGEX_CACHE = new Map<string, RegExp>();
function tagRegex(tag: string, global: boolean): RegExp {
  const key = `${global ? 'g' : '-'}${tag}`;
  let re = TAG_REGEX_CACHE.get(key);
  if (!re) {
    re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, global ? 'g' : '');
    TAG_REGEX_CACHE.set(key, re);
  }
  // 전역 정규식은 lastIndex 를 들고 있으므로 쓸 때마다 처음으로 돌린다(matchAll 은 복사본을 쓰지만 안전하게).
  re.lastIndex = 0;
  return re;
}

/**
 * `block` 안의 첫 `<tag>…</tag>` 내용을 글자로. CDATA 는 벗기고, 그 밖은 엔티티를 푼다.
 * 태그가 없거나 비어 있으면 ''. 자기 닫힘(`<tag/>`)도 ''.
 */
export function tagText(block: string, tag: string): string {
  const m = tagRegex(tag, false).exec(block);
  if (!m) return '';
  const inner = m[1] ?? '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(inner);
  return cdata ? (cdata[1] ?? '') : decodeEntities(inner);
}

/** `<tag>…</tag>` 블록을 전부. 중첩되지 않는 평평한 목록에만 쓴다. */
export function tagBlocks(xml: string, tag: string): string[] {
  return Array.from(xml.matchAll(tagRegex(tag, true)), (m) => m[1] ?? '');
}

/**
 * HTML 조각 → 글자. `script`·`style` 은 내용째 버리고, 블록 태그는 공백으로, 나머지 태그는 지운 뒤
 * 엔티티를 풀고 `cleanText` 로 정리한다. 결과는 **글자**다 — HTML 로 다시 해석하지 말 것.
 */
export function htmlToText(html: string): string {
  const withoutCode = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|iframe|object|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const tagless = withoutCode.replace(/<\/?(p|div|br|li|tr|td|h[1-6]|table|ul|ol)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '');
  return cleanText(decodeEntities(tagless));
}

/**
 * 코드 포인트 기준으로 `max` 글자(UTF-16 길이)까지 자른다 — 서러게이트 쌍을 가르지 않는다. 잘랐으면 `…` 를 붙이며,
 * 그것까지 포함해 `max` 를 넘지 않는다.
 */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}
