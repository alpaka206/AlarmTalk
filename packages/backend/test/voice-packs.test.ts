// 추가 음성팩(`docs/spec/voice-packs.md`) — 실제 SQLite(메모리)에 마이그레이션을 전부 돌리고 확인한다.
//  - 비게시 팩(draft·review)은 목록·상세·오디오 어디에도 없다
//  - 권리 메타데이터(증빙 위치·기간·허용 문구·지역·이용 조건)는 앱 응답에 한 글자도 없다
//  - 최소 앱 빌드·허용 지역·권리 기간 밖이면 받을 수 없다
//  - 게시가 끝나면 `withdrawn` 에 기존 재생 기한이 실린다(이용 조건별), 게시된 적 없는 팩은 안 실린다
//  - IDOR: 다른 팩의 clip id 로는 오디오를 못 받는다
//  - 관리자: 가져오기는 draft 만, 기본 목소리 구조 밖 자리는 거절, 게시 조건, 감사 기록, 게시 중 권리 수정이 조건을 깨면 거절
//  - 팩 목소리는 목소리 프로필이 아니다(직접 입력 합성이 그 목소리를 모른다)
//
// ⚠ 여기 팩 행은 **테스트 fixture** 다. 운영 시드·마이그레이션에는 팩을 넣지 않는다(스펙 §0).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { Hono } from 'hono';
import type { AppEnv } from '../src/types';
import { runMigrations } from '../src/lib/migrations';

const holder: { db: Client | null } = { db: null };
vi.mock('../src/lib/db', () => ({
  getDB: () => holder.db,
}));

import voicePackRoutes from '../src/routes/voice-packs';
import adminRoutes from '../src/routes/admin';
import {
  importVoicePackClip,
  packListable,
  publishBlockers,
  transitionVoicePack,
  updateVoicePackRights,
  upsertDraftVoicePack,
  voicePackExpectedVariants,
  withdrawnPlaybackUntil,
  VOICE_PACK_VOICE_ID_PREFIX,
  VoicePackAdminError,
  loadVoicePack,
  loadVoicePackClips,
  type VoicePackRow,
} from '../src/lib/voice-packs';

const DAY = 24 * 60 * 60 * 1000;
const EVIDENCE = 'drive://contracts/secret-evidence-location.pdf';
const ALLOWED_TEXT = 'internal allowed text scope note';

let db: Client;

/** R2 흉내 — put/get/delete 만. */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const bucket = {
    objects,
    async put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes: new Uint8Array(value), contentType: opts?.httpMetadata?.contentType ?? '' });
      return {};
    },
    async get(key: string) {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        customMetadata: { mimeType: obj.contentType },
        httpMetadata: { contentType: obj.contentType },
        size: obj.bytes.byteLength,
        uploaded: new Date(),
        arrayBuffer: async () => obj.bytes.buffer.slice(obj.bytes.byteOffset, obj.bytes.byteOffset + obj.bytes.byteLength),
      };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  return bucket;
}

let bucket = fakeBucket();

function b64(text: string): string {
  return Buffer.from(text).toString('base64');
}

/** 기본 목소리와 같은 구조의 완전한 draft 팩을 만든다. */
async function makeCompletePack(packId: string, language = 'ko'): Promise<VoicePackRow> {
  await upsertDraftVoicePack(db, { packId, speakerName: `화자 ${packId}`, language, usageNote: '알람 테마에 써요' }, 'test');
  await importVoicePackClip(
    db,
    bucket as unknown as R2Bucket,
    packId,
    { category: 'greeting', variant: 0, text: '안녕하세요', audioBase64: b64(`${packId}-greeting`), audioFormat: 'mp3' },
    'test',
  );
  for (const [category, count] of Object.entries(voicePackExpectedVariants())) {
    for (let i = 0; i < count; i++) {
      await importVoicePackClip(
        db,
        bucket as unknown as R2Bucket,
        packId,
        { category, variant: i, text: `${category} ${i}`, audioBase64: b64(`${packId}-${category}-${i}`), audioFormat: 'mp3' },
        'test',
      );
    }
  }
  return (await loadVoicePack(db, packId))!;
}

