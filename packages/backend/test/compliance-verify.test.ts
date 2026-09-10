// 컴플라이언스 API 실동작 검증 — mock 결과 주입이 아니라 실제 인메모리 libsql DB에
// 전체 마이그레이션을 올린 뒤, 동의 기록/조회(마케팅 포함)·탈퇴 유예/철회 엔드포인트를
// 진짜 HTTP 요청으로 호출해 응답과 DB 상태를 확인한다.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';
import {
  GENERAL_REQUIRED_CONSENTS,
  REQUIRED_CONSENT_TYPES,
  CURRENT_POLICY_VERSION,
  FEATURE_CONSENT_TYPES,
  needsConsent,
} from '../src/lib/consent';
import { billingRetentionUntil } from '../src/lib/account-deletion';

// libsql `:memory:` 는 연결마다 별도 DB라 autocommit execute 와 transaction 이 스키마를
// 공유하지 못한다. 모든 연결이 같은 스키마를 보도록 임시 파일 DB 를 사용한다.
const DB_PATH = join(tmpdir(), 'alarmtalk-compliance-verify.db');
const db: Client = createClient({ url: `file:${DB_PATH}` });

vi.mock('../src/lib/db', () => ({ getDB: () => db }));

import userRoutes from '../src/routes/user';

const SUB = 'compliance-sub';
const PK = 'compliance-pk';

describe('결제기록 달력 5년 보존', () => {
  it('윤년을 고정 일수로 줄이지 않고 UTC 연도를 5년 전진한다', () => {
    expect(billingRetentionUntil(new Date('2027-03-01T12:34:56.000Z')).toISOString()).toBe(
      '2032-03-01T12:34:56.000Z',
    );
    expect(billingRetentionUntil(new Date('2028-02-29T12:34:56.000Z')).toISOString()).toBe(
      '2033-03-01T12:34:56.000Z',
    );
  });
});

function authAs(userId = SUB, userPk = PK) {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set('userId', userId);
    c.set('userIdPK', userPk);
    c.set('userEmail', 'compliance@test.com');
    c.set('userName', 'Compliance Tester');
    await next();
  };
}

function buildApp(userId = SUB, userPk = PK) {
  const app = new Hono<AppEnv>();
  app.use('*', authAs(userId, userPk));
  app.route('/user', userRoutes);
  return app;
}

function req(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

/**
 * 가입 동의 화면이 실제로 제출하는 payload — 필수뿐 아니라 화면에 함께 뜨는 기능 동의
 * (voice_biometric)도 포함한다. 필수만 넣으면 '거절' 시나리오의 override 가 조용히
 * 무시되어(보내지 않은 유형 = 미응답) 테스트가 다른 상태를 검증하게 된다.
 */
function consentPayload(overrides: Record<string, boolean> = {}) {
  return [...REQUIRED_CONSENT_TYPES, ...FEATURE_CONSENT_TYPES].map((type) => ({
    type,
    agreed: overrides[type] ?? true,
  }));
}

/**
 * POST /user/consents 바디. 서버는 **클라가 실제로 띄운 문서의 버전**을 함께 요구한다 —
 * 구버전 앱이 옛 본문을 보여주면서 새 버전 동의 기록을 만드는 것을 막기 위해서다.
 */
function consentBody(consents: unknown) {
  return { consents, document_version: CURRENT_POLICY_VERSION };
}

beforeAll(async () => {
  await runMigrations(db);
  // 이전 실행에서 파일이 남아있을 수 있어(클라이언트가 파일을 잡고 있으면 rmSync 불가)
  // 테이블을 비워 항상 깨끗한 상태에서 시작한다.
  await db.execute('DELETE FROM user_consents');
  await db.execute('DELETE FROM retained_billing_records');
  await db.execute('DELETE FROM subscriptions');
  // 시스템 스톡 보이스(migration 43)가 시스템 유저를 참조하므로 먼저 비운다.
  await db.execute('DELETE FROM voice_profiles');
  await db.execute('DELETE FROM users');
  await db.execute({
    sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
    args: [PK, SUB, 'compliance@test.com', 'Compliance Tester'],
  });
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(`${DB_PATH}${suffix}`);
    } catch {
      /* 없으면 무시 */
    }
  }
});

