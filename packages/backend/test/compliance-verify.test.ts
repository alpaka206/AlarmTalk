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

// libsql `:memory:` 는 연결마다 별도 DB라 autocommit execute 와 transaction 이 스키마를
// 공유하지 못한다. 모든 연결이 같은 스키마를 보도록 임시 파일 DB 를 사용한다.
const DB_PATH = join(tmpdir(), 'alarmtalk-compliance-verify.db');
const db: Client = createClient({ url: `file:${DB_PATH}` });

vi.mock('../src/lib/db', () => ({ getDB: () => db }));

import userRoutes from '../src/routes/user';

const SUB = 'compliance-sub';
const PK = 'compliance-pk';

function authAs(userId = SUB, userPk = PK) {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set('userId', userId);
    c.set('userIdPK', userPk);
    c.set('userEmail', 'compliance@test.com');
    c.set('userName', 'Compliance Tester');
    c.set('userPicture', '');
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

beforeAll(async () => {
  await runMigrations(db);
  // 이전 실행에서 파일이 남아있을 수 있어(클라이언트가 파일을 잡고 있으면 rmSync 불가)
  // 테이블을 비워 항상 깨끗한 상태에서 시작한다.
  await db.execute('DELETE FROM user_consents');
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
      req('POST', '/user/consents', {
        consents: [
          { type: 'terms', agreed: true },
          { type: 'privacy', agreed: true },
          { type: 'marketing', agreed: false }, // 광고성 정보 수신: 선택 → 미동의로 기록
          { type: 'age14', agreed: true },
        ],
      }),
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
    await app.request(req('POST', '/user/consents', { consents: [{ type: 'marketing', agreed: true }] }));
    const res = await app.request(req('GET', '/user/consents'));
    const body = await res.json();
    const marketing = body.consents.find((c: { consent_type: string }) => c.consent_type === 'marketing');
    console.log('[GET /consents after re-consent]', JSON.stringify(marketing));
    expect(marketing.agreed).toBe(true);
  });

  it('허용되지 않은 동의 유형은 400 INVALID_CONSENT_TYPE', async () => {
    const app = buildApp();
    const res = await app.request(req('POST', '/user/consents', { consents: [{ type: 'sell_my_data', agreed: true }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error_code).toBe('INVALID_CONSENT_TYPE');
  });
});

describe('동의 상태 — 기존/신규 가입자 재동의 판단', () => {
  const NEW_SUB = 'no-consent-sub';
  const NEW_PK = 'no-consent-pk';

  it('동의 기록이 없는 사용자는 needs_consent=true, 필수 3종 모두 missing', async () => {
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
    expect(body.missing.sort()).toEqual(['age14', 'privacy', 'terms']);
  });

  it('필수 3종 동의 기록 후 needs_consent=false (marketing 미동의여도 무관)', async () => {
    const app = buildApp(NEW_SUB, NEW_PK);
    await app.request(
      req('POST', '/user/consents', {
        consents: [
          { type: 'terms', agreed: true },
          { type: 'privacy', agreed: true },
          { type: 'age14', agreed: true },
          { type: 'marketing', agreed: false },
        ],
      }),
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
      req('POST', '/user/consents', {
        consents: [
          { type: 'terms', agreed: true },
          { type: 'privacy', agreed: false },
          { type: 'age14', agreed: true },
        ],
      }),
    );
    const res = await app.request(req('GET', '/user/consents/status'));
    const body = await res.json();
    console.log('[GET /consents/status — 부분동의]', JSON.stringify(body));
    expect(body.needs_consent).toBe(true);
    expect(body.missing).toEqual(['privacy']);
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
