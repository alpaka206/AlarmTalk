// **탈퇴 파기 뒤 DB 에 무엇이 남는가** — 실제 SQLite(메모리)에 마이그레이션을 전부 돌리고
// 계정 하나를 모든 사용자별 표에 심은 다음, 운영과 같은 순서로 파기한다
// (`pseudonymizeBillingForRetention` → `purgeUserAccount`, 한 쓰기 트랜잭션).
//
// 처리방침(`docs/legal/privacy-policy.ko.md` 3장)의 약속은 "유예 기간이 지나면 서버 데이터를
// 영구 삭제한다. 다만 법정 보존 결제 기록은 **가명처리해 분리 보관**한다" 이다. 그래서 이
// 파일은 두 가지를 본다.
//  1. **직접 식별자**(계정 id·로그인 id·이메일·애플 id·푸시 토큰·이름)가 남은 행 어디에도 없다.
//     예외는 외부 삭제 큐(`pending_external_deletions`) 하나다 — R2 키가 `voices/<id>/…` 처럼
//     사람 id 로 시작하는데, 그 행은 **지울 파일의 주소**이고 크론이 지우는 순간 사라진다.
//  2. 남은 행이 가리키는 옛 id(내 목소리·알람·결제)는 **더는 풀리지 않는다** — 그 id 의
//     주인 행이 전부 없어졌다. 가명 보존 기록은 pepper 없이는 계정 id 로 되짚을 수 없다.
//
// ⚠ 원래 잡은 잔존물(2026-09-30) — `manual_tts_usage`(직접 입력 월 한도 장부). 개인 풀의 키가
// **계정 id 그대로**라, 파기 뒤에도 사람 id 가 남았다. 가명 보존 기록의 pseudonym 은
// SHA-256(id:pepper) 라, 서버가 가진 pepper 로 이 id 에서 곧장 보존 기록(스토어 거래 id)까지
// 이어진다 — 분리 보관이 무너진다.
//
// ⚠ **표가 새로 생기면 이 파일이 먼저 깨진다**(`TABLES`). 사용자 데이터가 들어가는 표라면
// 여기 심고, 파기(`lib/account-deletion.ts`)가 지우게 만든 뒤 분류할 것.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client, type InValue } from '@libsql/client';
import { runMigrations } from '../src/lib/migrations';
import { withWriteTransaction } from '../src/lib/transactions';
import {
  purgeUserAccount,
  pseudonymizeBillingForRetention,
  type AccountPurgeNotifications,
} from '../src/lib/account-deletion';

/** 표마다 파기에서 어떤 대접을 받는가. 새 표는 여기서 분류해야 테스트가 통과한다. */
const TABLES: Record<string, 'per-user' | 'no-personal-data' | 'retained-pseudonymized' | 'deletion-queue'> = {
  users: 'per-user',
  alarms: 'per-user',
  messages: 'per-user',
  message_library: 'per-user',
  generated_audio_assets: 'per-user',
  voice_profiles: 'per-user',
  voice_uploads: 'per-user',
  voice_prerender_queue: 'per-user',
  voice_draft_attempt_usage: 'per-user',
  voice_profile_change_ledger: 'per-user',
  manual_tts_usage: 'per-user',
  ad_reward_credits: 'per-user',
  paid_voice_retention: 'per-user',
  usage_events: 'per-user',
  user_consents: 'per-user',
  email_verification_codes: 'per-user',
  push_tokens: 'per-user',
  user_app_presence: 'per-user', // 앱 빌드·접속 기록(#133)
  plan_grants: 'per-user', // 관리자 기간 지급(#134)
  manual_tts_requests: 'per-user', // 직접 입력 같은 요청 표식(#135)
  apple_server_notifications: 'per-user', // 애플 서버 알림 수신 기록 — 주인을 찾은 행만 계정 id 를 담는다(#136)
  briefing_interests: 'per-user', // 아침 소식 관심 기업(#137)
  briefing_corp_codes: 'no-personal-data', // OpenDART 고유번호 공용 캐시(#137)
  briefing_items: 'no-personal-data', // 받아 둔 공시·정책뉴스 공용 캐시(#137)
  briefing_fetch_state: 'no-personal-data', // 원천·기업별 확인 상태(#137) — 사람 id 를 적지 않는다
  admin_push_jobs: 'no-personal-data', // 관리자 알림 기록 — 대상 토큰·받는 사람을 적지 않는다(#133)
  tts_synthesis_usage: 'no-personal-data', // 합성 사용량 장부 — 종류·날짜·숫자뿐, 사람을 가리키지 않는다(#139)
  tts_dev_budget_holds: 'no-personal-data', // dev 예산에서 합성 직전에 잡는 몫 — 월·글자 수뿐(#139)
  voice_packs: 'no-personal-data', // 추가 음성팩 카탈로그 — 누구에게나 같은 콘텐츠다(#144)
  voice_pack_clips: 'no-personal-data', // 팩 클립 — 사람과 묶이지 않는다(#144)
  voice_pack_events: 'no-personal-data', // 팩 감사 기록 — 행위자는 'admin-console' 같은 고정 값이다(#144)
  subscriptions: 'per-user',
  store_transactions: 'per-user',
  promo_code_redemptions: 'per-user',
  retained_billing_records: 'retained-pseudonymized',
  pending_external_deletions: 'deletion-queue',
  plans: 'no-personal-data',
  promo_codes: 'no-personal-data',
  event_likes: 'no-personal-data', // 랜딩 공개 카운터 — 사용자와 묶지 않는다
  event_slot_cursor: 'no-personal-data',
  weather_region_daily_official: 'no-personal-data', // 공식 원천 캐시(#127)
  weather_region_daily: 'no-personal-data', // 지역 × 날짜의 날씨 캐시 — 사용자와 묶지 않는다(#123)
  store_download_daily: 'no-personal-data', // 스토어가 모아 준 하루 다운로드 수(#138)
  store_download_sync: 'no-personal-data', // 스토어 받아 오기 상태(#138)
  store_report_instances: 'no-personal-data', // 받은 App Store 보고서 인스턴스 id(#138)
  _migrations: 'no-personal-data',
  sqlite_sequence: 'no-personal-data',
};

