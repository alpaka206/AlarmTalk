import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { createMockDB, fakeAuthMiddleware, jsonReq } from './helpers';

const mockDB = createMockDB();

vi.mock('../src/lib/db', () => ({
  getDB: () => mockDB.client,
}));

const { mockSendNotePush } = vi.hoisted(() => ({
  mockSendNotePush: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/lib/fcm', () => ({
  sendNotePush: mockSendNotePush,
}));

import notesRoutes from '../src/routes/notes';

function buildApp(userId = 'user-1') {
  const app = new Hono<AppEnv>();
  app.use('*', fakeAuthMiddleware(userId));
  app.route('/notes', notesRoutes);
  return app;
}

beforeEach(() => {
  mockDB.reset();
  mockSendNotePush.mockClear();
});

describe('POST /notes — 쪽지 전송', () => {
  it('사용자 조회 실패 시 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'r1', text: 'hi' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('receiver_id 누락 시 400', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { text: 'hi' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('receiver_id');
    expect(body.error_code).toBe('RECEIVER_REQUIRED');
  });

  it('text 누락 시 400', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'r1' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('text');
    expect(body.error_code).toBe('TEXT_REQUIRED');
  });

  it('text 500자 초과 시 400', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'r1', text: 'x'.repeat(501) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('500');
    expect(body.error_code).toBe('TEXT_TOO_LONG');
  });

  it('자기 자신에게 전송 시 400', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk1', text: 'hello' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('자기 자신');
    expect(body.error_code).toBe('SELF_NOTE');
  });

  it('수신자 미존재 시 404', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'no-one', text: 'hello' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('수신자');
    expect(body.error_code).toBe('RECEIVER_NOT_FOUND');
  });

  it('같은 가족 그룹이 아니면 403', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: 'hello' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('가족 그룹');
    expect(body.error_code).toBe('NOT_SAME_GROUP');
  });

  it('정상 전송 201', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: 'Sender', email: 'sender@test.com' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: '좋은 아침!' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.note.sender_id).toBe('pk1');
    expect(body.note.receiver_id).toBe('pk2');
    expect(body.note.text).toBe('좋은 아침!');
    expect(body.note.audio_url).toBeNull();
    expect(body.note.read_at).toBeNull();

    const insertSql = mockDB.calls[3].sql;
    expect(insertSql).toContain('INSERT INTO notes');
  });

  it('JSON 파싱 실패 시 receiver_id 누락으로 400', async () => {
    const app = buildApp();
    mockDB.pushResult([{ id: 'pk1' }]);
    const res = await app.request(
      new Request('http://localhost/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('sendNotePush 호출 시 올바른 인자 전달 (ko 기본)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: 'Sender', email: 'sender@test.com' }]);
    const app = buildApp();
    await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: '좋은 아침!' }));
    expect(mockSendNotePush).toHaveBeenCalledTimes(1);
    const callArgs = mockSendNotePush.mock.calls[0];
    expect(callArgs[1]).toBe('pk2');
    expect(callArgs[3]).toBe('Sender');
    expect(callArgs[4]).toBe('ko');
  });

  it('Accept-Language: en 시 locale en 전달', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: 'Sender', email: 'sender@test.com' }]);
    const app = buildApp();
    const req = jsonReq('POST', '/notes', { receiver_id: 'pk2', text: 'hi' });
    req.headers.set('Accept-Language', 'en-US,en;q=0.9');
    await app.request(req);
    expect(mockSendNotePush.mock.calls[0][4]).toBe('en');
  });

  it('sender name null 시 email 폴백', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: null, email: 'fallback@test.com' }]);
    const app = buildApp();
    await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: 'hi' }));
    expect(mockSendNotePush.mock.calls[0][3]).toBe('fallback@test.com');
  });

  it('sender name+email 모두 null 시 Someone 폴백', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: null, email: null }]);
    const app = buildApp();
    await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: 'hi' }));
    expect(mockSendNotePush.mock.calls[0][3]).toBe('Someone');
  });

  it('text 정확히 500자면 성공', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: 'Sender', email: 'sender@test.com' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: 'x'.repeat(500) }));
    expect(res.status).toBe(201);
  });

  it('receiver_id 공백만이면 400', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: '   ', text: 'hi' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('RECEIVER_REQUIRED');
  });

  it('text 공백만이면 400', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'r1', text: '   ' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error_code).toBe('TEXT_REQUIRED');
  });

  it('text 앞뒤 공백 trim', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'pk2' }]);
    mockDB.pushResult([{ plan_group_id: 'g1' }]);
    mockDB.pushResult([], 1);
    mockDB.pushResult([{ name: 'Sender', email: 'sender@test.com' }]);
    const app = buildApp();
    const res = await app.request(jsonReq('POST', '/notes', { receiver_id: 'pk2', text: '  hello  ' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.note.text).toBe('hello');
  });
});

