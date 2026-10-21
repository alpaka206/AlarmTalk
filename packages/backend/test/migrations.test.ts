import { describe, it, expect } from 'vitest';
import { createClient, type Client, type InValue } from '@libsql/client';
import {
  migrations,
  runMigrations,
  runMigrationsRange,
  migrationMaxId,
  __isIdempotentDDLErrorForTest,
  type Migration,
} from '../src/lib/migrations';

describe('migrations', () => {
  it('마이그레이션 ID가 순차적이고 고유하다', () => {
    const ids = migrations.map((m) => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);

    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it('모든 마이그레이션에 이름과 SQL이 있다', () => {
    for (const m of migrations) {
      expect(m.name).toBeTruthy();
      expect(m.statements.length).toBeGreaterThan(0);
    }
  });

  it('마이그레이션 #115는 기존 행을 보존해 백필하고 재실행/삭제 뒤에도 생성 순번을 재사용하지 않는다', async () => {
    const db = createClient({ url: ':memory:' });
    try {
      await runMigrationsRange(db, 1, 114);
      await db.execute("INSERT INTO users (id,google_id,email) VALUES ('cursor-user','cursor-login','cursor@example.test')");
      await db.execute("INSERT INTO alarms (id,user_id,time) VALUES ('z-old','cursor-user','07:00')");
      await runMigrationsRange(db, 115, 115);
      const before = await db.execute('SELECT sequence,alarm_id FROM alarm_creation_order');
      expect(before.rows).toHaveLength(1);
      expect(before.rows[0]!.alarm_id).toBe('z-old');
      // 실제 DDL/백필 재시도도 순번을 바꾸지 않는다(원장 쓰기 직전 중단 복구).
      await db.execute('DELETE FROM _migrations WHERE id=115');
      await runMigrationsRange(db, 115, 115);
      expect((await db.execute('SELECT sequence,alarm_id FROM alarm_creation_order')).rows).toEqual(before.rows);
      expect((await db.execute('SELECT id,time FROM alarms')).rows).toEqual([{ id: 'z-old', time: '07:00' }]);
      await db.execute("DELETE FROM alarms WHERE id='z-old'");
      expect((await db.execute('SELECT * FROM alarm_creation_order')).rows).toEqual([]);
      await db.execute("INSERT INTO alarms (id,user_id,time) VALUES ('a-new','cursor-user','06:00')");
      const after = await db.execute('SELECT sequence,alarm_id FROM alarm_creation_order');
      expect(Number(after.rows[0]!.sequence)).toBeGreaterThan(Number(before.rows[0]!.sequence));
      expect(after.rows[0]!.alarm_id).toBe('a-new');
    } finally { db.close(); }
  });

  it('마이그레이션 #116은 설치/재시도로 순번을 바꾸지 않고 실제 전달 세대 변경만 전진시킨다', async () => {
    const db = createClient({ url: ':memory:' });
    try {
      await runMigrationsRange(db, 1, 115);
      await db.execute(`INSERT INTO users (id,google_id,email) VALUES
        ('cursor-sender','cursor-sender','sender@example.test'),
        ('cursor-recipient','cursor-recipient','recipient@example.test')`);
      await db.execute(`INSERT INTO alarms (id,user_id,target_user_id,time,delivery_version) VALUES
        ('family','cursor-sender','cursor-recipient','07:00',NULL),
        ('own','cursor-recipient',NULL,'08:00',NULL)`);
      const cursors = () => db.execute('SELECT alarm_id,sequence FROM alarm_creation_order ORDER BY alarm_id');
      const before = await cursors();
      await runMigrationsRange(db, 116, 116);
      expect((await cursors()).rows).toEqual(before.rows);

      // 일반 편집/같은 null 재쓰기는 새 전달이 아니다.
      await db.execute("UPDATE alarms SET time='09:00',delivery_version=delivery_version");
      expect((await cursors()).rows).toEqual(before.rows);
      await db.execute("UPDATE alarms SET delivery_version='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id='family'");
      const changed = await cursors();
      expect(Number(changed.rows[0]!.sequence)).toBeGreaterThan(Number(before.rows[1]!.sequence));
      expect(changed.rows[1]).toEqual(before.rows[1]);
      await db.execute("UPDATE alarms SET delivery_version=delivery_version WHERE id='family'");
      expect((await cursors()).rows).toEqual(changed.rows);
      await db.execute("UPDATE alarms SET delivery_version='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',is_active=0 WHERE id='family'");
      const disabled = await cursors();
      expect(Number(disabled.rows[0]!.sequence)).toBeGreaterThan(Number(changed.rows[0]!.sequence));

      await db.execute('DELETE FROM _migrations WHERE id=116');
      await runMigrationsRange(db, 116, 116);
      expect((await cursors()).rows).toEqual(disabled.rows);
    } finally { db.close(); }
  });

  it('마이그레이션 #104가 기존 받은 알람에만 전달 버전을 채운다', async () => {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 103);
    await db.execute(
      `INSERT INTO users (id, google_id, email) VALUES
        ('sender', 'g-sender', 'sender@example.com'),
        ('recipient', 'g-recipient', 'recipient@example.com')`,
    );
    await db.execute(
      `INSERT INTO alarms (id, user_id, target_user_id, time) VALUES
        ('received', 'sender', 'recipient', '07:00'),
        ('local', 'recipient', NULL, '08:00')`,
    );

    expect(await runMigrationsRange(db, 104, 104)).toEqual(['104_alarm-delivery-version']);
    const rows = await db.execute(
      `SELECT id, delivery_version FROM alarms ORDER BY id`,
    );
    expect(rows.rows.find((row) => row.id === 'received')?.delivery_version).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(rows.rows.find((row) => row.id === 'local')?.delivery_version).toBeNull();
    db.close();
  });

  it('초기 마이그레이션(0001)에 8개 테이블 생성이 포함된다', () => {
    const initial = migrations.find((m) => m.id === 1);
    expect(initial).toBeDefined();

    const createStatements = initial!.statements.filter((s) => s.trim().startsWith('CREATE TABLE'));
    expect(createStatements.length).toBe(8);
  });

  it('초기 마이그레이션(0001)에 인덱스 생성이 포함된다', () => {
    const initial = migrations.find((m) => m.id === 1);
    expect(initial).toBeDefined();

    const indexStatements = initial!.statements.filter(
      (s) => s.trim().startsWith('CREATE INDEX') || s.trim().startsWith('CREATE UNIQUE INDEX'),
    );
    expect(indexStatements.length).toBe(19);
  });

  it('Migration 타입 인터페이스가 올바르다', () => {
    const sample: Migration = { id: 999, name: 'test', statements: ['SELECT 1'] };
    expect(sample.id).toBe(999);
    expect(sample.name).toBe('test');
  });

  it('마이그레이션 #2 에서 users 테이블 재생성 + password_hash 추가', () => {
    const m = migrations.find((x) => x.id === 2);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('users_new');
    expect(all).toContain('password_hash');
    expect(all).toContain('idx_users_email_unique');
  });

  it('마이그레이션 #3 에서 voice_uploads 테이블과 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 3);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS voice_uploads');
    expect(all).toContain('object_key');
    expect(all).toContain('size_bytes');
    expect(all).toContain('idx_voice_uploads_user');
  });

  it('마이그레이션 #4 에서 voice_speakers 테이블과 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 4);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS voice_speakers');
    expect(all).toContain('upload_id');
    expect(all).toContain('confidence');
    expect(all).toContain('idx_voice_speakers_upload');
  });

  it('마이그레이션 #5 에서 alarms 에 mode/voice_profile_id/speaker_id 컬럼을 추가한다', () => {
    const m = migrations.find((x) => x.id === 5);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('ALTER TABLE alarms ADD COLUMN mode');
    expect(all).toContain("CHECK(mode IN ('sound-only','tts'))");
    expect(all).toContain('ALTER TABLE alarms ADD COLUMN voice_profile_id');
    expect(all).toContain('ALTER TABLE alarms ADD COLUMN speaker_id');
    expect(all).toContain('idx_alarms_voice_profile');
    expect(all).toContain('idx_alarms_speaker');
  });

  it('마이그레이션 #6 에서 plans / subscriptions 테이블과 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 6);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS plans');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS subscriptions');
    expect(all).toContain("CHECK(plan_type IN ('free','personal','family'))");
    expect(all).toContain("CHECK(status IN ('active','expired','cancelled'))");
    expect(all).toContain('period_days');
    expect(all).toContain('max_members');
    expect(all).toContain('price_krw');
    expect(all).toContain('plan_group_id');
    expect(all).toContain('expires_at');
    expect(all).toContain('idx_plans_key');
    expect(all).toContain('idx_subscriptions_user');
    expect(all).toContain('idx_subscriptions_status');
    expect(all).toContain('idx_subscriptions_expires');
  });

  it('마이그레이션 #7 에서 voucher_codes 테이블과 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 7);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS voucher_codes');
    expect(all).toContain('code TEXT NOT NULL UNIQUE');
    expect(all).toContain('code_hash TEXT NOT NULL UNIQUE');
    expect(all).toContain("CHECK(status IN ('issued','used','expired'))");
    expect(all).toContain('issuer_user_id');
    expect(all).toContain('redeemed_by_user_id');
    expect(all).toContain('expires_at');
    expect(all).toContain('idx_voucher_codes_hash');
    expect(all).toContain('idx_voucher_codes_issuer');
    expect(all).toContain('idx_voucher_codes_status');
  });

  it('마이그레이션 #8 에서 plan_groups / plan_group_members 테이블과 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 8);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS plan_groups');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS plan_group_members');
    expect(all).toContain('owner_user_id TEXT NOT NULL REFERENCES users(id)');
    expect(all).toContain('max_members INTEGER NOT NULL DEFAULT 6');
    expect(all).toContain("CHECK(role IN ('owner','member'))");
    expect(all).toContain('idx_plan_groups_owner');
    expect(all).toContain('idx_plan_group_members_group');
    expect(all).toContain('idx_plan_group_members_user');
    expect(all).toContain('idx_plan_group_members_unique');
  });

  it('마이그레이션 #9 에서 plan_group_invites 테이블과 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 9);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS plan_group_invites');
    expect(all).toContain('plan_group_id TEXT NOT NULL REFERENCES plan_groups(id)');
    expect(all).toContain('inviter_user_id TEXT NOT NULL REFERENCES users(id)');
    expect(all).toContain('code TEXT NOT NULL UNIQUE');
    expect(all).toContain("CHECK(status IN ('pending','used','revoked','expired'))");
    expect(all).toContain('expires_at TEXT NOT NULL');
    expect(all).toContain('used_by_user_id');
    expect(all).toContain('idx_plan_group_invites_code');
    expect(all).toContain('idx_plan_group_invites_group');
    expect(all).toContain('idx_plan_group_invites_status');
  });

  it('마이그레이션 #10 에서 users.allow_family_alarms 컬럼을 추가한다 (기본 0/false)', () => {
    const m = migrations.find((x) => x.id === 10);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('ALTER TABLE users ADD COLUMN allow_family_alarms');
    expect(all).toContain('INTEGER NOT NULL DEFAULT 0');
  });

  it('마이그레이션 #6 에서 기본 플랜 3종(free / personal / family) 을 시드한다', () => {
    const m = migrations.find((x) => x.id === 6);
    expect(m).toBeDefined();
    const inserts = m!.statements.filter((s) => s.trim().startsWith('INSERT'));
    expect(inserts.length).toBe(3);
    const all = inserts.join('\n');
    expect(all).toContain("'free'");
    expect(all).toContain("'personal'");
    expect(all).toContain("'family'");
    // 가족 플랜은 max_members=6, 30일 주기, 9900원
    expect(all).toMatch(/'family',[^\n]*'family',\s*30,\s*6,\s*9900/);
    // 개인 플랜은 4900원, 1인, 30일 주기 — key/plan_type 모두 'personal'
    expect(all).toMatch(/'personal',\s*'개인',\s*'personal',\s*30,\s*1,\s*4900/);
    // INSERT OR IGNORE 로 재실행 안전성 확보
    for (const stmt of inserts) {
      expect(stmt).toContain('INSERT OR IGNORE');
    }
  });

  // tts_presets 는 #87 에서 삭제했다. 문구 단일 출처는 stock-clips.ts 이고, 옛 원격 문구
  // 테이블을 만들던 #33 과 갱신하던 #49 는 새 DB 가 아예 안 만들도록 비워 뒀다.
  it('migrations no longer create or seed tts_presets', () => {
    const all = migrations.flatMap((m) => m.statements).join('\n');
    expect(all).not.toContain('CREATE TABLE IF NOT EXISTS tts_presets');
    expect(all).not.toContain('INSERT OR IGNORE INTO tts_presets');
    // 그 테이블만 만들고 갱신하던 #33·#49 는 엔트리째 뺐다(빈 마이그레이션을 남기지 않는다).
    expect(migrations.find((x) => x.id === 33)).toBeUndefined();
    expect(migrations.find((x) => x.id === 49)).toBeUndefined();
  });

  it('migration #87 drops the tts_presets table and its index', () => {
    const m = migrations.find((x) => x.id === 87);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('DROP TABLE IF EXISTS tts_presets');
    expect(all).toContain('DROP INDEX IF EXISTS idx_tts_presets_order');
  });

  it('migration #35 adds Apple login identity storage', () => {
    const m = migrations.find((x) => x.id === 35);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('ALTER TABLE users ADD COLUMN apple_id');
    expect(all).toContain('idx_users_apple_id');
    expect(all).toContain('WHERE apple_id IS NOT NULL');
  });

  it('migration #34 separates TTS display text from synthesis text and tags', () => {
    const m = migrations.find((x) => x.id === 34);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('ALTER TABLE messages ADD COLUMN synthesis_text TEXT');
    expect(all).toContain(
      "ALTER TABLE messages ADD COLUMN delivery_tags_json TEXT NOT NULL DEFAULT '[]'",
    );
    expect(all).toContain('ALTER TABLE generated_audio_assets ADD COLUMN original_text TEXT');
    expect(all).toContain(
      "ALTER TABLE generated_audio_assets ADD COLUMN delivery_tags_json TEXT NOT NULL DEFAULT '[]'",
    );
  });

  it('migration #37 stores voice relationship labels', () => {
    const m = migrations.find((x) => x.id === 37);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('ALTER TABLE voice_profiles ADD COLUMN relationship_label TEXT');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS voice_profile_relationships');
    expect(all).toContain('UNIQUE(user_id, voice_profile_id)');
  });

  it('migration #40 stores user dynamic prompt settings', () => {
    const m = migrations.find((x) => x.id === 40);
    expect(m).toBeDefined();
    expect(m!.statements.join('\n')).toContain(
      "ALTER TABLE users ADD COLUMN dynamic_prompt_settings_json TEXT NOT NULL DEFAULT '{}'",
    );
  });

  it('migration #57 stores monthly official voice-change ledger', () => {
    const m = migrations.find((x) => x.id === 57);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS voice_profile_change_ledger');
    expect(all).toContain('idx_voice_profile_change_ledger_monthly');
    expect(all).toContain("WHERE status != 'failed'");
    expect(all).toContain('INSERT OR IGNORE INTO voice_profile_change_ledger');
    expect(all).toContain("'+9 hours'");
  });

  it('migration #60 adds the prerender queue claim lease', () => {
    const migration = migrations.find((item) => item.id === 60);
    expect(migration).toBeDefined();
    expect(migration?.statements.join('\n')).toContain(
      'ALTER TABLE voice_prerender_queue ADD COLUMN claimed_at TEXT',
    );
  });

  it('migration #61 adds the prerender queue claim token', () => {
    const migration = migrations.find((item) => item.id === 61);
    expect(migration).toBeDefined();
    expect(migration?.statements.join('\n')).toContain(
      'ALTER TABLE voice_prerender_queue ADD COLUMN claim_token TEXT',
    );
  });

  it('migration #62 adds a monthly draft-attempt ledger and preview marker', () => {
    const migration = migrations.find((item) => item.id === 62);
    expect(migration).toBeDefined();
    const sql = migration?.statements.join('\n') ?? '';
    expect(sql).toContain('voice_draft_attempt_usage');
    expect(sql).toContain('attempt_month');
    expect(sql).toContain('previewed_at');
    expect(sql).toContain('preview_claimed_at');
    expect(sql).toContain('preview_claim_token');
    expect(sql).toContain('preview_language');
  });

  it('migration #60 applies claimed_at to an existing prerender queue', async () => {
    const db = createClient({ url: ':memory:' });
    await db.execute(`CREATE TABLE voice_prerender_queue (
      voice_profile_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    expect(await runMigrationsRange(db, 60, 60)).toEqual(['60_voice-prerender-claim-lease']);
    const columns = await db.execute('PRAGMA table_info(voice_prerender_queue)');
    expect(columns.rows.map((row) => String(row.name))).toContain('claimed_at');
  });

  it('migration #61 applies claim_token after the lease migration', async () => {
    const db = createClient({ url: ':memory:' });
    await db.execute(`CREATE TABLE voice_prerender_queue (
      voice_profile_id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);

    expect(await runMigrationsRange(db, 60, 61)).toEqual([
      '60_voice-prerender-claim-lease',
      '61_voice-prerender-claim-token',
    ]);
    const columns = await db.execute('PRAGMA table_info(voice_prerender_queue)');
    expect(columns.rows.map((row) => String(row.name))).toContain('claim_token');
  });

  // #88 은 테이블 재작성이라 "값이 좁아졌는가" 만큼 "기존 행이 살아남았는가" 가 중요하다.
  describe('migration #88 narrows push/store allow-lists', () => {
    async function migratedDb() {
      const db = createClient({ url: ':memory:' });
      await runMigrationsRange(db, 1, 87);
      // push_tokens.user_id 의 FK 는 실제로 강제된다(PRAGMA foreign_keys=1).
      await db.execute(`INSERT INTO users (id, email) VALUES ('u-1', 'u1@example.com')`);
      await db.execute(
        `INSERT INTO push_tokens (id, user_id, token, platform)
           VALUES ('pt-keep', 'u-1', 'tok-keep', 'android')`,
      );
      await db.execute(
        `INSERT INTO store_transactions
           (id, user_id, provider, provider_transaction_id, product_id, plan_key)
           VALUES ('st-keep', 'u-1', 'google', 'gtx-1', 'sku.personal', 'personal')`,
      );
      await runMigrationsRange(db, 88, 88);
      return db;
    }

    it('keeps rows that are still allowed', async () => {
      const db = await migratedDb();
      const push = await db.execute(`SELECT token, platform FROM push_tokens WHERE id = 'pt-keep'`);
      expect(push.rows).toHaveLength(1);
      expect(String(push.rows[0]!.token)).toBe('tok-keep');
      expect(String(push.rows[0]!.platform)).toBe('android');

      const store = await db.execute(
        `SELECT provider, plan_key FROM store_transactions WHERE id = 'st-keep'`,
      );
      expect(store.rows).toHaveLength(1);
      expect(String(store.rows[0]!.provider)).toBe('google');
      expect(String(store.rows[0]!.plan_key)).toBe('personal');
    });

    it('rejects the retired platform / provider values', async () => {
      const db = await migratedDb();
      await expect(
        db.execute(
          `INSERT INTO push_tokens (id, user_id, token, platform)
             VALUES ('pt-ios', 'u-1', 'tok-ios', 'ios')`,
        ),
      ).rejects.toThrow();

      for (const provider of ['apple', 'portone']) {
        await expect(
          db.execute({
            sql: `INSERT INTO store_transactions
                    (id, user_id, provider, provider_transaction_id, product_id, plan_key)
                    VALUES (?, 'u-1', ?, ?, 'sku.personal', 'personal')`,
            args: [`st-${provider}`, provider, `tx-${provider}`],
          }),
        ).rejects.toThrow();
      }
    });

    // Codex #659(P1): 문장별 autocommit 으로 돌리면 '원본 DROP ~ RENAME' 사이에서 끊겼을 때
    // 재시도가 데이터를 들고 있는 임시 테이블을 지워 복구가 불가능해진다. 그래서 atomic 이다.
    it('is marked atomic and never drops the temp table unconditionally', () => {
      const m = migrations.find((x) => x.id === 88)!;
      expect(m.atomic).toBe(true);
      const all = m.statements.join('\n');
      // 재시도 시 유일한 사본을 지우는 선두 DROP 이 있으면 안 된다.
      expect(all).not.toContain('DROP TABLE IF EXISTS push_tokens_v2');
      expect(all).not.toContain('DROP TABLE IF EXISTS store_transactions_v2');
      // PRAGMA 는 트랜잭션 안에서 무시되므로 남겨두면 오해만 부른다.
      expect(all).not.toContain('PRAGMA foreign_keys');
    });

    it('rolls the whole rebuild back when a statement fails mid-way', async () => {
      const db = createClient({ url: ':memory:' });
      await runMigrationsRange(db, 1, 87);
      await db.execute(`INSERT INTO users (id, email) VALUES ('u-1', 'u1@example.com')`);
      await db.execute(
        `INSERT INTO push_tokens (id, user_id, token, platform)
           VALUES ('pt-1', 'u-1', 'tok-1', 'android')`,
      );

      // #88 과 똑같은 재작성 문장 뒤에, 새 CHECK 를 위반해 **런타임에** 실패하는 문장을 붙인다.
      const m88 = migrations.find((x) => x.id === 88)!;
      await expect(
        db.batch(
          [
            ...m88.statements,
            `INSERT INTO push_tokens (id, user_id, token, platform)
               VALUES ('pt-x', 'u-1', 'tok-x', 'ios')`,
          ],
          'write',
        ),
      ).rejects.toThrow();

      // 원본 행이 살아 있어야 한다 — 이게 이 마이그레이션의 진짜 위험이다.
      const rows = await db.execute('SELECT token, platform FROM push_tokens');
      expect(rows.rows).toHaveLength(1);
      expect(String(rows.rows[0]!.token)).toBe('tok-1');
      // 임시 테이블도 남지 않는다.
      const leftovers = await db.execute(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_v2' ESCAPE '\\'`,
      );
      expect(leftovers.rows).toHaveLength(0);
      // 옛 CHECK 가 그대로면(='ios' 가 통과하면) 롤백이 확실하다.
      await expect(
        db.execute(
          `INSERT INTO push_tokens (id, user_id, token, platform)
             VALUES ('pt-2', 'u-1', 'tok-2', 'ios')`,
        ),
      ).resolves.toBeTruthy();
    });

    it('rebuilds the indexes it dropped with the old tables', async () => {
      const db = await migratedDb();
      const indexes = await db.execute(
        `SELECT name FROM sqlite_master
          WHERE type = 'index' AND tbl_name IN ('push_tokens', 'store_transactions')`,
      );
      const names = indexes.rows.map((row) => String(row.name));
      expect(names).toEqual(
        expect.arrayContaining([
          'idx_push_tokens_user',
          'idx_push_tokens_unique',
          'idx_push_tokens_token',
          'idx_store_transactions_provider_tx',
          'idx_store_transactions_user',
        ]),
      );
    });
  });
});

