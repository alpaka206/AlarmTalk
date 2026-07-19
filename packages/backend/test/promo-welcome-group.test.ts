// 마이그레이션 #72(웰컴 프로모 3종 + redemption_group) 실동작 검증 — 실제 libsql 파일 DB 에
// 전체 마이그레이션을 올리고 redeemPromoCode 실경로로:
//  1) 시드 3종(개인/커플/가족, 30일, group=welcome)이 존재하는지,
//  2) 웰컴 계열은 '계정당 통틀어 1회'인지(개인 사용 후 커플/가족 불가),
//  3) 그룹 없는 일반 코드는 웰컴 사용 여부와 무관하게 코드별 1회 규칙만 적용되는지 확인한다.
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, runMigrationsRange } from '../src/lib/migrations';
import { redeemPromoCode, PromoRedemptionError } from '../src/lib/promo-redemption';

const DB_PATH = join(tmpdir(), 'alarmtalk-promo-welcome-group.db');
// 리딤이 만드는 plan_groups/subscriptions 의 FK 그래프가 넓어 부분 정리가 취약하다 —
// 항상 새 파일 DB 로 시작해 이전 실행 잔재를 원천 제거한다.
rmSync(DB_PATH, { force: true });
const db: Client = createClient({ url: `file:${DB_PATH}` });

async function insertUser(id: string) {
  await db.execute({
    sql: 'INSERT OR IGNORE INTO users (id, google_id, email) VALUES (?, ?, ?)',
    args: [id, id, `${id}@test`],
  });
}

async function redeem(userPk: string, code: string) {
  return redeemPromoCode(db, { userPk, rawCode: code });
}

async function expectPromoError(promise: Promise<unknown>, errorCode: string) {
  try {
    await promise;
    throw new Error(`expected PromoRedemptionError(${errorCode}) but resolved`);
  } catch (err) {
    expect(err).toBeInstanceOf(PromoRedemptionError);
    expect((err as PromoRedemptionError).errorCode).toBe(errorCode);
  }
}

beforeAll(async () => {
  await runMigrations(db);
  for (const u of ['pw-a', 'pw-b', 'pw-c']) await insertUser(u);
  // 그룹 없는 일반 코드 1개 (대조군)
  await db.execute(
    `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
     SELECT 'pw-plain-id', 'PLAIN_TEST_CODE', id, 7, 1 FROM plans WHERE key = 'personal'`,
  );
});

describe('마이그레이션 #72 — 웰컴 프로모 시드', () => {
  it('개인/커플/가족 3종이 30일·group=welcome·활성으로 시드된다', async () => {
    const res = await db.execute(
      `SELECT p.code, pl.key AS plan_key, p.duration_days, p.redemption_group, p.is_active, p.max_redemptions
       FROM promo_codes p JOIN plans pl ON pl.id = p.plan_id
       WHERE p.redemption_group = 'welcome' ORDER BY p.code`,
    );
    expect(res.rows.map((r) => [r.code, r.plan_key, Number(r.duration_days), Number(r.is_active)])).toEqual([
      ['WELCOME_COUPLE', 'couple', 30, 1],
      ['WELCOME_FAMILY', 'family', 30, 1],
      ['WELCOME_PERSONAL', 'personal', 30, 1],
    ]);
  });
});

describe('웰컴 계열 계정당 1회 규칙', () => {
  it('WELCOME_PERSONAL 사용 → 30일 personal 구독, 같은 코드 재사용 불가', async () => {
    const result = await redeem('pw-a', 'WELCOME_PERSONAL');
    expect(result.plan.key).toBe('personal');
    expect(result.promo.duration_days).toBe(30);
    await expectPromoError(redeem('pw-a', 'WELCOME_PERSONAL'), 'CODE_ALREADY_REDEEMED_BY_YOU');
  });

  it('웰컴을 이미 쓴 계정은 다른 웰컴 코드(커플/가족)도 불가', async () => {
    await expectPromoError(redeem('pw-a', 'WELCOME_COUPLE'), 'CODE_GROUP_ALREADY_REDEEMED');
    await expectPromoError(redeem('pw-a', 'WELCOME_FAMILY'), 'CODE_GROUP_ALREADY_REDEEMED');
  });

  it('대소문자를 바꿔도(welcome_couple) 그룹 규칙을 우회할 수 없다', async () => {
    await expectPromoError(redeem('pw-a', 'welcome_couple'), 'CODE_GROUP_ALREADY_REDEEMED');
  });

  it('다른 계정은 자기 몫의 웰컴 1회를 정상 사용할 수 있다', async () => {
    const result = await redeem('pw-b', 'WELCOME_FAMILY');
    expect(result.plan.key).toBe('family');
  });

  it('그룹 없는 일반 코드는 웰컴 사용 여부와 무관하게 사용 가능(코드별 1회만 적용)', async () => {
    const result = await redeem('pw-c', 'WELCOME_COUPLE');
    expect(result.plan.key).toBe('couple');
    // 웰컴을 쓴 계정도 일반 코드는 사용 가능
    const plain = await redeem('pw-c', 'PLAIN_TEST_CODE');
    expect(plain.plan.key).toBe('personal');
    await expectPromoError(redeem('pw-c', 'PLAIN_TEST_CODE'), 'CODE_ALREADY_REDEEMED_BY_YOU');
  });
});

