/**
 * 아침 소식 항목 → 알람이 읽을 **한 문단**(200자 이하 — 직접 입력 문구의 상한과 같다, `routes/tts.ts`).
 *
 * 이 함수는 글만 만든다. 목소리로 만드는 것은 직접 입력 문구와 같은 경로·같은 월 한도로 간다(이 함수의 일이 아니다).
 *
 * ⚠ **원천이 준 사실만 말한다** — 무엇을 언제 확인했는지, 보고서명·제목, 원문을 보라는 말. 전망·평가·추천을 넣지 않고,
 * "최신"·"새로운" 처럼 확인하지 않은 상태를 단정하는 말도 넣지 않는다(확인한 **날짜**를 말한다). 공시 시각은 원천이
 * 주지 않으므로 말하지 않는다.
 */
import type { BriefingDisclosure, BriefingPolicyNews } from '@alarmtalk/shared';
import { cleanText, truncateText } from './xml';

/** 직접 입력 문구 상한과 같다(`routes/tts.ts` 의 `> 200`). JS 길이(UTF-16)로 센다. */
export const BRIEFING_SPEECH_MAX = 200;

const CLOSING = '자세한 내용은 원문에서 확인해주세요.';

/** `YYYY-MM-DD` 또는 Date(한국 날짜로 읽는다) → "10월 26일". */
function koreanMonthDay(kstDate: string | Date): string {
  let ymd: string;
  if (typeof kstDate === 'string') {
    ymd = kstDate;
  } else {
    ymd = new Date(kstDate.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error('composeBriefingSpeech: kstDate 는 YYYY-MM-DD 다');
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}

/** 낭독용으로 다듬는다 — `[기재정정]사업보고서` → `기재정정 사업보고서`. */
function speakable(text: string): string {
  return cleanText(text.replace(/\[([^\]]*)\]/g, ' $1 '));
}

/** `head` + 자리 + `tail` 이 상한에 맞도록 자리 글을 자른다. */
function fit(head: string, slot: string, tail: string): string {
  const room = BRIEFING_SPEECH_MAX - head.length - tail.length;
  return `${head}${truncateText(slot, Math.max(room, 1))}${tail}`;
}

/**
 * 항목 하나 → 낭독 문단. `kstDate` 는 **확인한 날**(한국 날짜)이다 — 보통 그 항목을 받아 둔 날.
 * 예: "10월 26일 확인한 삼성전자의 공시입니다. 보고서명은 기재정정 사업보고서 (2025.12)입니다. 자세한 내용은 원문에서 확인해주세요."
 */
export function composeBriefingSpeech(
  item: BriefingDisclosure | BriefingPolicyNews,
  kstDate: string | Date,
): string {
  const day = koreanMonthDay(kstDate);
  if (item.source === 'opendart') {
    const corp = truncateText(speakable(item.corp_name), 40);
    const withdrawn = item.flags.withdrawn ? ' 이 공시는 철회되었습니다.' : '';
    return fit(`${day} 확인한 ${corp}의 공시입니다.${withdrawn} 보고서명은 `, speakable(item.report_name), `입니다. ${CLOSING}`);
  }
  return fit(`${day} 확인한 정책브리핑 정책뉴스입니다. 제목은 `, speakable(item.title), `입니다. ${CLOSING}`);
}