// DROP COLUMN 실패를 "이미 적용됨" 으로 오인해 삼키면, 컬럼은 그대로인데 _migrations 에는
// 성공으로 찍혀 다시는 재시도되지 않는다. 배포는 초록불이라 dev/prod 스키마가 조용히 갈라진다.
// 두 메시지가 모두 'no such column' 을 포함해서 구분이 한 조각('after drop column')에 달려 있다.
describe('마이그레이션 러너 — DROP COLUMN 실패는 삼키지 않는다', () => {
  it('인덱스가 참조해 실패한 DROP COLUMN 은 관용 대상이 아니다', () => {
    expect(
      __isIdempotentDDLErrorForTest('error in index ix after drop column: no such column: prof'),
    ).toBe(false);
  });

  it('이미 지워진 컬럼을 다시 DROP 하는 것은 관용한다', () => {
    expect(__isIdempotentDDLErrorForTest('no such column: "other"')).toBe(true);
  });

  it('기존 관용 규칙은 그대로다', () => {
    expect(__isIdempotentDDLErrorForTest('duplicate column name: foo')).toBe(true);
    expect(__isIdempotentDDLErrorForTest('table t already exists')).toBe(true);
    expect(__isIdempotentDDLErrorForTest('no such index: ix')).toBe(true);
    expect(__isIdempotentDDLErrorForTest('no such view: v')).toBe(true);
    expect(__isIdempotentDDLErrorForTest('syntax error near ")"')).toBe(false);
  });
});