describe('마이그레이션 #72 — 기존 동명 코드 충돌 수렴', () => {
  it('운영자가 미리 발급해둔 동명 코드(대소문자 달라도)에 그룹이 스탬프된다', async () => {
    const COLLIDE_PATH = join(tmpdir(), 'alarmtalk-promo-collide.db');
    rmSync(COLLIDE_PATH, { force: true });
    const collideDb = createClient({ url: `file:${COLLIDE_PATH}` });
    await runMigrationsRange(collideDb, 1, 71);
    // 마이그레이션 전 운영자 발급 시나리오: 소문자·그룹 없음·기간 14일(운영자 설정)
    await collideDb.execute(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
       SELECT 'op-issued', 'welcome_personal', id, 14, 1 FROM plans WHERE key = 'personal'`,
    );
    await runMigrationsRange(collideDb, 72, 73);

    const row = await collideDb.execute(
      `SELECT code, duration_days, redemption_group FROM promo_codes
       WHERE code = 'welcome_personal' COLLATE NOCASE AND id = 'op-issued'`,
    );
    // INSERT OR IGNORE 가 기존 행을 존중하되(기간 14일 유지), 그룹은 스탬프돼 웰컴 규칙에 포함.
    expect(row.rows).toHaveLength(1);
    expect(Number(row.rows[0]!.duration_days)).toBe(14);
    expect(row.rows[0]!.redemption_group).toBe('welcome');
    // NOCASE 유니크라 시드가 중복 행을 만들지 않는다 — 나머지 2종만 새로 생긴다.
    const count = await collideDb.execute(
      `SELECT COUNT(*) AS n FROM promo_codes WHERE redemption_group = 'welcome'`,
    );
    expect(Number(count.rows[0]!.n)).toBe(3);
    collideDb.close();
  });
});

describe('#72~#73 갭 — 백필 전 사전 존재 동명 코드도 웰컴 규칙 유지', () => {
  it('컬럼은 있지만 group 이 NULL 인 사전 존재 코드로 웰컴 2회를 우회할 수 없다', async () => {
    const GAP_PATH = join(tmpdir(), 'alarmtalk-promo-gap-72-73.db');
    rmSync(GAP_PATH, { force: true });
    const gapDb = createClient({ url: `file:${GAP_PATH}` });
    await runMigrationsRange(gapDb, 1, 71);
    // 마이그레이션 전 운영자 발급 동명 코드(소문자·그룹 없음)
    await gapDb.execute(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
       SELECT 'gap-op', 'welcome_personal', id, 14, 1 FROM plans WHERE key = 'personal'`,
    );
    // #72 만 적용(#73 백필 전) — 컬럼은 생겼지만 gap-op 의 group 은 NULL
    await runMigrationsRange(gapDb, 72, 72);
    await gapDb.execute({
      sql: 'INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)',
      args: ['gap-u', 'gap-u', 'gap@test'],
    });

    // group NULL 인 사전 존재 코드 리딤 → 이름 결합 판정으로 웰컴 1회 소진
    const first = await redeemPromoCode(gapDb, { userPk: 'gap-u', rawCode: 'welcome_personal' });
    expect(first.plan.key).toBe('personal');
    // 시드된(그룹 있는) 웰컴 코드가 이름 결합 조건으로 이전 리딤을 인식해 차단
    await expectPromoError(
      redeemPromoCode(gapDb, { userPk: 'gap-u', rawCode: 'WELCOME_COUPLE' }),
      'CODE_GROUP_ALREADY_REDEEMED',
    );
    // 반대 방향: 시드 코드 먼저 → group NULL 코드도 차단
    await gapDb.execute({
      sql: 'INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)',
      args: ['gap-v', 'gap-v', 'gapv@test'],
    });
    await redeemPromoCode(gapDb, { userPk: 'gap-v', rawCode: 'WELCOME_FAMILY' });
    await expectPromoError(
      redeemPromoCode(gapDb, { userPk: 'gap-v', rawCode: 'welcome_personal' }),
      'CODE_GROUP_ALREADY_REDEEMED',
    );
    gapDb.close();
  });
});