const PEPPER = 'test-pepper';
const NOW = new Date('2026-09-30T00:00:00.000Z');
const PERSONAL = '70000000-0000-4000-8000-000000000002';

// 떠나는 사람. 계정 id 와 로그인 id 를 일부러 다르게 둔다(통일 이전 행이 로그인 id 를 담는다).
const A_PK = 'a0000000-0000-4000-8000-00000000000a';
const A_LOGIN = 'google-sub-purged-000001';
const A_EMAIL = 'purged.person@example.com';
const A_NAME = '탈퇴한사람';
const A_APPLE = 'apple-sub-purged-000001';
const A_APPLE_REFRESH = 'apple-refresh-purged-000001';
const A_PUSH = 'push-token-purged-000001';
/** 사람을 곧장 가리키는 값. 파기 뒤 어디에도 남으면 안 된다(외부 삭제 큐 제외). */
const DIRECT_IDENTIFIERS = [A_PK, A_LOGIN, A_EMAIL, A_NAME, A_APPLE, A_APPLE_REFRESH, A_PUSH];

// 남는 사람들 — 과잉 삭제를 잡는다.
const B_PK = 'b0000000-0000-4000-8000-00000000000b';
const C_PK = 'c0000000-0000-4000-8000-00000000000c';

const A_UPLOAD_KEY = `voices/${A_PK}/1_0`;
const A_GENERATED_KEY = `generated-tts/${A_PK}/hash-a.mp3`;
const B_ON_A_GENERATED_KEY = `generated-tts/${B_PK}/hash-shared.mp3`;

/** A 가 소유했던 행들 — 파기 뒤 그 id 로 **풀리는 행**이 하나도 없어야 한다. */
const A_OWNED_ROWS: Array<[table: string, column: string, id: string]> = [
  ['voice_profiles', 'id', 'vp-a'],
  ['voice_uploads', 'id', 'up-a'],
  ['messages', 'id', 'msg-a'],
  ['generated_audio_assets', 'id', 'ga-a'],
  ['message_library', 'id', 'ml-a'],
  ['alarms', 'id', 'al-a-own'],
  ['subscriptions', 'id', 'sub-a'],
  ['store_transactions', 'id', 'st-a'],
  ['store_transactions', 'id', 'st-a-gift'],
  ['store_transactions', 'id', 'st-a-play'],
  ['voice_prerender_queue', 'voice_profile_id', 'vp-a'],
  ['voice_profile_change_ledger', 'id', 'vcl-a'],
  ['usage_events', 'id', 'ue-a'],
  ['ad_reward_credits', 'transaction_id', 'adr-a'],
  ['user_consents', 'id', 'uc-a'],
  ['email_verification_codes', 'id', 'evc-a'],
];
/** 심기 검사용 — 파기 전 사용자별 표마다 A 흔적이 하나는 있어야 한다(심기가 빠지면 검사가 헛돈다). */
const A_MARKERS = [...DIRECT_IDENTIFIERS, ...A_OWNED_ROWS.map(([, , id]) => id)];

