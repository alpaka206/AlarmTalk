/**
 * **앱에 실린 기본 목소리 소리에 서버와 같은 음량 올리기를 건다**(2026-10-08 — v4 Turbo 를 +4 dB, `TTS_LOUDNESS_BOOST_DB`).
 *
 * 대상은 `bundled-voice-clips.ts` 의 목록이다 — 안드로이드 res/raw 의 인사말 12개와 랜딩 미리듣기(iOS 도 같은 파일을
 * 싣는다), 그리고 랜딩 웹의 인사말 사본 12개. 다시 합성하지 않는다 — 들어 본 연기 그대로 크기만 바꾼다
 * (`mp3-loudness-boost.ts` — 서버·기본 목소리 게시본과 같은 셈·같은 인코더).
 *
 * - 멱등하다: 이미 올린 파일(표지가 있다)은 건너뛴다. 두 번 돌려도 두 번 올라가지 않는다.
 * - 다시 묶어도 커지지 않는 파일(봉우리가 높은 시우 인사말 3개)은 소리를 그대로 두고 표지만 단다(`[그대로]` —
 *   `boostMp3` 의 `reencoded`). 다시 묶으면 들어 본 것보다 0.24~0.38 dB 작아졌다.
 * - 랜딩 사본은 올린 res/raw 를 **그대로 복사**한다 — 따로 풀어 묶으면 바이트가 갈릴 수 있다.
 * - 끝에 검사한다: 표지(값이 지금 상수와 같은가)·프레임·랜딩 사본 일치·목록에 없는 파일. 하나라도 어긋나면 1 로 끝난다.
 * - 인사말을 새로 구웠으면(`npm run preview:stock -- --category greeting` → res/raw 로 복사) 이걸 한 번 돌리면 된다.
 *   ⚠ 상수를 바꾼 뒤에는 표지가 옛 값이라 검사에서 멈춘다 — 이미 올린 파일을 또 올리지 말고, 올리기 전 원본(git 이력)을
 *   되살려 다시 돌린다.
 *
 * 사용 (packages/backend 에서 — 올리기는 afconvert 를 써서 macOS 전용, `--check` 는 어디서나):
 *   npm run boost:greetings              # 올리고 랜딩 사본을 맞춘 뒤 검사한다
 *   npm run boost:greetings -- --check   # 쓰지 않고 검사만
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { TTS_LOUDNESS_BOOST_DB } from '../src/lib/tts-model.ts';
import { SYNTHESIS_PCM_SAMPLE_RATE } from '../src/lib/voice-pitch.ts';
import { type BundledClip, bundledVoiceClips, LANDING_AUDIO_DIR, RAW_DIR } from './bundled-voice-clips.ts';
import {
  afconvertDecoder,
  boostMp3,
  loudnessStats,
  readLoudnessBoostMarker,
  readMp3Layout,
} from './mp3-loudness-boost.ts';

/** 번들해서 돌리므로 `import.meta.url` 은 임시 폴더를 가리킨다 — cwd 에서 위로 찾는다(다른 스톡 스크립트와 같다). */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'packages/backend')) && existsSync(resolve(dir, 'apps'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`저장소 뿌리를 못 찾았다(cwd=${process.cwd()}). packages/backend 에서 실행할 것.`);
}

const REPO_ROOT = findRepoRoot();
/** afconvert 가 쓰는 중간 파일 자리(곧바로 지운다). */
const WORK_DIR = resolve(REPO_ROOT, 'packages/backend/node_modules/.cache/boost-bundled-greetings');

