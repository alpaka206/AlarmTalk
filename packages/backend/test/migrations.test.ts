import { describe, it, expect } from 'vitest';
import { migrations, type Migration } from '../src/lib/migrations';
import { PRESETS } from '../src/data/presets';

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

  it('마이그레이션 #11 에서 characters 테이블과 유니크 인덱스를 추가한다', () => {
    const m = migrations.find((x) => x.id === 11);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS characters');
    expect(all).toContain('user_id TEXT NOT NULL UNIQUE REFERENCES users(id)');
    expect(all).toContain('level INTEGER NOT NULL DEFAULT 1');
    expect(all).toContain('xp INTEGER NOT NULL DEFAULT 0');
    expect(all).toContain('affection INTEGER NOT NULL DEFAULT 0');
    expect(all).toContain("CHECK(stage IN ('seed','sprout','tree','bloom'))");
    expect(all).toContain('idx_characters_user');
  });

  it('마이그레이션 #12 에서 character_xp_logs 테이블 + daily_xp 컬럼 추가', () => {
    const m = migrations.find((x) => x.id === 12);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('ALTER TABLE characters ADD COLUMN daily_xp');
    expect(all).toContain('ALTER TABLE characters ADD COLUMN daily_xp_reset_at');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS character_xp_logs');
    expect(all).toContain('character_id TEXT NOT NULL REFERENCES characters(id)');
    expect(all).toContain('client_nonce TEXT');
    expect(all).toContain('granted_xp INTEGER NOT NULL DEFAULT 0');
    expect(all).toContain('affection_delta INTEGER NOT NULL DEFAULT 0');
    expect(all).toContain('idx_character_xp_logs_character');
    expect(all).toContain('idx_character_xp_logs_nonce');
    expect(all).toContain('WHERE client_nonce IS NOT NULL');
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

  it('migration #33 stores editable TTS preset categories in DB', () => {
    const m = migrations.find((x) => x.id === 33);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain('CREATE TABLE IF NOT EXISTS tts_presets');
    expect(all).toContain('messages_json TEXT NOT NULL');
    expect(all).toContain('idx_tts_presets_order');
    expect(
      m!.statements.filter((s) => s.includes('INSERT OR IGNORE INTO tts_presets')).length,
    ).toBe(PRESETS.length);
    expect(all).toContain("'morning'");
    expect(all).toContain("'love'");
  });

  it('migration #48 upserts refreshed morning/night/medication presets', () => {
    const m = migrations.find((x) => x.id === 48);
    expect(m).toBeDefined();
    const all = m!.statements.join('\n');
    expect(all).toContain("'morning'");
    expect(all).toContain("'night'");
    expect(all).toContain("'medication'");
    // 기존 행을 덮어쓰는 upsert 여야 한다 (초기 시드는 INSERT OR IGNORE 라 갱신 안 됨).
    for (const stmt of m!.statements) {
      expect(stmt).toContain('ON CONFLICT(category) DO UPDATE');
    }
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
});
