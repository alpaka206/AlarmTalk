// 앱·랜딩에 실린 기본 목소리 소리(`scripts/bundled-voice-clips.ts`)가 **서버와 같은 만큼 올린 사본**인지 고정한다.
//
// 인사말을 새로 구워 res/raw 에 넣고 `npm run boost:greetings` 를 빠뜨리면, 앱의 미리듣기·대체 인사말만 4 dB 작고 랜딩
// 사본과도 갈라진다 — 귀로는 '좀 작다' 일 뿐이라 아무도 모르고 나간다. 그래서 커밋된 파일 자체를 본다(afconvert 없이 돈다).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  bundledVoiceClips,
  GREETING_LANGUAGES,
  GREETING_VOICES,
  LANDING_AUDIO_DIR,
  RAW_DIR,
} from '../scripts/bundled-voice-clips.ts';
import { readLoudnessBoostMarker, readMp3Layout } from '../scripts/mp3-loudness-boost.ts';
import { TTS_LOUDNESS_BOOST_DB } from '../src/lib/tts-model';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const clips = bundledVoiceClips(REPO_ROOT);
/** 0 이면 올리지 않은 원본이어야 한다(표지 없음). */
const expectedMarker = TTS_LOUDNESS_BOOST_DB > 0 ? TTS_LOUDNESS_BOOST_DB : null;

describe('번들 기본 목소리 소리 — 올린 사본', () => {
  it('목록은 인사말 4목소리 × 3언어 + 랜딩 미리듣기다', () => {
    expect(clips).toHaveLength(GREETING_VOICES.length * GREETING_LANGUAGES.length + 1);
    // 애니는 앱이 `narin`, 웹이 `aeni` 다(`SystemVoices.kt` · `voice-preview.tsx`).
    const aeni = clips.find((clip) => clip.label === 'voice_greeting_narin_ko.mp3')!;
    expect(basename(aeni.landingPath!)).toBe('aeni-greeting.ko.mp3');
  });

  it.each(clips.map((clip) => [clip.label, clip] as const))('%s — 표지·44.1 kHz 모노 MP3·랜딩 사본 일치', (_, clip) => {
    const raw = readFileSync(clip.rawPath);
    expect(readLoudnessBoostMarker(raw)).toBe(expectedMarker);
    const layout = readMp3Layout(raw);
    expect(layout).toMatchObject({ sampleRate: 44_100, channels: 1, bitratesKbps: [128] });
    if (clip.landingPath) {
      expect(Buffer.compare(readFileSync(clip.landingPath), raw)).toBe(0);
    }
  });

  it('목록에 없는 인사말 파일이 없다 — 목소리·언어를 더하면 목록부터 고친다', () => {
    const rawNames = new Set(clips.map((clip) => basename(clip.rawPath)));
    const landingNames = new Set(clips.flatMap((clip) => (clip.landingPath ? [basename(clip.landingPath)] : [])));
    const strayRaw = readdirSync(join(REPO_ROOT, RAW_DIR)).filter(
      (name) => /^voice_greeting_.+\.mp3$/.test(name) && !rawNames.has(name),
    );
    const strayLanding = readdirSync(join(REPO_ROOT, LANDING_AUDIO_DIR)).filter(
      (name) => /-greeting\..+\.mp3$/.test(name) && !landingNames.has(name),
    );
    expect(strayRaw).toEqual([]);
    expect(strayLanding).toEqual([]);
  });
});