function db(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

function signedDb(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

async function boostAll(clips: BundledClip[]): Promise<void> {
  if (!(TTS_LOUDNESS_BOOST_DB > 0)) {
    // 0 이면 올리지 않는다(서버도 굽지 않는다) — 이미 올린 파일은 아래 검사가 잡는다(git 이력의 원본으로 되돌릴 것).
    console.log('음량 값이 0 이다 — 올리지 않는다.');
    return;
  }
  const decode = afconvertDecoder(WORK_DIR);
  for (const clip of clips) {
    const source = readFileSync(clip.rawPath);
    const marker = readLoudnessBoostMarker(source);
    if (marker !== null) {
      // 값이 지금 상수와 다르면 아래 검사가 잡는다 — 여기서 또 올리면 두 번 올라간다.
      console.log(`[건너뜀] ${clip.label} — 이미 표지가 있다(${marker} dB)`);
      continue;
    }
    const boosted = await boostMp3(source, decode);
    writeFileSync(clip.rawPath, boosted.bytes);
    const gainText = `배율 +${(20 * Math.log10(boosted.gain)).toFixed(2)} dB`;
    if (!boosted.reencoded) {
      // 다시 묶어도 커지지 않는다(대개 봉우리 때문에 배율이 다시 묶는 손실보다 작다) — 소리는 그대로 두고 표지만 달았다.
      const trial = boosted.netDb === null ? '' : `, 다시 묶으면 ${signedDb(boosted.netDb)} dB`;
      console.log(`[그대로] ${clip.label}  ${gainText}${trial} — 들어 본 소리에 표지만 달았다`);
      continue;
    }
    // `boostMp3` 가 묶은 소리를 다시 풀어 잰 값이다 — 실제로 풀리는지도 거기서 함께 봤다.
    const before = loudnessStats(boosted.before);
    const now = loudnessStats(boosted.after!);
    console.log(
      `[올림] ${clip.label}  ${gainText}  순 변화 ${signedDb(boosted.netDb!)} dB  ` +
        `LUFS ${db(before.lufs)} → ${db(now.lufs)}  봉우리 ${db(before.peakDbfs)} → ${db(now.peakDbfs)} dBFS  ` +
        `프레임 ${boosted.sourceAudioFrames} → ${boosted.boostedAudioFrames}  ` +
        `${(source.length / 1024).toFixed(0)}KB → ${(boosted.bytes.length / 1024).toFixed(0)}KB`,
    );
  }
}

function syncLandingCopies(clips: BundledClip[]): void {
  for (const clip of clips) {
    if (!clip.landingPath) continue;
    const raw = readFileSync(clip.rawPath);
    if (existsSync(clip.landingPath) && sameBytes(readFileSync(clip.landingPath), raw)) continue;
    writeFileSync(clip.landingPath, raw);
    console.log(`[사본] ${basename(clip.landingPath)} ← ${clip.label}`);
  }
}

/** 어긋난 것들(없으면 빈 배열). */
function verify(clips: BundledClip[]): string[] {
  const problems: string[] = [];
  // 0 이면 표지가 없어야 한다(올리지 않은 원본).
  const expectedMarker = TTS_LOUDNESS_BOOST_DB > 0 ? TTS_LOUDNESS_BOOST_DB : null;
  for (const clip of clips) {
    if (!existsSync(clip.rawPath)) {
      problems.push(`${clip.label}: 파일이 없다`);
      continue;
    }
    const raw = readFileSync(clip.rawPath);
    const marker = readLoudnessBoostMarker(raw);
    if (marker !== expectedMarker) {
      problems.push(`${clip.label}: 음량 표지 ${marker ?? '없음'} — 지금 값은 ${TTS_LOUDNESS_BOOST_DB} dB`);
    }
    try {
      const layout = readMp3Layout(raw);
      if (layout.sampleRate !== SYNTHESIS_PCM_SAMPLE_RATE || layout.channels !== 1) {
        problems.push(`${clip.label}: ${layout.sampleRate} Hz ${layout.channels}ch — ${SYNTHESIS_PCM_SAMPLE_RATE} Hz 모노가 아니다`);
      }
    } catch (error) {
      problems.push(`${clip.label}: ${(error as Error).message}`);
    }
    if (clip.landingPath) {
      if (!existsSync(clip.landingPath)) problems.push(`${basename(clip.landingPath)}: 랜딩 사본이 없다`);
      else if (!sameBytes(readFileSync(clip.landingPath), raw)) {
        problems.push(`${basename(clip.landingPath)}: 랜딩 사본이 ${clip.label} 과 다르다`);
      }
    }
  }
  // 목록에 없는 인사말 — 목소리·언어를 더했는데 목록을 안 고쳤다(그 파일은 올리지도 검사하지도 않는다).
  const rawNames = new Set(clips.map((clip) => basename(clip.rawPath)));
  for (const name of readdirSync(resolve(REPO_ROOT, RAW_DIR))) {
    if (/^voice_greeting_.+\.mp3$/.test(name) && !rawNames.has(name)) problems.push(`${name}: 목록에 없는 인사말`);
  }
  const landingNames = new Set(clips.flatMap((clip) => (clip.landingPath ? [basename(clip.landingPath)] : [])));
  for (const name of readdirSync(resolve(REPO_ROOT, LANDING_AUDIO_DIR))) {
    if (/-greeting\..+\.mp3$/.test(name) && !landingNames.has(name)) problems.push(`${name}: 목록에 없는 랜딩 인사말`);
  }
  return problems;
}

async function main(): Promise<void> {
  const clips = bundledVoiceClips(REPO_ROOT);
  if (!process.argv.slice(2).includes('--check')) {
    await boostAll(clips);
    syncLandingCopies(clips);
  }
  const problems = verify(clips);
  for (const problem of problems) console.error(`⚠ ${problem}`);
  const landingCount = clips.filter((clip) => clip.landingPath).length;
  const markerText = TTS_LOUDNESS_BOOST_DB > 0 ? `+${TTS_LOUDNESS_BOOST_DB} dB 표지` : '표지 없음(원본)';
  console.log(
    problems.length === 0
      ? `검사 통과 — 앱 ${clips.length}개 모두 ${markerText}·온전한 프레임, 랜딩 사본 ${landingCount}개 일치`
      : `검사 실패 ${problems.length}건`,
  );
  if (problems.length > 0) process.exitCode = 1;
}

await main();
