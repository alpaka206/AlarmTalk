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

// 이미 시드된 DB(INSERT OR IGNORE 라 갱신 안 됨)에 특정 카테고리의 멘트/라벨을 강제로
// 덮어쓰거나 신규 카테고리를 추가할 때 쓰는 upsert. PRESETS 가 단일 진실 공급원.
function ttsPresetUpsert(category: string): string {
  const index = PRESETS.findIndex((p) => p.category === category);
  const preset = PRESETS[index];
  if (!preset) throw new Error(`ttsPresetUpsert: unknown preset category "${category}"`);
  const messagesJson = JSON.stringify(preset.messages);
  return `INSERT INTO tts_presets
    (category, label, emoji, messages_json, sort_order, enabled)
    VALUES (
      ${sqlLiteral(preset.category)},
      ${sqlLiteral(preset.label)},
      ${sqlLiteral(preset.emoji)},
      ${sqlLiteral(messagesJson)},
      ${index},
      1
    )
    ON CONFLICT(category) DO UPDATE SET
      label = excluded.label,
      emoji = excluded.emoji,
      messages_json = excluded.messages_json,
      enabled = excluded.enabled,
      updated_at = datetime('now')`;
}

// 2026-07-19 확정 스톡 클립 대사(마이그레이션 #70 전용 '동결 사본').
// stock-clips.ts 의 STOCK_CLIP_PRESETS 를 import 하지 않는다 — 마이그레이션은 적용 후
// 불변이어야 하는데, 살아있는 상수를 참조하면 이후 문구가 또 바뀔 때 이 마이그레이션의
// 동작까지 소급 변경되기 때문. 문구가 다시 바뀌면 그때의 동결 사본으로 새 마이그레이션을 만든다.
const STOCK_PRESET_SYNTHESIS_TEXTS_2026_07_19: readonly string[] = [
  // ko — weather 9 · medication 2 · greeting 1
  '[brightly] 오늘은 날씨가 맑대요. 나갈 때 하늘 한 번 올려다보는 거 어떨까요? 생각보다 기분이 좋아질 거예요.',
  '[gently] 오늘은 비가 올 수도 있대요. 나갈 때 우산 챙겨 가고, 길이 미끄러울 수 있으니까 발밑도 조심해요.',
  '[gently] 오늘은 눈이 올 수도 있대요. 옷 따뜻하게 입고, 길 미끄러울 수 있으니까 평소보다 조금만 천천히 걸어요.',
  '[warmly] 오늘은 미세먼지가 심하대요. 나갈 때 마스크 꼭 챙기고요. 바깥 공기는 좀 답답하더라도, 기분 좋은 하루 보냈으면 좋겠어요.',
  '[reassuringly] 오늘은 하늘이 흐리대요. 비가 올 수도 있으니 작은 우산 하나 챙기세요. 흐린 날씨에 너무 처지지 말고, 오늘도 기분 좋게 다녀와요.',
  '[calmly] 오늘은 안개가 짙게 낀대요. 앞이 잘 안 보일 수 있으니까, 서두르지 말고 천천히 가요. 오늘은 안전이 제일이에요.',
  '[caring] 오늘은 햇볕도 강하고 꽤 덥대요. 물 자주 마시고, 한낮에는 너무 무리하지 말아요.',
  '[warmly] 오늘은 많이 춥대요. 외투 따뜻하게 챙겨 입고 나가요. 감기 걸리면 속상하니까요.',
  '[lightly] 인터넷이 안 돼서 오늘 날씨는 미리 못 봤어요. 나가기 전에 창밖 한 번 살펴봐요. 그래도 오늘 하루, 잘 다녀와요.',
  '[warmly] 약 먹을 시간이에요. 잊어버리기 전에, 물 한 잔이랑 같이 지금 챙겨 먹어요.',
  '[gently] 밥은 챙겨 먹었어요? 이제 약 먹을 시간이에요. 바빠도 약부터 먹고, 하던 일은 그다음에 해요.',
  '[brightly] 안녕하세요! 만나서 정말 반가워요. [warmly] 앞으로 매일 아침, 제 목소리로 기분 좋게 깨워 드릴게요. 우리 잘 지내봐요!',
  // en
  "[brightly] They say it's going to be a beautiful clear day. How about looking up at the sky on your way out? It'll lift your mood more than you'd expect.",
  '[gently] It might rain today. Take an umbrella with you, and watch your step — the ground could be slippery.',
  '[gently] It might snow today. Dress warm, and walk a little slower than usual — the streets could be slippery.',
  "[warmly] The air quality isn't great today. Don't forget your mask on the way out. It might feel a little stuffy, but I hope you have a lovely day anyway.",
  "[reassuringly] It looks pretty cloudy today. Tuck a small umbrella in your bag, just in case. Don't let the gray skies get you down — have a good one.",
  "[calmly] They say it's quite foggy this morning. Take it slow and watch where you're going. No need to rush — safety first today.",
  "[caring] It's going to be a hot one today, with strong sun. Drink plenty of water, and don't push yourself too hard around midday.",
  "[warmly] It's really cold out today. Bundle up in a warm coat before you head out — I'd hate for you to catch a cold.",
  "[lightly] I couldn't check today's weather — no internet this morning. Take a peek out the window before you leave. Have a great day out there.",
  "[warmly] It's time for your medicine. Take it now with a glass of water, before it slips your mind.",
  "[gently] Have you eaten? It's time for your medicine. Even if you're busy, take it first — everything else can wait a moment.",
  "[brightly] Hi there! It's so nice to meet you. [warmly] From now on, I'll be waking you up every morning with my voice. We're going to get along just fine!",
  // ja
  '[brightly] 今日はよく晴れるそうですよ。出かけるとき、空をちょっと見上げてみませんか?思ったより気分が明るくなりますよ。',
  '[gently] 今日は雨が降るかもしれないそうです。傘を持って出かけてくださいね。道がすべりやすいかもしれないので、足元にも気をつけて。',
  '[gently] 今日は雪が降るかもしれません。あたたかくして、道がすべりやすいかもしれないから、いつもより少しゆっくり歩いてくださいね。',
  '[warmly] 今日は空気があまりよくないみたいです。出かけるときはマスクを忘れずに。ちょっと息苦しくても、気分のいい一日になりますように。',
  '[reassuringly] 今日は曇りみたいですよ。雨が降るかもしれないから、小さい傘をひとつ持っていってくださいね。曇り空に気分まで沈まないで、今日も元気にいってらっしゃい。',
  '[calmly] 今日は霧が濃いそうです。急がずに、周りをよく見ながらゆっくり歩いてくださいね。今日は安全がいちばんですよ。',
  '[caring] 今日は日差しも強くて、かなり暑くなるそうです。水分をこまめにとって、昼間は無理しすぎないでくださいね。',
  '[warmly] 今日はとても寒いそうですよ。あたたかいコートを着て出かけてくださいね。風邪をひいたら大変ですから。',
  '[lightly] インターネットがつながらなくて、今日の天気は確認できませんでした。出かける前に、窓の外をちょっと見てみてくださいね。今日もいい一日を。',
  '[warmly] お薬の時間ですよ。忘れないうちに、お水と一緒に今飲んでくださいね。',
  '[gently] ごはんはちゃんと食べましたか?お薬の時間ですよ。忙しくても、まずお薬を飲んでから、続きをしましょうね。',
  '[brightly] こんにちは!お会いできてうれしいです。[warmly] これから毎朝、私の声で気持ちよく起こしますね。よろしくお願いします!',
];