let db: Client;

async function run(sql: string, args: InValue[] = []): Promise<void> {
  await db.execute({ sql, args });
}

async function tableNames(): Promise<string[]> {
  const res = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`);
  return res.rows.map((row) => String(row.name));
}

/** 모든 표의 모든 칸을 훑어 `needles` 중 하나를 품은 칸을 `표.열=값` 으로 돌려준다. */
async function cellsContaining(needles: string[]): Promise<Array<{ table: string; column: string; value: string }>> {
  const hits: Array<{ table: string; column: string; value: string }> = [];
  for (const table of await tableNames()) {
    // 표 이름은 sqlite_master 가 준 고정 값이다(사용자 입력 아님).
    const res = await db.execute(`SELECT * FROM "${table}"`);
    for (const row of res.rows) {
      for (const column of res.columns) {
        const value = row[column];
        if (typeof value !== 'string') continue;
        if (needles.some((needle) => value.includes(needle))) hits.push({ table, column, value });
      }
    }
  }
  return hits;
}

async function ids(sql: string, args: InValue[] = []): Promise<string[]> {
  const res = await db.execute({ sql, args });
  return res.rows.map((row) => String(row[res.columns[0]!])).sort();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function seed(): Promise<void> {
  // ── 사람 ──────────────────────────────────────────────────────────────────
  await run(
    `INSERT INTO users (id, google_id, email, name, plan, apple_id, apple_refresh_token,
                        dynamic_prompt_settings_json, deletion_status, deletion_requested_at, deletion_purge_at)
     VALUES (?, ?, ?, ?, 'plus', ?, ?, ?, 'pending_deletion', '2026-08-30T00:00:00.000Z', '2026-09-29T00:00:00.000Z')`,
    [A_PK, A_LOGIN, A_EMAIL, A_NAME, A_APPLE, A_APPLE_REFRESH, '{"weather":{"city":"Seoul"},"fortune":{"birth":"1990-01-01"}}'],
  );
  await run(`INSERT INTO users (id, google_id, email, name, plan) VALUES (?, 'google-sub-b', 'b@example.com', '남는사람', 'plus')`, [B_PK]);
  await run(`INSERT INTO users (id, email, name, plan) VALUES (?, 'c@example.com', '다른사람', 'free')`, [C_PK]);

  // ── 구독·결제 ─────────────────────────────────────────────────────────────
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at,
                                apple_transaction_id, apple_original_transaction_id, apple_product_id)
     VALUES ('sub-a', ?, ?, 'active', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z',
             'apple-tx-a-sub', 'apple-tx-a-sub', 'com.alarmtalk.app.personal_monthly')`,
    [A_PK, PERSONAL],
  );
  await run(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
     VALUES ('sub-b', ?, ?, 'active', '2026-09-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    [B_PK, PERSONAL],
  );
  await run(
    `INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key,
                                     subscription_id, raw_payload, last_paid_at)
     VALUES ('st-a', ?, 'apple', 'apple-tx-a-sub', 'com.alarmtalk.app.personal_monthly', 'personal', 'sub-a',
             '{"originalTransactionId":"apple-tx-a-sub"}', '2026-09-01T00:00:00.000Z')`,
    [A_PK],
  );
  // 선물 구매 — 구독 행 없이 거래만 남는 일회성 결제. 선물은 2026-10-14 에 없앴지만(App Store 3.1.1)
  // 그 전에 쓰인 거래 행은 이력으로 남는다 — 파기와 가명 보존은 그대로 돌아야 한다.
  await run(
    `INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key,
                                     subscription_id, raw_payload, last_paid_at)
     VALUES ('st-a-gift', ?, 'apple', 'apple-tx-a-gift', 'com.alarmtalk.app.personal_gift_1m', 'personal', NULL,
             '{"kind":"gift"}', '2026-09-05T00:00:00.000Z')`,
    [A_PK],
  );
  // ⚠ **거래 id 는 스토어마다 따로 매긴다** — `store_transactions` 의 유일성은 (provider, 거래 id) 다. 글자가
  //   같아도 스토어가 다르면 남의 결제다.
  //   ① C 가 애플로 산 옛 선물의 거래 id 를 A 의 Play 구매 토큰이 그대로 쓴다.
  //   ② 반대로 남는 B 의 Play 구매 토큰이 A 의 애플 선물 거래 id 와 같다.
  //   A 의 거래는 지워도 같은 글자를 쓰는 B·C 의 거래는 남아야 한다.
  //   A 의 Play 결제는 5년 보존 기한이 지난 것이라 가명 보존 기록에 들어가지 않는다(아래 보존 검사가 그대로다).
  await run(
    `INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key,
                                     subscription_id, raw_payload, last_paid_at)
     VALUES ('st-c-gift', ?, 'apple', 'apple-tx-c-gift', 'com.alarmtalk.app.personal_gift_1m', 'personal', NULL,
             '{"kind":"gift"}', '2026-09-04T00:00:00.000Z')`,
    [C_PK],
  );
  await run(
    `INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key,
                                     subscription_id, last_paid_at)
     VALUES ('st-a-play', ?, 'google', 'apple-tx-c-gift', 'personal_monthly', 'personal', NULL, '2018-01-01T00:00:00.000Z')`,
    [A_PK],
  );
  await run(
    `INSERT INTO store_transactions (id, user_id, provider, provider_transaction_id, product_id, plan_key,
                                     subscription_id, last_paid_at)
     VALUES ('st-b-play', ?, 'google', 'apple-tx-a-gift', 'personal_monthly', 'personal', 'sub-b', '2026-09-03T00:00:00.000Z')`,
    [B_PK],
  );
  await run(`INSERT INTO promo_codes (id, code, plan_id, duration_days) VALUES ('promo-1', 'WELCOME', ?, 30)`, [PERSONAL]);
  await run(`INSERT INTO promo_code_redemptions (id, promo_code_id, user_id) VALUES ('pr-a', 'promo-1', ?)`, [A_PK]);
  await run(`INSERT INTO promo_code_redemptions (id, promo_code_id, user_id) VALUES ('pr-b', 'promo-1', ?)`, [B_PK]);
  await run(`INSERT INTO paid_voice_retention (user_id, delete_after) VALUES (?, '2026-10-03T00:00:00.000Z')`, [A_PK]);

  // ── 목소리·문구·음원 ──────────────────────────────────────────────────────
  await run(
    `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status)
     VALUES ('vp-a', ?, '엄마 목소리', 'el-voice-a', 'ready')`,
    [A_PK],
  );
  await run(
    `INSERT INTO voice_profiles (id, user_id, name, elevenlabs_voice_id, status)
     VALUES ('vp-b', ?, 'B 목소리', 'el-voice-b', 'ready')`,
    [B_PK],
  );
  await run(
    `INSERT INTO voice_uploads (id, user_id, object_key, mime_type, size_bytes, voice_profile_id)
     VALUES ('up-a', ?, ?, 'audio/mp4', 100, 'vp-a')`,
    [A_PK, A_UPLOAD_KEY],
  );
  await run(
    `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
     VALUES ('msg-a', ?, 'vp-a', '엄마가 깨워줄게', ?, 'custom')`,
    [A_PK, `r2://${A_GENERATED_KEY}`],
  );
  await run(
    `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
     VALUES ('msg-b', ?, 'vp-b', 'B 문구', ?, 'custom')`,
    [B_PK, `r2://generated-tts/${B_PK}/hash-b.mp3`],
  );
  // 목소리를 나눠 쓰던 시절에 B 가 A 의 클론으로 만든 문구 — 그 기능은 없앴어도 행은 남아 있을 수 있다.
  // messages.voice_profile_id 는 NOT NULL FK 라, 파기가 이 행을 놓치면 A 의 목소리 삭제가 FK 로 막혀
  // 탈퇴가 통째로 롤백된다.
  await run(
    `INSERT INTO messages (id, user_id, voice_profile_id, text, audio_url, category)
     VALUES ('msg-b-on-a', ?, 'vp-a', '공유 목소리 문구', ?, 'custom')`,
    [B_PK, `r2://${B_ON_A_GENERATED_KEY}`],
  );
  await run(
    `INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                                         model_id, language, request_hash, text, audio_url, audio_object_key)
     VALUES ('ga-a', ?, 'vp-a', 'msg-a', 'elevenlabs', 'el-voice-a', 'm', 'ko', 'rh-a', '엄마가 깨워줄게', ?, ?)`,
    [A_PK, `r2://${A_GENERATED_KEY}`, A_GENERATED_KEY],
  );
  await run(
    `INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                                         model_id, language, request_hash, text, audio_url, audio_object_key)
     VALUES ('ga-b-on-a', ?, 'vp-a', 'msg-b-on-a', 'elevenlabs', 'el-voice-a', 'm', 'ko', 'rh-b-on-a', '공유 목소리 문구', ?, ?)`,
    [B_PK, `r2://${B_ON_A_GENERATED_KEY}`, B_ON_A_GENERATED_KEY],
  );
  await run(
    `INSERT INTO generated_audio_assets (id, user_id, voice_profile_id, message_id, provider, provider_voice_id,
                                         model_id, language, request_hash, text, audio_url, audio_object_key)
     VALUES ('ga-b', ?, 'vp-b', 'msg-b', 'elevenlabs', 'el-voice-b', 'm', 'ko', 'rh-b', 'B 문구', ?, ?)`,
    [B_PK, `r2://generated-tts/${B_PK}/hash-b.mp3`, `generated-tts/${B_PK}/hash-b.mp3`],
  );
  await run(`INSERT INTO message_library (id, user_id, message_id) VALUES ('ml-a', ?, 'msg-a')`, [A_PK]);
  await run(`INSERT INTO message_library (id, user_id, message_id) VALUES ('ml-b', ?, 'msg-b')`, [B_PK]);
  // 위 문구의 보관함 행 — messages 의 FK 자식이라 문구보다 먼저 지워져야 한다.
  await run(`INSERT INTO message_library (id, user_id, message_id) VALUES ('ml-b-on-a', ?, 'msg-b-on-a')`, [B_PK]);
  await run(`INSERT INTO voice_prerender_queue (voice_profile_id, owner_user_id, language) VALUES ('vp-a', ?, 'ko')`, [A_PK]);
  await run(`INSERT INTO voice_draft_attempt_usage (owner_user_id, attempt_month, used_count) VALUES (?, '2026-09', 1)`, [A_PK]);
  await run(
    `INSERT INTO voice_profile_change_ledger (id, owner_user_id, change_month, change_type, status)
     VALUES ('vcl-a', ?, '2026-09', 'create', 'succeeded')`,
    [A_PK],
  );
  // 직접 입력 월 한도 장부 — 개인 풀(키 = 계정 id, 통일 이전 행은 로그인 id).
  await run(`INSERT INTO manual_tts_usage (pool_key, usage_month, used_count) VALUES (?, '2026-09', 5)`, [A_PK]);
  await run(`INSERT INTO manual_tts_usage (pool_key, usage_month, used_count) VALUES (?, '2026-08', 2)`, [A_LOGIN]);
  await run(`INSERT INTO manual_tts_usage (pool_key, usage_month, used_count) VALUES (?, '2026-09', 3)`, [B_PK]);

  await run(`INSERT INTO ad_reward_credits (transaction_id, user_id, ad_unit, grant_month) VALUES ('adr-a', ?, 'unit', '2026-09')`, [A_PK]);

  // ── 알람 ─────────────────────────────────────────────────────────────────
  await run(`INSERT INTO alarms (id, user_id, message_id, voice_profile_id, time) VALUES ('al-a-own', ?, 'msg-a', 'vp-a', '07:00')`, [A_PK]);
  // B 가 A 의 클론 문구로 맞춰 둔 자기 알람, 그리고 A 와 무관한 B 의 알람.
  await run(`INSERT INTO alarms (id, user_id, message_id, voice_profile_id, time) VALUES ('al-b-own', ?, 'msg-b-on-a', 'vp-a', '06:30')`, [B_PK]);
  await run(`INSERT INTO alarms (id, user_id, message_id, voice_profile_id, time) VALUES ('al-b-own2', ?, 'msg-b', 'vp-b', '06:00')`, [B_PK]);

  // ── 기록·동의·인증·푸시 ───────────────────────────────────────────────────
  await run(
    `INSERT INTO usage_events (id, user_id, type, occurred_at, alarm_id, voice_profile_id, message_id)
     VALUES ('ue-a', ?, 'alarm_rang', '2026-09-20T22:00:00.000Z', 'al-a-own', 'vp-a', 'msg-a')`,
    [A_PK],
  );
  // B 자신의 기록 — A 의 클론으로 울렸다. B 의 데이터라 남는다(가리키는 id 는 풀리지 않게 된다).
  await run(
    `INSERT INTO usage_events (id, user_id, type, occurred_at, alarm_id, voice_profile_id, message_id)
     VALUES ('ue-b', ?, 'alarm_rang', '2026-09-20T21:30:00.000Z', 'al-b-own', 'vp-a', 'msg-b-on-a')`,
    [B_PK],
  );
  await run(`INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed) VALUES ('uc-a', ?, 'terms', '1', 1)`, [A_PK]);
  await run(`INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed) VALUES ('uc-a-voice', ?, 'voice_biometric', '1', 1)`, [A_PK]);
  await run(`INSERT INTO user_consents (id, user_id, consent_type, policy_version, agreed) VALUES ('uc-b', ?, 'terms', '1', 1)`, [B_PK]);
  await run(
    `INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at)
     VALUES ('evc-a', ?, 'password_reset', 'code-hash-a', '2026-10-01T00:00:00.000Z')`,
    [A_EMAIL],
  );
  await run(
    `INSERT INTO email_verification_codes (id, email, purpose, code_hash, expires_at)
     VALUES ('evc-b', 'b@example.com', 'password_reset', 'code-hash-b', '2026-10-01T00:00:00.000Z')`,
  );
  await run(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES ('pt-a', ?, ?, 'android')`, [A_PK, A_PUSH]);
  await run(`INSERT INTO push_tokens (id, user_id, token, platform) VALUES ('pt-b', ?, 'push-token-b', 'ios')`, [B_PK]);
  await run(`INSERT INTO user_app_presence (user_id, platform, app_version) VALUES (?, 'android', 35)`, [A_PK]);
  await run(`INSERT INTO user_app_presence (user_id, platform, app_version) VALUES (?, 'ios', 13)`, [B_PK]);
  await run(
    `INSERT INTO plan_grants (id, user_id, starts_at, ends_at, reason, granted_by, request_key)
     VALUES ('pg-a', ?, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'support', 'admin', 'key-a-000001')`,
    [A_PK],
  );
  // 아침 소식 관심 기업 — 옛 로그인 id 로 적힌 행까지 함께 지운다.
  await run(`INSERT INTO briefing_interests (user_id, corp_code) VALUES (?, '00126380')`, [A_PK]);
  await run(`INSERT INTO briefing_interests (user_id, corp_code) VALUES (?, '00164779')`, [A_LOGIN]);
  await run(`INSERT INTO briefing_interests (user_id, corp_code) VALUES (?, '00126380')`, [B_PK]);
  await run(
    `INSERT INTO plan_grants (id, user_id, starts_at, ends_at, reason, granted_by, request_key)
     VALUES ('pg-b', ?, '2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 'support', 'admin', 'key-b-000001')`,
    [B_PK],
  );
  await run(
    `INSERT INTO manual_tts_requests (user_id, request_id, input_hash, status, claimed_at)
     VALUES (?, 'req-a', 'h', 'done', '2026-10-01T00:00:00.000Z'), (?, 'req-b', 'h', 'done', '2026-10-01T00:00:00.000Z')`,
    [A_PK, B_PK],
  );
  await run(
    `INSERT INTO apple_server_notifications (notification_uuid, notification_type, environment, original_transaction_id, user_id, status)
     VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'DID_RENEW', 'Production', 'apple-tx-a-sub', ?, 'processed')`,
    [A_PK],
  );
  await run(
    `INSERT INTO apple_server_notifications (notification_uuid, notification_type, environment, original_transaction_id, user_id, status)
     VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'DID_RENEW', 'Production', 'apple-tx-b-sub', ?, 'processed')`,
    [B_PK],
  );
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  await runMigrations(db);
  // 운영처럼 FK 를 켠다 — 자식 행을 안 지우면 파기가 통째로 롤백되는 것까지 재현한다.
  await db.execute('PRAGMA foreign_keys = ON');
  await seed();
}, 60_000);