describe('GET /notes/received — 수신 쪽지', () => {
  it('사용자 미존재 시 빈 배열', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/received'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toEqual([]);
  });

  it('정상 조회', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 1 }]);
    mockDB.pushResult([
      {
        id: 'n1',
        sender_id: 'pk2',
        text: '안녕',
        audio_url: null,
        read_at: null,
        created_at: '2026-04-24T10:00:00Z',
        sender_name: 'Alice',
        sender_email: 'alice@test.com',
        sender_picture: null,
      },
    ]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/received'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].sender_name).toBe('Alice');
    expect(body.notes[0].text).toBe('안녕');
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('limit/offset 파라미터 적용', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(new Request('http://localhost/notes/received?limit=5&offset=10'));
    const selectArgs = mockDB.calls[2].args;
    expect(selectArgs).toContain(5);
    expect(selectArgs).toContain(10);
  });

  it('limit 범위 클램핑 (max 100)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(new Request('http://localhost/notes/received?limit=999'));
    expect(mockDB.calls[2].args).toContain(100);
  });

  it('limit 0 → 기본값 20 (0은 falsy)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/received?limit=0'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(20);
  });

  it('음수 offset → 0으로 클램핑', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/received?offset=-5'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.offset).toBe(0);
  });

  it('비숫자 limit/offset → 기본값 적용', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/received?limit=abc&offset=xyz'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });
});

describe('GET /notes/sent — 발신 쪽지', () => {
  it('사용자 미존재 시 빈 배열', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/sent'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toEqual([]);
  });

  it('정상 조회', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 1 }]);
    mockDB.pushResult([
      {
        id: 'n2',
        receiver_id: 'pk3',
        text: '잘 자',
        audio_url: 'https://r2.example/audio.mp3',
        read_at: '2026-04-24T12:00:00Z',
        created_at: '2026-04-24T10:00:00Z',
        receiver_name: 'Bob',
        receiver_email: 'bob@test.com',
      },
    ]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/sent'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].receiver_name).toBe('Bob');
    expect(body.notes[0].audio_url).toBe('https://r2.example/audio.mp3');
    expect(body.notes[0].read_at).toBe('2026-04-24T12:00:00Z');
    expect(body.total).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });
});

describe('GET /notes/sent — 페이지네이션', () => {
  it('limit/offset 파라미터 적용', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    await app.request(new Request('http://localhost/notes/sent?limit=10&offset=5'));
    const selectArgs = mockDB.calls[2].args;
    expect(selectArgs).toContain(10);
    expect(selectArgs).toContain(5);
  });

  it('limit max 100 클램핑', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/sent?limit=200'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
  });

  it('limit 음수 → 기본값 20 (NaN || 20)', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ cnt: 0 }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/sent?limit=-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(1);
  });
});

describe('PATCH /notes/:id/read — 읽음 처리', () => {
  it('사용자 미존재 시 404', async () => {
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/n1/read', { method: 'PATCH' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error_code).toBe('USER_NOT_FOUND');
  });

  it('쪽지 미존재 시 404', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/no-note/read', { method: 'PATCH' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('쪽지');
    expect(body.error_code).toBe('NOTE_NOT_FOUND');
  });

  it('다른 사용자의 쪽지 읽음 처리 시 403', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'n1', receiver_id: 'pk-other', read_at: null }]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/n1/read', { method: 'PATCH' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error_code).toBe('FORBIDDEN');
  });

  it('이미 읽은 쪽지는 already_read true', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'n1', receiver_id: 'pk1', read_at: '2026-04-24T10:00:00Z' }]);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/n1/read', { method: 'PATCH' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_read).toBe(true);
  });

  it('정상 읽음 처리', async () => {
    mockDB.pushResult([{ id: 'pk1' }]);
    mockDB.pushResult([{ id: 'n1', receiver_id: 'pk1', read_at: null }]);
    mockDB.pushResult([], 1);
    const app = buildApp();
    const res = await app.request(new Request('http://localhost/notes/n1/read', { method: 'PATCH' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.read_at).toBeDefined();

    const updateSql = mockDB.calls[2].sql;
    expect(updateSql).toContain('UPDATE notes SET read_at');
  });
});