// 시스템 보이스 preset 중 확정 리터럴(위 36종)과 문구가 다른 '낡은' 행의 id 집합.
// 2026-07-19 시딩으로 이미 최신 문구가 들어간 DB(dev/prod)에서는 정확히 0행 = no-op.
const STALE_STOCK_PRESET_SUBQUERY_2026_07_19 = `SELECT m.id FROM messages m
  WHERE COALESCE(m.is_preset, 0) = 1
    AND m.voice_profile_id IN (
      SELECT id FROM voice_profiles WHERE COALESCE(is_system, 0) = 1
    )
    AND COALESCE(m.synthesis_text, m.text, '') NOT IN (
      ${STOCK_PRESET_SYNTHESIS_TEXTS_2026_07_19.map(sqlLiteral).join(',\n      ')}
    )`;

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
  {
    // 호칭(listener title): 음성이 청자(=알람 사용자)를 어떻게 부를지 라벨.
    //   - voice_profiles.listener_title: 소유자가 설정한 기본 호칭.
    //   - voice_profile_relationships.listener_title: 공유 음성의 viewer 관점 호칭.
    // 동적 음성 프롬프트에 주입되어 청자 호칭을 그대로 사용하도록 모델을 가이드한다.
    id: 38,
    name: 'voice-profile-listener-title',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN listener_title TEXT`,
      `ALTER TABLE voice_profile_relationships ADD COLUMN listener_title TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    // 화자 분리 후 미리듣기/선택 흐름용 임시 보이스 프로파일.
    // is_draft=1 은 카운트/리스트에서 제외하고 promote 시 0 으로 변경.
    id: 39,
    name: 'voice-profile-draft-flag',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_voice_profiles_is_draft ON voice_profiles(is_draft, user_id)`,
    ],
  },
  {
    // 사용자별 동적 랜덤 문구 기본값. 상대 알람 생성 시 수신자 기준 날씨/운세 값을
    // 사용할 수 있도록 가족 멤버 응답에도 노출한다.
    id: 40,
    name: 'user-dynamic-prompt-settings',
    statements: [
      `ALTER TABLE users ADD COLUMN dynamic_prompt_settings_json TEXT NOT NULL DEFAULT '{}'`,
    ],
  },
  {
    // 개인정보보호법 컴플라이언스(이슈 #426).
    //  - user_consents: 가입/이용 중 동의 사실을 (유형, 정책 버전, 동의 여부, 시각) 으로
    //    파기 시까지 보관. consent_type: 'terms'(이용약관·필수), 'privacy'(개인정보·필수),
    //    'marketing'(마케팅·선택), 'age14'(만14세이상·필수) 등. 동일 (user_id, consent_type)
    //    의 최신 행이 현재 동의 상태이며, 이력은 누적 INSERT 로 남긴다.
    //  - users 탈퇴 유예 컬럼: deletion_requested_at(탈퇴 신청 시각),
    //    deletion_status('active'|'pending_deletion'), deletion_purge_at(영구파기 예정 시각).
    //    pending_deletion 이면 로그인/이용을 차단하고, purge_at 경과분을 cron 이 영구파기.
    id: 41,
    name: 'privacy-consents-and-withdrawal',
    statements: [
      `CREATE TABLE IF NOT EXISTS user_consents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        consent_type TEXT NOT NULL,
        policy_version TEXT NOT NULL DEFAULT '1',
        agreed INTEGER NOT NULL DEFAULT 0,
        agreed_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_consents_user
        ON user_consents(user_id, consent_type, created_at DESC)`,
      `ALTER TABLE users ADD COLUMN deletion_requested_at TEXT`,
      `ALTER TABLE users ADD COLUMN deletion_status TEXT NOT NULL DEFAULT 'active'
        CHECK(deletion_status IN ('active','pending_deletion'))`,
      `ALTER TABLE users ADD COLUMN deletion_purge_at TEXT`,
      // 법정 보존(전자상거래법 5년) 대상 결제·구독 기록의 가명처리 분리보관 테이블.
      // pseudonym = SHA-256(user_id + RETENTION_SALT). 원본 식별자와 직접 조인 불가.
      `CREATE TABLE IF NOT EXISTS retained_billing_records (
        id TEXT PRIMARY KEY,
        pseudonym TEXT NOT NULL,
        plan_id TEXT,
        status TEXT,
        starts_at TEXT,
        expires_at TEXT,
        amount_krw INTEGER,
        retained_reason TEXT NOT NULL DEFAULT 'ecommerce_act_5y',
        retain_until TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_retained_billing_pseudonym
        ON retained_billing_records(pseudonym)`,
      `CREATE INDEX IF NOT EXISTS idx_retained_billing_until
        ON retained_billing_records(retain_until)`,
    ],
  },
  {
    // 음성 수명주기 + 스케줄러 시간대 + 스토어 결제 기록.
    //  - pending_external_deletions: 트랜잭션 안에서 DB 행을 지우기 전에 ElevenLabs
    //    voice / R2 오브젝트 참조를 적재해 두고, cron 이 외부 API 로 실제 삭제 후
    //    큐에서 제거한다 (탈퇴·다운그레이드 시 클로닝/오디오 잔존 방지).
    //  - alarms.timezone: 클라이언트 IANA 시간대 (예: 'Asia/Seoul'). 푸시 스케줄러가
    //    알람 HH:mm 을 이 시간대 기준으로 판정한다. NULL 이면 Asia/Seoul 폴백.
    //  - store_transactions: Apple/Google/PortOne 결제 검증 기록 (중복 처리 방지 +
    //    전자상거래법 보존 원본). provider_transaction_id 는 provider 별 고유.
    id: 42,
    name: 'voice-lifecycle-and-store-billing',
    statements: [
      `CREATE TABLE IF NOT EXISTS pending_external_deletions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('elevenlabs_voice','r2_object')),
        ref TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_external_deletions_ref
        ON pending_external_deletions(kind, ref)`,
      `ALTER TABLE alarms ADD COLUMN timezone TEXT`,
      `CREATE TABLE IF NOT EXISTS store_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('apple','google','portone')),
        provider_transaction_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        plan_key TEXT NOT NULL,
        subscription_id TEXT,
        expires_at TEXT,
        raw_payload TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_store_transactions_provider_tx
        ON store_transactions(provider, provider_transaction_id)`,
      `CREATE INDEX IF NOT EXISTS idx_store_transactions_user
        ON store_transactions(user_id, created_at DESC)`,
    ],
  },
  {
    // 무료 플랜용 시스템 제공(스톡) 보이스.
    //  - voice_profiles.is_system=1 행은 모든 사용자의 목소리 목록에 노출되고,
    //    무료 플랜도 이 보이스로는 TTS(프리셋 문구 한정)를 쓸 수 있다.
    //  - 소유자는 'system:voice-library' 시스템 유저 (로그인 불가, 발급 전용).
    //  - elevenlabs_voice_id 는 ElevenLabs premade 보이스 (상업적 이용 허용 셋).
    //    Adam 은 릴스/숏폼에서 유행한 그 목소리.
    id: 43,
    name: 'system-stock-voices',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0`,
      // 주의: users.email 에 unique 인덱스가 있어 이메일은 다른 시스템 계정과
      // 절대 겹치면 안 된다 (겹치면 INSERT OR IGNORE 가 조용히 무시되고
      // 이어지는 voice_profiles 시드가 FK 로 실패).
      `INSERT OR IGNORE INTO users (id, google_id, email, name, plan)
        VALUES ('70000000-0000-4000-9000-000000000001', 'system:voice-library',
                'voice-library@alarm-talk.com', 'AlarmTalk 기본 목소리', 'free')`,
      `INSERT OR IGNORE INTO voice_profiles
        (id, user_id, name, elevenlabs_voice_id, status, is_system, is_shared, is_draft)
        VALUES ('70000000-0000-4000-9000-000000000101', '70000000-0000-4000-9000-000000000001',
                '아담', 'pNInz6obpgDQGcFmaJgB', 'ready', 1, 0, 0)`,
      `INSERT OR IGNORE INTO voice_profiles
        (id, user_id, name, elevenlabs_voice_id, status, is_system, is_shared, is_draft)
        VALUES ('70000000-0000-4000-9000-000000000102', '70000000-0000-4000-9000-000000000001',
                '레이첼', '21m00Tcm4TlvDq8ikWAM', 'ready', 1, 0, 0)`,
      `INSERT OR IGNORE INTO voice_profiles
        (id, user_id, name, elevenlabs_voice_id, status, is_system, is_shared, is_draft)
        VALUES ('70000000-0000-4000-9000-000000000103', '70000000-0000-4000-9000-000000000001',
                '브라이언', 'nPczCjzI2devNBz1zQrb', 'ready', 1, 0, 0)`,
      `INSERT OR IGNORE INTO voice_profiles
        (id, user_id, name, elevenlabs_voice_id, status, is_system, is_shared, is_draft)
        VALUES ('70000000-0000-4000-9000-000000000104', '70000000-0000-4000-9000-000000000001',
                '제시카', 'cgSgspJ2msm6clMCkdW9', 'ready', 1, 0, 0)`,
    ],
  },
  {
    // 무료 플랜용 "스톡 알람 클립" — 시스템 보이스로 서버에서 미리 합성해 둔 고정 음성.
    //  - messages.is_preset=1 + voice_profile_id(시스템 보이스) + category + language 조합으로 식별.
    //  - 무료 플랜은 랜덤 생성 없이 이 클립을 그대로 받아 알람에 붙여 쓴다 (생성 비용 0).
    //  - 실제 클립은 POST /api/admin/seed-stock-clips (dev 전용) 로 생성한다.
    id: 44,
    name: 'messages-language-for-stock-clips',
    statements: [
      `ALTER TABLE messages ADD COLUMN language TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_messages_stock
        ON messages(is_preset, voice_profile_id, category, language)`,
    ],
  },
  {
    // 시스템 스톡 보이스 이름/음성 재배치 (#43 시드 이후 변경분).
    //  - 레이첼·브라이언을 네이티브 한국어 보이스(Mina·Mr.K)로 교체하고 한글 이름(미나·하준) 부여.
    //  - 제시카→소은 은 음성 유지, 이름만 변경. 아담(101)은 이름·음성 모두 유지.
    //  - 음성이 바뀐 102·103, 인사말(greeting)이 바뀐 101·104 의 기존 스톡 클립은
    //    옛 음성/문구로 남아 새 프로필 이름 아래 그대로 노출되므로 아래에서 무효화한다.
    //    findMissingStockTargets 가 (voice_profile_id|category|language) 로만 존재 여부를
    //    보기 때문에, 행을 지워야 다음 seed 때 새 음성/문구로 재생성된다.
    //  - 배포 후 POST /api/admin/seed-stock-clips 로 재생성한다 (reset 불필요 — 여기서 무효화됨).
    //  - R2 오브젝트는 만료 정리에 맡기고, 이 클립을 참조하던 알람은 sound-only 로 떼어낸다.
    id: 45,
    name: 'rename-reassign-stock-voices',
    statements: [
      `UPDATE voice_profiles SET name = '미나', elevenlabs_voice_id = 'aiUUgjHa4mpHf6UenZuf'
        WHERE id = '70000000-0000-4000-9000-000000000102'`,
      `UPDATE voice_profiles SET name = '하준', elevenlabs_voice_id = 'LKOcTG4J4tYTPR9DnLeM'
        WHERE id = '70000000-0000-4000-9000-000000000103'`,
      `UPDATE voice_profiles SET name = '소은'
        WHERE id = '70000000-0000-4000-9000-000000000104'`,
      // 무효화 대상: 102·103 의 모든 프리셋 클립 + 101·104 의 greeting 프리셋 클립.
      `UPDATE alarms
        SET mode = 'sound-only', wake_mode = 'sound_then_voice',
            message_id = NULL, voice_profile_id = NULL, speaker_id = NULL,
            raw_audio_url = NULL, raw_audio_duration_ms = NULL
        WHERE message_id IN (
          SELECT id FROM messages
          WHERE COALESCE(is_preset, 0) = 1 AND (
            voice_profile_id IN (
              '70000000-0000-4000-9000-000000000102',
              '70000000-0000-4000-9000-000000000103'
            )
            OR (category = 'greeting' AND voice_profile_id IN (
              '70000000-0000-4000-9000-000000000101',
              '70000000-0000-4000-9000-000000000104'
            ))
          ))`,
      `DELETE FROM message_library WHERE message_id IN (
        SELECT id FROM messages
        WHERE COALESCE(is_preset, 0) = 1 AND (
          voice_profile_id IN (
            '70000000-0000-4000-9000-000000000102',
            '70000000-0000-4000-9000-000000000103'
          )
          OR (category = 'greeting' AND voice_profile_id IN (
            '70000000-0000-4000-9000-000000000101',
            '70000000-0000-4000-9000-000000000104'
          ))
        ))`,
      `DELETE FROM generated_audio_assets WHERE message_id IN (
        SELECT id FROM messages
        WHERE COALESCE(is_preset, 0) = 1 AND (
          voice_profile_id IN (
            '70000000-0000-4000-9000-000000000102',
            '70000000-0000-4000-9000-000000000103'
          )
          OR (category = 'greeting' AND voice_profile_id IN (
            '70000000-0000-4000-9000-000000000101',
            '70000000-0000-4000-9000-000000000104'
          ))
        ))`,
      `DELETE FROM messages
        WHERE COALESCE(is_preset, 0) = 1 AND (
          voice_profile_id IN (
            '70000000-0000-4000-9000-000000000102',
            '70000000-0000-4000-9000-000000000103'
          )
          OR (category = 'greeting' AND voice_profile_id IN (
            '70000000-0000-4000-9000-000000000101',
            '70000000-0000-4000-9000-000000000104'
          ))
        )`,
    ],
  },
  {
    // 관리자 편의용 KST 조회 뷰. 저장은 UTC 그대로 두고(만료·보존·빌링·JWT 등
    // 모든 시간 비교 로직의 정합성 유지), 타임스탬프 컬럼이 있는 테이블마다
    // `<table>_kst` 읽기전용 뷰를 만든다. 뷰는 `SELECT *` 로 원본 컬럼을 그대로
    // 노출하면서 각 `_at` 컬럼의 KST(+9h) 버전을 `_at_kst` 로 덧붙인다.
    //   예) SELECT email, created_at, created_at_kst FROM users_kst;
    // 새 _at 컬럼이 추가되면 이 뷰는 자동 반영되지 않으므로 그때 뷰를 다시 만든다.
    id: 46,
    name: 'kst-readonly-views',
    statements: [
      `CREATE VIEW IF NOT EXISTS "alarms_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst FROM "alarms"`,
      `CREATE VIEW IF NOT EXISTS "dub_jobs_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "dub_jobs"`,
      `CREATE VIEW IF NOT EXISTS "email_verification_codes_kst" AS SELECT *, datetime("expires_at",'+9 hours') AS expires_at_kst, datetime("consumed_at",'+9 hours') AS consumed_at_kst, datetime("created_at",'+9 hours') AS created_at_kst FROM "email_verification_codes"`,
      `CREATE VIEW IF NOT EXISTS "friendships_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "friendships"`,
      `CREATE VIEW IF NOT EXISTS "generated_audio_assets_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "generated_audio_assets"`,
      `CREATE VIEW IF NOT EXISTS "gifts_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "gifts"`,
      `CREATE VIEW IF NOT EXISTS "message_library_kst" AS SELECT *, datetime("received_at",'+9 hours') AS received_at_kst FROM "message_library"`,
      `CREATE VIEW IF NOT EXISTS "messages_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "messages"`,
      `CREATE VIEW IF NOT EXISTS "notes_kst" AS SELECT *, datetime("read_at",'+9 hours') AS read_at_kst, datetime("created_at",'+9 hours') AS created_at_kst FROM "notes"`,
      `CREATE VIEW IF NOT EXISTS "pending_external_deletions_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "pending_external_deletions"`,
      `CREATE VIEW IF NOT EXISTS "plan_group_invites_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("expires_at",'+9 hours') AS expires_at_kst, datetime("used_at",'+9 hours') AS used_at_kst FROM "plan_group_invites"`,
      `CREATE VIEW IF NOT EXISTS "plan_group_members_kst" AS SELECT *, datetime("joined_at",'+9 hours') AS joined_at_kst FROM "plan_group_members"`,
      `CREATE VIEW IF NOT EXISTS "plan_groups_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst FROM "plan_groups"`,
      `CREATE VIEW IF NOT EXISTS "plans_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "plans"`,
      `CREATE VIEW IF NOT EXISTS "push_tokens_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst FROM "push_tokens"`,
      `CREATE VIEW IF NOT EXISTS "retained_billing_records_kst" AS SELECT *, datetime("starts_at",'+9 hours') AS starts_at_kst, datetime("expires_at",'+9 hours') AS expires_at_kst, datetime("created_at",'+9 hours') AS created_at_kst FROM "retained_billing_records"`,
      `CREATE VIEW IF NOT EXISTS "store_transactions_kst" AS SELECT *, datetime("expires_at",'+9 hours') AS expires_at_kst, datetime("created_at",'+9 hours') AS created_at_kst FROM "store_transactions"`,
      `CREATE VIEW IF NOT EXISTS "subscriptions_kst" AS SELECT *, datetime("starts_at",'+9 hours') AS starts_at_kst, datetime("expires_at",'+9 hours') AS expires_at_kst, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst, datetime("canceled_at",'+9 hours') AS canceled_at_kst FROM "subscriptions"`,
      `CREATE VIEW IF NOT EXISTS "tts_presets_kst" AS SELECT *, datetime("updated_at",'+9 hours') AS updated_at_kst FROM "tts_presets"`,
      `CREATE VIEW IF NOT EXISTS "user_consents_kst" AS SELECT *, datetime("agreed_at",'+9 hours') AS agreed_at_kst, datetime("created_at",'+9 hours') AS created_at_kst FROM "user_consents"`,
      `CREATE VIEW IF NOT EXISTS "users_kst" AS SELECT *, datetime("daily_tts_reset_at",'+9 hours') AS daily_tts_reset_at_kst, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst, datetime("last_active_at",'+9 hours') AS last_active_at_kst, datetime("deletion_requested_at",'+9 hours') AS deletion_requested_at_kst, datetime("deletion_purge_at",'+9 hours') AS deletion_purge_at_kst FROM "users"`,
      `CREATE VIEW IF NOT EXISTS "voice_profile_relationships_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst FROM "voice_profile_relationships"`,
      `CREATE VIEW IF NOT EXISTS "voice_profiles_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst, datetime("deleted_at",'+9 hours') AS deleted_at_kst FROM "voice_profiles"`,
      `CREATE VIEW IF NOT EXISTS "voice_speakers_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "voice_speakers"`,
      `CREATE VIEW IF NOT EXISTS "voice_uploads_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst FROM "voice_uploads"`,
      `CREATE VIEW IF NOT EXISTS "voucher_codes_kst" AS SELECT *, datetime("issued_at",'+9 hours') AS issued_at_kst, datetime("used_at",'+9 hours') AS used_at_kst, datetime("expires_at",'+9 hours') AS expires_at_kst FROM "voucher_codes"`,
      `CREATE VIEW IF NOT EXISTS "voucher_redemptions_kst" AS SELECT *, datetime("redeemed_at",'+9 hours') AS redeemed_at_kst FROM "voucher_redemptions"`,
    ],
  },
  {
    // 아담(101) 인사말(greeting) 문구 교체 — 옛 "샤갈!" 멘트를 무효화한다.
    //  - VOICE_GREETING_OVERRIDES 의 아담 문구를 바꿨으므로, 옛 문구로 합성돼 있던
    //    greeting 스톡 클립을 지워 다음 seed 때 새 문구로 재생성되게 한다 (#45 와 동일 패턴).
    //  - findMissingStockTargets 가 (voice_profile_id|category|language) 로만 존재 여부를
    //    보기 때문에, 행을 지워야 새 문구로 다시 만들어진다.
    //  - 배포 후 POST /api/admin/seed-stock-clips 로 재생성한다 (reset 불필요 — 여기서 무효화됨).
    //  - 이 greeting 을 참조하던 알람은 sound-only 로 떼어낸다.
    id: 47,
    name: 'refresh-adam-greeting-clip',
    statements: [
      `UPDATE alarms
        SET mode = 'sound-only', wake_mode = 'sound_then_voice',
            message_id = NULL, voice_profile_id = NULL, speaker_id = NULL,
            raw_audio_url = NULL, raw_audio_duration_ms = NULL
        WHERE message_id IN (
          SELECT id FROM messages
          WHERE COALESCE(is_preset, 0) = 1 AND category = 'greeting'
            AND voice_profile_id = '70000000-0000-4000-9000-000000000101'
        )`,
      `DELETE FROM message_library WHERE message_id IN (
        SELECT id FROM messages
        WHERE COALESCE(is_preset, 0) = 1 AND category = 'greeting'
          AND voice_profile_id = '70000000-0000-4000-9000-000000000101'
      )`,
      `DELETE FROM generated_audio_assets WHERE message_id IN (
        SELECT id FROM messages
        WHERE COALESCE(is_preset, 0) = 1 AND category = 'greeting'
          AND voice_profile_id = '70000000-0000-4000-9000-000000000101'
      )`,
      `DELETE FROM messages
        WHERE COALESCE(is_preset, 0) = 1 AND category = 'greeting'
          AND voice_profile_id = '70000000-0000-4000-9000-000000000101'`,
    ],
  },
  {
    // raw-alarms 업로드 추적: POST /alarm/source 로 올린 직접 재생용 클립은 지금까지
    // DB 에 기록되지 않아, 사용자가 알람에 연결하지 않고 흐름을 이탈하면 R2 에서
    // 영구 고아로 남았다(TTL/GC 없음 + 계정 삭제로도 정리 안 됨). 업로드 시점에
    // 행을 남겨, 일정 시간 뒤에도 어떤 알람에서도 참조되지 않으면 정리(삭제 큐 적재)한다.
    id: 48,
    name: 'track-raw-alarm-uploads',
    statements: [
      `CREATE TABLE IF NOT EXISTS raw_alarm_uploads (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        object_key TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_alarm_uploads_key
        ON raw_alarm_uploads(object_key)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_alarm_uploads_created
        ON raw_alarm_uploads(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_alarm_uploads_user
        ON raw_alarm_uploads(user_id)`,
    ],
  },
  {
    // 무료 프리셋 멘트 개편(#478 흡수) + 신규 카테고리(약·운동) 추가. tts_presets 초기 시드는
    // INSERT OR IGNORE 라 기존 DB 에 반영되지 않으므로 여기서 upsert 로 강제 갱신/추가한다.
    // 기상·밤 멘트 교체, 약 멘트는 건강에서 분리, 약·운동 신규. (PRESETS 가 단일 진실 공급원)
    id: 49,
    name: 'tts-preset-refresh-and-add-medication-exercise',
    statements: [
      ttsPresetUpsert('morning'),
      ttsPresetUpsert('night'),
      ttsPresetUpsert('health'),
      ttsPresetUpsert('medication'),
      ttsPresetUpsert('exercise'),
    ],
  },
  {
    // 일일 TTS 생성 횟수 제한(하루 N회) 폐지. daily_tts_count / daily_tts_reset_at
    // 컬럼을 더 이상 읽거나 쓰지 않으므로 물리적으로 제거한다. 무료 플랜의 보이스/
    // 프리셋 게이팅(VOICE_FEATURE_REQUIRES_PAID_PLAN / FREE_PLAN_PRESET_ONLY)은
    // 이 컬럼과 무관하게 그대로 유지된다.
    //  - users_kst 뷰가 daily_tts_reset_at 를 참조하므로 먼저 떨군 뒤 DROP COLUMN.
    //    (libSQL/SQLite ≥ 3.35 의 ALTER TABLE DROP COLUMN 사용)
    //  - 컬럼이 이미 없는 DB(컬럼을 만든 적 없는 신규 분기 등)에서 재실행돼도
    //    'no such column'/'no such view' 는 idempotent 로 무시된다.
    //  - 뷰는 daily_tts_reset_at_kst 없이 재생성한다(나머지 _kst 컬럼은 #46 과 동일).
    id: 50,
    name: 'drop-daily-tts-limit-columns',
    statements: [
      `DROP VIEW IF EXISTS "users_kst"`,
      `ALTER TABLE users DROP COLUMN daily_tts_count`,
      `ALTER TABLE users DROP COLUMN daily_tts_reset_at`,
      `CREATE VIEW IF NOT EXISTS "users_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst, datetime("last_active_at",'+9 hours') AS last_active_at_kst, datetime("deletion_requested_at",'+9 hours') AS deletion_requested_at_kst, datetime("deletion_purge_at",'+9 hours') AS deletion_purge_at_kst FROM "users"`,
    ],
  },
  {
    // 토큰 폐기(revocation) / 전 기기 로그아웃 지원 (B5).
    //  - users.token_epoch: 발급된 앱 JWT 의 유효 세대(epoch). 로그아웃(POST /auth/logout)
    //    이나 향후 비밀번호 재설정 시 이 값을 +1 한다. authMiddleware 는 JWT 의 epoch
    //    클레임(기본 0)이 users.token_epoch 보다 작으면 TOKEN_REVOKED(401)로 거부한다.
    //    이로써 탈취·유출된 기존 토큰을 만료 전에도 즉시 무효화할 수 있다.
    id: 51,
    name: 'user-token-epoch',
    statements: [`ALTER TABLE users ADD COLUMN token_epoch INTEGER NOT NULL DEFAULT 0`],
  },
  {
    // 가격정책 + 가족 정원 6→5인. (근거: 루트 PRICING.md)
    //  - personal ₩3,900 / couple ₩6,900 / family ₩14,900 (저가 전환형, 사용량 과금 전제)
    //  - family.max_members 6→5: 신규 가족 그룹부터 5인 정원 (store-billing/billing-mutation 이
    //    plan_groups 생성 시 plan.max_members 를 복사). plan_groups 는 생성 시점 스냅샷이라 이미 만들어진
    //    그룹은 값이 유지되지만, 출시 전 prod DB 초기화 예정이므로 6인 그룹은 실제로 존재하지 않음
    //    (= grandfather 대상 없음). 따라서 /billing/subscription 이 plans.max_members(=5)를 그대로 노출해도
    //    그룹 정원과 어긋나지 않음.
    //  - 가족 초대 바우처 maxUses 는 plannedMaxUses = max(1, max_members-1) 이라 자동 4로 조정.
    id: 52,
    name: 'plan-prices-and-family-5',
    statements: [
      `UPDATE plans SET price_krw = 3900 WHERE key = 'personal'`,
      `UPDATE plans SET price_krw = 6900 WHERE key = 'couple'`,
      `UPDATE plans SET price_krw = 14900, max_members = 5 WHERE key = 'family'`,
    ],
  },
  {
    // 음성 프로필에 화자 성별·어체 격식 신호 추가(동적 알람 문구의 일본어 1인칭/정중 격상용).
    //  - voice_gender TEXT NULL ∈ {'male','female','neutral'}: 일본어 1인칭(僕/俺/私) 등 톤 보정.
    //  - speech_formality TEXT NULL ∈ {'auto','polite'}(null=auto): 'polite'면 캐주얼 관계여도
    //    ja=です·ます, ko=해요체로 격상.
    // additive nullable. 출시 전 prod DB 초기화 예정이라 back-compat 부담 없음.
    id: 53,
    name: 'voice-profile-gender-and-formality',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN voice_gender TEXT`,
      `ALTER TABLE voice_profiles ADD COLUMN speech_formality TEXT`,
    ],
  },
  {
    // 무료 버킷 회전(기상/약): 스톡 클립을 카테고리당 여러 'variant' 로 사전 합성해
    // 앱이 전부 캐시한 뒤 알람마다 순차 회전한다. (옵션 B — 완전 오프라인)
    //  - messages.variant: 같은 (보이스·카테고리·언어) 안에서 문구를 구분/정렬하는 인덱스.
    //    idx_messages_stock 은 애초에 UNIQUE 가 아니므로(일반 인덱스) variant 를 더해
    //    카테고리당 N행 조회·정렬만 빠르게 한다. 기존 프리셋 행은 variant=0 으로 백필된다.
    //  - alarms.bucket_id: 무료 알람이 가리키는 버킷(예: 'morning'·'medication'). message_id 는
    //    대표(변형0) 클립을 그대로 유지해, 회전을 모르는 경로/구버전에선 단일 재생 폴백이 된다.
    id: 54,
    name: 'stock-clip-variants-and-alarm-bucket',
    statements: [
      `ALTER TABLE messages ADD COLUMN variant INTEGER NOT NULL DEFAULT 0`,
      `DROP INDEX IF EXISTS idx_messages_stock`,
      `CREATE INDEX IF NOT EXISTS idx_messages_stock
        ON messages(is_preset, voice_profile_id, category, language, variant)`,
      `ALTER TABLE alarms ADD COLUMN bucket_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_alarms_bucket ON alarms(bucket_id)`,
    ],
  },
  {
    // 공용 프로모 쿠폰(관리자 발급). 기존 개인 코드(invite/gift = voucher_codes)와 별개.
    //  - promo_codes: 관리자가 임의 코드 문자열을 만들어 특정 플랜을 duration_days 만큼 부여.
    //    등록 가능 유효창(valid_from~valid_until)·총 사용 상한(max_redemptions)·활성 토글.
    //    code 는 대소문자 무시(NOCASE) UNIQUE.
    //  - promo_code_redemptions: 사용자당 1회(UNIQUE) + 총 사용량 원자 집계.
    id: 55,
    name: 'promo-codes',
    statements: [
      `CREATE TABLE IF NOT EXISTS promo_codes (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        duration_days INTEGER NOT NULL,
        valid_from TEXT,
        valid_until TEXT,
        max_redemptions INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code COLLATE NOCASE)`,
      `CREATE TABLE IF NOT EXISTS promo_code_redemptions (
        id TEXT PRIMARY KEY,
        promo_code_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        subscription_id TEXT,
        redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_redemptions_unique
        ON promo_code_redemptions(promo_code_id, user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code
        ON promo_code_redemptions(promo_code_id)`,
    ],
  },
  {
    // 가족 알람 '그만받기'(수신자 opt-out). 수신자(target_user_id)가 자기에게 온 반복 알람을
    // 서버에 영구 opt-out 한다. 생성자 소유의 alarms 행/is_active 는 건드리지 않는 비파괴 모델이며,
    // 읽기 경로(list·tick·cron)가 이 상태로 수신자별 배달을 차단한다. 로컬 삭제와 달리
    // 재설치·동기화로 부활하지 않는다(감사 A-1/A-2/A-3 봉합).
    id: 56,
    name: 'alarm-recipient-state',
    statements: [
      `CREATE TABLE IF NOT EXISTS alarm_recipient_state (
        alarm_id TEXT NOT NULL,
        recipient_user_id TEXT NOT NULL,
        declined INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (alarm_id, recipient_user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_alarm_recipient_state_recipient
        ON alarm_recipient_state(recipient_user_id)`,
    ],
  },
  {
    id: 57,
    name: 'voice-profile-monthly-change-ledger',
    statements: [
      `CREATE TABLE IF NOT EXISTS voice_profile_change_ledger (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        voice_profile_id TEXT,
        change_month TEXT NOT NULL,
        change_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','succeeded','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_profile_change_ledger_monthly
        ON voice_profile_change_ledger(owner_user_id, change_month, change_type)
        WHERE status != 'failed'`,
      `CREATE INDEX IF NOT EXISTS idx_voice_profile_change_ledger_profile
        ON voice_profile_change_ledger(voice_profile_id)`,
      `INSERT OR IGNORE INTO voice_profile_change_ledger
        (id, owner_user_id, voice_profile_id, change_month, change_type, status, created_at, updated_at)
        SELECT
          'seed:' || COALESCE(u.id, vp.user_id) || ':' || strftime('%Y-%m', datetime(vp.created_at, '+9 hours')) || ':official_voice',
          COALESCE(u.id, vp.user_id),
          MIN(vp.id),
          strftime('%Y-%m', datetime(vp.created_at, '+9 hours')),
          'official_voice',
          'succeeded',
          MIN(vp.created_at),
          datetime('now')
        FROM voice_profiles vp
        LEFT JOIN users u ON u.id = vp.user_id OR u.google_id = vp.user_id
        WHERE COALESCE(vp.is_draft, 0) = 0
          AND COALESCE(vp.status, 'ready') != 'failed'
          AND vp.created_at IS NOT NULL
        GROUP BY COALESCE(u.id, vp.user_id), strftime('%Y-%m', datetime(vp.created_at, '+9 hours'))`,
    ],
  },
  {
    // 직접 입력(사용자 타이핑) TTS 생성의 월 카운터. 유료 플랜만 소비하며 한도는
    // personal 30 / couple 50 / family 100 (manual-tts-quota.ts). couple/family 는
    // pool_key = plan_group_id 로 멤버 전원이 한 풀을 공유, personal 은 pool_key = 본인 PK.
    //  - used_count 를 원자적 upsert(ON CONFLICT DO UPDATE ... WHERE used_count < limit)로
    //    증가시켜 경합 없이 한도를 강제한다. 월(KST) 경계가 바뀌면 새 행이 생겨 자동 리셋.
    id: 58,
    name: 'manual-tts-monthly-usage',
    statements: [
      `CREATE TABLE IF NOT EXISTS manual_tts_usage (
        pool_key TEXT NOT NULL,
        usage_month TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (pool_key, usage_month)
      )`,
    ],
  },
  {
    // 유료 클론 목소리 preset 사전렌더 큐. 유료 구독자가 목소리를 확정(등록/승격)하면
    // 훅에서 INSERT OR IGNORE 로 1행 적재하고, cron(scheduled)이 status='pending' 을 소량씩
    // 드레인해 그 목소리 말투로 카테고리 클립을 생성한다(stock-clips.ts). voice_profile_id 를
    // PK 로 둬 재확정/중복 트리거가 있어도 큐가 1행으로 멱등하다. language 는 확정 시점의 앱
    // 언어 1개를 담아 cron 이 그 언어로만 렌더하도록 한다(3개국어 곱연산 비용 회피).
    id: 59,
    name: 'voice-prerender-queue',
    statements: [
      `CREATE TABLE IF NOT EXISTS voice_prerender_queue (
        voice_profile_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'ko',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        requested_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_voice_prerender_queue_pending
        ON voice_prerender_queue(status, requested_at)`,
    ],
  },
  {
    id: 60,
    name: 'voice-prerender-claim-lease',
    statements: [`ALTER TABLE voice_prerender_queue ADD COLUMN claimed_at TEXT`],
  },
  {
    id: 61,
    name: 'voice-prerender-claim-token',
    statements: [`ALTER TABLE voice_prerender_queue ADD COLUMN claim_token TEXT`],
  },
  {
    // 초안 생성은 외부 음성 제공자 슬롯/비용을 즉시 사용한다. 삭제-재생성으로 공식 월 1회
    // 장부를 우회하지 못하도록, 공식 등록 장부와 별개로 KST 월 3회 제공자 시도를 원자적으로 센다.
    // previewed_at 은 서버가 실제 미리듣기 오디오를 반환한 뒤에만 기록하며 승격의 전제조건이다.
    id: 62,
    name: 'voice-draft-attempt-and-preview',
    statements: [
      `CREATE TABLE IF NOT EXISTS voice_draft_attempt_usage (
        owner_user_id TEXT NOT NULL,
        attempt_month TEXT NOT NULL,
        used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (owner_user_id, attempt_month)
      )`,
      `ALTER TABLE voice_profiles ADD COLUMN previewed_at TEXT`,
      `ALTER TABLE voice_profiles ADD COLUMN preview_claimed_at TEXT`,
      `ALTER TABLE voice_profiles ADD COLUMN preview_claim_token TEXT`,
      `ALTER TABLE voice_profiles ADD COLUMN preview_language TEXT NOT NULL DEFAULT 'ko'`,
    ],
  },
  {
    id: 63,
    name: 'push-tokens-token-index',
    statements: [
      // /push/register 의 재배정 삭제(WHERE token = ? AND user_id != ?)와 /push/unregister(WHERE token = ?)
      // 는 token 으로 조회·삭제한다. 기존 인덱스(idx_push_tokens_user=user_id, idx_push_tokens_unique=
      // (user_id, token))는 모두 user_id 선행이라 token 단독 predicate 에 안 걸려, 앱 시작/로그인마다
      // 호출되는 등록이 push_tokens full scan 으로 저하될 수 있다 → token 선행 인덱스로 방지.
      'CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token)',
    ],
  },
  {
    id: 64,
    name: 'requeue-clone-prerender-for-weather-unknown-clip',
    statements: [
      // 날씨 버킷에 '미해결 안내' 클립(variant 8)이 추가돼, 이 배포 전 이미 렌더된(status='done') 클론
      // 목소리는 weather 클립이 8개라 클라 hasCompleteCloneBucket(=9)에 미달해 오프라인 버킷이 안 붙는다.
      // 스케줄 cron 은 voice_prerender_queue 의 'pending' 만 처리하므로(완료 목소리는 재스캔 안 함), 완료
      // 클론 목소리를 requeue 해 다음 cron 이 findMissingStockTargets 로 '빠진 variant 8 만' 채우게 한다
      // (기존 8개는 messages 에 있어 'seen' 이라 스킵). 신규 launch DB 는 done 행이 없어 무해(no-op).
      `UPDATE voice_prerender_queue
         SET status = 'pending', claimed_at = NULL, claim_token = NULL, attempts = 0,
             updated_at = datetime('now')
       WHERE status = 'done'`,
    ],
  },
  {
    id: 65,
    name: 'voice-draft-preview-text',
    statements: [
      // 등록 미리듣기의 관계·호칭 톤 적응 문구는 요청마다 달라질 수 있어, 첫 생성분을 draft 행에
      // 영속해 재생(replay)을 결정적으로 만든다(같은 문구 → 같은 캐시키 → previewed_at 이후 재생이
      // 캐시 히트로 성립). 관계/호칭 수정 시 previewed_at 과 함께 리셋해 새 문구로 재생성한다.
      `ALTER TABLE voice_profiles ADD COLUMN preview_text TEXT`,
      `ALTER TABLE voice_profiles ADD COLUMN preview_tag TEXT`,
    ],
  },
  {
    id: 66,
    name: 'voice-speech-style',
    statements: [
      // 클론 등록 녹음 전사에서 분석한 화자 말투(사투리 지역·강도·격식·특징 어미) JSON.
      // 미리듣기·사전렌더 문구 생성 프롬프트에 주입돼 그 사람 말투로 문구가 나오게 한다.
      `ALTER TABLE voice_profiles ADD COLUMN speech_style TEXT`,
    ],
  },
  {
    // 구독 해지와 음성 삭제를 분리한다: 해지/만료 시 유료 음성을 즉시 하드삭제하지 않고
    // 30일 보관 유예를 기록, cron 이 delete_after 경과분만 정리한다. 재구독 시 행을 지워
    // 보존하고, '지금 삭제'는 이 유예와 무관하게 즉시 삭제한다.
    id: 67,
    name: 'paid-voice-retention',
    statements: [
      `CREATE TABLE IF NOT EXISTS paid_voice_retention (
        user_id TEXT PRIMARY KEY,
        delete_after TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
  {
    // 말투 분석(전사→Vertex)의 결과 상태. best-effort 로 조용히 삼키던 실패를 클라에
    // 노출하고 재시도할 수 있게 한다. NULL=분석 대상 아님(구버전/시스템), pending=진행중,
    // done=완료, failed=실패(재시도 가능).
    id: 68,
    name: 'voice-speech-style-status',
    statements: [`ALTER TABLE voice_profiles ADD COLUMN speech_style_status TEXT`],
  },
  {
    // 말투 분석 재시도의 소스를 클론 등록 원본과 정확히 연결한다. 클론 등록 시 원본
    // 녹음을 R2+voice_uploads 에 남기고 이 컬럼으로 프로필에 묶어, 재시도가 '사용자
    // 최신 업로드'(가족알람 녹음 등 무관한 파일일 수 있음) 대신 등록 원본만 쓰게 한다.
    id: 69,
    name: 'voice-uploads-profile-link',
    statements: [`ALTER TABLE voice_uploads ADD COLUMN voice_profile_id TEXT`],
  },
  {
    // 스톡 클립 대사 전면 교체(2026-07-19 확정: 날씨/약 새 문구 + greeting 4보이스 공통·3언어)에
    // 맞춰, 확정 리터럴과 문구가 '다른' 시스템 preset 행만 무효화한다(#47 과 동일 패턴의 수렴형).
    //  - findMissingStockTargets 는 (voice|category|language|variant) 존재만 보므로, 낡은 행을
    //    지워야 다음 seed(POST /api/admin/seed-stock-clips, reset 불필요)가 새 문구로 채운다.
    //  - 2026-07-19 에 로컬 시딩으로 이미 새 문구가 들어간 DB(dev/prod)에서는 문구가 전부
    //    일치하므로 0행 no-op — 승인된 실오디오를 지우지 않는다.
    //  - 낡은 클립을 참조하던 알람은 sound-only 로 떼어낸다. R2 오브젝트는 #47 과 마찬가지로
    //    여기서 지우지 않는다(마이그레이션은 DB 전용; 소량 누수는 출시 전 prod 초기화로 정리).
    id: 70,
    name: 'refresh-stock-clips-2026-07-19-script',
    statements: [
      `UPDATE alarms
        SET mode = 'sound-only', wake_mode = 'sound_then_voice',
            message_id = NULL, voice_profile_id = NULL, speaker_id = NULL,
            raw_audio_url = NULL, raw_audio_duration_ms = NULL
        WHERE message_id IN (${STALE_STOCK_PRESET_SUBQUERY_2026_07_19})`,
      `DELETE FROM message_library
        WHERE message_id IN (${STALE_STOCK_PRESET_SUBQUERY_2026_07_19})`,
      `DELETE FROM generated_audio_assets
        WHERE message_id IN (${STALE_STOCK_PRESET_SUBQUERY_2026_07_19})`,
      `DELETE FROM messages
        WHERE id IN (${STALE_STOCK_PRESET_SUBQUERY_2026_07_19})`,
    ],
  },
  {
    // /push/register 의 비트랜잭션 'DELETE 타소유자 → UPSERT(user_id, token)' 2문장은 같은 기기의
    // 빠른 계정 전환에서 두 세션의 등록이 인터리빙되면 한 token 에 소유자 2행이 남아 가족알람
    // push 가 두 계정 모두에게 가는 레이스가 있었다(Codex #567 P1). 라우트는 쓰기 트랜잭션으로
    // 원자화했고(push.ts), 여기서 token 전역 UNIQUE 를 더해 DB 수준 불변식으로 이중 방어한다.
    // 기존 중복은 최신 행만 남긴다.
    //
    // 원자성 노트(Codex #570): runMigrations 는 문장을 개별 실행하므로 dedupe→CREATE 사이가
    // 완전 원자는 아니다. 대신 (1) 배포가 먼저 나가는 새 라우트는 트랜잭션 재배정이라 신규
    // 중복을 만들 수 없고(옛 코드 in-flight 는 배포 후 수초 내 소진, 마이그레이션은 그 뒤 실행),
    // (2) dedupe 를 CREATE 바로 앞에 붙여 갭을 한 문장 경계로 최소화했으며, (3) 세 문장 모두
    // 멱등이라 혹시 CREATE 가 UNIQUE 위반으로 실패해도 다음 migrate 재실행에서 수렴한다.
    id: 71,
    name: 'push-tokens-global-unique-token',
    statements: [
      // #63 의 비유니크 token 인덱스를 유니크로 교체(이름 유지). CREATE ... IF NOT EXISTS 는
      // '이름' 존재만 보므로 반드시 DROP 후 CREATE — 안 그러면 비유니크 인덱스가 그대로 남는다.
      'DROP INDEX IF EXISTS idx_push_tokens_token',
      // 타이브레이커는 rowid(삽입 순서 근사) — 레이스로 남은 중복은 대부분 같은 초에 찍혀
      // updated_at/created_at 이 동률인데, UUID(id) 비교는 삽입 순서와 무관해 이른 소유자가
      // 남을 수 있다. rowid 가 크면 나중 INSERT = 마지막 등록이 승자.
      `DELETE FROM push_tokens WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY token ORDER BY updated_at DESC, created_at DESC, rowid DESC
          ) AS rn FROM push_tokens
        ) WHERE rn = 1
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token)',
    ],
  },
  {
    // 웰컴 프로모 3종(개인/커플/가족, 각 30일). '웰컴 계열 전체에서 계정당 1회' 규칙을 위해
    // promo_codes.redemption_group 을 추가한다 — 같은 group 의 어떤 코드든 한 번 사용한 계정은
    // 그 group 의 다른 코드를 다시 사용할 수 없다(집행은 promo-redemption.ts 원자 claim).
    // group 이 NULL 인 기존/일반 코드는 코드별 1회 규칙만 그대로 적용된다.
    id: 72,
    name: 'promo-welcome-codes-redemption-group',
    statements: [
      `ALTER TABLE promo_codes ADD COLUMN redemption_group TEXT`,
      // 시드는 코드 문자열(UNIQUE NOCASE) 기준 멱등 — 이미 있으면 건드리지 않는다(운영자가
      // admin 에서 상한/유효창을 조정했어도 재실행이 덮어쓰지 않음).
      `INSERT OR IGNORE INTO promo_codes
         (id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions, is_active, note, redemption_group)
       SELECT '90000000-0000-4000-9000-000000000001', 'WELCOME_PERSONAL', id, 30, NULL, NULL, NULL, 1,
              '웰컴 프로모 — 퍼스널 1개월 (웰컴 계열 계정당 1회)', 'welcome'
       FROM plans WHERE key = 'personal'`,
      `INSERT OR IGNORE INTO promo_codes
         (id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions, is_active, note, redemption_group)
       SELECT '90000000-0000-4000-9000-000000000002', 'WELCOME_COUPLE', id, 30, NULL, NULL, NULL, 1,
              '웰컴 프로모 — 커플 1개월 (웰컴 계열 계정당 1회)', 'welcome'
       FROM plans WHERE key = 'couple'`,
      `INSERT OR IGNORE INTO promo_codes
         (id, code, plan_id, duration_days, valid_from, valid_until, max_redemptions, is_active, note, redemption_group)
       SELECT '90000000-0000-4000-9000-000000000003', 'WELCOME_FAMILY', id, 30, NULL, NULL, NULL, 1,
              '웰컴 프로모 — 패밀리 1개월 (웰컴 계열 계정당 1회)', 'welcome'
       FROM plans WHERE key = 'family'`,
    ],
  },
  {
    // #72 의 INSERT OR IGNORE 는 운영자가 그 전에 같은 이름(대소문자 무관)의 코드를 이미
    // 발급해뒀으면 그 행을 건드리지 않아 redemption_group 이 NULL 로 남는다 — 그 코드만
    // 웰컴 1회 규칙에서 빠진다. 이름 충돌 행에 그룹을 스탬프해 수렴시킨다(기간·상한 등
    // 운영자 설정은 존중). #72 를 고치지 않고 별도 마이그레이션으로 두는 이유: #72 는 이미
    // 적용된 DB(원장 기록)가 있어 본문을 바꿔도 재실행되지 않는다 — 백필은 새 id 로 돌린다.
    id: 73,
    name: 'promo-welcome-group-backfill',
    statements: [
      `UPDATE promo_codes SET redemption_group = 'welcome', updated_at = datetime('now')
       WHERE code COLLATE NOCASE IN ('WELCOME_PERSONAL', 'WELCOME_COUPLE', 'WELCOME_FAMILY')
         AND redemption_group IS NULL`,
    ],
  },
  {
    // 웰컴 3종 등록기한: 2026-08-31(KST)까지 — 2026-08-31T15:00:00Z = 2026-09-01 00:00 KST 부터
    // 등록 불가(valid_until 은 배타 비교: datetime(valid_until) > datetime('now') 일 때만 허용).
    // #72 시드는 이미 dev 에 적용돼 본문을 바꿀 수 없으므로(불변) 별도 스탬프로 수렴한다.
    // valid_until IS NULL 조건: 운영자가 이후 admin 에서 기한을 조정했다면 존중한다.
    id: 74,
    name: 'promo-welcome-deadline-2026-08-31',
    statements: [
      `UPDATE promo_codes SET valid_until = '2026-08-31T15:00:00Z', updated_at = datetime('now')
       WHERE code COLLATE NOCASE IN ('WELCOME_PERSONAL', 'WELCOME_COUPLE', 'WELCOME_FAMILY')
         AND valid_until IS NULL`,
    ],
  },
  {
    // 전역 클론 슬롯 상한(공급자 보이스 최대 개수) + LRU 제거를 위한 컬럼 2종.
    //  - last_used_at: LRU 선정 기준인 '마지막 사용' 시각. updated_at 은 status 전환·프리뷰
    //    클레임·공유 토글 등 사용과 무관한 쓰기마다 갱신돼 LRU 신호로 부적합 → 전용 컬럼.
    //    TTS 합성 성공·캐시 히트·사전렌더 enqueue 시점에 갱신한다(voice-mutation/tts).
    //  - evicted_at: 상한 초과로 공급자(ElevenLabs) 보이스만 회수하고 우리 DB row + R2 원본은
    //    보존한 '슬롯 반납' 마커. 이 행은 elevenlabs_voice_id=NULL 이지만 deleted_at 은 NULL 을
    //    유지한다 — 그래야 TTL 스윕(audio-retention)이 원본을 계속 보존하고, 재요청 시 원본으로
    //    자동 재클론(F3)이 가능하다. 실제 삭제(deleted_at 세팅)와는 명확히 구분된다.
    //  - idx_voice_profiles_lru: 상한 초과 시 LRU 1건 선정(ORDER BY last_used_at, created_at) 가속.
    id: 75,
    name: 'voice-profiles-lru-eviction',
    statements: [
      `ALTER TABLE voice_profiles ADD COLUMN last_used_at TEXT`,
      `ALTER TABLE voice_profiles ADD COLUMN evicted_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_voice_profiles_lru
         ON voice_profiles (last_used_at, created_at)`,
    ],
  },
  {
    // F1/F3(Codex #602): evict 직전의 provider 보이스 id 를 보관한다 — TTS 캐시 키가 provider
    // voice id 를 포함하므로, evict된 프로필도 이 값으로 기존 생성 오디오 캐시를 프로브해
    // 히트 시 재클론 없이 서빙할 수 있다(불필요한 외부 등록·연쇄 eviction 방지).
    id: 76,
    name: 'voice-profiles-evicted-provider-voice-id',
    statements: [`ALTER TABLE voice_profiles ADD COLUMN evicted_provider_voice_id TEXT`],
  },
  {
    // 출시 전 제거된 캐릭터/성장 기능의 잔재 테이블 정리. characters.user_id 가
    // users FK 로 남아 있어 계정 영구파기(account purge)가 FOREIGN KEY constraint 로
    // 실패하고 있었다(파기 cron 이 매 틱 실패 반복). 자식(FK→characters)부터 지운다.
    id: 77,
    name: 'drop-removed-character-tables',
    statements: [
      `DROP TABLE IF EXISTS character_xp_logs`,
      `DROP TABLE IF EXISTS character_stats`,
      `DROP TABLE IF EXISTS streak_achievements`,
      `DROP TABLE IF EXISTS characters`,
    ],
  },
  {
    // 웰컴 프로모 시드 폐기 — 실운영 프로모 코드명은 공개 레포 소스에 두지 않는다.
    // 코드 발급/관리는 /admin/promo 콘솔(운영 데이터)로만 한다(redemption_group 지정 가능).
    // #72 시드는 이미 적용된 원장(불변)이라 본문을 고칠 수 없으므로, 새 DB 재구축 시
    // #72 가 심는 구이름 3종을 여기서 걷어낸다. 운영 DB 처럼 이미 다른 이름으로 바꿔
    // 운영 중인 행(구이름 불일치)은 건드리지 않는다.
    id: 78,
    name: 'promo-welcome-retire-seeded-codes',
    statements: [
      // 리딤 이력이 없는 시드 행은 제거(신규 DB 경로). 이력이 있으면 웰컴 1회 규칙이
      // promo_code_id 조인으로 이어지므로 행을 지우지 않고 아래에서 비활성화만 한다.
      `DELETE FROM promo_codes
       WHERE code COLLATE NOCASE IN ('WELCOME_PERSONAL', 'WELCOME_COUPLE', 'WELCOME_FAMILY')
         AND id NOT IN (SELECT promo_code_id FROM promo_code_redemptions)`,
      `UPDATE promo_codes SET is_active = 0, updated_at = datetime('now')
       WHERE code COLLATE NOCASE IN ('WELCOME_PERSONAL', 'WELCOME_COUPLE', 'WELCOME_FAMILY')`,
    ],
  },
  {
    // 사장(死藏) 스키마 일괄 정리 (2026-07 감사).
    //  - notes(#18)·voice_speakers(#4): 기능 제거 후 INSERT 경로가 사라져 영구 공백 —
    //    friendships·gifts(#1): /friend·/gift 라우트가 클라 미호출 유령 기능이라 라우트째
    //    삭제. dub_jobs(#3): 더빙 파이프라인 미완성(처리기 전무·클라 미호출)이라 스텁 제거.
    //    인덱스는 DROP TABLE 이 함께 지우지만 _kst 뷰(#46)는 아니므로 명시 DROP.
    //  - users.picture: 구글 프로필 사진 URL 을 저장·서빙했지만 소비 UI 가 없다(미사용 PII).
    //  - users.last_active_at: 유일한 갱신 지점이 죽은 GET /user/me 라 한 번도 기록된 적
    //    없는 컬럼. 라우트와 함께 제거.
    //  - users_kst 뷰가 last_active_at 를 명시 참조하므로 #50 전례대로 뷰를 떨군 뒤
    //    DROP COLUMN 하고 해당 _kst 컬럼 없이 재생성한다. 재실행 시 'no such column'/
    //    'no such view' 는 idempotent 로 무시된다.
    //  - 캐릭터 _kst 뷰 4종(character_stats_kst 등)도 함께 DROP: #77 이 캐릭터 테이블만
    //    지우고 이 뷰들을 남겨 깨진(dangling) 뷰가 됐는데, libSQL(Turso)의 ALTER TABLE
    //    DROP COLUMN 은 전체 스키마의 모든 뷰를 검증하다 이 깨진 뷰('no such table:
    //    character_stats')에 걸려 실패한다(로컬 libsql 은 관대해 통과). ALTER 전에 정리.
    id: 79,
    name: 'drop-dead-social-tables-and-user-columns',
    statements: [
      `DROP VIEW IF EXISTS "character_stats_kst"`,
      `DROP VIEW IF EXISTS "character_xp_logs_kst"`,
      `DROP VIEW IF EXISTS "characters_kst"`,
      `DROP VIEW IF EXISTS "streak_achievements_kst"`,
      `DROP VIEW IF EXISTS "notes_kst"`,
      `DROP VIEW IF EXISTS "voice_speakers_kst"`,
      `DROP VIEW IF EXISTS "friendships_kst"`,
      `DROP VIEW IF EXISTS "gifts_kst"`,
      `DROP VIEW IF EXISTS "dub_jobs_kst"`,
      `DROP TABLE IF EXISTS notes`,
      `DROP TABLE IF EXISTS voice_speakers`,
      `DROP TABLE IF EXISTS friendships`,
      `DROP TABLE IF EXISTS gifts`,
      `DROP TABLE IF EXISTS dub_jobs`,
      `DROP VIEW IF EXISTS "users_kst"`,
      `ALTER TABLE users DROP COLUMN picture`,
      `ALTER TABLE users DROP COLUMN last_active_at`,
      `CREATE VIEW IF NOT EXISTS "users_kst" AS SELECT *, datetime("created_at",'+9 hours') AS created_at_kst, datetime("updated_at",'+9 hours') AS updated_at_kst, datetime("deletion_requested_at",'+9 hours') AS deletion_requested_at_kst, datetime("deletion_purge_at",'+9 hours') AS deletion_purge_at_kst FROM "users"`,
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
    lower.includes('no such index') ||
    // DROP COLUMN/VIEW 재실행 시(이미 제거된 컬럼/뷰) — 마이그레이션 #50.
    lower.includes('no such column') ||
    lower.includes('no such view')
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

    // 마이그레이션 #5 와 #17 처럼 동일 컬럼(alarms.voice_profile_id)을
    // 중복 ALTER 하는 케이스가 있으므로, idempotent DDL 에러는 무시한다.
    // runMigrationsRange 와 동일한 정책을 적용해 두 진입점이 동일하게 동작.
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
