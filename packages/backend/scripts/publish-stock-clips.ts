/**
 * **미리 구워 둔 스톡 클립을 R2 와 DB 에 게시한다.**
 *
 * `scripts/prerender-stock-preview.ts` 가 만든 `voice-preview/` 의 바이트를 그대로 올린다 —
 * **배포 때 서버가 다시 합성하지 않는다.** 그게 이 스크립트의 존재 이유다:
 *
 *  - 예전에는 배포 직후 cron 이 240개를 5분에 6개씩 구웠다. **3시간 20분** 동안 기본
 *    목소리로 테마를 고를 수 없었고(`freeBucketsFor` 가 완전한 세트만 노출한다),
 *    그 창 때문에 리뷰 지적이 줄줄이 나왔다 — 마이그레이션 사이 cron 경합, 부분 매니페스트,
 *    실패 타깃의 배치 독점, 그리고 **결정론적 키를 둘러싼 삭제 경합 전부**.
 *  - 미리 올려 두면 **동시에 굽는 렌더가 없다.** 경합이 성립하지 않는다.
 *
 * ⚠ **키는 서버가 계산하는 것과 한 글자도 달라선 안 된다.** 그래서 `computeTtsCacheKey`·
 *   `generatedTtsObjectKey`·`withClosingBreath` 를 **서버 소스에서 그대로 가져다 쓴다**
 *   (베끼지 않는다). 어긋나면 `findMissingStockTargets` 가 이 클립을 '없다' 로 세어
 *   cron 이 같은 자리를 다시 굽고, 그때부터 옛 경합이 되살아난다.
 *
 * 멱등하다 — 이미 게시된 자리는 건너뛴다. 중간에 끊기면 다시 돌리면 이어서 한다.
 *
 * 사용 (packages/backend 에서):
 *   npm run publish:stock -- --env dev --dry-run   # 무엇을 올릴지만 본다
 *   npm run publish:stock -- --env dev
 *   npm run publish:stock -- --env prod
 *
 * ⚠ **R2 버킷과 DB 는 환경별로 따로다**(dev `voice-alarm-voices` / prod
 *   `voice-alarm-voices-prod`). 합성은 한 번이지만 **게시는 두 번** 해야 한다.
 *
 * ⚠ **prod 는 `#110` 이 옛 프리셋을 은퇴시킨 뒤에 돌린다.** 은퇴 전에는 같은 자리에 살아
 *   있는 행이 있어 이 스크립트가 전부 건너뛴다. R2 업로드만 먼저 해 두는 것은 무해하다 —
 *   아무도 안 가리키는 오브젝트일 뿐이다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { createClient, type Client } from '@libsql/client';

import {
  STOCK_CLIP_PRESETS,
  SYSTEM_VOICE_LIBRARY_USER_ID,
  stripDeliveryTags,
  withClosingBreath,
} from '../src/lib/stock-clips.ts';
import { computeTtsCacheKey, generatedTtsObjectKey } from '../src/lib/audio-cache.ts';
import { prepareAlarmTextWithVertex } from '../src/lib/vertex-translate.ts';

/** `voice-provider.ts` 의 elevenlabs 갈래와 같은 값. 바뀌면 캐시 키가 갈라진다. */
const PROVIDER = 'elevenlabs';
const MODEL_ID = 'eleven_v3';
const OUTPUT_FORMAT = 'mp3';

/** 교체 후의 시스템 목소리. `migrations.ts` #111 · 시청본 생성기와 **같은 값**이어야 한다. */
const VOICES = [
  { name: '시우', profileId: '70000000-0000-4000-9000-000000000101', providerVoiceId: '1W00IGEmNmwmsDeYy7ag' },
  { name: '미나', profileId: '70000000-0000-4000-9000-000000000102', providerVoiceId: 'aiUUgjHa4mpHf6UenZuf' },
  { name: '도현', profileId: '70000000-0000-4000-9000-000000000103', providerVoiceId: 'MFZUKuGQUsGJPQjTS4wC' },
  { name: '애니', profileId: '70000000-0000-4000-9000-000000000104', providerVoiceId: 'OSwaPSNdfituxkWcjlkR' },
];

const LANGUAGES = ['ko', 'en', 'ja'] as const;
type Language = (typeof LANGUAGES)[number];

const BUCKETS: Record<string, string> = {
  dev: 'voice-alarm-voices',
  prod: 'voice-alarm-voices-prod',
};
const ENV_FILES: Record<string, string> = {
  dev: '.dev.vars.dev',
  prod: '.dev.vars.prod',
};

