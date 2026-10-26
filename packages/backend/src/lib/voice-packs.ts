import type { Client } from '@libsql/client';
import { typedRow } from './db-types';
import { withWriteTransaction, type DbExecutor } from './transactions';
import { endOfKstDate } from './plan-grants';
import { FREE_BUCKET_CATEGORIES, STOCK_CLIP_PRESETS, STOCK_GREETING_CATEGORY } from './stock-clips';

// MARK: - 추가 음성팩(`docs/spec/voice-packs.md`)
//
// 권리를 확인한 **고정 클립 묶음**이다. 규칙의 유일 출처는 스펙이고, 여기는 판정·저장을 한곳에 모은다.
//  - 팩 목소리는 `voice_profiles` 행이 아니다 — 직접 입력 합성·목소리 등록·접근권 대조가 그 목소리를 모른다(§1).
//  - 권리 메타데이터는 앱 API 로 한 글자도 내려가지 않는다 — 응답은 `toPublicPack` 으로만 만든다(§3).
//  - 게시가 끝나도 기존 알람은 허락된 기한까지 운다 — 그 기한은 `withdrawnPlaybackUntil` 하나가 정한다(§5).

/** 팩 목소리 id 의 대역. 기본 목소리(`…-9000-`)와 겹치지 않는다. 두 앱의 `isVoicePackVoiceId` 짝. */
export const VOICE_PACK_VOICE_ID_PREFIX = '70000000-0000-4000-9100-';

/** 영소문자·숫자·하이픈 3~40자, 앞뒤는 하이픈이 아니다. */
export const VOICE_PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const VOICE_PACK_LANGUAGES = ['ko', 'en', 'ja'] as const;
export type VoicePackLanguage = (typeof VOICE_PACK_LANGUAGES)[number];

export const VOICE_PACK_STATUSES = ['draft', 'review', 'published', 'suspended'] as const;
export type VoicePackStatus = (typeof VOICE_PACK_STATUSES)[number];

export const VOICE_PACK_RIGHTS_STATUSES = ['pending', 'verified', 'expired', 'revoked'] as const;
export type VoicePackRightsStatus = (typeof VOICE_PACK_RIGHTS_STATUSES)[number];

export const VOICE_PACK_FILE_TERMS = ['stop_on_suspend', 'until_rights_end', 'until_date'] as const;
export type VoicePackFileTerms = (typeof VOICE_PACK_FILE_TERMS)[number];

/** 미리듣기 샘플 = 인사말 variant 0. 알람 테마가 아니다(스펙 §2). */
export const VOICE_PACK_PREVIEW_CATEGORY = STOCK_GREETING_CATEGORY;

/** 클립 하나의 상한. 테마 클립은 수십~수백 KB 다. */
export const VOICE_PACK_CLIP_MAX_BYTES = 2 * 1024 * 1024;

export const VOICE_PACK_AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
};

/**
 * 팩이 갖춰야 하는 알람 테마와 variant 수 — **기본 목소리 매니페스트와 같다**(스펙 §2).
 * 손으로 적지 않는다: 기본 목소리 시드(`STOCK_CLIP_PRESETS`)에서 유도한다 — `GET /tts/stock-clips` 의
 * `expected_variants.system` 과 같은 출처다. 날씨·운세는 절대 인덱스로 조건을 고르므로 수가 어긋나면 엉뚱한 문구가 나간다.
 */
export function voicePackExpectedVariants(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const preset of STOCK_CLIP_PRESETS) {
    if (!FREE_BUCKET_CATEGORIES.includes(preset.category)) continue;
    out[preset.category] = preset.texts.ko?.length ?? 0;
  }
  return out;
}

