/**
 * 스톡 클립 **시청본** 생성기 (로컬 전용, 읽기+파일쓰기만).
 *
 * `STOCK_CLIP_PRESETS` 의 확정 대사를 시스템 목소리 4종 × 3언어로 구워
 * `voice-preview/` 에 떨군다. 사람이 먼저 들어 보고 확정하기 위한 것이고,
 * 확정되면 같은 바이트를 R2 에 올려 **배포 때 재합성하지 않는다**.
 *
 * ⚠ **백엔드와 파라미터가 한 글자도 달라지면 안 된다.** 여기서 만든 바이트를 그대로
 *   R2 에 올릴 것이므로, 모델·voice_settings·output_format·무음 패딩이 다르면
 *   시청한 소리와 실제로 울리는 소리가 달라진다. 그래서 `appendMp3TrailingSilence`
 *   와 `STOCK_CLIP_PRESETS` 를 **서버 소스에서 그대로 가져다 쓴다**(베끼지 않는다).
 *
 * 멱등하다 — 이미 있는 파일은 건너뛴다. 중간에 끊기면 다시 돌리면 이어서 받는다.
 *
 * 사용 (packages/backend 에서):
 *   npm run preview:stock -- --dry-run     # 무엇이 빠졌는지만 본다
 *   npm run preview:stock                  # 빠진 것 전부 굽는다
 *   npm run preview:stock -- --lang ja --voice 미나
 *   옵션: --force  이미 있어도 다시 굽는다 / --dry-run  무엇을 구울지만 출력
 *
 * ⚠ **`node --experimental-strip-types` 로는 못 돌린다.** 이 스크립트가 가져다 쓰는
 *   서버 소스(`stock-clips.ts`)가 확장자 없는 import 를 쓰는데(워커 번들러 기준),
 *   node 의 ESM 해석기는 그걸 못 찾는다(`ERR_MODULE_NOT_FOUND: .../r2-storage`).
 *   그래서 `preview:stock` 이 esbuild 로 먼저 번들한다.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { STOCK_CLIP_PRESETS, withClosingBreath } from '../src/lib/stock-clips.ts';
import { appendMp3TrailingSilence } from '../src/lib/mp3-silence.ts';
import { ELEVENLABS_TTS_OUTPUT_FORMAT } from '../src/lib/elevenlabs.ts';

/**
 * ⚠ `import.meta.url` 로 저장소 뿌리를 잡지 않는다. 이 스크립트는 extensionless import 를
 *   쓰는 서버 소스를 그대로 가져오므로 **esbuild 로 번들해서** 돌리는데, 그러면
 *   `import.meta.url` 이 번들 위치(임시 폴더)를 가리켜 `voice-preview/` 를 못 찾는다.
 *   실제로 그렇게 "240개 전부 없음" 으로 읽었다. cwd 에서 위로 올라가며 찾는다.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'packages/backend')) && existsSync(resolve(dir, 'apps'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`저장소 뿌리를 못 찾았다(cwd=${process.cwd()}). packages/backend 에서 실행할 것.`);
}

const REPO_ROOT = findRepoRoot();
const BACKEND_DIR = resolve(REPO_ROOT, 'packages/backend');
const OUT_ROOT = resolve(REPO_ROOT, 'voice-preview');

/**
 * 교체 후의 시스템 목소리 4종. `migrations.ts` #111 과 **같은 값**이어야 한다 —
 * 다르면 시청본과 실제 알람이 다른 목소리가 된다.
 */
const VOICES: { name: string; providerVoiceId: string }[] = [
  { name: '시우', providerVoiceId: '1W00IGEmNmwmsDeYy7ag' },
  { name: '미나', providerVoiceId: 'aiUUgjHa4mpHf6UenZuf' }, // #111 이 안 건드리는 유일한 목소리
  { name: '도현', providerVoiceId: 'MFZUKuGQUsGJPQjTS4wC' },
  { name: '애니', providerVoiceId: 'OSwaPSNdfituxkWcjlkR' },
];

const LANGUAGES = ['ko', 'en', 'ja'] as const;
type Language = (typeof LANGUAGES)[number];

/** `elevenlabs.ts` 의 `textToSpeech` 기본값과 동일. 바꾸면 소리가 갈라진다. */
const MODEL_ID = 'eleven_v3';
const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.8,
  style: 0.4,
  // ⚠ 1.0 으로 올리지 말 것 — 알람은 막 깬 사람이 듣는다(elevenlabs.ts 주석 참조).
  speed: 0.9,
  use_speaker_boost: true,
} as const;

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function loadApiKey(): string {
  const fromEnv = process.env.ELEVENLABS_API_KEY;
  if (fromEnv) return fromEnv;
  const path = resolve(BACKEND_DIR, '.dev.vars.dev');
  if (!existsSync(path)) {
    throw new Error('ELEVENLABS_API_KEY 가 없다 — 환경변수나 .dev.vars.dev 에 넣을 것.');
  }
  for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== 'ELEVENLABS_API_KEY') continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  throw new Error('.dev.vars.dev 에 ELEVENLABS_API_KEY 가 비어 있다.');
}

/**
 * ko 는 `voice-preview/<목소리>/`, en·ja 는 `voice-preview/<언어>/<목소리>/`.
 * 먼저 만들어 둔 폴더 구조를 그대로 따른다 — 옮기면 이미 들어 본 것과 짝이 안 맞는다.
 */