function findRepoRoot(): string {
  // 번들해서 돌리므로 `import.meta.url` 은 임시 폴더를 가리킨다 — cwd 에서 위로 찾는다
  // (`prerender-stock-preview.ts` 와 같은 이유).
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
const BACKEND_DIR = resolve(REPO_ROOT, 'packages/backend');
const PREVIEW_ROOT = resolve(REPO_ROOT, 'voice-preview');

function argValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === name) return argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}
const hasFlag = (name: string) => process.argv.slice(2).includes(name);

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/** ko 는 `voice-preview/<목소리>/`, en·ja 는 `voice-preview/<언어>/<목소리>/`. */
function previewPath(language: Language, voiceName: string, fileName: string): string {
  return language === 'ko'
    ? resolve(PREVIEW_ROOT, voiceName, fileName)
    : resolve(PREVIEW_ROOT, language, voiceName, fileName);
}

interface Target {
  language: Language;
  voiceName: string;
  profileId: string;
  providerVoiceId: string;
  category: string;
  variant: number;
  baseText: string;
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
      for (const preset of STOCK_CLIP_PRESETS) {
        const texts = preset.texts[language] as readonly string[] | undefined;
        if (!texts) continue;
        texts.forEach((baseText, variant) => {
          const fileName = `${preset.category}_${String(variant).padStart(2, '0')}.mp3`;
          targets.push({
            language,
            voiceName: voice.name,
            profileId: voice.profileId,
            providerVoiceId: voice.providerVoiceId,
            category: preset.category,
            variant,
            baseText,
            filePath: previewPath(language, voice.name, fileName),
          });
        });
      }
    }
  }
  return targets;
}

/**
 * 서버의 시스템 스톡 갈래와 **같은 방식**으로 문구 세 벌을 만든다
 * (`generateStockClip` 의 else 분기).
 *
 * `translate:false, autoTag:false` 면 `prepareAlarmTextWithVertex` 는 네트워크를 타지 않고
 * 로컬 패스스루로 태그만 뽑는다 — 그래서 `env` 가 비어도 된다.
 */
async function deriveTexts(baseText: string, language: Language) {
  const prepared = await prepareAlarmTextWithVertex({} as never, baseText, {
    targetLanguage: language,
    sourceLanguage: language,
    translate: false,
    autoTag: false,
  });
  const synthesisText = prepared.text;
  return {
    synthesisText,
    displayText: stripDeliveryTags(synthesisText) || stripDeliveryTags(baseText),
    deliveryTagsJson: JSON.stringify(prepared.tags),
  };
}

async function alreadyPublished(db: Client, target: Target): Promise<boolean> {
  const rows = await db.execute({
    sql: `SELECT 1 FROM messages
           WHERE voice_profile_id = ? AND category = ? AND language = ? AND variant = ?
             AND COALESCE(is_preset, 0) = 1 AND retired_at IS NULL
           LIMIT 1`,
    args: [target.profileId, target.category, target.language, target.variant],
  });
  return rows.rows.length > 0;
}

function uploadToR2(bucket: string, key: string, filePath: string, env: Record<string, string>): void {
  execFileSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', filePath, '--remote', '--content-type', 'audio/mpeg'],
    {
      cwd: BACKEND_DIR,
      stdio: 'pipe',
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN ?? '',
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID ?? '',
      },
    },
  );
}