export type VoicePackRow = {
  id: string;
  voice_id: string;
  content_revision: number;
  speaker_name: string;
  description: string;
  usage_note: string;
  language: string;
  min_android_build: number;
  min_ios_build: number;
  status: VoicePackStatus;
  rights_status: VoicePackRightsStatus;
  rights_evidence_ref: string;
  rights_valid_from: string | null;
  rights_valid_until: string | null;
  rights_allowed_text: string;
  rights_allowed_regions: string;
  existing_file_terms: VoicePackFileTerms;
  existing_playback_until: string | null;
  published_at: string | null;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VoicePackClipRow = {
  id: string;
  pack_id: string;
  category: string;
  variant: number;
  text: string;
  audio_key: string;
  audio_format: string;
  sha256: string;
  size_bytes: number;
};

export type VoicePackEventRow = {
  id: string;
  pack_id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  note: string;
  created_at: string;
};

/** 요청한 앱의 맥락 — 나라(`CF-IPCountry`)와 빌드(`X-App-Platform`·`X-App-Version`). */
export interface VoicePackClientContext {
  now: Date;
  country: string | null;
  platform: 'android' | 'ios' | null;
  build: number | null;
}

/** DB 시각 — ISO 문자열이든 SQLite `datetime('now')`(UTC, 'YYYY-MM-DD HH:MM:SS')든 읽는다. */
export function parsePackInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseAllowedRegions(json: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && /^(\*|[A-Z]{2})$/.test(v));
  } catch {
    return [];
  }
}

