/**
 * **앱·랜딩에 실린 기본 목소리 소리** — 음량 올리기(`boost-bundled-greetings.ts`)와 그 회귀 테스트가 함께 쓰는 목록.
 *
 * - 안드로이드 `res/raw` 의 인사말 12개(`voice_greeting_<목소리>_<언어>.mp3` — `SystemVoices.kt` 의
 *   `bundledSystemGreetingRes`)와 랜딩 미리듣기 4개(`landing_preview_<목소리>.mp3` — `LandingScreen.kt` 의
 *   `LandingVoiceChips`). 둘 다 v4 Turbo 로 구운 기본 목소리 소리다. iOS 는 사본을 두지 않고 이 폴더를 그대로 번들한다(`apps/ios-native/project.yml`) —
 *   여기만 바꾸면 두 앱이 같다.
 * - 랜딩 웹 `apps/landing/public/audio/<목소리>-greeting.<언어>.mp3` 12개 — res/raw 인사말의 **같은 바이트** 사본이다
 *   (`voice-preview.tsx` — 웹에서 들은 소리가 앱에서 나는 소리여야 한다). 애니만 이름이 다르다: 앱은 이력상 이름
 *   `narin`, 웹은 표시 이름 `aeni`.
 */

import { resolve } from 'node:path';

/** res/raw 와 랜딩 웹의 목소리 이름. 순서는 앱이 보여 주는 순서(시우·미나·도현·애니). */
export const GREETING_VOICES = [
  { app: 'siwoo', landing: 'siwoo' },
  { app: 'mina', landing: 'mina' },
  { app: 'dohyun', landing: 'dohyun' },
  { app: 'narin', landing: 'aeni' },
] as const;
export const GREETING_LANGUAGES = ['ko', 'en', 'ja'] as const;

export const RAW_DIR = 'apps/android-native/app/src/main/res/raw';
export const LANDING_AUDIO_DIR = 'apps/landing/public/audio';
/**
 * 랜딩 미리듣기 — 인사말이 아니라 로그인 전 첫 화면의 목소리 칩이 트는 한마디다(목소리마다 문장이 다르다,
 * 2026-11-14). 순서는 칩 순서(= 앱 순서). 웹 사본은 없다.
 */
export const LANDING_PREVIEW_FILES = GREETING_VOICES.map((voice) => `landing_preview_${voice.app}.mp3`);

export interface BundledClip {
  /** 사람이 읽는 이름(`res/raw` 파일명). */
  label: string;
  /** 앱 번들 원본(안드로이드 res/raw — iOS 도 이 파일을 싣는다). */
  rawPath: string;
  /** 랜딩 웹의 같은 바이트 사본. 없으면 null. */
  landingPath: string | null;
}

export function bundledVoiceClips(repoRoot: string): BundledClip[] {
  const clips: BundledClip[] = [];
  for (const voice of GREETING_VOICES) {
    for (const language of GREETING_LANGUAGES) {
      const label = `voice_greeting_${voice.app}_${language}.mp3`;
      clips.push({
        label,
        rawPath: resolve(repoRoot, RAW_DIR, label),
        landingPath: resolve(repoRoot, LANDING_AUDIO_DIR, `${voice.landing}-greeting.${language}.mp3`),
      });
    }
  }
  for (const file of LANDING_PREVIEW_FILES) {
    clips.push({ label: file, rawPath: resolve(repoRoot, RAW_DIR, file), landingPath: null });
  }
  return clips;
}