async function main(): Promise<void> {
  const envName = argValue('--env') ?? 'dev';
  const bucket = BUCKETS[envName];
  const envFile = ENV_FILES[envName];
  if (!bucket || !envFile) throw new Error(`--env 는 dev 또는 prod 다(받은 값: ${envName}).`);
  const dryRun = hasFlag('--dry-run');

  const env = loadEnvFile(resolve(BACKEND_DIR, envFile));
  const targets = collectTargets();

  const missingFiles = targets.filter((t) => !existsSync(t.filePath));
  if (missingFiles.length > 0) {
    console.error(`⚠ 시청본이 없는 자리 ${missingFiles.length}개 — 먼저 \`npm run preview:stock\` 을 돌릴 것.`);
    for (const t of missingFiles.slice(0, 5)) console.error(`  ${t.language}/${t.voiceName}/${t.category}_${t.variant}`);
    if (missingFiles.length > 5) console.error(`  … 외 ${missingFiles.length - 5}개`);
    process.exitCode = 1;
    return;
  }

  const db = createClient({ url: env.TURSO_DATABASE_URL!, authToken: env.TURSO_AUTH_TOKEN });

  // ⚠ **`retired_at` 이 없으면 아직 #110 이 안 돌았다.** 그 상태로 진행하면 같은 자리에
  //   살아 있는 옛 행이 있어 전부 건너뛰고, 사용자는 "왜 아무것도 안 올라가지" 로 읽는다.
  //   컬럼이 없으면 아래 조회가 `no such column` 으로 죽으므로 먼저 알아듣게 말한다.
  const columns = await db.execute('PRAGMA table_info(messages)');
  if (!columns.rows.some((row) => String(row.name) === 'retired_at')) {
    console.error(
      `⚠ ${envName} DB 에 messages.retired_at 이 없다 — 마이그레이션 #110 이 아직 안 돌았다.\n` +
        '  배포(=마이그레이션) 뒤에 다시 돌릴 것. 그전에는 옛 프리셋이 같은 자리에 살아 있어\n' +
        '  이 스크립트가 전부 건너뛴다.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`환경 ${envName} · 버킷 ${bucket} · 대상 ${targets.length}개`);

  let published = 0;
  let skipped = 0;
  let failed = 0;
  for (const target of targets) {
    const label = `${target.language}/${target.voiceName}/${target.category}_${String(target.variant).padStart(2, '0')}`;
    try {
      if (await alreadyPublished(db, target)) {
        skipped += 1;
        continue;
      }
      const { synthesisText, displayText, deliveryTagsJson } = await deriveTexts(
        target.baseText,
        target.language,
      );
      // ⚠ **제공자에게 보낸 그 글자로 키를 만든다** — 시청본도 같은 글자로 구웠다.
      const cacheKey = await computeTtsCacheKey({
        provider: PROVIDER,
        providerVoiceId: target.providerVoiceId,
        voiceProfileId: target.profileId,
        modelId: MODEL_ID,
        language: target.language,
        languageCode: target.language,
        text: withClosingBreath(synthesisText),
        outputFormat: OUTPUT_FORMAT,
      });
      const objectKey = generatedTtsObjectKey(SYSTEM_VOICE_LIBRARY_USER_ID, cacheKey, OUTPUT_FORMAT);
      const audioUrl = `r2://${objectKey}`;
      const size = statSync(target.filePath).size;

      if (dryRun) {
        console.log(`[예정] ${label}  ${(size / 1024).toFixed(0)}KB  ${objectKey}`);
        published += 1;
        continue;
      }

      uploadToR2(bucket, objectKey, target.filePath, env);

      const messageId = crypto.randomUUID();
      // 조건부 INSERT — 두 번 돌려도 중복 행이 생기지 않는다(서버의 게시 가드와 같은 술어).
      const inserted = await db.execute({
        sql: `INSERT INTO messages
                (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
                 category, language, variant, is_preset, audio_url)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
               WHERE NOT EXISTS (
                 SELECT 1 FROM messages
                  WHERE voice_profile_id = ? AND category = ? AND language = ? AND variant = ?
                    AND COALESCE(is_preset, 0) = 1 AND retired_at IS NULL
               )`,
        args: [
          messageId, SYSTEM_VOICE_LIBRARY_USER_ID, target.profileId,
          displayText, synthesisText, deliveryTagsJson,
          target.category, target.language, target.variant, audioUrl,
          target.profileId, target.category, target.language, target.variant,
        ],
      });
      if ((inserted.rowsAffected ?? 0) === 0) {
        // 그 사이 누군가 같은 자리를 채웠다. 오브젝트는 남지만 아무도 안 가리키므로
        // 보관 스윕이 회수한다 — 여기서 지우면 **이긴 쪽의 오브젝트**를 지울 수 있다.
        skipped += 1;
        continue;
      }
      // R2 키의 **유일한 원장**이다 — 이 행이 없으면 동의 철회에도 오디오를 못 지운다.
      await db.execute({
        sql: `INSERT OR IGNORE INTO generated_audio_assets
                (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                 model_id, language, request_hash, text,
                 audio_url, audio_object_key, audio_format)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(), SYSTEM_VOICE_LIBRARY_USER_ID, target.profileId, messageId,
          PROVIDER, target.providerVoiceId, MODEL_ID, target.language,
          cacheKey, synthesisText, audioUrl, objectKey, OUTPUT_FORMAT,
        ],
      });
      published += 1;
      console.log(`[${published}] ${label}  ${(size / 1024).toFixed(0)}KB`);
    } catch (error) {
      failed += 1;
      console.error(`[실패] ${label}  ${(error as Error).message.slice(0, 200)}`);
    }
  }

  console.log(
    `\n게시 ${published}개 · 이미 있음 ${skipped}개${failed ? ` · 실패 ${failed}개(다시 돌리면 그것만 재시도한다)` : ''}`,
  );
  if (failed > 0) process.exitCode = 1;
}

await main();
