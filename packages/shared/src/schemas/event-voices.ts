import { z } from 'zod';
import catalogJson from '../event-voices.json';

/**
 * 랜딩 이벤트의 **목소리 목록** — 단일 출처는 옆의 `event-voices.json` 이다.
 *
 * 백엔드(`packages/backend/src/lib/event-voices.ts`)는 여기서 Perso 프로젝트·좋아요 대상 id 를
 * 읽고, 랜딩(`apps/landing/components/event/event-catalog.ts`)은 같은 JSON 을 직접 읽어 순서·
 * 이름·사진을 그린다. 그래서 **목소리를 더하는 일은 JSON 항목 하나 + 샘플 mp3 셋**이다:
 *
 *   1. `event-voices.json` 의 `"<이벤트 id>".voices` 에 항목을 더한다(배열 순서 = 화면 순서, `?celeb=2`
 *      같은 번호 링크의 순번). `id` 는 소문자 슬러그이고 주소·좋아요 행·파일 이름에 그대로 쓰인다.
 *      `name` 은 세 언어 라벨(익명이면 "voice 2" 처럼), `portrait` 는 `public/` 경로이거나 null
 *      (null 이면 추상 아바타). `perso` 는 언어별 더빙 프로젝트 번호 — 같은 프로젝트를 여러 언어가
 *      나눠 써도 되고, `reserved` 는 돌리면 안 되는 문장(홍보용) 번호다.
 *   2. 미리 듣기 샘플을 `apps/landing/public/event/samples/<id>.<locale>.mp3` 로 넣는다(세 언어).
 *   3. 끝. 좋아요 행은 첫 좋아요 때 서버가 만들고, 슬롯 순번은 프로젝트별로 자동이다.
 *
 * ⚠ 실존 인물의 이름·사진·목소리를 넣지 않는다(2026-09-17 결정 — 부정경쟁방지법 타목). 목소리는
 * 본인 동의를 받은 사람의 것이어야 하고, 라벨·아바타는 누구를 연상시키지 않아야 한다.
 */
export const EVENT_VOICE_LOCALES = ['ko', 'en', 'ja'] as const;
export type EventVoiceLocale = (typeof EVENT_VOICE_LOCALES)[number];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const EventVoiceProjectSchema = z.object({
  /** Perso 더빙 프로젝트 번호. 그 프로젝트의 화자가 곧 목소리, 문장들이 슬롯이다. */
  project: z.number().int().positive(),
  /** 돌리지 않는 문장(audio-sentence seq) — 홍보 영상 등에 쓰는 글자가 들어 있다. */
  reserved: z.array(z.number().int().positive()).default([]),
});

export const EventVoiceSchema = z.object({
  id: z.string().regex(SLUG_RE),
  name: z.object({ ko: z.string().min(1), en: z.string().min(1), ja: z.string().min(1) }),
  /** `public/` 아래 경로. null 이면 사진 없이 추상 아바타. */
  portrait: z.string().startsWith('/').nullable(),
  perso: z.object({
    /** 프로젝트가 속한 Perso 스페이스(`GET /portal/api/v1/spaces`). 문장 목록을 읽을 때 필요하다. */
    spaceSeq: z.number().int().positive(),
    ko: EventVoiceProjectSchema.optional(),
    en: EventVoiceProjectSchema.optional(),
    ja: EventVoiceProjectSchema.optional(),
  }),
});

export const EventVoiceCatalogSchema = z.record(
  z.string().regex(SLUG_RE),
  z.object({
    voices: z
      .array(EventVoiceSchema)
      .min(1)
      .refine((vs) => new Set(vs.map((v) => v.id)).size === vs.length, 'voice id 가 겹친다'),
  }),
);

export type EventVoice = z.infer<typeof EventVoiceSchema>;
export type EventVoiceProject = z.infer<typeof EventVoiceProjectSchema>;
export type EventVoiceCatalog = z.infer<typeof EventVoiceCatalogSchema>;

/** JSON 을 한 번 검증해 둔 목록. 모양이 틀리면 모듈을 불러오는 순간 던진다 — 배포 전에 걸린다. */
export const EVENT_VOICE_CATALOG: EventVoiceCatalog = EventVoiceCatalogSchema.parse(catalogJson);

export function findEventVoice(eventId: string, voiceId: string): EventVoice | undefined {
  return EVENT_VOICE_CATALOG[eventId]?.voices.find((v) => v.id === voiceId);
}

/** 이 이벤트에서 좋아요를 받을 수 있는 대상 id 들. */
export function eventVoiceIds(eventId: string): string[] {
  return EVENT_VOICE_CATALOG[eventId]?.voices.map((v) => v.id) ?? [];
}