async function verifyRights(packId: string, now = new Date(), overrides: Partial<Parameters<typeof updateVoicePackRights>[2]> = {}) {
  const day = (offset: number) => new Date(now.getTime() + offset * DAY).toISOString().slice(0, 10);
  await updateVoicePackRights(
    db,
    packId,
    {
      rightsStatus: 'verified',
      evidenceRef: EVIDENCE,
      validFrom: day(-3),
      validUntil: day(60),
      allowedText: ALLOWED_TEXT,
      allowedRegions: 'KR, JP',
      existingFileTerms: 'until_rights_end',
      existingPlaybackUntil: '',
      ...overrides,
    },
    'test',
    now,
  );
}

async function publish(packId: string, now = new Date()) {
  await transitionVoicePack(db, packId, 'submit', '', 'test', now);
  await transitionVoicePack(db, packId, 'publish', '', 'test', now);
}

function app() {
  const a = new Hono<AppEnv>();
  a.route('/api/voice-packs', voicePackRoutes);
  return a;
}

function appRequest(path: string, headers: Record<string, string> = {}) {
  return app().request(
    `http://localhost${path}`,
    { headers: { 'X-App-Platform': 'android', 'X-App-Version': '50', 'CF-IPCountry': 'KR', ...headers } },
    { VOICE_BUCKET: bucket } as unknown as AppEnv['Bindings'],
  );
}

beforeAll(async () => {
  db = createClient({ url: ':memory:' });
  holder.db = db;
  await runMigrations(db);
});

beforeEach(async () => {
  for (const t of ['voice_pack_events', 'voice_pack_clips', 'voice_packs']) await db.execute(`DELETE FROM ${t}`);
  bucket = fakeBucket();
});