describe('동의 기록 — 마케팅(광고성 정보 수신) 포함', () => {
  it('terms/privacy/marketing/age14 4종을 한 번에 기록한다', async () => {
    const app = buildApp();
    const res = await app.request(
      req('POST', '/user/consents', consentBody(
        [
          { type: 'terms', agreed: true },
          { type: 'privacy', agreed: true },
          { type: 'marketing', agreed: false }, // 광고성 정보 수신: 선택 → 미동의로 기록
          { type: 'age14', agreed: true },
        ],
      )),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    console.log('[POST /consents]', JSON.stringify(body));
    expect(body).toEqual({ success: true, recorded: 4 });
  });

  it('GET 으로 마케팅 동의가 미동의(false)로 조회된다', async () => {
    const app = buildApp();
    const res = await app.request(req('GET', '/user/consents'));
    expect(res.status).toBe(200);
    const body = await res.json();
    console.log('[GET /consents]', JSON.stringify(body));
    const types = body.consents.map((c: { consent_type: string }) => c.consent_type).sort();
    expect(types).toEqual(['age14', 'marketing', 'privacy', 'terms']);
    const marketing = body.consents.find((c: { consent_type: string }) => c.consent_type === 'marketing');
    expect(marketing.agreed).toBe(false);
  });

  it('마케팅 동의를 true 로 재기록하면 최신값이 동의(true)로 바뀐다', async () => {
    const app = buildApp();
    await app.request(req('POST', '/user/consents', consentBody([{ type: 'marketing', agreed: true }])));
    const res = await app.request(req('GET', '/user/consents'));
    const body = await res.json();
    const marketing = body.consents.find((c: { consent_type: string }) => c.consent_type === 'marketing');
    console.log('[GET /consents after re-consent]', JSON.stringify(marketing));
    expect(marketing.agreed).toBe(true);
  });

  it('허용되지 않은 동의 유형은 400 INVALID_CONSENT_TYPE', async () => {
    const app = buildApp();
    const res = await app.request(req('POST', '/user/consents', consentBody([{ type: 'sell_my_data', agreed: true }])));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_CONSENT_TYPE');
  });

  // 법무 문서 전문은 APK 에 실려 있어 화면에 뜨는 내용이 설치된 앱 버전에 고정된다.
  // 서버가 무조건 현재 버전으로 도장을 찍으면, 구버전 앱이 옛 본문을 보여주면서 새 버전
  // 동의 기록을 만들고 진짜 재동의는 이미 충족된 것으로 판정돼 영영 안 뜬다.
  it('띄운 문서 버전이 서버와 다르면 409 로 거부한다', async () => {
    const app = buildApp(SUB, PK);
    const res = await app.request(
      new Request('http://localhost/user/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consents: [{ type: 'terms', agreed: true }],
          document_version: '3',
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe('POLICY_VERSION_MISMATCH');
    // 클라가 '업데이트하면 풀리는가' 를 판단하려면 서버 버전을 알아야 한다.
    expect(body.current).toBe(CURRENT_POLICY_VERSION);
  });

  it('띄운 문서 버전을 아예 안 보내면 400 으로 거부한다', async () => {
    const app = buildApp(SUB, PK);
    const res = await app.request(
      req('POST', '/user/consents', { consents: [{ type: 'terms', agreed: true }] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('DOCUMENT_VERSION_REQUIRED');
  });
});

describe('동의 상태 — 기존/신규 가입자 재동의 판단', () => {
  const NEW_SUB = 'no-consent-sub';
  const NEW_PK = 'no-consent-pk';

  it('동의 기록이 없는 사용자는 needs_consent=true, 가입 필수 4종 모두 missing', async () => {
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [NEW_PK, NEW_SUB, 'noconsent@test.com', 'No Consent'],
    });
    const app = buildApp(NEW_SUB, NEW_PK);
    const res = await app.request(req('GET', '/user/consents/status'));
    expect(res.status).toBe(200);
    const body = await res.json();
    console.log('[GET /consents/status — 미동의]', JSON.stringify(body));
    expect(body.needs_consent).toBe(true);
    expect(body.missing.sort()).toEqual([...REQUIRED_CONSENT_TYPES].sort());
  });

  it('가입 필수 4종 동의 기록 후 needs_consent=false (marketing 미동의여도 무관)', async () => {
    const app = buildApp(NEW_SUB, NEW_PK);
    await app.request(
      req('POST', '/user/consents', consentBody([...consentPayload(), { type: 'marketing', agreed: false }])),
    );
    const res = await app.request(req('GET', '/user/consents/status'));
    const body = await res.json();
    console.log('[GET /consents/status — 동의완료]', JSON.stringify(body));
    expect(body.needs_consent).toBe(false);
    expect(body.missing).toEqual([]);
  });

  it('필수 중 하나(privacy)만 미동의면 needs_consent=true, missing=[privacy]', async () => {
    const SUB2 = 'partial-sub';
    const PK2 = 'partial-pk';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK2, SUB2, 'partial@test.com', 'Partial'],
    });
    const app = buildApp(SUB2, PK2);
    await app.request(
      req('POST', '/user/consents', consentBody(consentPayload({ privacy: false }))),
    );
    const res = await app.request(req('GET', '/user/consents/status'));
    const body = await res.json();
    console.log('[GET /consents/status — 부분동의]', JSON.stringify(body));
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['privacy']);
  });

  // 민감 동의만 빠진 사용자. 국외 이전은 가입 필수라 missing 에 뜨지만, 음성 생체정보는
  // 선택이라 거절해도 missing 에 들어가지 않는다 — 목소리 등록 화면에서 다시 받는 몫이라
  // sensitive_missing 에만 남는다. 미들웨어의 하드 게이트는 GENERAL 3종만 보므로
  // 어느 쪽이든 앱 전체가 잠기지는 않는다.
  it('민감 동의만 빠지면 국외 이전만 missing 이고 둘 다 sensitive_missing 에 뜬다', async () => {
    const SUB4 = 'sensitive-sub';
    const PK4 = 'sensitive-pk';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK4, SUB4, 'sensitive@test.com', 'Sensitive'],
    });
    const app = buildApp(SUB4, PK4);
    await app.request(
      req(
        'POST',
        '/user/consents',
        consentBody(consentPayload({ voice_biometric: false, overseas_transfer: false })),
      ),
    );
    const res = await app.request(req('GET', '/user/consents/status'));
    const body = await res.json();
    console.log('[GET /consents/status — 민감 미동의]', JSON.stringify(body));
    expect(body.missing).toEqual(['overseas_transfer']);
    expect(body.sensitive_missing).toEqual(['voice_biometric', 'overseas_transfer']);
    expect(body.needs_consent).toBe(true);
    // 거절한 생체정보는 다시 묻지 않는다(답은 이미 받았다). 목소리 등록 화면의 몫이다.
    // marketing 은 이 픽스처가 한 번도 안 물어봐서 남는다.
    expect(body.collect).toEqual(['overseas_transfer', 'marketing']);
    // 게이트가 보는 일반 3종은 그대로 충족 — 앱 전체가 잠기면 안 된다.
    expect(await needsConsent(db, PK4, GENERAL_REQUIRED_CONSENTS)).toBe(false);
  });
});

