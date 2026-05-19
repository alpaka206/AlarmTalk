import type { Client } from '@libsql/client/web';
import { PRESETS } from '../data/presets';

export interface Migration {
  id: number;
  name: string;
  statements: string[];
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const TTS_PRESET_SEED_STATEMENTS = PRESETS.map((preset, index) => {
  const messagesJson = JSON.stringify(preset.messages);
  return `INSERT OR IGNORE INTO tts_presets
    (category, label, emoji, messages_json, sort_order, enabled)
    VALUES (
      ${sqlLiteral(preset.category)},
      ${sqlLiteral(preset.label)},
      ${sqlLiteral(preset.emoji)},
      ${sqlLiteral(messagesJson)},
      ${index},
      1
    )`;
});

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial-schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        picture TEXT,
        plan TEXT DEFAULT 'free' CHECK(plan IN ('free','plus','family')),
        daily_tts_count INTEGER DEFAULT 0,
        daily_tts_reset_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS voice_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        perso_voice_id TEXT,
        elevenlabs_voice_id TEXT,
        avatar_url TEXT,
        status TEXT DEFAULT 'processing' CHECK(status IN ('processing','ready','failed')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id),
        text TEXT NOT NULL,
        audio_url TEXT,
        category TEXT DEFAULT 'custom',
        is_preset INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS alarms (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        target_user_id TEXT,
        message_id TEXT NOT NULL REFERENCES messages(id),
        time TEXT NOT NULL,
        repeat_days TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        snooze_minutes INTEGER DEFAULT 5,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS message_library (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        message_id TEXT NOT NULL REFERENCES messages(id),
        is_favorite INTEGER DEFAULT 0,
        received_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS friendships (
        id TEXT PRIMARY KEY,
        user_a TEXT NOT NULL,
        user_b TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','blocked')),
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS gifts (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        message_id TEXT NOT NULL REFERENCES messages(id),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
        note TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS dub_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_message_id TEXT,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        status TEXT DEFAULT 'uploading' CHECK(status IN ('uploading','processing','ready','failed')),
        perso_space_seq INTEGER,
        perso_project_seq INTEGER,
        perso_media_seq INTEGER,
        result_message_id TEXT,
        progress INTEGER DEFAULT 0,
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      // Indexes
      'CREATE INDEX IF NOT EXISTS idx_voice_profiles_user ON voice_profiles(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_messages_voice ON messages(voice_profile_id)',
      'CREATE INDEX IF NOT EXISTS idx_alarms_user ON alarms(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_alarms_target ON alarms(target_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_alarms_message ON alarms(message_id)',
      'CREATE INDEX IF NOT EXISTS idx_alarms_active ON alarms(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_library_user ON message_library(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_library_message ON message_library(message_id)',
      'CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships(user_a)',
      'CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships(user_b)',
      'CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_sender ON gifts(sender_id)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts(recipient_id)',
      'CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status)',
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_dub_jobs_user ON dub_jobs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_dub_jobs_status ON dub_jobs(status)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)',
    ],
  },
  {
    id: 2,
    name: 'email-password-auth',
    statements: [
      // 기존 스키마는 google_id NOT NULL — 이메일/비밀번호 사용자를 위해 nullable 로 재정의.
      // SQLite 의 ALTER TABLE 한계로 users 테이블 재생성 패턴 사용.
      `CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        google_id TEXT UNIQUE,
        email TEXT NOT NULL,
        password_hash TEXT,
        name TEXT,
        picture TEXT,
        plan TEXT DEFAULT 'free' CHECK(plan IN ('free','plus','family')),
        daily_tts_count INTEGER DEFAULT 0,
        daily_tts_reset_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `INSERT INTO users_new (id, google_id, email, name, picture, plan,
        daily_tts_count, daily_tts_reset_at, created_at, updated_at)
        SELECT id, google_id, email, name, picture, plan,
        daily_tts_count, daily_tts_reset_at, created_at, updated_at FROM users`,
      'DROP TABLE users',
      'ALTER TABLE users_new RENAME TO users',
      'CREATE UNIQUE INDEX idx_users_email_unique ON users(email)',
      'CREATE INDEX idx_users_email ON users(email)',
      'CREATE UNIQUE INDEX idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL',
    ],
  },
  {
    id: 3,
    name: 'voice-uploads',
    statements: [
      `CREATE TABLE IF NOT EXISTS voice_uploads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        object_key TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        duration_ms INTEGER,
        original_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_voice_uploads_user ON voice_uploads(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_voice_uploads_created ON voice_uploads(created_at)',
    ],
  },
  {
    id: 4,
    name: 'voice-speakers',
    statements: [
      `CREATE TABLE IF NOT EXISTS voice_speakers (
        id TEXT PRIMARY KEY,
        upload_id TEXT NOT NULL REFERENCES voice_uploads(id),
        label TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_voice_speakers_upload ON voice_speakers(upload_id)',
    ],
  },
  {
    id: 5,
    name: 'alarm-mode-voice-speaker',
    statements: [
      // mode: 'sound-only' 는 원본 오디오 재생, 'tts' 는 합성 메시지 재생 (기본)
      `ALTER TABLE alarms ADD COLUMN mode TEXT NOT NULL DEFAULT 'tts'
        CHECK(mode IN ('sound-only','tts'))`,
      // 메시지 경유 없이 알람이 특정 음성 프로필·화자 세그먼트에 직접 바인딩될 수 있음
      'ALTER TABLE alarms ADD COLUMN voice_profile_id TEXT',
      'ALTER TABLE alarms ADD COLUMN speaker_id TEXT',
      'CREATE INDEX IF NOT EXISTS idx_alarms_voice_profile ON alarms(voice_profile_id)',
      'CREATE INDEX IF NOT EXISTS idx_alarms_speaker ON alarms(speaker_id)',
    ],
  },
  {
    id: 6,
    name: 'plans-and-subscriptions',
    statements: [
      // plan_type: 'free'=무료, 'personal'=개인 1인, 'family'=가족 최대 6인
      `CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        plan_type TEXT NOT NULL CHECK(plan_type IN ('free','personal','family')),
        period_days INTEGER NOT NULL DEFAULT 30,
        max_members INTEGER NOT NULL DEFAULT 1,
        price_krw INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      // plan_group_id 는 #31 (가족 플랜 그룹) 에서 채움. 현재는 nullable.
      `CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        plan_id TEXT NOT NULL REFERENCES plans(id),
        plan_group_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','cancelled')),
        starts_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_key ON plans(key)',
      'CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)',
      'CREATE INDEX IF NOT EXISTS idx_subscriptions_expires ON subscriptions(expires_at)',
      // 기본 플랜 3개 시드 — 고정 UUID 로 재마이그레이션 시 중복 방지
      `INSERT OR IGNORE INTO plans (id, key, name, plan_type, period_days, max_members, price_krw, is_active)
        VALUES ('70000000-0000-4000-8000-000000000001', 'free', '무료', 'free', 36500, 1, 0, 1)`,
      `INSERT OR IGNORE INTO plans (id, key, name, plan_type, period_days, max_members, price_krw, is_active)
        VALUES ('70000000-0000-4000-8000-000000000002', 'personal', '개인', 'personal', 30, 1, 4900, 1)`,
      `INSERT OR IGNORE INTO plans (id, key, name, plan_type, period_days, max_members, price_krw, is_active)
        VALUES ('70000000-0000-4000-8000-000000000003', 'family', '가족', 'family', 30, 6, 9900, 1)`,
    ],
  },
  {
    id: 7,
    name: 'voucher-codes',
    statements: [
      // code: plaintext 'VA-XXXX-XXXX-XXXX' (발급자 본인에게만 노출)
      // code_hash: SHA-256(code) hex — 등록 시 lookup 용 (#29)
      `CREATE TABLE IF NOT EXISTS voucher_codes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        code_hash TEXT NOT NULL UNIQUE,
        plan_id TEXT NOT NULL REFERENCES plans(id),
        issuer_user_id TEXT NOT NULL REFERENCES users(id),
        issuer_subscription_id TEXT REFERENCES subscriptions(id),
        redeemed_by_user_id TEXT REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','used','expired')),
        issued_at TEXT NOT NULL DEFAULT (datetime('now')),
        used_at TEXT,
        expires_at TEXT NOT NULL
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_voucher_codes_hash ON voucher_codes(code_hash)',
      'CREATE INDEX IF NOT EXISTS idx_voucher_codes_issuer ON voucher_codes(issuer_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_voucher_codes_status ON voucher_codes(status)',
    ],
  },
  {
    id: 8,
    name: 'plan-groups',
    statements: [
      // 가족 플랜 그룹: 소유자 1인 + 멤버 N인 (최대 max_members = 6).
      // 1 그룹 = 1 가족 구독 (subscriptions.plan_group_id 로 역참조).
      `CREATE TABLE IF NOT EXISTS plan_groups (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        plan_id TEXT NOT NULL REFERENCES plans(id),
        max_members INTEGER NOT NULL DEFAULT 6,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      // 그룹 멤버: (plan_group_id, user_id) 조합 유일.
      // role='owner' 는 그룹당 1명만 허용 (애플리케이션 레벨에서 보장).
      `CREATE TABLE IF NOT EXISTS plan_group_members (
        id TEXT PRIMARY KEY,
        plan_group_id TEXT NOT NULL REFERENCES plan_groups(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
        joined_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_plan_groups_owner ON plan_groups(owner_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_plan_group_members_group ON plan_group_members(plan_group_id)',
      'CREATE INDEX IF NOT EXISTS idx_plan_group_members_user ON plan_group_members(user_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_group_members_unique ON plan_group_members(plan_group_id, user_id)',
    ],
  },
  {
    id: 9,
    name: 'plan-group-invites',
    statements: [
      // 가족 플랜 초대권 코드 — INV-XXXX-XXXX-XXXX 형식, 10분 만료, 일회용.
      // status 전이: pending → used | revoked | expired.
      `CREATE TABLE IF NOT EXISTS plan_group_invites (
        id TEXT PRIMARY KEY,
        plan_group_id TEXT NOT NULL REFERENCES plan_groups(id),
        inviter_user_id TEXT NOT NULL REFERENCES users(id),
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','used','revoked','expired')),
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL,
        used_by_user_id TEXT REFERENCES users(id),
        used_at TEXT
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_group_invites_code ON plan_group_invites(code)',
      'CREATE INDEX IF NOT EXISTS idx_plan_group_invites_group ON plan_group_invites(plan_group_id)',
      'CREATE INDEX IF NOT EXISTS idx_plan_group_invites_status ON plan_group_invites(status)',
    ],
  },
  {
    id: 10,
    name: 'user-allow-family-alarms',
    statements: [
      // 가족이 내게 알람을 추가할 수 있는지 여부 — 기본 false(0) 로 opt-in 설계
      `ALTER TABLE users ADD COLUMN allow_family_alarms INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    id: 11,
    name: 'characters',
    statements: [
      // 1 사용자 = 1 캐릭터. 알람을 정상 종료하면 XP 획득 → level/stage 성장.
      // stage: 'seed'(씨앗) → 'sprout'(새싹) → 'tree'(나무) → 'bloom'(꽃)
      `CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
        name TEXT NOT NULL DEFAULT '내 캐릭터',
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        affection INTEGER NOT NULL DEFAULT 0,
        stage TEXT NOT NULL DEFAULT 'seed' CHECK(stage IN ('seed','sprout','tree','bloom')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id)',
    ],
  },
  {
    id: 12,
    name: 'character-xp-logs',
    statements: [
      // 일일 XP 캡 관리: 지급 시점 날짜(YYYY-MM-DD) 와 달라지면 daily_xp 리셋.
      `ALTER TABLE characters ADD COLUMN daily_xp INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE characters ADD COLUMN daily_xp_reset_at TEXT`,
      // 지급 이력 + 멱등성 로그. client_nonce 가 있으면 (character_id, client_nonce) 유니크.
      `CREATE TABLE IF NOT EXISTS character_xp_logs (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id),
        event TEXT NOT NULL,
        client_nonce TEXT,
        granted_xp INTEGER NOT NULL DEFAULT 0,
        affection_delta INTEGER NOT NULL DEFAULT 0,
        capped INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_character_xp_logs_character ON character_xp_logs(character_id)',
      'CREATE INDEX IF NOT EXISTS idx_character_xp_logs_created ON character_xp_logs(created_at)',
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_character_xp_logs_nonce
        ON character_xp_logs(character_id, client_nonce)
        WHERE client_nonce IS NOT NULL`,
    ],
  },
  {
    id: 13,
    name: 'character-streak-stats',
    statements: [
      // 연속 기상 스트릭 — 클라이언트가 local_date(YYYY-MM-DD)를 전송, 서버가 streak 갱신.
      `ALTER TABLE characters ADD COLUMN current_streak INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE characters ADD COLUMN longest_streak INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE characters ADD COLUMN last_wakeup_date TEXT`,

      // 능력치: 나무 테마 (뿌리깊이=diligence, 줄기튼튼함=health, 잎무성함=consistency)
      // 1 캐릭터 = 1 stats 행. 값은 누적 카운트 기반으로 계산.
      `CREATE TABLE IF NOT EXISTS character_stats (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL UNIQUE REFERENCES characters(id),
        diligence INTEGER NOT NULL DEFAULT 0,
        health INTEGER NOT NULL DEFAULT 0,
        consistency INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_character_stats_character ON character_stats(character_id)',

      // 마일스톤 달성 기록: 7일(100XP), 30일(500XP), 90일(2000XP)
      `CREATE TABLE IF NOT EXISTS streak_achievements (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL REFERENCES characters(id),
        milestone INTEGER NOT NULL,
        bonus_xp INTEGER NOT NULL,
        achieved_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_streak_achievements_character ON streak_achievements(character_id)',
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_streak_achievements_unique
        ON streak_achievements(character_id, milestone)`,
    ],
  },
  {
    id: 14,
    name: 'push-tokens',
    statements: [
      `CREATE TABLE IF NOT EXISTS push_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        platform TEXT NOT NULL CHECK(platform IN ('ios','android','web')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_unique ON push_tokens(user_id, token)',
    ],
  },
  {
    id: 15,
    name: 'alarm-vibration-pattern',
    statements: [
      `ALTER TABLE alarms ADD COLUMN vibration_pattern TEXT NOT NULL DEFAULT 'default'
         CHECK(vibration_pattern IN ('default','strong','none'))`,
    ],
  },
  {
    id: 16,
    name: 'user-last-active',
    // SQLite ALTER TABLE ADD COLUMN requires a *constant* DEFAULT, so the
    // datetime('now') call cannot live in the column definition. We backfill
    // existing rows separately and let new inserts set the value explicitly.
    statements: [
      `ALTER TABLE users ADD COLUMN last_active_at TEXT`,
      `UPDATE users SET last_active_at = datetime('now') WHERE last_active_at IS NULL`,
    ],
  },
  {
    id: 17,
    name: 'alarm-wake-mode',
    statements: [
      `ALTER TABLE alarms ADD COLUMN wake_mode TEXT NOT NULL DEFAULT 'sound_then_voice'
         CHECK(wake_mode IN ('sound_then_voice','voice_only'))`,
      `ALTER TABLE alarms ADD COLUMN voice_profile_id TEXT DEFAULT NULL`,
    ],
  },
  {
    id: 18,
    name: 'notes-table',
    statements: [
      `CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL REFERENCES users(id),
        receiver_id TEXT NOT NULL REFERENCES users(id),
        text TEXT NOT NULL,
        audio_url TEXT,
        read_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_notes_receiver ON notes(receiver_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_notes_sender ON notes(sender_id, created_at DESC)`,
    ],
  },
  {
    id: 19,
    name: 'composite-indices',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_friendships_a_status ON friendships(user_a, status)`,
      `CREATE INDEX IF NOT EXISTS idx_friendships_b_status ON friendships(user_b, status)`,
      `CREATE INDEX IF NOT EXISTS idx_gifts_recipient_created ON gifts(recipient_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_gifts_sender_created ON gifts(sender_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_alarms_user_active ON alarms(user_id, is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_alarms_target_active ON alarms(target_user_id, is_active)`,
    ],
  },
  {
    id: 20,
    // Cleanup orphaned `alarms_new` left behind by a half-applied earlier
    // attempt at the table-recreation migration. No-op on fresh DBs.
    name: 'alarm-raw-audio-cleanup',
    statements: ['DROP TABLE IF EXISTS alarms_new'],
  },
  {
    id: 21,
    // Add raw_audio columns directly via ALTER. Keeps `message_id` NOT NULL —
    // raw-audio alarms get a placeholder message row in alarm-mutation.
    name: 'alarm-raw-audio-columns',
    statements: [
      `ALTER TABLE alarms ADD COLUMN raw_audio_url TEXT`,
      `ALTER TABLE alarms ADD COLUMN raw_audio_duration_ms INTEGER`,
    ],
  },
  {
    id: 22,
    // Make alarms.message_id NULLABLE so the "alarm-only" play mode (just a
    // buzzer, no TTS or voice clip) can store an alarm row without inventing
    // a placeholder message. SQLite has no ALTER COLUMN DROP NOT NULL, so we
    // rebuild the table. NOTE: this version (re)introduced FK constraints
    // that conflict with the established convention of storing the JWT sub
    // (Google ID) in `user_id` instead of the users.id PK — superseded by
    // migration 23, which drops those FKs. Kept here for ledger continuity.
    name: 'alarms-message-id-nullable',
    statements: [
      `PRAGMA foreign_keys=off`,
      `DROP TABLE IF EXISTS alarms_v2`,
      `CREATE TABLE alarms_v2 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        target_user_id TEXT,
        message_id TEXT REFERENCES messages(id),
        time TEXT NOT NULL,
        repeat_days TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        snooze_minutes INTEGER DEFAULT 5,
        mode TEXT NOT NULL DEFAULT 'tts',
        voice_profile_id TEXT,
        speaker_id TEXT,
        vibration_pattern TEXT NOT NULL DEFAULT 'default',
        wake_mode TEXT NOT NULL DEFAULT 'sound_then_voice',
        raw_audio_url TEXT,
        raw_audio_duration_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `INSERT INTO alarms_v2 (
        id, user_id, target_user_id, message_id, time, repeat_days,
        is_active, snooze_minutes, mode, voice_profile_id, speaker_id,
        vibration_pattern, wake_mode, raw_audio_url, raw_audio_duration_ms,
        created_at, updated_at
      ) SELECT
        id, user_id, target_user_id, message_id, time, repeat_days,
        is_active, snooze_minutes, mode, voice_profile_id, speaker_id,
        vibration_pattern, wake_mode, raw_audio_url, raw_audio_duration_ms,
        created_at, updated_at
      FROM alarms`,
      `DROP TABLE alarms`,
      `ALTER TABLE alarms_v2 RENAME TO alarms`,
      `PRAGMA foreign_keys=on`,
    ],
  },
  {
    id: 23,
    // Drop the FK constraints (re)added by migration 22. The codebase stores
    // the Google JWT sub in `alarms.user_id` (rather than the users.id PK)
    // to match the legacy `WHERE google_id = ?` lookup convention used
    // across other routes. With the FK enabled, every new alarm fails with
    // SQLITE_CONSTRAINT: FOREIGN KEY constraint failed because the sub
    // doesn't match any users.id. Rebuild without FKs; nullability is kept.
    name: 'alarms-drop-fks',
    statements: [
      `PRAGMA foreign_keys=off`,
      `DROP TABLE IF EXISTS alarms_v3`,
      `CREATE TABLE alarms_v3 (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        target_user_id TEXT,
        message_id TEXT,
        time TEXT NOT NULL,
        repeat_days TEXT DEFAULT '[]',
        is_active INTEGER DEFAULT 1,
        snooze_minutes INTEGER DEFAULT 5,
        mode TEXT NOT NULL DEFAULT 'tts',
        voice_profile_id TEXT,
        speaker_id TEXT,
        vibration_pattern TEXT NOT NULL DEFAULT 'default',
        wake_mode TEXT NOT NULL DEFAULT 'sound_then_voice',
        raw_audio_url TEXT,
        raw_audio_duration_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      `INSERT INTO alarms_v3 (
        id, user_id, target_user_id, message_id, time, repeat_days,
        is_active, snooze_minutes, mode, voice_profile_id, speaker_id,
        vibration_pattern, wake_mode, raw_audio_url, raw_audio_duration_ms,
        created_at, updated_at
      ) SELECT
        id, user_id, target_user_id, message_id, time, repeat_days,
        is_active, snooze_minutes, mode, voice_profile_id, speaker_id,
        vibration_pattern, wake_mode, raw_audio_url, raw_audio_duration_ms,
        created_at, updated_at
      FROM alarms`,
      `DROP TABLE alarms`,
      `ALTER TABLE alarms_v3 RENAME TO alarms`,
      `PRAGMA foreign_keys=on`,
    ],
  },
  {
    id: 24,
    name: 'generated-audio-assets-cache',
    statements: [
      `CREATE TABLE IF NOT EXISTS generated_audio_assets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        voice_profile_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_voice_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        language TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        text TEXT NOT NULL,
        category TEXT DEFAULT 'custom',
        audio_url TEXT,
        audio_object_key TEXT,
        audio_format TEXT NOT NULL DEFAULT 'mp3',
        mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
        size_bytes INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_audio_assets_request ON generated_audio_assets(request_hash)',
      'CREATE INDEX IF NOT EXISTS idx_generated_audio_assets_user ON generated_audio_assets(user_id, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_generated_audio_assets_voice ON generated_audio_assets(voice_profile_id)',
      'CREATE INDEX IF NOT EXISTS idx_generated_audio_assets_message ON generated_audio_assets(message_id)',
    ],
  },
  {
    id: 25,
    name: 'voice-profile-sharing',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0`,
      'CREATE INDEX IF NOT EXISTS idx_voice_profiles_family_shared ON voice_profiles(user_id, status, is_shared)',
    ],
  },
  {
    id: 26,
    name: 'couple-plan-seed',
    statements: [
      `INSERT OR IGNORE INTO plans (id, key, name, plan_type, period_days, max_members, price_krw, is_active)
        VALUES ('70000000-0000-4000-8000-000000000004', 'couple', '커플', 'family', 30, 2, 7900, 1)`,
    ],
  },
  {
    // 구독 해지/플랜 변경 예약용 필드.
    // - cancel_at_period_end: 결제일까지 사용 후 자동 해지 플래그
    // - canceled_at: 즉시 해지된 경우 시각
    // - next_plan_id: 결제일 이후 자동 적용될 플랜 (변경 예약)
    id: 27,
    name: 'subscription-cancel-fields',
    statements: [
      `ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE subscriptions ADD COLUMN canceled_at TEXT`,
      `ALTER TABLE subscriptions ADD COLUMN next_plan_id TEXT REFERENCES plans(id)`,
    ],
  },
  {
    // 초대 코드 N명 사용 (가족: 코드 1장으로 5명 합류).
    // - voucher_codes.max_uses: 코드별 최대 사용 가능 인원
    // - voucher_redemptions: 어느 사용자가 언제 사용했는지의 다대일 기록.
    //   (voucher_codes.redeemed_by_user_id/used_at 은 호환성 위해 유지하되 첫 사용자 기록용으로 약화)
    id: 28,
    name: 'voucher-multi-use',
    statements: [
      `ALTER TABLE voucher_codes ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1`,
      `CREATE TABLE IF NOT EXISTS voucher_redemptions (
        id TEXT PRIMARY KEY,
        voucher_id TEXT NOT NULL REFERENCES voucher_codes(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        redeemed_at TEXT DEFAULT (datetime('now')),
        UNIQUE (voucher_id, user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_voucher
        ON voucher_redemptions(voucher_id)`,
      `CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_user
        ON voucher_redemptions(user_id)`,
    ],
  },
  {
    // 상대방이 내 알람을 설정할 수 있는 시간대 제한.
    // 기본은 월-금 09:00-18:30 설정 불가. allow_family_alarms 가 꺼져 있으면 전체 차단.
    id: 29,
    name: 'family-alarm-quiet-time',
    statements: [
      `ALTER TABLE users ADD COLUMN family_alarm_quiet_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]'`,
      `ALTER TABLE users ADD COLUMN family_alarm_quiet_start TEXT NOT NULL DEFAULT '09:00'`,
      `ALTER TABLE users ADD COLUMN family_alarm_quiet_end TEXT NOT NULL DEFAULT '18:30'`,
    ],
  },
  {
    // 여러 개의 설정 불가 시간 규칙. 기존 단일 필드는 첫 번째 규칙으로 유지한다.
    id: 30,
    name: 'family-alarm-quiet-windows',
    statements: [
      `ALTER TABLE users ADD COLUMN family_alarm_quiet_windows TEXT NOT NULL DEFAULT '[{"days":[1,2,3,4,5],"start":"09:00","end":"18:30"}]'`,
    ],
  },
  {
    id: 31,
    name: 'email-verification-codes',
    statements: [
      `CREATE TABLE IF NOT EXISTS email_verification_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT 'register',
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_email_verification_email_purpose
        ON email_verification_codes(email, purpose, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_email_verification_expires
        ON email_verification_codes(expires_at)`,
    ],
  },
  {
    // Voice profile deletion must not remove alarms or generated message history.
    // Keep the row for existing references, but hide it from profile selection and
    // block any future synthesis/edit flow.
    id: 32,
    name: 'voice-profile-soft-delete',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN deleted_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_voice_profiles_active_user
        ON voice_profiles(user_id, deleted_at, created_at)`,
    ],
  },
  {
    id: 33,
    name: 'tts-preset-remote-config',
    statements: [
      `CREATE TABLE IF NOT EXISTS tts_presets (
        category TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        emoji TEXT,
        messages_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      'CREATE INDEX IF NOT EXISTS idx_tts_presets_order ON tts_presets(enabled, sort_order, category)',
      ...TTS_PRESET_SEED_STATEMENTS,
    ],
  },
  {
    id: 34,
    name: 'tts-prepared-text-fields',
    statements: [
      `ALTER TABLE messages ADD COLUMN synthesis_text TEXT`,
      `ALTER TABLE messages ADD COLUMN delivery_tags_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE generated_audio_assets ADD COLUMN original_text TEXT`,
      `ALTER TABLE generated_audio_assets ADD COLUMN delivery_tags_json TEXT NOT NULL DEFAULT '[]'`,
    ],
  },
  {
    id: 35,
    name: 'apple-login-users',
    statements: [
      `ALTER TABLE users ADD COLUMN apple_id TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_id
        ON users(apple_id)
        WHERE apple_id IS NOT NULL`,
    ],
  },
  {
    // Apple StoreKit2 IAP 트랜잭션 추적 컬럼.
    //   - apple_transaction_id: 결제 단위 ID. 멱등 lookup 키.
    //   - apple_original_transaction_id: 자동 갱신 구독의 원본 구매 ID.
    //   - apple_product_id: SKU (com.voicealarm.nativeapp.ios.personal_monthly 등)
    // 유니크 인덱스로 동일 transaction_id 의 중복 INSERT 를 방지 (POST /billing/apple/confirm 멱등성).
    id: 36,
    name: 'subscriptions-apple-fields',
    statements: [
      `ALTER TABLE subscriptions ADD COLUMN apple_transaction_id TEXT`,
      `ALTER TABLE subscriptions ADD COLUMN apple_original_transaction_id TEXT`,
      `ALTER TABLE subscriptions ADD COLUMN apple_product_id TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_apple_transaction
        ON subscriptions(apple_transaction_id)
        WHERE apple_transaction_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_apple_original
        ON subscriptions(apple_original_transaction_id)
        WHERE apple_original_transaction_id IS NOT NULL`,
    ],
  },
  {
    id: 37,
    name: 'voice-profile-relationship-labels',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN relationship_label TEXT`,
      `CREATE TABLE IF NOT EXISTS voice_profile_relationships (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id),
        relationship_label TEXT NOT NULL DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, voice_profile_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voice_profile_relationships_user
        ON voice_profile_relationships(user_id, voice_profile_id)`,
    ],
  },
];

// Errors that mean the statement was already applied — safe to ignore so
// we can recover databases whose `_migrations` ledger is out of sync with
// reality (e.g. partial historical migration runs before the ledger existed).
function isIdempotentDDLError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('duplicate column name') ||
    lower.includes('already exists') ||
    lower.includes('no such index')
  );
}

/**
 * Run only migrations whose id falls inside [fromId, toId] (inclusive).
 * Useful for batched init under Workers' subrequest cap. Idempotent —
 * skips DDL errors that imply the statement is already applied.
 */
export async function runMigrationsRange(
  db: Client,
  fromId: number,
  toId: number,
): Promise<string[]> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )`,
  );
  const applied = await db.execute('SELECT id FROM _migrations ORDER BY id');
  const appliedIds = new Set(applied.rows.map((r) => Number(r.id)));
  const ran: string[] = [];
  for (const migration of migrations) {
    if (migration.id < fromId || migration.id > toId) continue;
    if (appliedIds.has(migration.id)) continue;
    for (const stmt of migration.statements) {
      try {
        await db.execute(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isIdempotentDDLError(msg)) throw err;
      }
    }
    await db.execute({
      sql: 'INSERT INTO _migrations (id, name) VALUES (?, ?)',
      args: [migration.id, migration.name],
    });
    ran.push(`${migration.id}_${migration.name}`);
  }
  return ran;
}

export async function runMigrations(db: Client): Promise<string[]> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    )`,
  );

  const applied = await db.execute('SELECT id FROM _migrations ORDER BY id');
  const appliedIds = new Set(applied.rows.map((r) => Number(r.id)));

  const ran: string[] = [];

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;

    for (const stmt of migration.statements) {
      await db.execute(stmt);
    }

    await db.execute({
      sql: 'INSERT INTO _migrations (id, name) VALUES (?, ?)',
      args: [migration.id, migration.name],
    });

    ran.push(`${migration.id}_${migration.name}`);
  }

  return ran;
}
