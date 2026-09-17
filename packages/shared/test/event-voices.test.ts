import { describe, expect, it } from 'vitest';
import {
  EVENT_VOICE_CATALOG,
  EVENT_VOICE_LOCALES,
  EventVoiceCatalogSchema,
  eventVoiceIds,
  findEventVoice,
} from '../src/index.js';

describe('event-voices.json — 랜딩 이벤트 목소리 목록', () => {
  it('JSON 이 스키마를 통과하고 이벤트 1 에 목소리가 하나 이상 있다', () => {
    expect(EVENT_VOICE_CATALOG['1']?.voices.length).toBeGreaterThan(0);
    expect(eventVoiceIds('1')).toContain('voice1');
    expect(findEventVoice('1', 'voice1')?.name.ko).toBe('voice 1');
    expect(findEventVoice('1', 'nobody')).toBeUndefined();
  });

  it('모든 목소리에 세 언어 라벨과 스페이스 번호가 있고, Perso 프로젝트가 하나 이상 있다', () => {
    for (const [, event] of Object.entries(EVENT_VOICE_CATALOG)) {
      for (const v of event.voices) {
        for (const l of EVENT_VOICE_LOCALES) expect(v.name[l].length).toBeGreaterThan(0);
        expect(v.perso.spaceSeq).toBeGreaterThan(0);
        expect(EVENT_VOICE_LOCALES.some((l) => v.perso[l])).toBe(true);
      }
    }
  });

  it('id 가 겹치거나 슬러그가 아니면 거절한다', () => {
    const dup = { '1': { voices: [voice('a'), voice('a')] } };
    expect(EventVoiceCatalogSchema.safeParse(dup).success).toBe(false);
    const bad = { '1': { voices: [voice('Voice 1')] } };
    expect(EventVoiceCatalogSchema.safeParse(bad).success).toBe(false);
  });
});

function voice(id: string) {
  return {
    id,
    name: { ko: 'x', en: 'x', ja: 'x' },
    portrait: null,
    perso: { spaceSeq: 1, ko: { project: 1, reserved: [] } },
  };
}