// 배포 직후 옛 번들이 응답하면 새 마이그레이션 id 를 '모르는 id' 로 건너뛰고 빈 결과를 준다.
// 호출자는 그걸 '이미 적용됨' 과 구분할 수 없어, 스키마가 안 바뀐 채 배포가 성공으로 끝난다
// (2026-08-01 dev 에서 89~91 이 통째로 누락됐다). maxId 는 그 전파를 확인하는 유일한 신호다.
describe('migrationMaxId — 배포 전파 확인 신호', () => {
  it('번들이 아는 마이그레이션 최대 id 를 돌려준다', () => {
    const expected = migrations.reduce((max, m) => Math.max(max, m.id), 0);
    expect(migrationMaxId()).toBe(expected);
    // 마이그레이션이 추가되면 이 값도 따라 올라가야 한다(상수로 박아 두면 의미가 없다).
    expect(migrationMaxId()).toBeGreaterThanOrEqual(91);
  });

  it('모르는 id 범위는 아무것도 실행하지 않는다 — 이 경우가 빈 결과의 두 번째 원인이다', async () => {
    const db = createClient({ url: ':memory:' });
    const ran = await runMigrationsRange(db, migrationMaxId() + 100, migrationMaxId() + 200);
    expect(ran).toEqual([]);
  });
});

