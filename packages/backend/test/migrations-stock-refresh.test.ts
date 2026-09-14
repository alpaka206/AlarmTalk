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
import { createHash } from 'node:crypto';
import { STOCK_CLIP_PRESETS } from '../src/lib/stock-clips';
import { STOCK_FINGERPRINT_IN_NAME, STOCK_INVALIDATION_NAME } from '../src/lib/migrations';

const DB_PATH = join(tmpdir(), 'alarmtalk-migration-stock-refresh.db');
// 파일 DB 는 실행 간 남는다. 이전 실행이 더 뒤의 마이그레이션까지 적용해 뒀으면 원장
// (_migrations) 때문에 아래 범위 지정이 무시되므로, 매번 새 파일에서 시작한다.
for (const suffix of ['', '-shm', '-wal']) rmSync(`${DB_PATH}${suffix}`, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

const SYSTEM_USER = '70000000-0000-4000-9000-000000000001';
const ADAM_VOICE = '70000000-0000-4000-9000-000000000101';

const migration70 = migrations.find((m) => m.id === 70)!;
// ⚠ **살아 있는 프리셋에서 가져오지 않는다.** #70 은 **자기 시대의** 문구를 지키는
// 마이그레이션이라, 기준을 현재 문구로 두면 대사를 새로 쓸 때마다 이 테스트가 깨진다
// (2026-09-02 에 실제로 그랬다). #70 자신의 동결 사본에서 한 줄을 꺼내 쓴다.
const KEEP_LIST_SQL = migration70.statements[migration70.statements.length - 1]!;
const MIGRATION_70_KEPT_TEXT = KEEP_LIST_SQL.match(/'(\[cheerfully\][^']*)'/)?.[1]
  ?? KEEP_LIST_SQL.match(/'(\[[a-z]+\][^']{20,})'/)![1]!;

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
  /**
   * **문구가 바뀌면 옛 클립을 무효화하는 마이그레이션을 반드시 함께 넣게 한다.**
   *
   * ⚠ 예전에는 "가장 최근 refresh 의 동결 사본이 현재 문구를 전부 포함하는가" 로 봤다.
   *   그 방식은 문구 52개를 마이그레이션에 **한 벌 더** 적어야 했고, 대사를 통째로
   *   새로 쓴 2026-09-02 에는 그 사본이 순수한 중복이 됐다(#110 은 텍스트를 비교하지 않고
   *   시스템 프리셋을 **전부** 지운다 — 어차피 전부가 대상이라 그쪽이 단순하다).
   *
   *   그래서 사본 대신 **지문**을 고정한다. 문구를 한 글자라도 고치면 이 값이 달라져
   *   테스트가 빨개지고, 값을 갱신하려면 `migrations.ts` 를 열게 된다 — 바로 그 자리에
   *   "새 무효화 마이그레이션도 함께 넣어라" 가 적혀 있다.
   */
  /**
   * **문구를 고치면 무효화 마이그레이션을 만들 수밖에 없게 한다.**
   *
   * ⚠ 지문을 **별도 상수**로 두었더니 우회가 됐다(2026-09-03 리뷰): 문구를 고친 사람이
   *   그 상수만 새로 계산해 넣으면 초록이 되고, 무효화 없이 배포된다 — 그러면
   *   `findMissingStockTargets` 가 옛 행을 '있다' 로 보고 건너뛰어 **프로덕션은 계속 옛
   *   문구를 재생한다.**
   *
   *   그래서 지문을 **마이그레이션 이름 안**으로 옮겼다. 적용된 마이그레이션은 고칠 수
   *   없으니, 지문을 바꾸려면 새 마이그레이션을 만드는 수밖에 없다 — 그게 곧 무효화다.
   */
  it('최신 무효화 마이그레이션의 이름에 박힌 지문이 현재 문구와 같다', () => {
    const invalidations = migrations.filter((m) => STOCK_INVALIDATION_NAME.test(m.name));
    expect(invalidations.length, '스톡 무효화 마이그레이션이 하나도 없다').toBeGreaterThan(0);
    const latest = invalidations.reduce((newest, m) => (m.id > newest.id ? m : newest));

    const stamped = latest.name.match(STOCK_FINGERPRINT_IN_NAME)?.[1];
    expect(
      stamped,
      `최신 무효화 #${latest.id}(${latest.name}) 의 이름에 지문이 없다. ` +
        '이름을 `...-script-<지문16자>` 로 끝내라.',
    ).toBeDefined();

    const canonical = STOCK_CLIP_PRESETS.flatMap((preset) =>
      Object.entries(preset.texts as Record<string, readonly string[]>)
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([language, list]) => list.map((text) => `${preset.category}|${language}|${text}`)),
    ).join('\n');
    const fingerprint = createHash('sha256').update(canonical).digest('hex').slice(0, 16);

    expect(
      stamped,
      `스톡 문구가 바뀌었다(현재 지문 ${fingerprint}). **새 무효화 마이그레이션을 추가하고** ` +
        `그 이름을 \`...-script-${fingerprint}\` 로 끝내라 — 적용된 마이그레이션은 고칠 수 ` +
        '없으므로 이름만 바꿔서는 통과하지 않는다. 옛 행을 안 지우면 재시드해도 옛 문구가 남는다.',
    ).toBe(fingerprint);
  });

  it('낡은 문구 preset 만 지우고, 확정 문구 preset 과 참조 알람 처리까지 정확히 수행한다', async () => {
    await insertPreset('m70-stale', '[cheerfully] 오늘 날씨 진짜 좋아요. (구버전 문구)');
    await insertPreset('m70-current', MIGRATION_70_KEPT_TEXT);
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