/** 이 나라에서 받을 수 있는가. `*` 는 전 세계, 나라를 모르면 `*` 일 때만 된다. */
export function regionAllowed(regionsJson: string, country: string | null): boolean {
  const regions = parseAllowedRegions(regionsJson);
  if (regions.includes('*')) return true;
  const code = (country ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && regions.includes(code);
}

/** 권리가 지금 유효한가 — verified 이고 기간 안이다. 기간이 비면 유효하지 않다(게시 조건이 막는다). */
export function rightsWindowOpen(row: VoicePackRow, now: Date): boolean {
  if (row.rights_status !== 'verified') return false;
  const from = parsePackInstant(row.rights_valid_from);
  const until = parsePackInstant(row.rights_valid_until);
  if (!from || !until) return false;
  return from.getTime() <= now.getTime() && now.getTime() < until.getTime();
}

/** 앱 빌드가 그 팩의 최소 빌드 이상인가. 헤더가 없으면 아니다 — 팩을 모르는 옛 앱이다. */
export function buildAllowed(row: VoicePackRow, platform: VoicePackClientContext['platform'], build: number | null): boolean {
  if (!platform || build === null) return false;
  const min = platform === 'ios' ? Number(row.min_ios_build ?? 0) : Number(row.min_android_build ?? 0);
  return build >= min;
}

/**
 * **지금 이 앱이 받을 수 있는가**(스펙 §3) — 게시 · 권리 유효 · 허용 지역 · 최소 빌드. 목록·상세·오디오가 모두 이것 하나를 본다.
 */
export function packListable(row: VoicePackRow, ctx: VoicePackClientContext): boolean {
  return (
    row.status === 'published' &&
    rightsWindowOpen(row, ctx.now) &&
    regionAllowed(row.rights_allowed_regions, ctx.country) &&
    buildAllowed(row, ctx.platform, ctx.build)
  );
}

/**
 * **게시가 끝난 팩인가** — 한 번이라도 게시됐고, 지금 게시 중이 아니거나(중단·고치려고 draft 로 되돌림) 권리가 끝났다.
 * 앱은 이 목록으로만 대체를 한다(§5-5). 게시된 적 없는 draft·review 는 들지 않는다.
 */
export function packWithdrawn(row: VoicePackRow, now: Date): boolean {
  if (!row.published_at) return false;
  if (row.status !== 'published') return true;
  return !rightsWindowOpen(row, now);
}

/**
 * 게시가 끝난 팩으로 **기존 알람이 울 수 있는 기한**(스펙 §5 표). 어느 경우든 권리 기간 끝을 넘지 않고, 권리가 revoked 면
 * 중단 시각이다. 기준 시각은 중단 시각, 중단하지 않았는데 권리가 끝났으면 권리 기간 끝(그것도 없으면 지금)이다.
 */
export function withdrawnPlaybackUntil(row: VoicePackRow, now: Date): Date {
  const rightsEnd = parsePackInstant(row.rights_valid_until);
  const base =
    (row.status !== 'published' ? parsePackInstant(row.suspended_at) : null) ??
    (rightsEnd && rightsEnd.getTime() <= now.getTime() ? rightsEnd : null) ??
    now;
  if (row.rights_status === 'revoked') return base;
  let until: Date;
  switch (row.existing_file_terms) {
    case 'until_rights_end':
      until = rightsEnd ?? base;
      break;
    case 'until_date':
      until = parsePackInstant(row.existing_playback_until) ?? base;
      break;
    default:
      until = base;
  }
  if (rightsEnd && until.getTime() > rightsEnd.getTime()) until = rightsEnd;
  // 기한이 기준보다 앞설 수는 없다(이미 지난 날짜를 적은 경우) — 중단 시각에 끝난다.
  return until.getTime() < base.getTime() ? base : until;
}

export interface PublicPackClip {
  clip_id: string;
  category: string;
  language: string;
  variant: number;
  text: string;
  sha256: string;
  size_bytes: number;
  audio_format: string;
}

export interface PublicPack {
  pack_id: string;
  voice_id: string;
  content_revision: number;
  speaker_name: string;
  description: string;
  usage_note: string;
  language: string;
  categories: string[];
  clip_count: number;
  total_bytes: number;
  preview: { clip_id: string; size_bytes: number } | null;
  clips?: PublicPackClip[];
}

/**
 * **앱 API 로 나가는 팩의 유일한 모양**(스펙 §3). 공개 필드만 하나씩 옮긴다 — 행을 펼쳐 넣지 말 것.
 * `rights_*`·`existing_*`·`status`·최소 빌드는 여기서 빠진다(빌드·지역은 걸러서 적용할 뿐 내려주지 않는다).
 */
export function toPublicPack(row: VoicePackRow, clips: VoicePackClipRow[], withClips: boolean): PublicPack {
  const preview = clips.find((c) => c.category === VOICE_PACK_PREVIEW_CATEGORY && Number(c.variant) === 0) ?? null;
  const categories = [...new Set(clips.map((c) => c.category).filter((c) => c !== VOICE_PACK_PREVIEW_CATEGORY))].sort();
  const pack: PublicPack = {
    pack_id: row.id,
    voice_id: row.voice_id,
    content_revision: Number(row.content_revision),
    speaker_name: row.speaker_name,
    description: row.description,
    usage_note: row.usage_note,
    language: row.language,
    categories,
    clip_count: clips.length,
    total_bytes: clips.reduce((sum, c) => sum + Number(c.size_bytes), 0),
    preview: preview ? { clip_id: preview.id, size_bytes: Number(preview.size_bytes) } : null,
  };
  if (withClips) {
    pack.clips = clips.map((c) => ({
      clip_id: c.id,
      category: c.category,
      language: row.language,
      variant: Number(c.variant),
      text: c.text,
      sha256: c.sha256,
      size_bytes: Number(c.size_bytes),
      audio_format: c.audio_format,
    }));
  }
  return pack;
}

/** 게시를 막는 남은 항목(스펙 §4) — 비면 게시할 수 있다. 화면이 그대로 보여 준다. */
export function publishBlockers(row: VoicePackRow, clips: VoicePackClipRow[], now: Date): string[] {
  const out: string[] = [];
  if (!row.speaker_name.trim()) out.push('화자 표시가 비어 있어요.');
  if (row.rights_status !== 'verified') out.push('권리 상태가 확인됨이 아니에요.');
  if (!row.rights_evidence_ref.trim()) out.push('증빙 위치가 비어 있어요.');
  const from = parsePackInstant(row.rights_valid_from);
  const until = parsePackInstant(row.rights_valid_until);
  if (!from || !until) out.push('권리 기간이 비어 있어요.');
  else if (!(from.getTime() <= now.getTime() && now.getTime() < until.getTime())) out.push('권리 기간이 지금을 포함하지 않아요.');
  if (!row.rights_allowed_text.trim()) out.push('허용 문구가 비어 있어요.');
  if (parseAllowedRegions(row.rights_allowed_regions).length === 0) out.push('허용 지역이 비어 있어요.');
  if (row.existing_file_terms === 'until_date' && !parsePackInstant(row.existing_playback_until)) {
    out.push('기존 파일 이용 기한 날짜가 비어 있어요.');
  }
  if (!clips.some((c) => c.category === VOICE_PACK_PREVIEW_CATEGORY && Number(c.variant) === 0)) {
    out.push('미리듣기 샘플(인사말 0번)이 없어요.');
  }
  const expected = voicePackExpectedVariants();
  for (const [category, count] of Object.entries(expected)) {
    const have = new Set(clips.filter((c) => c.category === category).map((c) => Number(c.variant)));
    const missing: number[] = [];
    for (let i = 0; i < count; i++) if (!have.has(i)) missing.push(i);
    if (missing.length > 0) out.push(`${category} 테마에 ${missing.join(', ')}번 클립이 없어요(필요 ${count}개).`);
  }
  for (const clip of clips) {
    const limit = clip.category === VOICE_PACK_PREVIEW_CATEGORY ? 1 : expected[clip.category];
    if (limit === undefined || Number(clip.variant) >= limit) {
      out.push(`${clip.category} ${clip.variant}번은 기본 목소리에 없는 자리예요.`);
    }
  }
  return out;
}

// MARK: - 읽기

export async function loadVoicePack(db: Pick<DbExecutor, 'execute'>, packId: string): Promise<VoicePackRow | null> {
  if (!VOICE_PACK_ID_RE.test(packId)) return null;
  const res = await db.execute({ sql: 'SELECT * FROM voice_packs WHERE id = ?', args: [packId] });
  return res.rows.length ? typedRow<VoicePackRow>(res.rows[0]!) : null;
}

export async function loadVoicePackClips(db: Pick<DbExecutor, 'execute'>, packId: string): Promise<VoicePackClipRow[]> {
  const res = await db.execute({
    sql: 'SELECT * FROM voice_pack_clips WHERE pack_id = ? ORDER BY category ASC, variant ASC',
    args: [packId],
  });
  return res.rows.map((r) => typedRow<VoicePackClipRow>(r));
}

export async function listVoicePacks(db: Pick<DbExecutor, 'execute'>): Promise<VoicePackRow[]> {
  const res = await db.execute('SELECT * FROM voice_packs ORDER BY created_at ASC, id ASC');
  return res.rows.map((r) => typedRow<VoicePackRow>(r));
}

/** 게시된 적 있는 팩만 — 앱 목록은 draft·review 를 읽을 필요도 없다. */
export async function listEverPublishedVoicePacks(db: Pick<DbExecutor, 'execute'>): Promise<VoicePackRow[]> {
  const res = await db.execute(
    'SELECT * FROM voice_packs WHERE published_at IS NOT NULL ORDER BY published_at ASC, id ASC',
  );
  return res.rows.map((r) => typedRow<VoicePackRow>(r));
}

export async function listVoicePackClipsFor(
  db: Pick<DbExecutor, 'execute'>,
  packIds: string[],
): Promise<Map<string, VoicePackClipRow[]>> {
  const out = new Map<string, VoicePackClipRow[]>();
  if (packIds.length === 0) return out;
  const res = await db.execute({
    sql: `SELECT * FROM voice_pack_clips WHERE pack_id IN (${packIds.map(() => '?').join(', ')})
          ORDER BY pack_id ASC, category ASC, variant ASC`,
    args: packIds,
  });
  for (const r of res.rows) {
    const clip = typedRow<VoicePackClipRow>(r);
    const list = out.get(clip.pack_id) ?? [];
    list.push(clip);
    out.set(clip.pack_id, list);
  }
  return out;
}

export async function listVoicePackEvents(db: Pick<DbExecutor, 'execute'>, packId: string): Promise<VoicePackEventRow[]> {
  const res = await db.execute({
    sql: 'SELECT * FROM voice_pack_events WHERE pack_id = ? ORDER BY created_at DESC, id DESC LIMIT 100',
    args: [packId],
  });
  return res.rows.map((r) => typedRow<VoicePackEventRow>(r));
}

// MARK: - 관리자 쓰기

export type VoicePackAdminErrorCode = 'ADMIN_VOICE_PACK_INVALID' | 'ADMIN_VOICE_PACK_NOT_FOUND' | 'ADMIN_VOICE_PACK_LOCKED';

export class VoicePackAdminError extends Error {
  constructor(
    readonly code: VoicePackAdminErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VoicePackAdminError';
  }
}

function eventStatement(packId: string, action: string, from: string | null, to: string | null, actor: string, note: string) {
  return {
    sql: `INSERT INTO voice_pack_events (id, pack_id, action, from_status, to_status, actor, note)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), packId, action, from, to, actor, note.slice(0, 500)],
  };
}

/** 제어문자는 공백으로 바꾸고(줄바꿈 포함) 다듬어 자른다. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return Array.from(out.trim()).slice(0, max).join('');
}

function cleanBuild(value: unknown): number {
  const n = Math.trunc(Number(value ?? 0));
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : 0;
}

export interface DraftPackInput {
  packId: string;
  speakerName: string;
  description?: string;
  usageNote?: string;
  language: string;
  minAndroidBuild?: number;
  minIosBuild?: number;
}

function newVoicePackVoiceId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return VOICE_PACK_VOICE_ID_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * draft 팩을 만들거나(없으면) 공개 정보를 고친다(draft 일 때만). `voice_id` 는 처음 만들 때 한 번 정하고 바꾸지 않는다 —
 * 그 목소리를 든 알람이 기기에 있다.
 */
export async function upsertDraftVoicePack(
  db: Client,
  input: DraftPackInput,
  actor: string,
): Promise<{ created: boolean; pack: VoicePackRow }> {
  const packId = cleanText(input.packId, 40);
  if (!VOICE_PACK_ID_RE.test(packId)) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '팩 id 는 영소문자·숫자·하이픈 3~40자예요.');
  }
  const speaker = cleanText(input.speakerName, 50);
  if (!speaker) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '화자 표시를 적어 주세요.');
  if (!(VOICE_PACK_LANGUAGES as readonly string[]).includes(input.language)) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '언어는 ko·en·ja 중 하나예요.');
  }
  const description = cleanText(input.description, 300);
  const usageNote = cleanText(input.usageNote, 300);
  const minAndroid = cleanBuild(input.minAndroidBuild);
  const minIos = cleanBuild(input.minIosBuild);
  return withWriteTransaction(db, async (tx) => {
    const existing = await loadVoicePack(tx, packId);
    if (!existing) {
      await tx.execute({
        sql: `INSERT INTO voice_packs (id, voice_id, speaker_name, description, usage_note, language, min_android_build, min_ios_build)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [packId, newVoicePackVoiceId(), speaker, description, usageNote, input.language, minAndroid, minIos],
      });
      await tx.execute(eventStatement(packId, 'create', null, 'draft', actor, ''));
      return { created: true, pack: (await loadVoicePack(tx, packId))! };
    }
    if (existing.status !== 'draft') {
      throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', 'draft 상태에서만 고칠 수 있어요. 반려하거나 중단한 뒤 고쳐 주세요.');
    }
    if (existing.language !== input.language) {
      const clips = await loadVoicePackClips(tx, packId);
      if (clips.length > 0) {
        throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '클립이 있는 팩의 언어는 바꿀 수 없어요.');
      }
    }
    await tx.execute({
      sql: `UPDATE voice_packs SET speaker_name = ?, description = ?, usage_note = ?, language = ?,
              min_android_build = ?, min_ios_build = ?, updated_at = datetime('now')
            WHERE id = ? AND status = 'draft'`,
      args: [speaker, description, usageNote, input.language, minAndroid, minIos, packId],
    });
    await tx.execute(eventStatement(packId, 'update_meta', 'draft', 'draft', actor, ''));
    return { created: false, pack: (await loadVoicePack(tx, packId))! };
  });
}

