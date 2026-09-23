/**
 * 랜딩 이벤트의 **미리 듣기 샘플** 생성기(로컬 전용, Perso 호출 + 파일 쓰기).
 *
 * `EVENT_PREVIEW_MESSAGES`(`src/lib/event-voices.ts`)의 문안을 Perso 로 굽고,
 * `apps/landing/public/event/samples/<voice>.<locale>.mp3` 에 떨군다. 서버 라우트가 만드는 것과
 * **같은 함수**(`generateSentenceAudio`·`fetchPersoMedia`)를 쓴다 — 목소리·슬롯 규칙이 어긋나지 않게.
 * 문안이나 목소리가 바뀌면 다시 돌린다(옛 문안을 읽는 샘플은 거짓말이다).
 *
 * 사용 (packages/backend 에서):
 *   npm run samples:event                 # 이벤트 1 의 모든 목소리 × 세 언어
 *   npm run samples:event -- --voice voice1 --locale ko
 *   ⚠ 옵션 이름·값을 목록과 대조하고, 모르는 옵션이 섞이거나 아무것도 굽지 않으면 **실패로 끝낸다**
 *     — 오타 하나로 "성공했는데 옛 샘플 그대로" 거나 "전부 다시 구워짐" 이 되지 않도록.
 *
 * 키는 `.dev.vars.prod` 의 `PERSO_API_KEY` 를 읽는다(운영과 같은 Perso 프로젝트). 슬롯은 DB 커서 대신
 * 쓸 수 있는 문장 가운데 무작위로 고른다 — 운영 요청과 겹치면 서버와 같은 `PersoSlotRace` 로 잡혀
 * 다른 문장으로 다시 시도한다(최대 3회).
 *
 * ⚠ `node --experimental-strip-types` 로는 못 돌린다(`prerender-stock-preview.ts` 와 같은 이유) —
 *   `samples:event` 가 esbuild 로 먼저 번들한다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EVENT_LOCALES,
  renderPreviewMessage,
  slotAt,
  voiceProjectFor,
  type EventLocale,
} from '../src/lib/event-voices.ts';
import { eventVoiceIds } from '@alarmtalk/shared';
import {
  fetchPersoMedia,
  generateSentenceAudio,
  listSentenceSeqs,
  looksLikeMp3,
  MIN_CLIP_BYTES,
  PersoSlotRace,
} from '../src/lib/perso.ts';

const EVENT_ID = '1';

// esbuild 번들이 `node_modules/.cache/` 에서 돌므로 파일 위치가 아니라 **실행 위치**(packages/backend)를 기준으로 한다.
const backendRoot = process.cwd();
const samplesDir = resolve(backendRoot, '../../apps/landing/public/event/samples');

function readPersoKey(): string {
  const env = readFileSync(resolve(backendRoot, '.dev.vars.prod'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('PERSO_API_KEY='));
  if (!line) throw new Error('PERSO_API_KEY not in .dev.vars.prod');
  let v = line.slice('PERSO_API_KEY='.length).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

/**
 * `--name 값`. **값이 빠졌거나 목록에 없으면 그 자리에서 멈춘다**(코덱스 #797) — 오타 하나로
 * "아무것도 굽지 않고 성공" 하거나(자동화는 0 을 보고 지나간다) `--voice` 값이 없어 **전부**
 * 다시 구워지는 일이 없도록.
 */
/** 이 스크립트가 아는 옵션 전부. 여기 없는 이름은 오타로 본다. */
const KNOWN_FLAGS = ['--voice', '--locale'] as const;

/**
 * 인자를 **`--이름 값` 쌍으로만** 읽는다. 하나라도 그 꼴이 아니면 멈춘다(코덱스 #798).
 *
 * 왜 이렇게까지: 이 스크립트는 저장소에 커밋되는 샘플을 **덮어쓴다.** 무엇이든 조용히 지나가면
 * 필터가 사라진 채 전부 다시 구워지고, 사람은 성공했다고 믿는다. 실제로 세 가지가 그랬다 —
 * 모르는 이름(`--voiec voice1`), 등호 꼴(`--voice=voice1`), 그리고 표시를 빠뜨린 값(`locale ko`).
 */
