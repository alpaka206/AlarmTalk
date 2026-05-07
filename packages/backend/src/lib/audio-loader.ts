import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { R2VoiceStorage } from './r2-storage';

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export async function loadAudioBytes(
  c: Context<AppEnv>,
  audioUrl: string,
): Promise<{ bytes: Uint8Array; format: string } | null> {
  let bytes: Uint8Array;
  let format = audioFormatFromUrl(audioUrl);

  if (audioUrl.startsWith('r2://')) {
    if (!c.env.VOICE_BUCKET) return null;
    const objectKey = audioUrl.slice('r2://'.length);
    const stored = await new R2VoiceStorage(c.env.VOICE_BUCKET).get(objectKey);
    if (!stored) return null;
    bytes = stored.bytes;
    format = audioFormatFromMime(stored.meta.mimeType) ?? format;
  } else if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    bytes = new Uint8Array(await audioRes.arrayBuffer());
    format = audioFormatFromMime(audioRes.headers.get('content-type')) ?? format;
  } else if (c.env.VOICE_BUCKET) {
    const stored = await new R2VoiceStorage(c.env.VOICE_BUCKET).get(audioUrl);
    if (!stored) return null;
    bytes = stored.bytes;
    format = audioFormatFromMime(stored.meta.mimeType) ?? format;
  } else {
    return null;
  }

  return { bytes, format };
}

function audioFormatFromMime(mimeType: string | null | undefined): string | null {
  if (!mimeType) return null;
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp4') || mimeType.includes('aac')) return 'm4a';
  return null;
}

function audioFormatFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.wav')) return 'wav';
  if (lower.includes('.m4a') || lower.includes('.aac') || lower.includes('.mp4')) return 'm4a';
  return 'mp3';
}