export interface ClipImportInput {
  category: string;
  variant: number;
  text: string;
  audioBase64: string;
  audioFormat: string;
}

/** R2 의 팩 클립 자리. 서버가 만든 값만 들어간다(사용자 입력이 키가 되지 않는다). */
export function voicePackAudioKey(packId: string, clipId: string, format: string): string {
  return `voice-packs/${packId}/${clipId}.${format}`;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const bin = atob(value.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 클립 하나를 올린다(draft 일 때만). 해시·크기는 **서버가 직접** 센다 — 스크립트가 보낸 값을 믿지 않는다. 같은 자리(테마·
 * variant)에 이미 있으면 새 id 로 바꾸고 옛 오디오를 지운다. 어느 경우든 `content_revision` 이 오른다.
 */
export async function importVoicePackClip(
  db: Client,
  bucket: R2Bucket | undefined,
  packId: string,
  input: ClipImportInput,
  actor: string,
): Promise<VoicePackClipRow> {
  const pack = await loadVoicePack(db, packId);
  if (!pack) throw new VoicePackAdminError('ADMIN_VOICE_PACK_NOT_FOUND', '팩을 찾지 못했어요.');
  if (pack.status !== 'draft') {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', 'draft 상태에서만 클립을 바꿀 수 있어요.');
  }
  const expected = voicePackExpectedVariants();
  const category = cleanText(input.category, 30);
  const variant = Math.trunc(Number(input.variant));
  const limit = category === VOICE_PACK_PREVIEW_CATEGORY ? 1 : expected[category];
  if (limit === undefined || !Number.isInteger(variant) || variant < 0 || variant >= limit) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '테마·번호가 기본 목소리 구조에 없는 자리예요.');
  }
  const text = cleanText(input.text, 500);
  if (!text) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '클립 문구를 적어 주세요.');
  const format = cleanText(input.audioFormat, 5).toLowerCase();
  const mime = VOICE_PACK_AUDIO_MIME[format];
  if (!mime) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '오디오는 mp3·m4a·wav 만 받아요.');
  if (typeof input.audioBase64 !== 'string' || input.audioBase64.length > Math.ceil(VOICE_PACK_CLIP_MAX_BYTES * 1.4)) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '클립 하나는 2MB 까지예요.');
  }
  const bytes = decodeBase64(input.audioBase64);
  if (!bytes || bytes.byteLength === 0) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '오디오를 읽지 못했어요.');
  if (bytes.byteLength > VOICE_PACK_CLIP_MAX_BYTES) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '클립 하나는 2MB 까지예요.');
  }
  if (!bucket) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '오디오 저장소가 설정되지 않았어요.');
  const clipId = crypto.randomUUID();
  const audioKey = voicePackAudioKey(packId, clipId, format);
  const sha256 = await sha256Hex(bytes);
  // 오디오를 먼저 둔다 — 행이 먼저 커밋되면 받을 바이트가 없는 클립이 생긴다. 행 쓰기가 실패하면 그 객체만 지운다.
  await bucket.put(audioKey, bytes, { httpMetadata: { contentType: mime } });
  let replacedKey: string | null = null;
  try {
    await withWriteTransaction(db, async (tx) => {
      const fresh = await loadVoicePack(tx, packId);
      if (!fresh || fresh.status !== 'draft') {
        throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', 'draft 상태에서만 클립을 바꿀 수 있어요.');
      }
      const prev = await tx.execute({
        sql: 'SELECT id, audio_key FROM voice_pack_clips WHERE pack_id = ? AND category = ? AND variant = ?',
        args: [packId, category, variant],
      });
      if (prev.rows.length) {
        replacedKey = String(prev.rows[0]!.audio_key);
        await tx.execute({ sql: 'DELETE FROM voice_pack_clips WHERE id = ?', args: [String(prev.rows[0]!.id)] });
      }
      await tx.execute({
        sql: `INSERT INTO voice_pack_clips (id, pack_id, category, variant, text, audio_key, audio_format, sha256, size_bytes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [clipId, packId, category, variant, text, audioKey, format, sha256, bytes.byteLength],
      });
      await tx.execute({
        sql: `UPDATE voice_packs SET content_revision = content_revision + 1, updated_at = datetime('now') WHERE id = ?`,
        args: [packId],
      });
      await tx.execute(
        eventStatement(packId, replacedKey ? 'replace_clip' : 'add_clip', 'draft', 'draft', actor, `${category} ${variant}`),
      );
    });
  } catch (err) {
    await bucket.delete(audioKey).catch(() => undefined);
    throw err;
  }
  if (replacedKey) await bucket.delete(replacedKey).catch(() => undefined);
  return {
    id: clipId,
    pack_id: packId,
    category,
    variant,
    text,
    audio_key: audioKey,
    audio_format: format,
    sha256,
    size_bytes: bytes.byteLength,
  };
}

/** draft 팩의 클립 하나를 지운다. */
export async function deleteVoicePackClip(
  db: Client,
  bucket: R2Bucket | undefined,
  packId: string,
  clipId: string,
  actor: string,
): Promise<void> {
  const key = await withWriteTransaction(db, async (tx) => {
    const pack = await loadVoicePack(tx, packId);
    if (!pack) throw new VoicePackAdminError('ADMIN_VOICE_PACK_NOT_FOUND', '팩을 찾지 못했어요.');
    if (pack.status !== 'draft') throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', 'draft 상태에서만 클립을 바꿀 수 있어요.');
    const res = await tx.execute({
      sql: 'SELECT audio_key, category, variant FROM voice_pack_clips WHERE id = ? AND pack_id = ?',
      args: [clipId, packId],
    });
    if (!res.rows.length) throw new VoicePackAdminError('ADMIN_VOICE_PACK_NOT_FOUND', '클립을 찾지 못했어요.');
    await tx.execute({ sql: 'DELETE FROM voice_pack_clips WHERE id = ? AND pack_id = ?', args: [clipId, packId] });
    await tx.execute({
      sql: `UPDATE voice_packs SET content_revision = content_revision + 1, updated_at = datetime('now') WHERE id = ?`,
      args: [packId],
    });
    await tx.execute(
      eventStatement(packId, 'delete_clip', 'draft', 'draft', actor, `${String(res.rows[0]!.category)} ${String(res.rows[0]!.variant)}`),
    );
    return String(res.rows[0]!.audio_key);
  });
  if (bucket) await bucket.delete(key).catch(() => undefined);
}

export interface RightsInput {
  rightsStatus: string;
  evidenceRef: string;
  validFrom: string;
  validUntil: string;
  allowedText: string;
  allowedRegions: string;
  existingFileTerms: string;
  existingPlaybackUntil: string;
  note?: string;
}

/** 한국 날짜 `YYYY-MM-DD` 가 시작하는 순간(0시 KST). */
function startOfKstDate(date: string): Date | null {
  const end = endOfKstDate(date);
  return end ? new Date(end.getTime() - 24 * 60 * 60 * 1000) : null;
}

function parseRegionsInput(raw: string): string[] {
  const parts = raw
    .split(/[\s,]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  if (parts.some((p) => !/^(\*|[A-Z]{2})$/.test(p))) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '허용 지역은 나라 코드(KR, JP …)나 * 로 적어 주세요.');
  }
  return [...new Set(parts)];
}

/**
 * 권리 정보를 고친다. 게시 중인 팩이면 고친 값으로 게시 조건을 다시 보고, 깨지면 고치지 않는다(먼저 중단한다 — 스펙 §4).
 * 날짜는 한국 날짜로 받는다: 시작은 그날 0시, 끝은 그날이 끝나는 순간(배타).
 */
export async function updateVoicePackRights(
  db: Client,
  packId: string,
  input: RightsInput,
  actor: string,
  now: Date,
): Promise<VoicePackRow> {
  if (!(VOICE_PACK_RIGHTS_STATUSES as readonly string[]).includes(input.rightsStatus)) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '권리 상태를 골라 주세요.');
  }
  if (!(VOICE_PACK_FILE_TERMS as readonly string[]).includes(input.existingFileTerms)) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '기존 파일 이용 조건을 골라 주세요.');
  }
  const date = (raw: string, kind: 'start' | 'end'): string | null => {
    const value = raw.trim();
    if (!value) return null;
    const d = kind === 'start' ? startOfKstDate(value) : endOfKstDate(value);
    if (!d) throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '날짜는 YYYY-MM-DD 로 적어 주세요.');
    return d.toISOString();
  };
  const from = date(input.validFrom, 'start');
  const until = date(input.validUntil, 'end');
  if (from && until && Date.parse(from) >= Date.parse(until)) {
    throw new VoicePackAdminError('ADMIN_VOICE_PACK_INVALID', '권리 기간의 끝이 시작보다 뒤여야 해요.');
  }
  const playbackUntil = date(input.existingPlaybackUntil, 'end');
  const regions = JSON.stringify(parseRegionsInput(input.allowedRegions));
  return withWriteTransaction(db, async (tx) => {
    const pack = await loadVoicePack(tx, packId);
    if (!pack) throw new VoicePackAdminError('ADMIN_VOICE_PACK_NOT_FOUND', '팩을 찾지 못했어요.');
    const next: VoicePackRow = {
      ...pack,
      rights_status: input.rightsStatus as VoicePackRightsStatus,
      rights_evidence_ref: cleanText(input.evidenceRef, 300),
      rights_valid_from: from,
      rights_valid_until: until,
      rights_allowed_text: cleanText(input.allowedText, 1000),
      rights_allowed_regions: regions,
      existing_file_terms: input.existingFileTerms as VoicePackFileTerms,
      existing_playback_until: playbackUntil,
    };
    if (pack.status === 'published') {
      const blockers = publishBlockers(next, await loadVoicePackClips(tx, packId), now);
      if (blockers.length > 0) {
        throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', `게시 중인 팩의 조건이 깨져요: ${blockers[0]} 먼저 게시를 중단해 주세요.`);
      }
    }
    await tx.execute({
      sql: `UPDATE voice_packs SET rights_status = ?, rights_evidence_ref = ?, rights_valid_from = ?, rights_valid_until = ?,
              rights_allowed_text = ?, rights_allowed_regions = ?, existing_file_terms = ?, existing_playback_until = ?,
              updated_at = datetime('now')
            WHERE id = ? AND status = ?`,
      args: [
        next.rights_status,
        next.rights_evidence_ref,
        next.rights_valid_from,
        next.rights_valid_until,
        next.rights_allowed_text,
        next.rights_allowed_regions,
        next.existing_file_terms,
        next.existing_playback_until,
        packId,
        pack.status,
      ],
    });
    await tx.execute(eventStatement(packId, 'update_rights', pack.status, pack.status, actor, cleanText(input.note, 300)));
    return (await loadVoicePack(tx, packId))!;
  });
}

export const VOICE_PACK_TRANSITIONS = {
  submit: { from: 'draft', to: 'review', checks: false },
  reject: { from: 'review', to: 'draft', checks: false },
  publish: { from: 'review', to: 'published', checks: true },
  suspend: { from: 'published', to: 'suspended', checks: false },
  republish: { from: 'suspended', to: 'published', checks: true },
  // 게시를 끝낸 팩의 클립을 고치려면 draft 로 되돌린다 — 다시 검수를 거쳐야 게시된다. 중단 시각은 그대로 남아
  // 앱에는 계속 '게시 끝남' 으로 보인다(`packWithdrawn`).
  revise: { from: 'suspended', to: 'draft', checks: false },
} as const satisfies Record<string, { from: VoicePackStatus; to: VoicePackStatus; checks: boolean }>;
export type VoicePackTransition = keyof typeof VOICE_PACK_TRANSITIONS;

export function isVoicePackTransition(value: unknown): value is VoicePackTransition {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VOICE_PACK_TRANSITIONS, value);
}

/**
 * 게시 상태를 옮긴다(스펙 §4 그림). 게시·다시 게시는 게시 조건을 본다. 상태가 그 사이 바뀌었으면(두 창) 옮기지 않는다 —
 * `WHERE status = ?` 비교 후 교체.
 */
export async function transitionVoicePack(
  db: Client,
  packId: string,
  action: VoicePackTransition,
  note: string,
  actor: string,
  now: Date,
): Promise<VoicePackRow> {
  const rule = VOICE_PACK_TRANSITIONS[action];
  return withWriteTransaction(db, async (tx) => {
    const pack = await loadVoicePack(tx, packId);
    if (!pack) throw new VoicePackAdminError('ADMIN_VOICE_PACK_NOT_FOUND', '팩을 찾지 못했어요.');
    if (pack.status !== rule.from) {
      throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', `지금 상태(${pack.status})에서는 할 수 없어요.`);
    }
    if (rule.checks) {
      const blockers = publishBlockers(pack, await loadVoicePackClips(tx, packId), now);
      if (blockers.length > 0) throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', `게시 조건이 남았어요: ${blockers[0]}`);
    }
    const iso = now.toISOString();
    const res = await tx.execute({
      sql: `UPDATE voice_packs SET status = ?,
              published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END,
              suspended_at = CASE WHEN ? = 'suspended' THEN ? WHEN ? = 'published' THEN NULL ELSE suspended_at END,
              updated_at = datetime('now')
            WHERE id = ? AND status = ?`,
      args: [rule.to, rule.to, iso, rule.to, iso, rule.to, packId, rule.from],
    });
    if (res.rowsAffected === 0) {
      throw new VoicePackAdminError('ADMIN_VOICE_PACK_LOCKED', '그 사이 상태가 바뀌었어요. 새로고침해 주세요.');
    }
    await tx.execute(eventStatement(packId, action, rule.from, rule.to, actor, cleanText(note, 300)));
    return (await loadVoicePack(tx, packId))!;
  });
}
