import { findEventVoice, type EventVoiceLocale } from '@alarmtalk/shared';
import type { PersoSlot } from './perso';

/**
 * 랜딩 이벤트의 **문장과 슬롯 규칙**. 목소리 목록(누가 있고, 어느 Perso 프로젝트인지)은
 * `packages/shared/src/event-voices.json` 이 단일 출처다 — 목소리를 더하는 방법은 그 옆
 * `schemas/event-voices.ts` 머리 주석에 있다. 여기는 그 목록을 읽어 쓸 뿐이다.
 *
 * 읽을 문장은 서버가 정한다 — 클라가 임의 문장을 보내 남의 목소리로 읽히는 길을 두지 않는다.
 *
 * 슬롯: Perso 더빙 프로젝트의 문장(audio-sentence) **전부**를 돌려 쓴다(2026-09-16 지시 —
 * 문장은 100개가 넘는다). 목록은 요청 때 Perso 에서 읽어 잠깐 들고 있고(`routes/event.ts`),
 * 순번은 DB 카운터로 돌린다(`event_slot_cursor`) — 한 문장에 두 요청이 겹치면 서로 글자를
 * 덮어쓰기 때문이다(`lib/perso.ts`). `reserved` 는 돌리지 않는 문장(홍보 영상용).
 */
export const EVENT_LOCALES = ['ko', 'en', 'ja'] as const satisfies readonly EventVoiceLocale[];
export type EventLocale = (typeof EVENT_LOCALES)[number];
export function isEventLocale(v: unknown): v is EventLocale {
  return typeof v === 'string' && (EVENT_LOCALES as readonly string[]).includes(v);
}

export const EVENT_MESSAGE_KINDS = ['birthday', 'chuseok'] as const;
export type EventMessageKind = (typeof EVENT_MESSAGE_KINDS)[number];

/**
 * 화면에서 뺀 옛 종류 → 지금 종류. **배포 창 호환용**이다(코덱스 리뷰, 2026-09-22): 서버가 먼저
 * 배포된 뒤에도 브라우저에 열려 있거나 캐시된 옛 랜딩 번들은 `kind: "comfort"` 를 그대로 보낸다.
 * 그걸 400 으로 거절하면 두 클립 중 하나가 실패하고, 새로고침 전에는 재시도로도 못 살린다.
 * 옛 이름은 받되 지금 문구(추석 인사)로 읽어 준다 — '위로' 문안은 이미 지웠다.
 * 새 번들이 다 퍼진 뒤(며칠) 지워도 된다.
 */
export const LEGACY_EVENT_MESSAGE_KINDS: Readonly<Record<string, EventMessageKind>> = {
  comfort: 'chuseok',
};

/** 지금 종류만 — 내보내지 않는다. 요청 검증은 옛 이름까지 받는 `resolveEventMessageKind` 하나로 한다. */
function isEventMessageKind(v: unknown): v is EventMessageKind {
  return typeof v === 'string' && (EVENT_MESSAGE_KINDS as readonly string[]).includes(v);
}

/**
 * 요청의 `kind` 를 지금 종류로 — 옛 이름이면 호환표로 바꾸고, 모르는 값이면 null.
 * `routes/event.ts` 의 `POST /api/event/:eventId/clips` 는 **이것으로만** 검증한다 — 옛 번들의
 * `comfort` 가 400 이 아니라 200 으로 읽히는 회귀 테스트가 `test/event-clips.test.ts` 에 있다.
 */