describe('앱 API — 노출', () => {
  it('운영 마이그레이션은 팩을 심지 않는다(외부 권리/음원 대기)', async () => {
    const fresh = createClient({ url: ':memory:' });
    await runMigrations(fresh);
    const rows = await fresh.execute('SELECT COUNT(*) AS n FROM voice_packs');
    expect(Number(rows.rows[0]!.n)).toBe(0);
  });

  it('draft·review 팩은 목록·상세·오디오 어디에도 없다', async () => {
    const pack = await makeCompletePack('draft-pack');
    await verifyRights('draft-pack');
    const clip = (await loadVoicePackClips(db, pack.id))[0]!;
    for (const step of ['draft', 'review']) {
      if (step === 'review') await transitionVoicePack(db, pack.id, 'submit', '', 'test', new Date());
      const list = await (await appRequest('/api/voice-packs')).json();
      expect(list).toEqual({ packs: [], withdrawn: [] });
      const detail = await appRequest(`/api/voice-packs/${pack.id}`);
      expect(detail.status).toBe(404);
      expect(((await detail.json()) as { error_code: string }).error_code).toBe('VOICE_PACK_NOT_FOUND');
      const audio = await appRequest(`/api/voice-packs/${pack.id}/clips/${clip.id}/audio`);
      expect(audio.status).toBe(404);
    }
  });

  it('게시된 팩은 보이고, 권리 메타데이터는 한 글자도 내려가지 않는다', async () => {
    await makeCompletePack('first-pack');
    await verifyRights('first-pack');
    await publish('first-pack');
    const listRes = await appRequest('/api/voice-packs');
    const listText = await listRes.text();
    const list = JSON.parse(listText) as { packs: Array<Record<string, unknown>> };
    expect(list.packs).toHaveLength(1);
    const summary = list.packs[0]!;
    expect(summary.pack_id).toBe('first-pack');
    expect(String(summary.voice_id).startsWith(VOICE_PACK_VOICE_ID_PREFIX)).toBe(true);
    expect(summary.categories).toEqual(['cheer', 'fortune', 'medication', 'weather']);
    // 공개 표식이 있어야 나오는 묶음(새 응원·기상 인사)은 팩의 게시 조건이 아니다 — 테마 넷만 갖춘다(스펙 §2).
    expect(Object.keys(voicePackExpectedVariants()).sort()).toEqual(['cheer', 'fortune', 'medication', 'weather']);
    expect((summary.preview as { clip_id: string }).clip_id).toMatch(/^[0-9a-f-]{36}$/);

    const detailText = await (await appRequest('/api/voice-packs/first-pack')).text();
    const detail = JSON.parse(detailText) as { pack: { clips: Array<Record<string, unknown>> } };
    const expectedCount = 1 + Object.values(voicePackExpectedVariants()).reduce((a, b) => a + b, 0);
    expect(detail.pack.clips).toHaveLength(expectedCount);
    expect(Object.keys(detail.pack.clips[0]!).sort()).toEqual(
      ['audio_format', 'category', 'clip_id', 'language', 'sha256', 'size_bytes', 'text', 'variant'].sort(),
    );

    for (const body of [listText, detailText]) {
      for (const secret of [
        'rights',
        'evidence',
        'existing_file_terms',
        'existing_playback_until',
        'min_android_build',
        'min_ios_build',
        'status',
        'audio_key',
        EVIDENCE,
        ALLOWED_TEXT,
        'voice-packs/',
      ]) {
        expect(body).not.toContain(secret);
      }
    }
  });

  it('오디오는 해시·크기와 함께 받는다', async () => {
    await makeCompletePack('audio-pack');
    await verifyRights('audio-pack');
    await publish('audio-pack');
    const clip = (await loadVoicePackClips(db, 'audio-pack')).find((c) => c.category === 'weather' && c.variant === 0)!;
    const res = await appRequest(`/api/voice-packs/audio-pack/clips/${clip.id}/audio`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { audio_base64: string; sha256: string; size_bytes: number };
    const bytes = Buffer.from(body.audio_base64, 'base64');
    expect(bytes.toString()).toBe('audio-pack-weather-0');
    expect(body.size_bytes).toBe(bytes.byteLength);
    const { createHash } = await import('node:crypto');
    expect(body.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('최소 앱 빌드보다 낮거나 헤더가 없으면 받을 수 없다', async () => {
    await upsertDraftVoicePack(db, { packId: 'new-build', speakerName: 'x', language: 'ko', minAndroidBuild: 60, minIosBuild: 20 }, 'test');
    await makeCompletePack('new-build');
    // makeCompletePack 의 upsert 가 최소 빌드를 0 으로 되돌렸으니 다시 올린다.
    await upsertDraftVoicePack(db, { packId: 'new-build', speakerName: 'x', language: 'ko', minAndroidBuild: 60, minIosBuild: 20 }, 'test');
    await verifyRights('new-build');
    await publish('new-build');
    const count = async (headers: Record<string, string>) =>
      ((await (await appRequest('/api/voice-packs', headers)).json()) as { packs: unknown[] }).packs.length;
    expect(await count({ 'X-App-Version': '59' })).toBe(0);
    expect(await count({ 'X-App-Version': '60' })).toBe(1);
    expect(await count({ 'X-App-Platform': 'ios', 'X-App-Version': '19' })).toBe(0);
    expect(await count({ 'X-App-Platform': 'ios', 'X-App-Version': '20' })).toBe(1);
    expect(await count({ 'X-App-Version': '' })).toBe(0);
    expect((await appRequest('/api/voice-packs/new-build', { 'X-App-Version': '59' })).status).toBe(404);
  });

  it('허용 지역 밖이면 받을 수 없고, * 는 어디서나 된다', async () => {
    await makeCompletePack('region-pack');
    await verifyRights('region-pack');
    await publish('region-pack');
    const count = async (country: string) =>
      ((await (await appRequest('/api/voice-packs', { 'CF-IPCountry': country })).json()) as { packs: unknown[] }).packs.length;
    expect(await count('KR')).toBe(1);
    expect(await count('US')).toBe(0);
    expect(await count('')).toBe(0);
    await transitionVoicePack(db, 'region-pack', 'suspend', '', 'test', new Date());
    await verifyRights('region-pack', new Date(), { allowedRegions: '*' });
    await transitionVoicePack(db, 'region-pack', 'republish', '', 'test', new Date());
    expect(await count('US')).toBe(1);
    expect(await count('')).toBe(1);
  });

  it('IDOR — 다른 팩의 clip id 로는 오디오를 못 받는다(비게시 팩 포함)', async () => {
    await makeCompletePack('open-pack');
    await verifyRights('open-pack');
    await publish('open-pack');
    const hidden = await makeCompletePack('hidden-pack');
    const hiddenClip = (await loadVoicePackClips(db, hidden.id))[0]!;
    const res = await appRequest(`/api/voice-packs/open-pack/clips/${hiddenClip.id}/audio`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error_code: string }).error_code).toBe('VOICE_PACK_CLIP_NOT_FOUND');
    expect((await appRequest('/api/voice-packs/open-pack/clips/not-a-uuid/audio')).status).toBe(404);
    expect((await appRequest(`/api/voice-packs/hidden-pack/clips/${hiddenClip.id}/audio`)).status).toBe(404);
    expect((await appRequest('/api/voice-packs/..%2Fusers')).status).toBe(404);
  });
});

describe('게시가 끝나면 — 기존 재생 기한', () => {
  it('권리 기간이 끝나면 게시 중이어도 목록에서 빠지고 withdrawn 에 권리 끝으로 실린다', async () => {
    const start = new Date('2026-10-26T03:00:00Z');
    await makeCompletePack('ending-pack');
    await verifyRights('ending-pack', start, { validFrom: '2026-10-20', validUntil: '2026-11-01', existingFileTerms: 'until_date', existingPlaybackUntil: '2026-12-31' });
    await publish('ending-pack', start);
    const pack = (await loadVoicePack(db, 'ending-pack'))!;
    const ctx = { now: start, country: 'KR', platform: 'android' as const, build: 50 };
    expect(packListable(pack, ctx)).toBe(true);
    const after = new Date('2026-11-05T00:00:00Z');
    expect(packListable(pack, { ...ctx, now: after })).toBe(false);
    // 이용 기한(12/31)이 권리 끝(11/1 끝 = 11/1 15:00Z)을 넘을 수 없다.
    expect(withdrawnPlaybackUntil(pack, after).toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });

  it('중단하면 이용 조건대로 기한을 알린다', async () => {
    const now = new Date();
    await makeCompletePack('stop-pack');
    await verifyRights('stop-pack', now, { existingFileTerms: 'stop_on_suspend' });
    await publish('stop-pack', now);
    await transitionVoicePack(db, 'stop-pack', 'suspend', '사고', 'test', now);
    let pack = (await loadVoicePack(db, 'stop-pack'))!;
    expect(withdrawnPlaybackUntil(pack, now).getTime()).toBe(Date.parse(pack.suspended_at!));

    await updateVoicePackRights(
      db,
      'stop-pack',
      {
        rightsStatus: 'verified',
        evidenceRef: EVIDENCE,
        validFrom: new Date(now.getTime() - 3 * DAY).toISOString().slice(0, 10),
        validUntil: new Date(now.getTime() + 60 * DAY).toISOString().slice(0, 10),
        allowedText: ALLOWED_TEXT,
        allowedRegions: 'KR',
        existingFileTerms: 'until_date',
        existingPlaybackUntil: new Date(now.getTime() + 10 * DAY).toISOString().slice(0, 10),
      },
      'test',
      now,
    );
    pack = (await loadVoicePack(db, 'stop-pack'))!;
    expect(withdrawnPlaybackUntil(pack, now).getTime()).toBe(Date.parse(pack.existing_playback_until!));
    expect(withdrawnPlaybackUntil({ ...pack, rights_status: 'revoked' }, now).getTime()).toBe(Date.parse(pack.suspended_at!));

    const list = (await (await appRequest('/api/voice-packs', { 'CF-IPCountry': 'US', 'X-App-Version': '1' })).json()) as {
      packs: unknown[];
      withdrawn: Array<{ pack_id: string; voice_id: string; playback_until: string }>;
    };
    // 지역·빌드로 거르지 않는다 — 받아 둔 기기는 어디서든 이 신호를 받아야 한다.
    expect(list.packs).toHaveLength(0);
    expect(list.withdrawn).toEqual([{ pack_id: 'stop-pack', voice_id: pack.voice_id, playback_until: pack.existing_playback_until }]);
    // 상세·오디오는 받을 수 없다(새로 받기를 막는다).
    expect((await appRequest('/api/voice-packs/stop-pack')).status).toBe(404);

    // 고치려고 draft 로 되돌려도 기기에는 계속 '게시 끝남' 이다.
    await transitionVoicePack(db, 'stop-pack', 'revise', '', 'test', now);
    const again = (await (await appRequest('/api/voice-packs')).json()) as { withdrawn: unknown[] };
    expect(again.withdrawn).toHaveLength(1);
  });
});

describe('관리자 — 가져오기·검수·게시', () => {
  it('기본 목소리 구조 밖 자리·형식·크기는 거절하고, draft 가 아니면 클립을 못 바꾼다', async () => {
    await upsertDraftVoicePack(db, { packId: 'strict-pack', speakerName: '화자', language: 'ko' }, 'test');
    const put = (category: string, variant: number, format = 'mp3', audio = b64('x')) =>
      importVoicePackClip(db, bucket as unknown as R2Bucket, 'strict-pack', { category, variant, text: 't', audioBase64: audio, audioFormat: format }, 'test');
    await expect(put('weather', voicePackExpectedVariants().weather!)).rejects.toThrow(VoicePackAdminError);
    await expect(put('greeting', 1)).rejects.toThrow(VoicePackAdminError);
    await expect(put('custom', 0)).rejects.toThrow(VoicePackAdminError);
    await expect(put('weather', 0, 'exe')).rejects.toThrow(VoicePackAdminError);
    await expect(put('weather', 0, 'mp3', Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64'))).rejects.toThrow(VoicePackAdminError);
    expect(bucket.objects.size).toBe(0);
    await expect(upsertDraftVoicePack(db, { packId: 'Bad_ID', speakerName: '화자', language: 'ko' }, 'test')).rejects.toThrow(VoicePackAdminError);

    await makeCompletePack('strict-pack');
    await verifyRights('strict-pack');
    await transitionVoicePack(db, 'strict-pack', 'submit', '', 'test', new Date());
    await expect(put('weather', 0)).rejects.toMatchObject({ code: 'ADMIN_VOICE_PACK_LOCKED' });
  });

  it('같은 자리를 바꾸면 새 clip id·옛 오디오 삭제·개정 증가', async () => {
    await upsertDraftVoicePack(db, { packId: 'swap-pack', speakerName: '화자', language: 'ko' }, 'test');
    const first = await importVoicePackClip(db, bucket as unknown as R2Bucket, 'swap-pack', { category: 'cheer', variant: 0, text: 'a', audioBase64: b64('a'), audioFormat: 'mp3' }, 'test');
    const rev1 = (await loadVoicePack(db, 'swap-pack'))!.content_revision;
    const second = await importVoicePackClip(db, bucket as unknown as R2Bucket, 'swap-pack', { category: 'cheer', variant: 0, text: 'b', audioBase64: b64('b'), audioFormat: 'mp3' }, 'test');
    expect(second.id).not.toBe(first.id);
    expect(bucket.objects.has(first.audio_key)).toBe(false);
    expect(bucket.objects.has(second.audio_key)).toBe(true);
    expect((await loadVoicePack(db, 'swap-pack'))!.content_revision).toBe(Number(rev1) + 1);
    expect(await loadVoicePackClips(db, 'swap-pack')).toHaveLength(1);
  });

  it('게시 조건이 남으면 게시하지 못하고, 다 채우면 게시된다', async () => {
    await upsertDraftVoicePack(db, { packId: 'gate-pack', speakerName: '화자', language: 'ko' }, 'test');
    const now = new Date();
    let pack = (await loadVoicePack(db, 'gate-pack'))!;
    const blockers = publishBlockers(pack, [], now);
    expect(blockers.join(' ')).toContain('권리 상태');
    expect(blockers.join(' ')).toContain('미리듣기');
    await transitionVoicePack(db, 'gate-pack', 'submit', '', 'test', now);
    await expect(transitionVoicePack(db, 'gate-pack', 'publish', '', 'test', now)).rejects.toMatchObject({ code: 'ADMIN_VOICE_PACK_LOCKED' });
    await transitionVoicePack(db, 'gate-pack', 'reject', '', 'test', now);
    await makeCompletePack('gate-pack');
    await verifyRights('gate-pack', now);
    pack = (await loadVoicePack(db, 'gate-pack'))!;
    expect(publishBlockers(pack, await loadVoicePackClips(db, 'gate-pack'), now)).toEqual([]);
    await publish('gate-pack', now);
    expect((await loadVoicePack(db, 'gate-pack'))!.status).toBe('published');
    // 이미 게시 중이면 다시 게시할 수 없다(상태 비교 후 교체).
    await expect(transitionVoicePack(db, 'gate-pack', 'publish', '', 'test', now)).rejects.toMatchObject({ code: 'ADMIN_VOICE_PACK_LOCKED' });
  });

  it('게시 중인 팩의 권리를 조건이 깨지게 고치면 거절한다', async () => {
    await makeCompletePack('live-pack');
    await verifyRights('live-pack');
    await publish('live-pack');
    await expect(verifyRights('live-pack', new Date(), { rightsStatus: 'expired' })).rejects.toMatchObject({ code: 'ADMIN_VOICE_PACK_LOCKED' });
    await expect(verifyRights('live-pack', new Date(), { allowedRegions: '' })).rejects.toMatchObject({ code: 'ADMIN_VOICE_PACK_LOCKED' });
    // 조건을 지키는 수정(기간 연장)은 된다.
    const later = new Date(Date.now() + 200 * DAY).toISOString().slice(0, 10);
    await verifyRights('live-pack', new Date(), { validUntil: later });
    expect((await loadVoicePack(db, 'live-pack'))!.status).toBe('published');
  });

  it('모든 쓰기가 감사 기록을 남긴다', async () => {
    await makeCompletePack('audit-pack');
    await verifyRights('audit-pack');
    await publish('audit-pack');
    await transitionVoicePack(db, 'audit-pack', 'suspend', '권리 분쟁', 'test', new Date());
    const events = await db.execute({ sql: 'SELECT action, from_status, to_status, note FROM voice_pack_events WHERE pack_id = ? ORDER BY created_at, rowid', args: ['audit-pack'] });
    const actions = events.rows.map((r) => String(r.action));
    expect(actions[0]).toBe('create');
    expect(actions.filter((a) => a === 'add_clip').length).toBe(1 + Object.values(voicePackExpectedVariants()).reduce((a, b) => a + b, 0));
    expect(actions.slice(-4)).toEqual(['update_rights', 'submit', 'publish', 'suspend']);
    const last = events.rows[events.rows.length - 1]!;
    expect([last.from_status, last.to_status, last.note]).toEqual(['published', 'suspended', '권리 분쟁']);
  });

  it('팩 목소리는 목소리 프로필이 아니다 — 직접 입력 합성이 그 목소리를 모른다', async () => {
    const pack = await makeCompletePack('not-a-profile');
    expect(pack.voice_id.startsWith(VOICE_PACK_VOICE_ID_PREFIX)).toBe(true);
    expect(pack.voice_id.startsWith('70000000-0000-4000-9000-')).toBe(false);
    const res = await db.execute({ sql: 'SELECT 1 FROM voice_profiles WHERE id = ?', args: [pack.voice_id] });
    expect(res.rows).toHaveLength(0);
  });
});

describe('관리자 — 콘솔 경로', () => {
  const SECRET = 'admin-secret-value';
  const AUTH = 'Basic ' + Buffer.from('x:' + SECRET).toString('base64');
  function request(path: string, init: RequestInit = {}) {
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    const headers = new Headers(init.headers);
    headers.set('Authorization', AUTH);
    if (init.method === 'POST') headers.set('Origin', 'http://localhost');
    return a.request(`http://localhost${path}`, { ...init, headers }, { ADMIN_SECRET: SECRET, VOICE_BUCKET: bucket } as unknown as AppEnv['Bindings']);
  }

  it('인증 없이는 못 들어온다', async () => {
    const a = new Hono<AppEnv>();
    a.route('/admin', adminRoutes);
    const res = await a.request(
      'http://localhost/admin/voice-packs/import',
      { method: 'POST', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: '{}' },
      { ADMIN_SECRET: SECRET } as unknown as AppEnv['Bindings'],
    );
    expect(res.status).toBe(401);
  });

  it('스크립트 가져오기 → 화면 → 권리 → 검수 → 게시', async () => {
    const created = await request('/admin/voice-packs/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack_id: 'console-pack', speaker_name: '콘솔 화자', language: 'ko' }),
    });
    expect(created.status).toBe(200);
    const bad = await request('/admin/voice-packs/console-pack/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'weather', variant: 99, text: 't', audio_base64: b64('x'), audio_format: 'mp3' }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error_code: string }).error_code).toBe('ADMIN_VOICE_PACK_INVALID');
    await makeCompletePack('console-pack');

    const list = await request('/admin/voice-packs');
    expect(await list.text()).toContain('console-pack');
    const detail = await request('/admin/voice-packs/console-pack');
    const page = await detail.text();
    expect(page).toContain('권리 (내부 전용)');
    expect(page).toContain('미리듣기');

    const day = (o: number) => new Date(Date.now() + o * DAY).toISOString().slice(0, 10);
    const rights = await request('/admin/voice-packs/console-pack/rights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        rights_status: 'verified',
        evidence_ref: EVIDENCE,
        valid_from: day(-1),
        valid_until: day(30),
        allowed_text: ALLOWED_TEXT,
        allowed_regions: 'KR',
        file_terms: 'until_rights_end',
        playback_until: '',
      }),
    });
    expect(rights.status).toBe(303);
    expect(rights.headers.get('Location')).toContain('done=rights');

    const form = (values: Record<string, string>) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    });
    await request('/admin/voice-packs/console-pack/transition', form({ action: 'submit' }));
    // 확인 체크 없이는 게시하지 않는다.
    const noConfirm = await request('/admin/voice-packs/console-pack/transition', form({ action: 'publish' }));
    expect(noConfirm.headers.get('Location')).toContain('err=');
    expect((await loadVoicePack(db, 'console-pack'))!.status).toBe('review');
    const ok = await request('/admin/voice-packs/console-pack/transition', form({ action: 'publish', confirm: '1' }));
    expect(ok.headers.get('Location')).toContain('done=publish');
    expect((await loadVoicePack(db, 'console-pack'))!.status).toBe('published');

    // 게시 중이면 가져오기가 막힌다(409).
    const locked = await request('/admin/voice-packs/console-pack/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'weather', variant: 0, text: 't', audio_base64: b64('x'), audio_format: 'mp3' }),
    });
    expect(locked.status).toBe(409);

    const clip = (await loadVoicePackClips(db, 'console-pack'))[0]!;
    const audio = await request(`/admin/voice-packs/console-pack/clips/${clip.id}/audio`);
    expect(audio.status).toBe(200);
    expect(audio.headers.get('Content-Type')).toBe('audio/mpeg');
  });
});