describe('탈퇴 30일 유예 / 철회', () => {
  it('POST /me/deletion → pending_deletion, purge_at ≈ now+30일', async () => {
    const app = buildApp();
    const res = await app.request(req('POST', '/user/me/deletion'));
    expect(res.status).toBe(200);
    const body = await res.json();
    console.log('[POST /me/deletion]', JSON.stringify(body));
    expect(body.status).toBe('pending_deletion');
    expect(body.grace_days).toBe(30);

    const row = await db.execute({ sql: 'SELECT deletion_status, deletion_purge_at FROM users WHERE id = ?', args: [PK] });
    expect(row.rows[0]!.deletion_status).toBe('pending_deletion');
    const days = (new Date(body.purge_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('DELETE /me/deletion → active 로 복구', async () => {
    const app = buildApp();
    const res = await app.request(req('DELETE', '/user/me/deletion'));
    expect(res.status).toBe(200);
    const body = await res.json();
    console.log('[DELETE /me/deletion]', JSON.stringify(body));
    expect(body.status).toBe('active');
    const row = await db.execute({ sql: 'SELECT deletion_status FROM users WHERE id = ?', args: [PK] });
    expect(row.rows[0]!.deletion_status).toBe('active');
  });

  it('유예 상태가 아닐 때 철회는 404 NO_PENDING_DELETION', async () => {
    const app = buildApp();
    const res = await app.request(req('DELETE', '/user/me/deletion'));
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe('NO_PENDING_DELETION');
  });
});

describe('즉시 회원탈퇴(DELETE /me) — 결제기록 5년 가명보존', () => {
  const SUB3 = 'hard-del-sub';
  const PK3 = 'hard-del-pk';
  const PERSONAL_PLAN = '70000000-0000-4000-8000-000000000002';

  it('구독이 있으면 retained_billing_records 로 가명보존한 뒤 계정을 파기한다', async () => {
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK3, SUB3, 'harddel@test.com', 'Hard Delete'],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'active', '2026-01-01', '2030-01-01')`,
      args: ['sub-hard-1', PK3, PERSONAL_PLAN],
    });

    const app = buildApp(SUB3, PK3);
    // DELETE /me 는 c.env.PASSWORD_PEPPER 를 쓰므로 env 를 넘긴다.
    const res = await app.request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT pseudonym, plan_id, retained_reason FROM retained_billing_records WHERE plan_id = ?`,
      args: [PERSONAL_PLAN],
    });
    console.log('[DELETE /me retained]', JSON.stringify(retained.rows));
    expect(retained.rows.length).toBe(1);
    expect(String(retained.rows[0]!.pseudonym)).toHaveLength(64); // SHA-256 hex
    expect(retained.rows[0]!.retained_reason).toBe('ecommerce_act_5y');

    const userGone = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [PK3] });
    expect(userGone.rows.length).toBe(0);
  });

  it('구독 결제도 스토어 증빙(거래 id·상품·원본)을 함께 보존한다', async () => {
    // ⚠ `purgeUserAccount` 가 `store_transactions` 를 통째로 지우므로, 증빙을 옮겨 두지
    //   않으면 **남은 기록을 실제 주문에 되짚을 방법이 사라진다** — 결제 분쟁에서
    //   "이 사람이 이 주문을 했다" 를 보일 수 없다(코덱스 #730 4차).
    const SUB5 = 'hard-del-sub-3';
    const PK5 = 'hard-del-pk-3';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK5, SUB5, 'harddel3@test.com', 'Hard Delete 3'],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'active', '2026-01-01', '2030-01-01')`,
      args: ['sub-hard-3', PK5, PERSONAL_PLAN],
    });
    await db.execute({
      sql: `INSERT INTO store_transactions
              (id, user_id, provider, provider_transaction_id, product_id, plan_key,
               subscription_id, raw_payload, created_at)
            VALUES (?, ?, 'google', ?, ?, 'personal', ?, ?, '2026-01-01T00:00:00.000Z')`,
      args: [
        'st-hard-3',
        PK5,
        'play-token-hard-3',
        'personal_monthly',
        'sub-hard-3',
        '{"via":"confirm"}',
      ],
    });

    const res = await buildApp(SUB5, PK5).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT provider, provider_transaction_id, product_id, raw_payload, amount_krw
            FROM retained_billing_records
            WHERE provider_transaction_id = ?`,
      args: ['play-token-hard-3'],
    });
    expect(retained.rows.length).toBe(1);
    const row = retained.rows[0]!;
    expect(row.provider).toBe('google');
    expect(row.product_id).toBe('personal_monthly');
    expect(row.raw_payload).toBe('{"via":"confirm"}');
    // ⚠ **증빙이 있으면 금액은 비운다**(코덱스 #734 4차). `plans.price_krw` 는 지금의
    //   원화 표시가일 뿐인데, 특정 애플/Play 주문 옆에 적으면 **그 주문이 이 금액이었다**
    //   고 단언하는 셈이다(통화도 비어 있다). 실제 금액은 거래 id 로 스토어에서 확인한다.
    expect(row.amount_krw).toBeNull();

    // 원본은 파기됐다 — 그래서 위 증빙을 옮겨 두는 것이다.
    const gone = await db.execute({
      sql: 'SELECT id FROM store_transactions WHERE user_id = ?',
      args: [PK5],
    });
    expect(gone.rows.length).toBe(0);
  });

  it('스토어 결제가 아니면(프로모·바우처) 요금제 표시가를 남긴다 — 되짚을 곳이 없다', async () => {
    const SUB9 = 'hard-del-sub-7';
    const PK9 = 'hard-del-pk-7';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK9, SUB9, 'harddel7@test.com', 'Hard Delete 7'],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'active', '2026-08-01', '2026-12-01')`,
      args: ['sub-hard-7', PK9, PERSONAL_PLAN],
    });
    // store_transactions 없음 — 프로모·바우처 갈래.

    const res = await buildApp(SUB9, PK9).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT amount_krw, provider FROM retained_billing_records
            WHERE plan_id = ? AND provider IS NULL`,
      args: [PERSONAL_PLAN],
    });
    expect(retained.rows.length).toBeGreaterThan(0);
    expect(Number(retained.rows[retained.rows.length - 1]!.amount_krw)).toBeGreaterThan(0);
  });

  it('5년이 지난 구독 결제는 다시 보존하지 않는다 — 기준은 탈퇴일이 아니라 거래일', async () => {
    // ⚠ 탈퇴 시각부터 5년을 세면 4년 전에 결제한 구독이 **9년**을 남는다 —
    //   처리방침이 밝힌 최대 5년을 넘긴다(코덱스 #734). 일회성 갈래와 같은 규칙이다.
    const SUB6 = 'hard-del-sub-4';
    const PK6 = 'hard-del-pk-4';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK6, SUB6, 'harddel4@test.com', 'Hard Delete 4'],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'expired', '2018-01-01', '2018-02-01')`,
      args: ['sub-hard-4', PK6, PERSONAL_PLAN],
    });
    await db.execute({
      sql: `INSERT INTO store_transactions
              (id, user_id, provider, provider_transaction_id, product_id, plan_key,
               subscription_id, created_at)
            VALUES (?, ?, 'google', ?, 'personal_monthly', 'personal', ?, '2018-01-01T00:00:00.000Z')`,
      args: ['st-hard-4', PK6, 'play-token-hard-4', 'sub-hard-4'],
    });

    const res = await buildApp(SUB6, PK6).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT id FROM retained_billing_records WHERE provider_transaction_id = ?`,
      args: ['play-token-hard-4'],
    });
    expect(retained.rows.length).toBe(0);

    // 계정 파기 자체는 끝까지 간다.
    const userGone = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [PK6] });
    expect(userGone.rows.length).toBe(0);
  });

  it('5년 넘게 갱신해 온 구독은 최근 기간을 기준으로 보존한다 — 체인 최초 시각이 아니라', async () => {
    // ⚠ `store_transactions.created_at` 은 **체인이 처음 들어온 시각**이다(갱신은 그 행의
    //   expires_at 만 고친다). 그것만 보면 오래 갱신해 온 구독은 이미 지난 날짜가 나와
    //   **이번 달에 결제한 사람의 증빙까지 버린다**(코덱스 #734 2차).
    const SUB7 = 'hard-del-sub-5';
    const PK7 = 'hard-del-pk-5';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK7, SUB7, 'harddel5@test.com', 'Hard Delete 5'],
    });
    // 2018년부터 갱신해 온 구독 — 지금도 유효하다.
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'active', '2018-01-01', '2030-01-01')`,
      args: ['sub-hard-5', PK7, PERSONAL_PLAN],
    });
    await db.execute({
      sql: `INSERT INTO store_transactions
              (id, user_id, provider, provider_transaction_id, product_id, plan_key,
               subscription_id, created_at)
            VALUES (?, ?, 'google', ?, 'personal_monthly', 'personal', ?, '2018-01-01T00:00:00.000Z')`,
      args: ['st-hard-5', PK7, 'play-token-hard-5', 'sub-hard-5'],
    });

    const res = await buildApp(SUB7, PK7).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT retain_until FROM retained_billing_records WHERE provider_transaction_id = ?`,
      args: ['play-token-hard-5'],
    });
    expect(retained.rows.length).toBe(1);
    // 기준일이 2018 이 아니라 **지금 기간의 시작**(2030-01-01 − 30일 ≈ 2029-12-02)이다.
    const retainUntil = String(retained.rows[0]!.retain_until);
    expect(retainUntil > '2034-11-01').toBe(true);
    // ⚠ **기간의 끝(2030-01-01)을 쓰면 2035-01-01 이 된다 — 한 주기만큼 더 남는다.**
    //   프로모처럼 기간이 길면 그 초과가 몇 년이 되어 처리방침의 최대 5년을 넘긴다
    //   (코덱스 #734 3차).
    expect(retainUntil < '2035-01-01').toBe(true);
  });

  it('last_paid_at 이 있으면 그것을 기준으로 삼는다 — 추정치를 쓰지 않는다', async () => {
    // ⚠ 확정 경로가 결제 시점에 적어 두는 값이다(마이그레이션 114). 추정으로 되돌리면
    //   애플의 달력 달(P1M)과 period_days=30 이 어긋나 며칠씩 틀린다(코덱스 #734 5차).
    const SUBA = 'hard-del-sub-8';
    const PKA = 'hard-del-pk-8';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PKA, SUBA, 'harddel8@test.com', 'Hard Delete 8'],
    });
    // 2018 에 시작해 지금도 갱신 중 — created_at 과 last_paid_at 이 크게 벌어진 상태.
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'active', '2018-01-01', '2026-10-31')`,
      args: ['sub-hard-8', PKA, PERSONAL_PLAN],
    });
    await db.execute({
      sql: `INSERT INTO store_transactions
              (id, user_id, provider, provider_transaction_id, product_id, plan_key,
               subscription_id, created_at, last_paid_at)
            VALUES (?, ?, 'apple', ?, 'com.alarmtalk.app.personal_monthly', 'personal', ?,
                    '2018-01-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z')`,
      args: ['st-hard-8', PKA, 'apple-original-8', 'sub-hard-8'],
    });

    const res = await buildApp(SUBA, PKA).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT retain_until FROM retained_billing_records WHERE provider_transaction_id = ?`,
      args: ['apple-original-8'],
    });
    expect(retained.rows.length).toBe(1);
    // 2026-09-05 + 5년 = 2031-09-05.
    // ⚠ 추정치를 썼다면 2026-10-31 − 30일 = 2026-10-01 → **2031-10-01** 이 나온다.
    //   두 날짜가 겹치지 않게 기간을 어긋나게 뒀다 — 겹치면 이 테스트가 아무것도 안 지킨다.
    expect(String(retained.rows[0]!.retain_until).startsWith('2031-09-05')).toBe(true);
  });

  it('기간이 긴 부여는 초과 보존이 더 커진다 — 그래서 기간의 끝을 쓰지 않는다', async () => {
    // 3년짜리 수동 부여를 흉내 낸다. 기간의 끝을 기준으로 삼으면 결제일로부터 8년이 남는다.
    const SUB8 = 'hard-del-sub-6';
    const PK8 = 'hard-del-pk-6';
    const LONG_PLAN = 'plan-long-grant';
    await db.execute({
      sql: `INSERT INTO plans (id, key, name, plan_type, period_days, max_members, price_krw, is_active)
            VALUES (?, 'long_grant', '장기부여', 'personal', 1095, 1, 0, 0)`,
      args: [LONG_PLAN],
    });
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK8, SUB8, 'harddel6@test.com', 'Hard Delete 6'],
    });
    await db.execute({
      sql: `INSERT INTO subscriptions (id, user_id, plan_id, status, starts_at, expires_at)
            VALUES (?, ?, ?, 'active', '2026-01-01', '2029-01-01')`,
      args: ['sub-hard-6', PK8, LONG_PLAN],
    });
    await db.execute({
      sql: `INSERT INTO store_transactions
              (id, user_id, provider, provider_transaction_id, product_id, plan_key,
               subscription_id, created_at)
            VALUES (?, ?, 'google', ?, 'long_grant', 'long_grant', ?, '2026-01-01T00:00:00.000Z')`,
      args: ['st-hard-6', PK8, 'play-token-hard-6', 'sub-hard-6'],
    });

    const res = await buildApp(SUB8, PK8).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const retained = await db.execute({
      sql: `SELECT retain_until FROM retained_billing_records WHERE provider_transaction_id = ?`,
      args: ['play-token-hard-6'],
    });
    expect(retained.rows.length).toBe(1);
    // 결제일(2026-01-01)로부터 5년 — 기간의 끝(2029-01-01)을 썼다면 2034 가 됐을 것이다.
    expect(String(retained.rows[0]!.retain_until) < '2032-01-01').toBe(true);
  });

  it('사용 기록이 남아 있어도 계정 파기가 끝까지 간다', async () => {
    const SUB4 = 'hard-del-sub-2';
    const PK4 = 'hard-del-pk-2';
    await db.execute({
      sql: `INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)`,
      args: [PK4, SUB4, 'harddel2@test.com', 'Hard Delete 2'],
    });
    // `usage_events.user_id` 는 users 의 FK 자식이다 — 파기에서 빼먹으면 여기서
    // FK 로 던져 **탈퇴가 통째로 롤백된다**(1년 보관이 다할 때까지 계정이 안 지워진다).
    await db.execute({
      sql: `INSERT INTO usage_events (id, user_id, type, occurred_at)
            VALUES (?, ?, 'alarm_rang', '2026-09-01T00:00:00.000Z')`,
      args: ['ev-purge-1', PK4],
    });

    const res = await buildApp(SUB4, PK4).request(req('DELETE', '/user/me'), undefined, {
      PASSWORD_PEPPER: 'pep',
    } as unknown as Record<string, unknown>);
    expect(res.status).toBe(200);

    const userGone = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [PK4] });
    expect(userGone.rows.length).toBe(0);
    const events = await db.execute({
      sql: 'SELECT id FROM usage_events WHERE user_id = ?',
      args: [PK4],
    });
    expect(events.rows.length).toBe(0);
  });
});
