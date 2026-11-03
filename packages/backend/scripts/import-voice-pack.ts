// 추가 음성팩 가져오기(`docs/spec/voice-packs.md` §6) — 폴더 하나를 draft 팩으로 올린다.
//
//   ADMIN_BASE_URL=https://api-dev.alarm-talk.com ADMIN_SECRET=… npx tsx scripts/import-voice-pack.ts <폴더>
//
// 폴더에는 `pack.json` 과 오디오 파일이 있다:
//   {
//     "pack_id": "first-pack", "speaker_name": "화자 표시", "language": "ko",
//     "description": "…", "usage_note": "…", "min_android_build": 0, "min_ios_build": 0,
//     "clips": [{ "category": "greeting", "variant": 0, "text": "…", "file": "greeting-0.mp3" }, …]
//   }
//
// - draft 팩만 받는다. 게시 중인 팩을 고치려면 콘솔에서 게시 중단 → '고치려고 draft 로' 를 한 뒤 다시 올린다.
// - 해시·크기는 서버가 계산한다. 권리 정보는 여기서 올리지 않는다 — 콘솔의 '권리 (내부 전용)' 에서 적는다.
// - 계약서 원문을 폴더에 넣지 말 것(올리지 않지만, 실수로 섞일 자리를 만들지 않는다).
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

type ClipEntry = { category: string; variant: number; text: string; file: string };
type PackManifest = {
  pack_id: string;
  speaker_name: string;
  language: string;
  description?: string;
  usage_note?: string;
  min_android_build?: number;
  min_ios_build?: number;
  clips: ClipEntry[];
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요해요.`);
  return value;
}

async function post(baseUrl: string, secret: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`admin:${secret}`).toString('base64')}`,
      'Content-Type': 'application/json',
      // 콘솔의 CSRF 검사는 같은 출처만 받는다(`routes/admin.ts`).
      Origin: new URL(baseUrl).origin,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} ${res.status} ${String(json.error_code ?? '')} ${String(json.error ?? '')}`);
  return json;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error('사용법: import-voice-pack.ts <폴더>');
  const baseUrl = requireEnv('ADMIN_BASE_URL').replace(/\/+$/, '');
  const secret = requireEnv('ADMIN_SECRET');
  const manifest = JSON.parse(readFileSync(resolve(dir, 'pack.json'), 'utf8')) as PackManifest;
  if (!Array.isArray(manifest.clips) || manifest.clips.length === 0) throw new Error('pack.json 에 clips 가 없어요.');

  const created = await post(baseUrl, secret, '/admin/voice-packs/import', {
    pack_id: manifest.pack_id,
    speaker_name: manifest.speaker_name,
    language: manifest.language,
    description: manifest.description ?? '',
    usage_note: manifest.usage_note ?? '',
    min_android_build: manifest.min_android_build ?? 0,
    min_ios_build: manifest.min_ios_build ?? 0,
  });
  console.log(`팩 ${String(created.pack_id)} (${created.created ? '새로 만듦' : '공개 정보 고침'}) voice_id=${String(created.voice_id)}`);

  const packPath = `/admin/voice-packs/${encodeURIComponent(manifest.pack_id)}/clips`;
  for (const clip of manifest.clips) {
    const bytes = readFileSync(resolve(dir, clip.file));
    const format = extname(clip.file).slice(1).toLowerCase();
    const result = await post(baseUrl, secret, packPath, {
      category: clip.category,
      variant: clip.variant,
      text: clip.text,
      audio_format: format,
      audio_base64: bytes.toString('base64'),
    });
    console.log(`  ${clip.category} ${clip.variant} → ${String(result.clip_id)} ${String(result.size_bytes)}B`);
  }
  console.log('끝. 콘솔에서 권리를 적고 검수 요청 → 게시해 주세요.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
