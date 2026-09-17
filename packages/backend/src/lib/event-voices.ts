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

export const EVENT_MESSAGE_KINDS = ['birthday', 'comfort'] as const;
export type EventMessageKind = (typeof EVENT_MESSAGE_KINDS)[number];
export function isEventMessageKind(v: unknown): v is EventMessageKind {
  return typeof v === 'string' && (EVENT_MESSAGE_KINDS as readonly string[]).includes(v);
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
 * 읽힐 문장. `{name}` 자리에 부르는 꼴(`vocative`)이 들어간다. 대괄호는 ElevenLabs v3 감정
 * 태그라 소리에는 없고 화면에는 벗겨서 보여 준다(`renderMessage`). 줄바꿈은 화면의 문단이다.
 * 생일 문구 셋은 2026-09-16 에 사용자가 Perso 슬롯에 적어 둔 것을 그대로 옮겼다. 위로 문구는
 * 랜딩에 있던 문장에 같은 결의 태그만 얹은 것 — 바꾸려면 여기만 고친다.
 */
export const EVENT_MESSAGES: Record<EventMessageKind, Record<EventLocale, string>> = {
  birthday: {
    ko: `[warm, relaxed] {name}, [gently cheerful] 생일 너무너무 축하해!

[gentle, sincere] 늘 응원해 줘서 너무 고마워.
[warm, conversational] 오늘은 맛있는 것도 많이 먹고, 누구보다 행복한 하루 보냈으면 좋겠어.

[lightly playful, affectionate] 우리 앞으로도 좋은 추억 많이 만들자!`,
    en: `[warm, relaxed] Hey, {name}. [gently cheerful] Happy birthday!

[gentle, sincere] Thank you so much for always supporting me.
[warm, conversational] Hope you get to enjoy lots of good food today and have the happiest birthday!

[lightly playful, affectionate] Let’s keep making lots of great memories together!`,
    ja: `[warm, relaxed] {name}、[gently cheerful] お誕生日、本当におめでとう！

[gentle, sincere] いつも応援してくれて、本当にありがとう。
[warm, conversational] 今日はおいしいものいっぱい食べて、誰よりも幸せな一日を過ごしてね。

[lightly playful, affectionate] これからも一緒に、楽しい思い出いっぱい作ろうね！`,
  },
  comfort: {
    ko: `[warm, relaxed] {name}, [gentle, sincere] 오늘도 정말 고생했어.

[warm, conversational] 안 보이는 데서 애쓴 거 다 알아.
[warm, sincere] 충분히 잘하고 있어.`,
    en: `[warm, relaxed] Hey, {name}. [gentle, sincere] You worked so hard today.

[warm, conversational] I see the effort nobody else does.
[warm, sincere] You’re doing more than enough.`,
    ja: `[warm, relaxed] {name}、[gentle, sincere] 今日も本当におつかれさま。

[warm, conversational] 誰にも見えないところでがんばったの、知ってるよ。
[warm, sincere] 十分やれてる。`,
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