// 커플·가족 요금제와 가족 알람을 지운다(2026-10-20). dev 는 #130 위에 그룹 시절 데이터를 들고 있다 — 그 모양을
// 심고 FK 를 켠 채(Turso 와 같다) 한 번에 끝나는지, 지울 것만 지우는지 본다.
describe('마이그레이션 #131 — 커플·가족 요금제 삭제', () => {
  const PLAN = {
    personal: '70000000-0000-4000-8000-000000000002',
    family: '70000000-0000-4000-8000-000000000003',
    couple: '70000000-0000-4000-8000-000000000004',
  };
  const DROPPED_TABLES = [
    'alarm_creation_order',
    'alarm_recipient_state',
    'targeted_alarm_slots',
    'pending_plan_notifications',
    'voice_profile_relationships',
    'plan_group_members',
    'plan_groups',
    'apple_gift_deliveries',
    'voucher_redemptions',
    'voucher_codes',
  ];
  const DROPPED_TRIGGERS = [
    'alarm_creation_order_insert',
    'alarm_creation_order_delete',
    'alarm_creation_order_delivery_update',
  ];
  const DROPPED_INDEXES = [
    'idx_alarms_target_active',
    'idx_alarms_target',
    'idx_voice_profiles_family_shared',
    'idx_subscriptions_plan_group',
  ];
  const DROPPED_COLUMNS: Array<[table: string, column: string]> = [
    ['alarms', 'target_user_id'],
    ['alarms', 'delivery_version'],
    ['voice_profiles', 'is_shared'],
    ['subscriptions', 'plan_group_id'],
    ['users', 'allow_family_alarms'],
    ['users', 'family_alarm_quiet_windows'],
    ['plans', 'max_members'],
  ];

  async function list(db: Client, sql: string, args: InValue[] = []): Promise<string[]> {
    const res = await db.execute({ sql, args });
    return res.rows.map((row) => String(row[res.columns[0]!]));
  }
  const names = (db: Client, type: 'table' | 'index' | 'trigger') =>
    list(db, `SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`, [type]);
  const columns = (db: Client, table: string) =>
    list(db, `SELECT name FROM pragma_table_info(?) ORDER BY cid`, [table]);

  async function seedGroupEra(db: Client): Promise<void> {
    const run = (sql: string, args: InValue[] = []) => db.execute({ sql, args });
    // 사람 — 그룹 주인(가족·개인 구독 없음), 멤버(가족·권한 있는 개인 구독), 보류 개인 구독만 남은 가족, 개인, 무료.
    await run(`INSERT INTO users (id, email, name, plan) VALUES
      ('u-owner','o@t.test','주인','family'),
      ('u-member','m@t.test','멤버','family'),
      ('u-held','h@t.test','보류','family'),
      ('u-plus','p@t.test','개인','plus'),
      ('u-free','f@t.test','무료','free')`);
    await run(`UPDATE users SET allow_family_alarms = 1, family_alarm_quiet_windows = '[]' WHERE id = 'u-member'`);
    // 구독 — 끝난 커플·가족 구독, 개인 구독(권한 있음·보류), 가족으로 바꾸기를 예약해 둔 개인 구독.
    await run(
      `INSERT INTO subscriptions (id, user_id, plan_id, plan_group_id, status, starts_at, expires_at) VALUES
        ('s-owner-family','u-owner',?,'g-family','cancelled','2026-09-01','2026-10-01'),
        ('s-member-family','u-member',?,'g-family','cancelled','2026-09-01','2026-10-01'),
        ('s-couple','u-free',?,'g-couple','cancelled','2026-09-01','2026-10-01'),
        ('s-member-personal','u-member',?,NULL,'active','2026-10-01','2026-11-01'),
        ('s-held-personal','u-held',?,NULL,'active','2026-09-01','2026-10-01'),
        ('s-plus','u-plus',?,NULL,'active','2026-10-01','2026-11-01')`,
      [PLAN.family, PLAN.family, PLAN.couple, PLAN.personal, PLAN.personal, PLAN.personal],
    );
    await run(`UPDATE subscriptions SET entitlement_state = 'suspended' WHERE id = 's-held-personal'`);
    await run(`UPDATE subscriptions SET cancel_at_period_end = 1, next_plan_id = ? WHERE id = 's-plus'`, [PLAN.family]);
    await run(`INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key, subscription_id)
      VALUES ('st-plus','u-plus','google','tok-plus','personal_monthly','personal','s-plus')`);
    // 그룹·초대 코드·옛 선물 연결·등급 통지 대기열.
    await run(
      `INSERT INTO plan_groups (id, owner_user_id, plan_id, max_members) VALUES
        ('g-family','u-owner',?,5), ('g-couple','u-free',?,2)`,
      [PLAN.family, PLAN.couple],
    );
    await run(`INSERT INTO plan_group_members (id, plan_group_id, user_id, role) VALUES
      ('pm-owner','g-family','u-owner','owner'),
      ('pm-member','g-family','u-member','member'),
      ('pm-couple','g-couple','u-free','owner')`);
    await run(
      `INSERT INTO voucher_codes (id, code, code_hash, plan_id, issuer_user_id, issuer_subscription_id,
                                  redeemed_by_user_id, status, expires_at, max_uses)
       VALUES ('v-invite','INV-AAAA-BBBB-CCCC','h-invite',?,'u-owner','s-owner-family','u-member','used','2026-10-01',4)`,
      [PLAN.family],
    );
    await run(`INSERT INTO voucher_redemptions (id, voucher_id, user_id) VALUES ('vr-member','v-invite','u-member')`);
    await run(`INSERT INTO apple_gift_deliveries (transaction_id, voucher_id) VALUES ('apple-gift-tx','v-invite')`);
    await run(`INSERT INTO pending_plan_notifications (user_id) VALUES ('u-member')`);
    // 프로모 코드 이력 — 운영에 가족·커플 코드가 남아 있다(상품을 가리키는 FK 는 없다).
    await run(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active) VALUES ('promo-family','FAMILY',?,30,0)`,
      [PLAN.family],
    );
    // 목소리 — 공유한 클론과 받은 사람이 붙인 관계 라벨.
    await run(`INSERT INTO voice_profiles (id, user_id, name, status, elevenlabs_voice_id, is_shared) VALUES
      ('vp-owner','u-owner','주인 목소리','ready','el-owner',1),
      ('vp-plus','u-plus','내 목소리','ready','el-plus',0)`);
    await run(`INSERT INTO voice_profile_relationships (id, user_id, voice_profile_id, relationship_label)
      VALUES ('rel-member','u-member','vp-owner','엄마')`);
    // 문구 — 가족 녹음(받은 사람 소유, 음원은 보낸 사람의 업로드 키), 가족 TTS 문구, 내 문구.
    await run(`INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category) VALUES
      ('m-family-voice','u-member','vp-owner','녹음','voices/u-owner/rec.m4a','family-voice'),
      ('m-family','u-member','vp-owner','가족 문구','r2://generated-tts/u-owner/family.mp3','family'),
      ('m-own','u-plus','vp-plus','내 문구','r2://generated-tts/u-plus/own.mp3','custom')`);
    await run(`INSERT INTO message_library (id, user_id, message_id) VALUES
      ('ml-family-voice','u-member','m-family-voice'), ('ml-own','u-plus','m-own')`);
    // 알람 — 보낸 가족 알람 둘, 내 알람, 가족 문구를 가리키는 내 알람(지우기 전 안전장치 갈래).
    // 넣는 순간 #115·#116 트리거가 받은 알람 순번(alarm_creation_order)을 함께 적는다.
    await run(`INSERT INTO alarms (id, user_id, target_user_id, message_id, voice_profile_id, time, mode, delivery_version) VALUES
      ('a-sent-voice','u-owner','u-member','m-family-voice','vp-owner','07:00','tts','dv-1'),
      ('a-sent-tts','u-owner','u-member','m-family','vp-owner','07:30','tts','dv-2'),
      ('a-own','u-plus',NULL,'m-own','vp-plus','08:00','tts',NULL),
      ('a-family-text','u-member',NULL,'m-family','vp-owner','09:00','tts',NULL)`);
    await run(`INSERT INTO alarm_recipient_state (alarm_id, recipient_user_id, declined, sender_user_id, voice_profile_id)
      VALUES ('a-sent-voice','u-member',0,'u-owner','vp-owner')`);
    await run(`INSERT INTO targeted_alarm_slots (sender_user_id, recipient_user_id, time, alarm_id)
      VALUES ('u-owner','u-member','07:00','a-sent-voice')`);
    // 직접 입력 한도 장부 — 그룹 풀(키 = 그룹 id)과 개인 풀.
    await run(`INSERT INTO manual_tts_usage (pool_key, usage_month, used_count) VALUES
      ('g-family','2026-10',3), ('u-plus','2026-10',2)`);
  }

  async function groupEraDb(): Promise<Client> {
    const db = createClient({ url: ':memory:' });
    await runMigrationsRange(db, 1, 130);
    await seedGroupEra(db);
    await db.execute('PRAGMA foreign_keys = ON');
    return db;
  }

  it('그룹 시절 데이터 위에서 FK 를 켠 채 한 번에 끝나고, 그룹 전용 표·트리거·인덱스·칸이 사라진다', async () => {
    const db = await groupEraDb();
    try {
      expect(await list(db, 'PRAGMA foreign_keys')).toEqual(['1']);
      // 심기가 헛돌지 않았다 — 지울 것이 실제로 있다.
      expect(await list(db, 'SELECT COUNT(*) FROM alarm_creation_order')).toEqual(['4']);
      expect(await names(db, 'trigger')).toEqual([...DROPPED_TRIGGERS].sort());

      expect(await runMigrationsRange(db, 131, 131)).toEqual(['131_drop-couple-family-plans']);

      const tables = await names(db, 'table');
      expect(DROPPED_TABLES.filter((table) => tables.includes(table))).toEqual([]);
      expect(await names(db, 'trigger')).toEqual([]);
      const indexes = await names(db, 'index');
      expect(DROPPED_INDEXES.filter((index) => indexes.includes(index))).toEqual([]);
      const leftover: string[] = [];
      for (const [table, column] of DROPPED_COLUMNS) {
        if ((await columns(db, table)).includes(column)) leftover.push(`${table}.${column}`);
      }
      expect(leftover).toEqual([]);
      expect(await list(db, 'SELECT key FROM plans ORDER BY key')).toEqual(['free', 'personal']);
      expect(await list(db, 'SELECT id FROM _migrations WHERE id = 131')).toEqual(['131']);
      expect((await db.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
      expect(await list(db, 'PRAGMA integrity_check')).toEqual(['ok']);
    } finally {
      db.close();
    }
  });

  it('개인 데이터는 그대로이고, 가족 등급은 남은 개인 구독으로 다시 정해진다', async () => {
    const db = await groupEraDb();
    try {
      await runMigrationsRange(db, 131, 131);
      // 커플·가족 구독 행만 지운다. 가족으로 바꾸기를 예약해 둔 개인 구독은 예약만 풀린다.
      expect(await list(db, 'SELECT id FROM subscriptions ORDER BY id')).toEqual([
        's-held-personal',
        's-member-personal',
        's-plus',
      ]);
      expect(
        (await db.execute(`SELECT status, cancel_at_period_end, next_plan_id FROM subscriptions WHERE id = 's-plus'`))
          .rows,
      ).toEqual([{ status: 'active', cancel_at_period_end: 1, next_plan_id: null }]);
      // 코드의 등급 재계산과 같은 규칙 — 권한 있는 개인 구독이 남았으면 plus, 아니면(보류만 남아도) free.
      expect(
        (await db.execute(`SELECT id, plan FROM users WHERE id LIKE 'u-%' ORDER BY id`)).rows.map((row) => [
          row.id,
          row.plan,
        ]),
      ).toEqual([
        ['u-free', 'free'],
        ['u-held', 'free'],
        ['u-member', 'plus'],
        ['u-owner', 'free'],
        ['u-plus', 'plus'],
      ]);
      // 내 알람·문구·보관함·목소리·결제 증빙·개인 풀은 그대로다.
      expect(
        (await db.execute(`SELECT message_id, voice_profile_id, mode FROM alarms WHERE id = 'a-own'`)).rows,
      ).toEqual([{ message_id: 'm-own', voice_profile_id: 'vp-plus', mode: 'tts' }]);
      expect(await list(db, 'SELECT id FROM message_library ORDER BY id')).toEqual(['ml-own']);
      expect(
        (await db.execute(`SELECT id, elevenlabs_voice_id FROM voice_profiles WHERE COALESCE(is_system, 0) = 0 ORDER BY id`))
          .rows.map((row) => [row.id, row.elevenlabs_voice_id]),
      ).toEqual([
        ['vp-owner', 'el-owner'],
        ['vp-plus', 'el-plus'],
      ]);
      expect(await list(db, 'SELECT id FROM store_transactions ORDER BY id')).toEqual(['st-plus']);
      expect(await list(db, 'SELECT pool_key FROM manual_tts_usage ORDER BY pool_key')).toEqual(['u-plus']);
      // 프로모 코드 발급 기록은 이력이라 남는다.
      expect(await list(db, 'SELECT id FROM promo_codes ORDER BY id')).toEqual(['promo-family']);
    } finally {
      db.close();
    }
  });

  it('가족 알람과 그 문구만 지운다 — 녹음 원본은 삭제 큐로, 가족 문구를 가리키던 내 알람은 소리 알람으로', async () => {
    const db = await groupEraDb();
    try {
      await runMigrationsRange(db, 131, 131);
      expect(
        (await db.execute(`SELECT id, message_id, voice_profile_id, mode, wake_mode FROM alarms ORDER BY id`)).rows.map(
          (row) => [row.id, row.message_id, row.voice_profile_id, row.mode, row.wake_mode],
        ),
      ).toEqual([
        ['a-family-text', null, null, 'sound-only', 'sound_then_voice'],
        ['a-own', 'm-own', 'vp-plus', 'tts', 'sound_then_voice'],
      ]);
      expect(await list(db, 'SELECT id FROM messages ORDER BY id')).toEqual(['m-own']);
      // 가족 녹음 문구가 업로드 원본 키를 아는 마지막 자리일 수 있다 — 지우기 전에 삭제 큐로 옮긴다.
      expect(
        (await db.execute('SELECT kind, ref FROM pending_external_deletions ORDER BY ref')).rows.map((row) => [
          row.kind,
          row.ref,
        ]),
      ).toEqual([['r2_object', 'voices/u-owner/rec.m4a']]);
      // 알람을 넣고 지우는 데 받은 알람 순번 트리거가 더는 끼지 않는다.
      await db.execute(`INSERT INTO alarms (id, user_id, time) VALUES ('a-new', 'u-free', '06:00')`);
      await db.execute(`DELETE FROM alarms WHERE id = 'a-new'`);
      expect(await list(db, `SELECT id FROM alarms WHERE id = 'a-new'`)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('중간에 실패하면 통째로 롤백되고, 고친 뒤 다시 돌리면 끝난다 — 끝난 뒤 재실행은 건너뛴다', async () => {
    const db = await groupEraDb();
    try {
      const snapshot = async () =>
        Promise.all([
          db.execute('SELECT type, name, sql FROM sqlite_master ORDER BY type, name'),
          db.execute('SELECT * FROM alarms ORDER BY id'),
          db.execute('SELECT * FROM messages ORDER BY id'),
          db.execute('SELECT * FROM users ORDER BY id'),
          db.execute('SELECT * FROM subscriptions ORDER BY id'),
          db.execute('SELECT * FROM manual_tts_usage ORDER BY pool_key'),
          db.execute('SELECT kind, ref FROM pending_external_deletions ORDER BY ref'),
        ]).then((results) => results.map((result) => result.rows));
      // 문장 대부분이 이미 돈 뒤(상품 행을 지우는 자리)에서 실패시킨다.
      await db.execute(`CREATE TRIGGER fail_131 BEFORE DELETE ON plans
        BEGIN SELECT RAISE(ABORT, 'forced #131 failure'); END`);
      const before = await snapshot();
      await expect(runMigrationsRange(db, 131, 131)).rejects.toThrow('forced #131 failure');
      expect(await snapshot()).toEqual(before);
      expect(await list(db, 'SELECT id FROM _migrations WHERE id = 131')).toEqual([]);

      await db.execute('DROP TRIGGER fail_131');
      expect(await runMigrationsRange(db, 131, 131)).toEqual(['131_drop-couple-family-plans']);
      expect(await list(db, 'SELECT id FROM messages ORDER BY id')).toEqual(['m-own']);
      expect(await runMigrationsRange(db, 1, 131)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('빈 DB 의 전체 실행에도 #131 이 들어 있고, 상품은 무료·개인 둘이다', async () => {
    const db = createClient({ url: ':memory:' });
    try {
      expect(await runMigrations(db)).toContain('131_drop-couple-family-plans');
      expect(await list(db, 'SELECT key FROM plans ORDER BY key')).toEqual(['free', 'personal']);
      const tables = await names(db, 'table');
      expect(DROPPED_TABLES.filter((table) => tables.includes(table))).toEqual([]);
      const triggers = await names(db, 'trigger');
      expect(DROPPED_TRIGGERS.filter((trigger) => triggers.includes(trigger))).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('FK 를 켠 빈 DB(1..130)에서도 실행되고 FK 위반을 남기지 않는다', async () => {
    const db = createClient({ url: ':memory:' });
    try {
      await runMigrationsRange(db, 1, 130);
      await db.execute('PRAGMA foreign_keys = ON');
      expect(await runMigrationsRange(db, 131, 131)).toEqual(['131_drop-couple-family-plans']);
      expect((await db.execute('PRAGMA foreign_key_check')).rows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('마이그레이션 #132 는 유료 이용권 이름을 플러스로 바꾸고 키·상품은 그대로 둔다', async () => {
    const db = createClient({ url: ':memory:' });
    try {
      await runMigrationsRange(db, 1, 131);
      expect((await db.execute(`SELECT name FROM plans WHERE key = 'personal'`)).rows[0].name).toBe('개인');
      expect(await runMigrationsRange(db, 132, 132)).toEqual(['132_rename-personal-plan-to-plus']);
      const rows = (await db.execute('SELECT key, name, plan_type FROM plans ORDER BY key')).rows.map((r) => [r.key, r.name, r.plan_type]);
      expect(rows).toEqual([
        ['free', '무료', 'free'],
        ['personal', '플러스', 'personal'],
      ]);
    } finally {
      db.close();
    }
  });
});
