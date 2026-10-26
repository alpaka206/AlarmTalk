import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { getDB } from '../lib/db';
import { jsonError } from '../lib/api-error';
import { uint8ToBase64 } from '../lib/audio-loader';
import { R2VoiceStorage } from '../lib/r2-storage';
import { UUID_RE } from '../lib/validate';
import { parseAppPlatformHeader, parseAppVersionHeader } from '../middleware/appPresence';
import {
  listEverPublishedVoicePacks,
  listVoicePackClipsFor,
  loadVoicePack,
  loadVoicePackClips,
  packListable,
  packWithdrawn,
  toPublicPack,
  withdrawnPlaybackUntil,
  type VoicePackClientContext,
  type VoicePackRow,
} from '../lib/voice-packs';

// MARK: - 추가 음성팩 앱 API(`docs/spec/voice-packs.md` §3)
//
// 팩은 **누구에게나 같은 무료 고정 콘텐츠**라 계정·플랜을 보지 않는다 — 게이트는 '지금 받을 수 있는가'(`packListable`)
// 하나다. 받을 수 없는 팩은 있다는 사실도 드러내지 않는다(404). 응답은 `toPublicPack` 으로만 만든다 — 권리 메타데이터를
// 내려주지 않는다.

const voicePacks = new Hono<AppEnv>();

function clientContext(c: Context<AppEnv>): VoicePackClientContext {
  return {
    now: new Date(),
    country: c.req.header('CF-IPCountry') ?? null,
    platform: parseAppPlatformHeader(c.req.header('X-App-Platform')),
    build: parseAppVersionHeader(c.req.header('X-App-Version')),
  };
}

async function listablePack(c: Context<AppEnv>, packId: string): Promise<VoicePackRow | null> {
  const pack = await loadVoicePack(getDB(c.env), packId);
  return pack && packListable(pack, clientContext(c)) ? pack : null;
}

voicePacks.get('/', async (c) => {
  const db = getDB(c.env);
  const ctx = clientContext(c);
  // draft·review 는 읽지도 않는다 — 게시된 적 있는 팩만 고른다.
  const rows = await listEverPublishedVoicePacks(db);
  const listable = rows.filter((row) => packListable(row, ctx));
  const clips = await listVoicePackClipsFor(
    db,
    listable.map((row) => row.id),
  );
  return c.json({
    packs: listable.map((row) => toPublicPack(row, clips.get(row.id) ?? [], false)),
    // 게시가 끝난 팩 — 앱은 받아 둔 팩이 여기 있으면 기한까지 안내하고, 기한 뒤 미나로 바꾼다(스펙 §5).
    // 지역·빌드로 거르지 않는다: 받아 둔 기기는 어디서든 이 신호를 받아야 한다.
    withdrawn: rows
      .filter((row) => packWithdrawn(row, ctx.now))
      .map((row) => ({
        pack_id: row.id,
        voice_id: row.voice_id,
        playback_until: withdrawnPlaybackUntil(row, ctx.now).toISOString(),
      })),
  });
});

voicePacks.get('/:packId', async (c) => {
  const pack = await listablePack(c, c.req.param('packId'));
  if (!pack) return jsonError(c, 404, 'VOICE_PACK_NOT_FOUND', 'Voice pack not found');
  const clips = await loadVoicePackClips(getDB(c.env), pack.id);
  return c.json({ pack: toPublicPack(pack, clips, true) });
});

voicePacks.get('/:packId/clips/:clipId/audio', async (c) => {
  const pack = await listablePack(c, c.req.param('packId'));
  if (!pack) return jsonError(c, 404, 'VOICE_PACK_NOT_FOUND', 'Voice pack not found');
  const clipId = c.req.param('clipId');
  if (!UUID_RE.test(clipId)) return jsonError(c, 404, 'VOICE_PACK_CLIP_NOT_FOUND', 'Voice pack clip not found');
  // ⚠ **그 팩의 클립이어야 한다**(IDOR). 다른 팩(비게시 포함)의 clip id 를 붙여 오면 없는 것으로 답한다.
  const res = await getDB(c.env).execute({
    sql: 'SELECT id, audio_key, audio_format, sha256, size_bytes FROM voice_pack_clips WHERE id = ? AND pack_id = ?',
    args: [clipId, pack.id],
  });
  const row = res.rows[0];
  if (!row) return jsonError(c, 404, 'VOICE_PACK_CLIP_NOT_FOUND', 'Voice pack clip not found');
  const bucket = c.env.VOICE_BUCKET;
  const stored = bucket ? await new R2VoiceStorage(bucket).get(String(row.audio_key)) : null;
  if (!stored) return jsonError(c, 404, 'VOICE_PACK_CLIP_NOT_FOUND', 'Voice pack clip audio not found');
  return c.json({
    clip_id: String(row.id),
    pack_id: pack.id,
    audio_base64: uint8ToBase64(stored.bytes),
    audio_format: String(row.audio_format),
    sha256: String(row.sha256),
    size_bytes: Number(row.size_bytes),
  });
});

export default voicePacks;
