import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { loadAudioBytes, uint8ToBase64, isStoredAudioUrl } from '../lib/audio-loader';

const notes = new Hono<AppEnv>();

async function resolveUserPk(
  db: ReturnType<typeof getDB>,
  googleId: string,
): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT id FROM users WHERE google_id = ?',
    args: [googleId],
  });
  return res.rows.length > 0 ? String(res.rows[0]!.id) : null;
}

notes.post('/', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const senderPk = await resolveUserPk(db, userId);
  if (!senderPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const body = await c.req
    .json<{ receiver_id?: unknown; text?: unknown; audio_url?: unknown }>()
    .catch(() => ({ receiver_id: undefined, text: undefined, audio_url: undefined }));

  const receiverId = typeof body.receiver_id === 'string' ? body.receiver_id.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const audioUrl = typeof body.audio_url === 'string' ? body.audio_url.trim() : null;

  if (!receiverId) return c.json({ error: 'receiver_id 는 필수입니다', error_code: 'RECEIVER_REQUIRED' }, 400);
  if (!text) return c.json({ error: 'text 는 필수입니다', error_code: 'TEXT_REQUIRED' }, 400);
  if (text.length > 500) return c.json({ error: 'text 는 최대 500자입니다', error_code: 'TEXT_TOO_LONG' }, 400);
  if (receiverId === senderPk) return c.json({ error: '자기 자신에게는 보낼 수 없습니다', error_code: 'SELF_NOTE' }, 400);

  if (audioUrl && !isStoredAudioUrl(audioUrl)) {
    return c.json({ error: 'audio_url must be a stored r2:// object', error_code: 'INVALID_AUDIO_URL' }, 400);
  }

  const receiverRes = await db.execute({
    sql: 'SELECT id FROM users WHERE id = ?',
    args: [receiverId],
  });
  if (receiverRes.rows.length === 0) {
    return c.json({ error: '수신자를 찾을 수 없습니다', error_code: 'RECEIVER_NOT_FOUND' }, 404);
  }

  const memberCheck = await db.execute({
    sql: `SELECT pgm1.plan_group_id
          FROM plan_group_members pgm1
          JOIN plan_group_members pgm2
            ON pgm1.plan_group_id = pgm2.plan_group_id
          WHERE pgm1.user_id = ? AND pgm2.user_id = ?
          LIMIT 1`,
    args: [senderPk, receiverId],
  });
  if (memberCheck.rows.length === 0) {
    return c.json({ error: '같은 가족 그룹 멤버에게만 쪽지를 보낼 수 있습니다', error_code: 'NOT_SAME_GROUP' }, 403);
  }

  const noteId = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO notes (id, sender_id, receiver_id, text, audio_url)
          VALUES (?, ?, ?, ?, ?)`,
    args: [noteId, senderPk, receiverId, text, audioUrl || null],
  });

  return c.json({
    success: true,
    note: {
      id: noteId,
      sender_id: senderPk,
      receiver_id: receiverId,
      text,
      audio_url: audioUrl || null,
      audio_available: Boolean(audioUrl),
      read_at: null,
      created_at: new Date().toISOString(),
    },
  }, 201);
});

notes.get('/received', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ notes: [] });

  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
  const offset = Math.max(Number(offsetRaw) || 0, 0);

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM notes WHERE receiver_id = ?',
      args: [userPk],
    }),
    db.execute({
      sql: `SELECT n.id, n.sender_id, n.text, n.audio_url, n.read_at, n.created_at,
                   u.name AS sender_name, u.email AS sender_email, u.picture AS sender_picture
            FROM notes n
            JOIN users u ON u.id = n.sender_id
            WHERE n.receiver_id = ?
            ORDER BY n.created_at DESC
            LIMIT ? OFFSET ?`,
      args: [userPk, limit, offset],
    }),
  ]);

  return c.json({
    notes: result.rows.map((r) => {
      const audioUrl = (r.audio_url as string | null) ?? null;
      return {
        id: String(r.id),
        sender_id: String(r.sender_id),
        sender_name: (r.sender_name as string | null) ?? null,
        sender_email: String(r.sender_email),
        sender_picture: (r.sender_picture as string | null) ?? null,
        text: String(r.text),
        audio_url: audioUrl,
        audio_available: Boolean(audioUrl),
        read_at: (r.read_at as string | null) ?? null,
        created_at: String(r.created_at),
      };
    }),
    total: Number(countRes.rows[0]!.cnt),
    limit,
    offset,
  });
});

notes.get('/sent', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ notes: [] });

  const limitRaw = c.req.query('limit');
  const offsetRaw = c.req.query('offset');
  const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
  const offset = Math.max(Number(offsetRaw) || 0, 0);

  const [countRes, result] = await Promise.all([
    db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM notes WHERE sender_id = ?',
      args: [userPk],
    }),
    db.execute({
      sql: `SELECT n.id, n.receiver_id, n.text, n.audio_url, n.read_at, n.created_at,
                   u.name AS receiver_name, u.email AS receiver_email
            FROM notes n
            JOIN users u ON u.id = n.receiver_id
            WHERE n.sender_id = ?
            ORDER BY n.created_at DESC
            LIMIT ? OFFSET ?`,
      args: [userPk, limit, offset],
    }),
  ]);

  return c.json({
    notes: result.rows.map((r) => {
      const audioUrl = (r.audio_url as string | null) ?? null;
      return {
        id: String(r.id),
        receiver_id: String(r.receiver_id),
        receiver_name: (r.receiver_name as string | null) ?? null,
        receiver_email: String(r.receiver_email),
        text: String(r.text),
        audio_url: audioUrl,
        audio_available: Boolean(audioUrl),
        read_at: (r.read_at as string | null) ?? null,
        created_at: String(r.created_at),
      };
    }),
    total: Number(countRes.rows[0]!.cnt),
    limit,
    offset,
  });
});

notes.get('/:id/audio', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const noteId = c.req.param('id');

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: 'User not found', error_code: 'USER_NOT_FOUND' }, 404);

  const noteRes = await db.execute({
    sql: `SELECT n.id, n.sender_id, n.receiver_id, n.text, n.audio_url,
                 s.google_id AS sender_google_id, s.apple_id AS sender_apple_id
          FROM notes n
          LEFT JOIN users s ON s.id = n.sender_id
          WHERE n.id = ?`,
    args: [noteId],
  });
  if (noteRes.rows.length === 0) {
    return c.json({ error: 'Note not found', error_code: 'NOTE_NOT_FOUND' }, 404);
  }

  const note = noteRes.rows[0]!;
  const senderId = String(note.sender_id);
  const receiverId = String(note.receiver_id);
  if (senderId !== userPk && receiverId !== userPk) {
    return c.json({ error: 'Forbidden', error_code: 'FORBIDDEN' }, 403);
  }

  const audioUrl = (note.audio_url as string | null) ?? null;
  if (!audioUrl) {
    return c.json({ error: 'Note has no stored audio', error_code: 'NOTE_AUDIO_MISSING' }, 404);
  }

  // 음성 쪽지의 R2 오브젝트는 발신자가 만든 것이므로, 키의 소유자 segment 가
  // 발신자(users.id PK 또는 JWT sub = google_id/apple_id)와 일치해야만 로드한다.
  // 그래야 타인 네임스페이스(r2://voices/{victim}/...) 키를 쪽지에 끼워 넣어
  // 생체 음성을 빼내는 cross-tenant 읽기(IDOR)를 막을 수 있다.
  // (Apple 전용 계정은 키가 apple_id 로 네임스페이스되므로 apple_id 도 허용.)
  const senderGoogleId =
    typeof note.sender_google_id === 'string' ? note.sender_google_id : null;
  const senderAppleId =
    typeof note.sender_apple_id === 'string' ? note.sender_apple_id : null;
  const ownerIds = [
    senderId,
    ...(senderGoogleId ? [senderGoogleId] : []),
    ...(senderAppleId ? [senderAppleId] : []),
  ];
  const loaded = await loadAudioBytes(c, audioUrl, { kind: 'owner', ownerIds });
  if (!loaded) {
    if (audioUrl.startsWith('r2://')) {
      await db.execute({
        sql: 'UPDATE notes SET audio_url = NULL WHERE id = ? AND audio_url = ?',
        args: [noteId, audioUrl],
      });
    }
    return c.json({ error: 'Stored note audio not found', error_code: 'NOTE_AUDIO_NOT_FOUND' }, 404);
  }

  return c.json({
    note_id: String(note.id),
    audio_base64: uint8ToBase64(loaded.bytes),
    audio_format: loaded.format,
    audio_url: audioUrl,
    text: String(note.text ?? ''),
  });
});

notes.patch('/:id/read', async (c) => {
  const userId = c.get('userId');
  const db = getDB(c.env);
  const noteId = c.req.param('id');

  const userPk = await resolveUserPk(db, userId);
  if (!userPk) return c.json({ error: '사용자를 찾을 수 없습니다', error_code: 'USER_NOT_FOUND' }, 404);

  const noteRes = await db.execute({
    sql: 'SELECT id, receiver_id, read_at FROM notes WHERE id = ?',
    args: [noteId],
  });
  if (noteRes.rows.length === 0) {
    return c.json({ error: '쪽지를 찾을 수 없습니다', error_code: 'NOTE_NOT_FOUND' }, 404);
  }
  if (String(noteRes.rows[0]!.receiver_id) !== userPk) {
    return c.json({ error: '권한이 없습니다', error_code: 'FORBIDDEN' }, 403);
  }
  if (noteRes.rows[0]!.read_at) {
    return c.json({ success: true, already_read: true });
  }

  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE notes SET read_at = ? WHERE id = ?`,
    args: [now, noteId],
  });

  return c.json({ success: true, read_at: now });
});

export default notes;