describe('배포→마이그레이션 창 호환 (#72 적용 전 스키마)', () => {
  // deploy-backend.yml 이 배포 후 마이그레이션을 돌리므로, 새 코드가 redemption_group 컬럼이
  // 없는 DB(#71까지만 적용)를 만나도 리딤이 500 나지 않고 레거시 규칙으로 동작해야 한다.
  it('redemption_group 컬럼이 없어도 리딤이 정상 동작한다(레거시 폴백)', async () => {
    const LEGACY_PATH = join(tmpdir(), 'alarmtalk-promo-legacy-schema.db');
    rmSync(LEGACY_PATH, { force: true });
    const legacyDb = createClient({ url: `file:${LEGACY_PATH}` });
    await runMigrationsRange(legacyDb, 1, 71);
    await legacyDb.execute({
      sql: 'INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)',
      args: ['legacy-u', 'legacy-u', 'legacy@test'],
    });
    await legacyDb.execute(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
       SELECT 'legacy-code-id', 'LEGACY_WINDOW_CODE', id, 7, 1 FROM plans WHERE key = 'personal'`,
    );

    const result = await redeemPromoCode(legacyDb, {
      userPk: 'legacy-u',
      rawCode: 'LEGACY_WINDOW_CODE',
    });
    expect(result.plan.key).toBe('personal');
    await expectPromoError(
      redeemPromoCode(legacyDb, { userPk: 'legacy-u', rawCode: 'LEGACY_WINDOW_CODE' }),
      'CODE_ALREADY_REDEEMED_BY_YOU',
    );

    // 사전 존재하는 WELCOME_* 동명 코드도 배포 창에서 웰컴 1회 규칙을 우회할 수 없다 —
    // 컬럼이 없으므로 '이름 기반' 게이트가 대신 선다(대소문자 달라도).
    await legacyDb.execute(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
       SELECT 'legacy-wp', 'WELCOME_PERSONAL', id, 30, 1 FROM plans WHERE key = 'personal'`,
    );
    await legacyDb.execute(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active)
       SELECT 'legacy-wc', 'welcome_couple', id, 30, 1 FROM plans WHERE key = 'couple'`,
    );
    await legacyDb.execute({
      sql: 'INSERT INTO users (id, google_id, email) VALUES (?, ?, ?)',
      args: ['legacy-w', 'legacy-w', 'legacy-w@test'],
    });
    const welcome = await redeemPromoCode(legacyDb, {
      userPk: 'legacy-w',
      rawCode: 'WELCOME_PERSONAL',
    });
    expect(welcome.plan.key).toBe('personal');
    await expectPromoError(
      redeemPromoCode(legacyDb, { userPk: 'legacy-w', rawCode: 'welcome_couple' }),
      'CODE_GROUP_ALREADY_REDEEMED',
    );
    // 일반 코드는 이름 게이트와 무관하게 여전히 사용 가능
    const stillPlain = await redeemPromoCode(legacyDb, {
      userPk: 'legacy-w',
      rawCode: 'LEGACY_WINDOW_CODE',
    });
    expect(stillPlain.plan.key).toBe('personal');
    legacyDb.close();
  });
});

describe('마이그레이션 #74 — 웰컴 등록기한 (2026-08-31 KST 까지)', () => {
  it('웰컴 3종의 valid_until 이 2026-08-31T15:00:00Z(= 9/1 00:00 KST)로 스탬프된다', async () => {
    const res = await db.execute(
      `SELECT code, valid_until FROM promo_codes WHERE redemption_group = 'welcome' ORDER BY code`,
    );
    expect(res.rows).toHaveLength(3);
    for (const r of res.rows) {
      expect(r.valid_until).toBe('2026-08-31T15:00:00Z');
    }
  });

  it('기한이 지난 웰컴 코드는 CODE_NOT_IN_WINDOW 로 거부된다', async () => {
    // datetime('now') 는 주입할 수 없으므로 이미 지난 기한의 웰컴 그룹 코드로 윈도우 판정을 검증.
    await db.execute(
      `INSERT INTO promo_codes (id, code, plan_id, duration_days, is_active, valid_until, redemption_group)
       SELECT 'pw-expired', 'WELCOME_EXPIRED_TEST', id, 30, 1, '2020-01-01T00:00:00Z', 'welcome'
       FROM plans WHERE key = 'personal'`,
    );
    await insertUser('pw-d');
    await expectPromoError(redeem('pw-d', 'WELCOME_EXPIRED_TEST'), 'CODE_NOT_IN_WINDOW');
  });
});