export function resolveEventMessageKind(v: unknown): EventMessageKind | null {
  if (isEventMessageKind(v)) return v;
  if (typeof v !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(LEGACY_EVENT_MESSAGE_KINDS, v)
    ? LEGACY_EVENT_MESSAGE_KINDS[v]!
    : null;
}

export type VoiceProject = {
  project: number;
  /** 프로젝트가 속한 스페이스(`GET /portal/api/v1/spaces`). 문장 목록을 읽을 때 필요하다. */
  spaceSeq: number;
  /** 돌리지 않는 문장 — 홍보 영상에 쓰는 글자가 들어 있다. */
  reserved: readonly number[];
};

/**
 * (이벤트, 목소리, 언어) → Perso 프로젝트. 목소리가 없으면 `null`(404 감), 있는데 그 언어 프로젝트가
 * 없으면 `undefined`(503 감).
 */
export function voiceProjectFor(
  eventId: string,
  voiceId: string,
  locale: EventLocale,
): VoiceProject | null | undefined {
  const voice = findEventVoice(eventId, voiceId);
  if (!voice) return null;
  const p = voice.perso[locale];
  if (!p) return undefined;
  return { project: p.project, spaceSeq: voice.perso.spaceSeq, reserved: p.reserved };
}

/**
 * 읽힐 문장. `{name}` 자리에 부르는 꼴(`vocative`)이 들어간다. 대괄호는 감정 태그라 소리에는
 * 없고 화면에는 벗겨서 보여 준다(`renderMessage`). 줄바꿈은 화면의 문단이다.
 * 2026-09-22 사용자 지시로 생일 문구를 새 문안으로 바꾸고, '위로 한마디' 를 '추석 인사' 로
 * 갈아 끼웠다(한국어는 사용자 원문 그대로, 영어·일본어는 같은 결로 옮긴 것). 바꾸려면 여기만
 * 고친다 — 랜딩은 종류 id(`MESSAGE_KINDS`)와 라벨(`messages/*.json` 의 `event.studio.kinds`)만 안다.
 */
export const EVENT_MESSAGES: Record<EventMessageKind, Record<EventLocale, string>> = {
  birthday: {
    ko: `[warm, relaxed] {name}, [gently cheerful] 생일 정말 축하해!
[gentle, sincere] 늘 응원해 줘서 고마워.
[warm, conversational] 오늘 누구보다 행복한 하루 보내고,
[lightly playful, smiling] 우리 앞으로도 좋은 추억 많이 만들자!`,
    en: `[warm, relaxed] Hey, {name}. [gently cheerful] Happy birthday!
[gentle, sincere] Thank you for always cheering me on.
[warm, conversational] I hope today is the happiest day of all for you,
[lightly playful, smiling] and let's keep making great memories together!`,
    ja: `[warm, relaxed] {name}、[gently cheerful] お誕生日、本当におめでとう！
[gentle, sincere] いつも応援してくれて、ありがとう。
[warm, conversational] 今日は誰よりも幸せな一日を過ごしてね。
[lightly playful, smiling] これからも一緒に、いい思い出をたくさん作ろうね！`,
  },
  chuseok: {
    ko: `[warm, relaxed] {name}, [gently cheerful] 즐거운 추석 보내!
[warm, conversational] 맛있는 것도 많이 먹고, 이번 연휴엔 푹 쉬면서 편안하게 보내.
[gentle, sincere] 늘 건강하고, 웃을 일도 가득했으면 좋겠어.`,
    en: `[warm, relaxed] Hey, {name}. [gently cheerful] Happy Chuseok!
[warm, conversational] Eat lots of good food, and take it easy and really rest this holiday.
[gentle, sincere] Stay healthy, and I hope your days are full of things to smile about.`,
    ja: `[warm, relaxed] {name}、[gently cheerful] 楽しいチュソクを過ごしてね！
[warm, conversational] おいしいものをたくさん食べて、この連休はゆっくり休んで、のんびり過ごしてね。
[gentle, sincere] いつも元気で、笑えることがいっぱいありますように。`,
  },
};

/** 랜딩 `EVENT_NAME_MAX_LENGTH` 와 같다. 길면 이름이 아니라 문장을 인물 목소리로 읽히려는 것이다. */
export const EVENT_NAME_MAX_LENGTH = 20;
/** 이보다 긴 원문은 보지도 않고 거절한다 — 20자 상한을 재기 전에 25MiB 를 걷게 두지 않는다. */
const EVENT_NAME_MAX_RAW_UNITS = EVENT_NAME_MAX_LENGTH * 8;

/**
 * 이름에 남기는 글자 — **허용 목록**이다(랜딩 `sanitizeEventName` 과 같은 규칙).
 *
 * 이 값은 화면에 보일 뿐 아니라 **실제 인물 목소리로 읽힌다.** 계정 닉네임처럼 문장부호를 살리면
 * 대괄호로 ElevenLabs 감정·효과 태그를 심거나(`[angry]`), `$'` 같은 치환 패턴으로 문장을 부풀리거나,
 * 따옴표·쉼표로 문장을 꾸며 인물이 한 말처럼 만들 수 있다. 그래서 글자(문자·결합 부호)·숫자·
 * 공백·하이픈·아포스트로피(O'Brien, Jean-Luc)만 남긴다. 이모지·괄호·기호는 이름이 아니다.
 */
const NAME_ALLOWED_RE = /[\p{L}\p{M}\p{N} '’-]/u;

/**
 * 정리한 뒤 비거나 길면 null — 랜딩이 이미 거른 값이 오지만 서버가 최종 문지기다.
 * 줄바꿈·탭은 공백으로 바꾸고(지우면 두 낱말이 붙는다), 나머지 허용 밖 글자는 지운다.
 */
export function sanitizeEventName(raw: string): string | null {
  if (raw.length > EVENT_NAME_MAX_RAW_UNITS) return null;
  const chars: string[] = [];
  for (const ch of raw.replace(/[\r\n\t]+/g, ' ')) {
    if (NAME_ALLOWED_RE.test(ch)) chars.push(ch);
  }
  const cleaned = chars.join('').replace(/ {2,}/g, ' ').trim();
  if (!cleaned || Array.from(cleaned).length > EVENT_NAME_MAX_LENGTH) return null;
  return cleaned;
}

/**
 * 부르는 꼴. 한국어는 받침이 있으면 「아」, 없으면 「야」(지민→지민아, 하나→하나야); 마지막 글자가
 * 한글이 아니면(영어 이름·숫자) 어떤 소리로 끝나는지 몰라 조사를 붙이지 않는다. 영어·일본어는
 * 문장 쪽에 호칭이 있어("Hey, {name}." / "{name}、") 이름 그대로.
 */
export function vocative(name: string, locale: EventLocale): string {
  if (locale !== 'ko' || !name) return name;
  const lastCp = Array.from(name).at(-1)!.codePointAt(0)!;
  if (lastCp < 0xac00 || lastCp > 0xd7a3) return name;
  const hasFinal = (lastCp - 0xac00) % 28 !== 0;
  return name + (hasFinal ? '아' : '야');
}

/** 감정 태그를 벗기고 문단 사이 빈 줄을 한 줄바꿈으로 — 화면에 보일 글자. */
export function stripEmotionTags(text: string): string {
  return text
    .replace(/\[[^\]\n]*\]\s*/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export type RenderedMessage = {
  /** Perso 에 보낼 글자(태그 포함). */
  tts: string;
  /** 화면에 보일 글자(태그 없음, 줄바꿈은 문단). */
  display: string;
  /** 문장 안에서 이름이 실제로 읽히는 꼴 — 화면이 이 글자를 굵게 표시한다. */
  spoken: string;
};

export function renderMessage(kind: EventMessageKind, locale: EventLocale, name: string): RenderedMessage {
  const spoken = vocative(name, locale);
  const template = EVENT_MESSAGES[kind][locale];
  // 함수 치환 — 문자열 치환은 `$'`·`$&` 를 패턴으로 읽어 이름이 문장을 부풀릴 수 있다.
  const tts = template.replaceAll('{name}', () => spoken);
  // 읽힐 글자는 문장 + 이름(+조사) 을 넘을 수 없다. 넘으면 위 규칙 어딘가가 뚫린 것이다.
  if (tts.length > template.length + spoken.length) {
    throw new Error('rendered message longer than template + name');
  }
  return { tts, display: stripEmotionTags(tts), spoken };
}

/**
 * 순번 → 슬롯. `position` 은 DB 카운터가 준 값(요청마다 1 씩 큰다)이라 요청이 문장을 하나씩
 * 돌아가며 쓴다. 카운터를 못 받았으면(로컬·DB 장애) 호출자가 무작위 값을 준다.
 */
export function slotAt(voice: VoiceProject, sentences: readonly number[], position: number): PersoSlot {
  const usable = sentences.filter((seq) => !voice.reserved.includes(seq));
  if (usable.length === 0) throw new Error(`project ${voice.project} has no usable sentences`);
  const idx = ((position % usable.length) + usable.length) % usable.length;
  return { project: voice.project, sentence: usable[idx]! };
}