describe('탈퇴 파기 뒤 잔존물 (실제 SQLite)', () => {
  it('모든 표가 분류돼 있다 — 새 표는 파기 대상인지 먼저 정해야 한다', async () => {
    expect(await tableNames()).toEqual(Object.keys(TABLES).sort());
  });

  it('심기가 사용자별 표를 전부 덮는다(검사가 헛돌지 않게)', async () => {
    const hits = await cellsContaining(A_MARKERS);
    const covered = new Set(hits.map((hit) => hit.table));
    const perUser = Object.entries(TABLES)
      .filter(([, kind]) => kind === 'per-user')
      .map(([table]) => table);
    expect(perUser.filter((table) => !covered.has(table))).toEqual([]);
  });

  describe('파기 후', () => {
    let purged: AccountPurgeNotifications;
    beforeAll(async () => {
      purged = await withWriteTransaction(db, async (tx) => {
        await pseudonymizeBillingForRetention(tx, A_PK, PEPPER, NOW);
        return purgeUserAccount(tx, A_PK, A_LOGIN);
      });
    }, 60_000);

    it('사람을 곧장 가리키는 값이 어디에도 남지 않는다(외부 삭제 큐의 파일 주소만 예외)', async () => {
      const hits = await cellsContaining(DIRECT_IDENTIFIERS);
      const outsideQueue = hits.filter(
        (hit) => !(hit.table === 'pending_external_deletions' && hit.column === 'ref'),
      );
      expect(outsideQueue).toEqual([]);
    });

    it('외부 삭제 큐에는 A 의 클론·원본 녹음·A 의 목소리로 만든 음원만 들어 있다', async () => {
      const queue = await db.execute(`SELECT kind, ref FROM pending_external_deletions ORDER BY kind, ref`);
      const jobs = queue.rows.map((row) => [String(row.kind), String(row.ref)]);
      // B 가 A 의 클론으로 만든 음원까지 들어 있다. 크론이 지우는 순간 사라진다.
      expect(jobs).toEqual(
        [
          ['elevenlabs_voice', 'el-voice-a'],
          ['r2_object', A_GENERATED_KEY],
          ['r2_object', A_UPLOAD_KEY],
          ['r2_object', B_ON_A_GENERATED_KEY],
        ].sort(),
      );
      // B 의 클론은 그대로다 — A 의 탈퇴가 남의 등급이나 클론 슬롯을 건드리지 않는다.
      const bVoice = await db.execute(`SELECT elevenlabs_voice_id, evicted_at FROM voice_profiles WHERE id = 'vp-b'`);
      expect(bVoice.rows.map((row) => [row.elevenlabs_voice_id, row.evicted_at])).toEqual([['el-voice-b', null]]);
    });

    it('A 의 클론을 쓰던 B 의 알람만 알린다 — 떠나는 사람에게는 보내지 않는다', () => {
      // 알람은 남기고 목소리만 내린다(아래 알람 검사). 철회 신호는 그 알람의 주인이 받고,
      // 떠나는 사람의 기기는 곧 사라지므로 아무 신호도 받지 않는다.
      expect(purged).toEqual({
        downgradedAlarms: [{ alarmId: 'al-b-own', ownerUserId: B_PK }],
        voiceAccessRevokedUserIds: [],
      });
    });

    it('A 가 소유했던 행은 그 id 로 더는 풀리지 않는다', async () => {
      const resolvable: string[] = [];
      for (const [table, column, id] of A_OWNED_ROWS) {
        const res = await db.execute({ sql: `SELECT 1 FROM "${table}" WHERE "${column}" = ?`, args: [id] });
        if (res.rows.length > 0) resolvable.push(`${table}.${column}=${id}`);
      }
      expect(resolvable).toEqual([]);
    });

    it('직접 입력 월 한도 장부 — A 의 개인 풀(옛 로그인 id 키 포함)만 지우고 남의 풀은 남긴다', async () => {
      expect(await ids(`SELECT pool_key FROM manual_tts_usage`)).toEqual([B_PK]);
    });

    it('A 의 클론으로 만든 남의 문구도 목소리와 함께 사라진다 — 탈퇴가 FK 로 막히지 않는다', async () => {
      expect(await ids(`SELECT id FROM messages WHERE user_id IN (?, ?, ?)`, [A_PK, B_PK, C_PK])).toEqual(['msg-b']);
      expect(await ids(`SELECT id FROM message_library`)).toEqual(['ml-b']);
    });

    it('남는 사람의 데이터는 남는다 — 과잉 삭제가 없다', async () => {
      expect(await ids(`SELECT id FROM users WHERE id IN (?, ?, ?)`, [A_PK, B_PK, C_PK])).toEqual([B_PK, C_PK].sort());
      expect(await ids(`SELECT id FROM push_tokens`)).toEqual(['pt-b']);
      expect(await ids(`SELECT user_id FROM user_app_presence`)).toEqual([B_PK]);
      expect(await ids(`SELECT id FROM plan_grants`)).toEqual(['pg-b']);
      expect(await ids(`SELECT request_id AS id FROM manual_tts_requests`)).toEqual(['req-b']);
      expect(await ids(`SELECT user_id FROM apple_server_notifications`)).toEqual([B_PK]);
      expect(await ids(`SELECT user_id FROM briefing_interests`)).toEqual([B_PK]);
      expect(await ids(`SELECT id FROM user_consents`)).toEqual(['uc-b']);
      expect(await ids(`SELECT id FROM email_verification_codes`)).toEqual(['evc-b']);
      expect(await ids(`SELECT id FROM promo_code_redemptions`)).toEqual(['pr-b']);
      expect(await ids(`SELECT id FROM generated_audio_assets WHERE user_id IN (?, ?)`, [A_PK, B_PK])).toEqual(['ga-b']);
      expect(await ids(`SELECT id FROM voice_profiles WHERE user_id IN (?, ?)`, [A_PK, B_PK])).toEqual(['vp-b']);
      expect(await ids(`SELECT id FROM usage_events`)).toEqual(['ue-b']);
      // B 의 구독과 등급은 그대로다 — A 의 탈퇴가 남의 결제를 끊지 않는다.
      const subscriptions = await db.execute(`SELECT id, status FROM subscriptions ORDER BY id`);
      expect(subscriptions.rows.map((row) => [row.id, row.status])).toEqual([['sub-b', 'active']]);
      const plans = await db.execute({ sql: `SELECT plan FROM users WHERE id = ?`, args: [B_PK] });
      expect(plans.rows.map((row) => row.plan)).toEqual(['plus']);
    });

    it('스토어가 다른 같은 거래 id 는 남의 것이다 — B 의 Play 거래와 C 의 애플 거래가 남는다', async () => {
      // A 의 거래(구독·선물·Play)는 전부 사라지고, 같은 글자를 쓰는 남의 거래만 남는다.
      const transactions = await db.execute(
        `SELECT id, user_id, provider, provider_transaction_id FROM store_transactions ORDER BY id`,
      );
      expect(
        transactions.rows.map((row) => [
          row.id,
          row.user_id,
          row.provider,
          row.provider_transaction_id,
        ]),
      ).toEqual([
        ['st-b-play', B_PK, 'google', 'apple-tx-a-gift'],
        ['st-c-gift', C_PK, 'apple', 'apple-tx-c-gift'],
      ]);
    });

    it('B 의 알람은 남고, A 의 목소리를 쓰던 것만 목소리를 잃는다', async () => {
      const alarms = await db.execute(
        `SELECT id, message_id, voice_profile_id, mode, is_active FROM alarms ORDER BY id`,
      );
      expect(
        alarms.rows.map((row) => [row.id, row.message_id, row.voice_profile_id, row.mode, Number(row.is_active)]),
      ).toEqual([
        ['al-b-own', null, null, 'sound-only', 1],
        ['al-b-own2', 'msg-b', 'vp-b', 'tts', 1],
      ]);
    });

    it('결제 기록은 가명으로만 남는다 — pepper 없이는 계정 id 로 되짚을 수 없다', async () => {
      const retained = await db.execute(
        `SELECT pseudonym, provider_transaction_id FROM retained_billing_records ORDER BY provider_transaction_id`,
      );
      expect(retained.rows.map((row) => row.provider_transaction_id)).toEqual(['apple-tx-a-gift', 'apple-tx-a-sub']);
      const pseudonyms = new Set(retained.rows.map((row) => String(row.pseudonym)));
      expect([...pseudonyms]).toEqual([await sha256Hex(`${A_PK}:${PEPPER}`)]);
      // 소금 없는 해시(구매-계정 바인딩이 쓰는 모양)로는 맞춰 볼 수 없다.
      expect(pseudonyms.has(await sha256Hex(A_PK))).toBe(false);
      expect(pseudonyms.has(await sha256Hex(A_LOGIN))).toBe(false);
    });
  });
});