function parseFlags(): Map<string, string> {
  const rest = process.argv.slice(2);
  const out = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) {
      throw new Error(`\`${token}\` 은 옵션이 아니다 — 인자는 \`--이름 값\` 쌍으로만 준다`);
    }
    if (token.includes('=')) {
      throw new Error(`${token} — 등호 꼴은 읽지 않는다. \`${token.split('=')[0]} 값\` 으로 준다`);
    }
    if (!(KNOWN_FLAGS as readonly string[]).includes(token)) {
      throw new Error(`모르는 옵션 ${token} (가능한 옵션: ${KNOWN_FLAGS.join(', ')})`);
    }
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} 에 값이 없다`);
    if (out.has(token)) throw new Error(`${token} 이 두 번 있다`);
    out.set(token, value);
    i += 1;
  }
  return out;
}

/** 파싱해 둔 쌍에서 값 하나. 목록이 있으면 거기 없는 값은 거절한다. */
function arg(
  flags: Map<string, string>,
  name: string,
  allowed?: readonly string[],
): string | undefined {
  const value = flags.get(`--${name}`);
  if (value === undefined) return undefined;
  if (allowed && !allowed.includes(value)) {
    throw new Error(`--${name} ${value} 는 목록에 없다 (가능한 값: ${allowed.join(', ')})`);
  }
  return value;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const apiKey = readPersoKey();
  const voiceIds = eventVoiceIds(EVENT_ID);
  const onlyVoice = arg(flags, 'voice', voiceIds);
  const onlyLocale = arg(flags, 'locale', EVENT_LOCALES) as EventLocale | undefined;
  mkdirSync(samplesDir, { recursive: true });
  const sentenceCache = new Map<number, number[]>();
  let written = 0;

  for (const voiceId of voiceIds) {
    if (onlyVoice && voiceId !== onlyVoice) continue;
    for (const locale of EVENT_LOCALES) {
      if (onlyLocale && locale !== onlyLocale) continue;
      const voice = voiceProjectFor(EVENT_ID, voiceId, locale);
      if (!voice) {
        console.log(`skip ${voiceId}.${locale}: no Perso project for this locale`);
        continue;
      }
      const message = renderPreviewMessage(locale);
      let sentences = sentenceCache.get(voice.project);
      if (!sentences) {
        sentences = await listSentenceSeqs(apiKey, voice.project, voice.spaceSeq);
        sentenceCache.set(voice.project, sentences);
      }
      let path: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const slot = slotAt(voice, sentences, Math.floor(Math.random() * 1_000_000));
        try {
          path = (await generateSentenceAudio(apiKey, slot, message.tts)).path;
          break;
        } catch (err) {
          if (!(err instanceof PersoSlotRace) || attempt === 2) throw err;
          console.warn(`slot race on ${slot.project}/${slot.sentence}, retrying`);
        }
      }
      if (!path) throw new Error('no slot succeeded');
      const bytes = new Uint8Array(await (await fetchPersoMedia(path)).arrayBuffer());
      if (bytes.byteLength < MIN_CLIP_BYTES || !looksLikeMp3(bytes)) {
        throw new Error(`${voiceId}.${locale}: Perso media is not an mp3 (${bytes.byteLength} bytes)`);
      }
      const out = resolve(samplesDir, `${voiceId}.${locale}.mp3`);
      writeFileSync(out, bytes);
      written += 1;
      console.log(`wrote ${out} (${bytes.byteLength} bytes) — "${message.display.replace(/\n/g, ' ')}"`);
    }
  }
  // 아무것도 안 구웠는데 0 으로 끝나면, 오래된 샘플을 그대로 커밋하게 된다(코덱스 #797).
  if (written === 0) throw new Error('구운 샘플이 없다 — --voice/--locale 조합을 확인할 것');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