function outputDir(language: Language, voiceName: string): string {
  return language === 'ko'
    ? resolve(OUT_ROOT, voiceName)
    : resolve(OUT_ROOT, language, voiceName);
}

interface Target {
  language: Language;
  voiceName: string;
  providerVoiceId: string;
  category: string;
  variant: number;
  text: string;
  fileName: string;
  filePath: string;
}

function collectTargets(): Target[] {
  const onlyLang = argValue('--lang');
  const onlyVoice = argValue('--voice');
  const targets: Target[] = [];
  for (const language of LANGUAGES) {
    if (onlyLang && onlyLang !== language) continue;
    for (const voice of VOICES) {
      if (onlyVoice && onlyVoice !== voice.name) continue;
      const dir = outputDir(language, voice.name);
      for (const preset of STOCK_CLIP_PRESETS) {
        const texts = preset.texts[language] as readonly string[] | undefined;
        if (!texts) continue;
        texts.forEach((text, variant) => {
          const fileName = `${preset.category}_${String(variant).padStart(2, '0')}.mp3`;
          targets.push({
            language,
            voiceName: voice.name,
            providerVoiceId: voice.providerVoiceId,
            category: preset.category,
            variant,
            text,
            fileName,
            filePath: resolve(dir, fileName),
          });
        });
      }
    }
  }
  return targets;
}

async function synthesize(apiKey: string, target: Target): Promise<Uint8Array> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${target.providerVoiceId}?output_format=${ELEVENLABS_TTS_OUTPUT_FORMAT}`;
  // 서버와 같은 본문. `language_code` 는 모델이 거부하면 빼고 한 번 더 시도한다 —
  // 확정 리터럴이라 언어 힌트가 없어도 발음이 갈리지 않는다.
  for (const withLanguage of [true, false]) {
    const body: Record<string, unknown> = {
      // ⚠ **서버가 제공자에게 보내는 그 글자여야 한다.** `generateStockClip` 은
      //   `withClosingBreath(synthesisText)` 를 보낸다 — 문장 끝 ` ...` 가 v3 의
      //   급마감을 막는다. 여기서 빼면 시청본과 실제 알람의 **말끝이 달라진다.**
      text: withClosingBreath(target.text),
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    };
    if (withLanguage) body.language_code = target.language;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return appendMp3TrailingSilence(new Uint8Array(await res.arrayBuffer()));
    const detail = await res.text().catch(() => '');
    const languageRejected =
      withLanguage && res.status === 422 && detail.toLowerCase().includes('language');
    if (!languageRejected) {
      throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
  throw new Error('unreachable');
}

/** 무엇을 어떤 문구로 구웠는지 사람이 볼 수 있게 남긴다(시청할 때 대조용). */
function writeScriptManifest(language: Language, voiceName: string, targets: Target[]): void {
  const lines: string[] = [];
  for (const target of targets) {
    lines.push(target.fileName, `    ${target.text}`, '');
  }
  writeFileSync(resolve(outputDir(language, voiceName), '문구.txt'), lines.join('\n'), 'utf-8');
}

async function main(): Promise<void> {
  const force = hasFlag('--force');
  const dryRun = hasFlag('--dry-run');
  const targets = collectTargets();
  const pending = force ? targets : targets.filter((t) => !existsSync(t.filePath));

  const bySet = new Map<string, number>();
  for (const t of pending) {
    const key = `${t.language}/${t.voiceName}`;
    bySet.set(key, (bySet.get(key) ?? 0) + 1);
  }
  console.log(`전체 ${targets.length}개 중 만들 것 ${pending.length}개`);
  for (const [key, count] of [...bySet].sort()) console.log(`  ${key}\t${count}개`);
  if (dryRun || pending.length === 0) {
    if (pending.length === 0) console.log('빠진 것이 없다.');
    return;
  }

  const apiKey = loadApiKey();
  for (const dir of new Set(pending.map((t) => dirname(t.filePath)))) {
    mkdirSync(dir, { recursive: true });
  }

  let done = 0;
  let failed = 0;
  for (const target of pending) {
    const label = `${target.language}/${target.voiceName}/${target.fileName}`;
    try {
      const bytes = await synthesize(apiKey, target);
      writeFileSync(target.filePath, bytes);
      done += 1;
      console.log(`[${done}/${pending.length}] ${label}  ${(bytes.length / 1024).toFixed(0)}KB`);
    } catch (error) {
      failed += 1;
      console.error(`[실패] ${label}  ${(error as Error).message}`);
    }
  }

  // 문구 대조표는 그 세트가 온전할 때만 새로 쓴다(부분 실패 상태를 완성본처럼 남기지 않는다).
  for (const key of bySet.keys()) {
    const [language, voiceName] = key.split('/') as [Language, string];
    const setTargets = targets.filter((t) => t.language === language && t.voiceName === voiceName);
    if (setTargets.every((t) => existsSync(t.filePath))) {
      writeScriptManifest(language, voiceName, setTargets);
    }
  }

  console.log(`\n완료 ${done}개${failed ? ` · 실패 ${failed}개(다시 돌리면 그것만 재시도한다)` : ''}`);
}

await main();
