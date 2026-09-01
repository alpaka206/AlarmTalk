import { describe, it, expect } from 'vitest';
import type { Client } from '@libsql/client/web';
import {
  STOCK_CLIP_PRESETS,
  STOCK_CLIP_LANGUAGES,
  STOCK_GREETING_CATEGORY,
  findMissingStockTargets,
  type PrerenderVoice,
} from '../src/lib/stock-clips';
import { appendMp3TrailingSilence } from '../src/lib/mp3-silence';

// ---------- STOCK_CLIP_PRESETS 리터럴 불변식 ----------

describe('STOCK_CLIP_PRESETS (확정 리터럴)', () => {
  it('모든 카테고리가 3개 언어를 갖고, 언어별 variant 수가 같다', () => {
    for (const preset of STOCK_CLIP_PRESETS) {
      const texts = preset.texts as Record<string, readonly string[]>;
      expect(Object.keys(texts).sort()).toEqual([...STOCK_CLIP_LANGUAGES].sort());
      const counts = new Set(Object.values(texts).map((list) => list.length));
      expect(counts.size).toBe(1);
    }
  });

  it('weather 는 9개(조건 8 + 마지막 폴백), medication 2개, greeting 1개', () => {
    const byCategory = new Map(STOCK_CLIP_PRESETS.map((p) => [p.category, p.texts.ko.length]));
    expect(byCategory.get('weather')).toBe(9);
    expect(byCategory.get('medication')).toBe(2);
    expect(byCategory.get(STOCK_GREETING_CATEGORY)).toBe(1);
    // 마지막 weather variant = '날씨 미확인' 폴백 규약
    const weather = STOCK_CLIP_PRESETS.find((p) => p.category === 'weather')!;
    expect(weather.texts.ko[8]).toContain('인터넷');
    expect(weather.texts.en[8].toLowerCase()).toContain('internet');
    expect(weather.texts.ja[8]).toContain('インターネット');
  });

  it('모든 문구가 딜리버리 태그로 시작한다(자동 태깅 미사용 전제)', () => {
    for (const preset of STOCK_CLIP_PRESETS) {
      for (const list of Object.values(preset.texts as Record<string, readonly string[]>)) {
        for (const text of list) {
          expect(text).toMatch(/^\[[a-z][a-z -]{1,32}\]/i);
        }
      }
    }
  });
});

// ---------- findMissingStockTargets: 시스템 보이스 매트릭스 ----------

function stubDb(rows: Record<string, unknown>[] = []): Client {
  return { execute: async () => ({ rows }) } as unknown as Client;
}

function systemVoice(id: string, eleven: string): PrerenderVoice {
  return {
    id,
    name: `voice-${id}`,
    elevenlabsVoiceId: eleven,
    ownerUserId: '70000000-0000-4000-9000-000000000001',
    categories: STOCK_CLIP_PRESETS.map((p) => p.category),
  };
}

describe('findMissingStockTargets (시스템 리터럴)', () => {
  // ⚠ **개수를 손으로 적지 않는다.** 카테고리는 늘어난다(2026-09-02 에 운세·사랑을 더했다).
  //   숫자를 박아 두면 카테고리를 추가할 때마다 이 테스트가 "기능이 깨졌다" 처럼 빨개져,
  //   실제로 검증하려던 **(문구 × 언어) 매트릭스가 빠짐없이 나오는가**는 가려진다.
  const KO_TEXT_COUNT = STOCK_CLIP_PRESETS.reduce((sum, p) => sum + p.texts.ko.length, 0);
  const TARGETS_PER_VOICE = KO_TEXT_COUNT * 3; // ko·en·ja

  it('보이스당 (문구 × 3언어) 타깃을 만들고, baseText 는 해당 언어 리터럴이다', async () => {
    const voice = systemVoice('vp-1', 'eleven-a');
    const targets = await findMissingStockTargets(stubDb(), [voice]);
    expect(targets).toHaveLength(TARGETS_PER_VOICE);

    const langs = new Set(targets.map((t) => t.language));
    expect([...langs].sort()).toEqual(['en', 'ja', 'ko']);

    const enWeather0 = targets.find(
      (t) => t.category === 'weather' && t.language === 'en' && t.variantIndex === 0,
    )!;
    expect(enWeather0.baseText).toBe(
      STOCK_CLIP_PRESETS.find((p) => p.category === 'weather')!.texts.en[0],
    );
    expect(enWeather0.toneAdapt).toBe(false);
  });

  it('greeting 은 3개 언어 모두 생성되고, 보이스가 달라도 같은 문구다(음색 비교용 통일)', async () => {
    const a = await findMissingStockTargets(stubDb(), [systemVoice('vp-1', 'eleven-a')]);
    const b = await findMissingStockTargets(stubDb(), [systemVoice('vp-2', 'eleven-b')]);
    const greetingsA = a.filter((t) => t.category === STOCK_GREETING_CATEGORY);
    const greetingsB = b.filter((t) => t.category === STOCK_GREETING_CATEGORY);
    expect(greetingsA).toHaveLength(3);
    expect(greetingsA.map((t) => t.baseText).sort()).toEqual(
      greetingsB.map((t) => t.baseText).sort(),
    );
  });

  it('이미 존재하는 (voice|category|language|variant) 조합은 건너뛴다', async () => {
    const voice = systemVoice('vp-1', 'eleven-a');
    const db = stubDb([
      { voice_profile_id: 'vp-1', category: 'weather', language: 'ko', variant: 0 },
    ]);
    const targets = await findMissingStockTargets(db, [voice]);
    expect(targets).toHaveLength(TARGETS_PER_VOICE - 1);
    expect(
      targets.some(
        (t) => t.category === 'weather' && t.language === 'ko' && t.variantIndex === 0,
      ),
    ).toBe(false);
  });
});

