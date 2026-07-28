// 마이그레이션 #70(refresh-stock-clips-2026-07-19-script) 실동작 검증 — 실제 libsql 파일 DB 에
// 전체 마이그레이션을 올린 뒤:
//  1) 동결 사본이 살아있는 STOCK_CLIP_PRESETS 와 오늘 일치하는지(어긋나면 새 refresh
//     마이그레이션 없이 문구만 바뀐 것 → 이 테스트가 강제한다),
//  2) '낡은 문구' preset 만 지워지고 확정 문구 preset 은 보존되는지(2026-07-19 시딩 DB no-op 보장),
//  3) 낡은 클립을 참조하던 알람이 sound-only 로 떼어지는지 확인한다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { migrations, runMigrationsRange } from '../src/lib/migrations';
import { STOCK_CLIP_PRESETS } from '../src/lib/stock-clips';

const DB_PATH = join(tmpdir(), 'alarmtalk-migration-stock-refresh.db');
// 파일 DB 는 실행 간 남는다. 이전 실행이 더 뒤의 마이그레이션까지 적용해 뒀으면 원장
// (_migrations) 때문에 아래 범위 지정이 무시되므로, 매번 새 파일에서 시작한다.
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

const SYSTEM_USER = '70000000-0000-4000-9000-000000000001';
const ADAM_VOICE = '70000000-0000-4000-9000-000000000101';

const migration70 = migrations.find((m) => m.id === 70)!;
const CURRENT_KO_WEATHER_0 = STOCK_CLIP_PRESETS.find((p) => p.category === 'weather')!.texts.ko[0]!;

async function insertPreset(id: string, synthesisText: string) {
  await db.execute({
    sql: `INSERT INTO messages
          (id, user_id, voice_profile_id, text, synthesis_text, delivery_tags_json,
           category, language, variant, is_preset, audio_url)
          VALUES (?, ?, ?, ?, ?, '[]', 'weather', 'ko', 0, 1, 'r2://generated-tts/x/x.mp3')`,
    args: [id, SYSTEM_USER, ADAM_VOICE, synthesisText, synthesisText],
  });
  await db.execute({
    sql: `INSERT INTO generated_audio_assets
          (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
           model_id, language, request_hash, text, audio_url, audio_object_key,
           audio_format, mime_type, size_bytes)
          VALUES (?, ?, ?, ?, 'elevenlabs', 'v', 'eleven_v3', 'ko', ?, ?, 'r2://x', 'x',
                  'mp3', 'audio/mpeg', 1)`,
    args: [`ga-${id}`, SYSTEM_USER, ADAM_VOICE, id, `hash-${id}`, synthesisText],
  });
}

beforeAll(async () => {
  // #70 의 문장을 그대로 재실행해 검증하므로, 스키마를 **그 시점 상태**(#79까지)로 세운다.
  // 전체 체인을 돌리면 이후 정리 마이그레이션(#83 의 alarms.speaker_id DROP)이 #70 의
  // UPDATE 문을 'no such column' 으로 깨뜨린다. 적용된 마이그레이션 본문은 불변이어야 하므로
  // (#1 을 수정해 perso_voice_id 드리프트를 만든 전례) 테스트 쪽에서 범위를 고정한다.
  await runMigrationsRange(db, 1, 79);
  await db.execute('DELETE FROM alarms');
  await db.execute("DELETE FROM messages WHERE id LIKE 'm70-%'");
  await db.execute("DELETE FROM generated_audio_assets WHERE id LIKE 'ga-m70-%'");
  await db.execute(
    `INSERT OR IGNORE INTO users (id, google_id, email) VALUES ('m70-user', 'm70-user', 'm70@test')`,
  );
});

describe('migration #70 — 스톡 클립 문구 수렴형 무효화', () => {
  it('동결 사본이 현재 STOCK_CLIP_PRESETS 문구를 전부 포함한다 (문구 변경 시 새 마이그레이션 강제)', () => {
    const deleteSql = migration70.statements[migration70.statements.length - 1]!;
    for (const preset of STOCK_CLIP_PRESETS) {
      for (const list of Object.values(preset.texts as Record<string, readonly string[]>)) {
        for (const text of list) {
          expect(deleteSql).toContain(text.replace(/'/g, "''"));
        }
      }
    }
  });

  it('낡은 문구 preset 만 지우고, 확정 문구 preset 과 참조 알람 처리까지 정확히 수행한다', async () => {
    await insertPreset('m70-stale', '[cheerfully] 오늘 날씨 진짜 좋아요. (구버전 문구)');
    await insertPreset('m70-current', CURRENT_KO_WEATHER_0);
    await db.execute({
      sql: `INSERT INTO alarms (id, user_id, message_id, time, mode)
            VALUES ('m70-alarm', 'm70-user', 'm70-stale', '07:00', 'tts')`,
      args: [],
    });

    for (const sql of migration70.statements) {
      await db.execute(sql);
    }

    const messages = await db.execute(
      "SELECT id FROM messages WHERE id IN ('m70-stale', 'm70-current')",
    );
    expect(messages.rows.map((r) => String(r.id))).toEqual(['m70-current']);

    const assets = await db.execute(
      "SELECT id FROM generated_audio_assets WHERE id IN ('ga-m70-stale', 'ga-m70-current')",
    );
    expect(assets.rows.map((r) => String(r.id))).toEqual(['ga-m70-current']);

    const alarm = await db.execute("SELECT mode, message_id FROM alarms WHERE id = 'm70-alarm'");
    expect(alarm.rows[0]!.mode).toBe('sound-only');
    expect(alarm.rows[0]!.message_id).toBeNull();
  });
});