// ---------- appendMp3TrailingSilence ----------

const FRAME_LEN = 417; // MPEG1 L3 44.1kHz 128k, padding 0
const SILENCE_BYTES = 5851;
const SILENCE_FRAMES = 14;

/** MPEG1 Layer III · 44.1kHz · 128kbps · CRC 없음 프레임 헤더 + 지정 채널모드. */
function frameHeader(channelMode: number): number[] {
  return [0xff, 0xfb, 0x90, (channelMode & 0x03) << 6];
}

function makeFrame(channelMode = 3): Uint8Array {
  const frame = new Uint8Array(FRAME_LEN);
  frame.set(frameHeader(channelMode), 0);
  return frame;
}

/** Info 헤더(FRAMES|BYTES 플래그)를 가진 첫 프레임. side info 17B(mono) 뒤에 마커. */
function makeInfoFrame(frames: number, bytes: number): Uint8Array {
  const frame = makeFrame(3);
  const tagPos = 4 + 17;
  frame.set([0x49, 0x6e, 0x66, 0x6f], tagPos); // "Info"
  frame.set([0, 0, 0, 0x03], tagPos + 4); // flags: FRAMES|BYTES
  new DataView(frame.buffer).setUint32(tagPos + 8, frames);
  new DataView(frame.buffer).setUint32(tagPos + 12, bytes);
  return frame;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function countFrames(bytes: Uint8Array): number {
  let off = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    off =
      10 +
      (((bytes[6]! & 0x7f) << 21) |
        ((bytes[7]! & 0x7f) << 14) |
        ((bytes[8]! & 0x7f) << 7) |
        (bytes[9]! & 0x7f));
  }
  let frames = 0;
  while (off + 4 <= bytes.length) {
    if (bytes[off] === 0xff && (bytes[off + 1]! & 0xe0) === 0xe0) {
      const pad = (bytes[off + 2]! >> 1) & 0x01;
      frames++;
      off += FRAME_LEN + pad;
    } else {
      off++;
    }
  }
  return frames;
}

describe('appendMp3TrailingSilence', () => {
  it('mono 44.1k/128k 스트림 끝에 무음 14프레임(5851B)을 붙인다', () => {
    const input = concat(makeFrame(), makeFrame());
    const out = appendMp3TrailingSilence(input);
    expect(out.length).toBe(input.length + SILENCE_BYTES);
    expect(countFrames(out)).toBe(2 + SILENCE_FRAMES);
  });

  it('Info 헤더의 프레임/바이트 카운트를 함께 보정한다', () => {
    const input = concat(makeInfoFrame(2, FRAME_LEN * 2), makeFrame());
    const out = appendMp3TrailingSilence(input);
    const tagPos = 4 + 17;
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint32(tagPos + 8)).toBe(2 + SILENCE_FRAMES);
    expect(view.getUint32(tagPos + 12)).toBe(FRAME_LEN * 2 + SILENCE_BYTES);
  });

  it('ID3v2 태그가 앞에 있어도 첫 프레임을 찾아 처리한다', () => {
    const id3 = new Uint8Array(10);
    id3.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0], 0); // 크기 0 인 ID3v2 헤더
    const input = concat(id3, makeFrame());
    const out = appendMp3TrailingSilence(input);
    expect(out.length).toBe(input.length + SILENCE_BYTES);
  });

  it('mono 가 아니거나(스테레오) MP3 가 아니면 원본을 그대로 반환한다', () => {
    const stereo = concat(makeFrame(0), makeFrame(0));
    expect(appendMp3TrailingSilence(stereo)).toBe(stereo);
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    expect(appendMp3TrailingSilence(garbage)).toBe(garbage);
  });

  it('내장 무음 프레임 자체가 mono 44.1k/128k 이고 리저버 참조가 없다', () => {
    // 무음 위에 다시 붙여도(형식 동일) 깨지지 않는지로 간접 검증
    const once = appendMp3TrailingSilence(concat(makeFrame()));
    const silencePart = once.slice(FRAME_LEN);
    expect(silencePart.length).toBe(SILENCE_BYTES);
    expect(silencePart[0]).toBe(0xff);
    // 무음 각 프레임의 main_data_begin(side info 첫 9비트) == 0
    let off = 0, checked = 0;
    while (off + 4 <= silencePart.length) {
      expect(silencePart[off]).toBe(0xff);
      const mainDataBegin = (silencePart[off + 4]! << 1) | (silencePart[off + 5]! >> 7);
      expect(mainDataBegin).toBe(0);
      const pad = (silencePart[off + 2]! >> 1) & 0x01;
      off += FRAME_LEN + pad;
      checked++;
    }
    expect(checked).toBe(SILENCE_FRAMES);
  });
});
