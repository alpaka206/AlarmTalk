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

const MAX_AUDIO_URL_LENGTH = 2048;

/**
 * R2 객체 키 네임스페이스. 보이스/녹음 원본은 voices/{userId}/...,
 * 생성 TTS 캐시는 generated-tts/{userId}/..., 알람 직접재생 클립은
 * raw-alarms/{userId}/... 형태로 저장된다(r2-storage.ts, audio-cache.ts,
 * alarm-source.ts 참고). 키의 둘째 path segment 가 소유자 id.
 * raw-alarms/ 는 alarm.raw_audio_url 소유권 게이트(alarm-mutation.ts)가
 * isR2KeyAuthorized({kind:'owner'}) 로 이 네임스페이스를 검증하는 데 쓴다.
 */
const R2_USER_PREFIXES = ['voices/', 'generated-tts/', 'raw-alarms/'] as const;

export type AudioAccess =
  /**
   * 신뢰된 호출자(예: tts.ts). audio_url 이 서버 측 DB(generated_audio_assets,
   * messages.audio_url)에서 온 것이라 이미 소유권 검증을 거쳤다. r2:// 키
   * 네임스페이스만 강제하고 별도 소유자 매칭은 하지 않는다.
   */
  | { kind: 'trusted' }
  /**
   * 클라이언트가 제공한 audio_url(예: alarm.raw_audio_url).
   * r2:// 키의 소유자 segment 가 ownerIds 중 하나와 일치해야 한다.
   */
  | { kind: 'owner'; ownerIds: string[] };

/**
 * 클라이언트가 제공할 수 있는 audio_url 의 형식만 1차 검증한다.
 * (스킴/길이) — 소유권/SSRF 검증은 loadAudioBytes 에서 수행한다.
 * https 등 임의 원격 호스트 프록시는 SSRF 위험이라 더 이상 허용하지 않는다.
 */
export function isStoredAudioUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_AUDIO_URL_LENGTH &&
    value.startsWith('r2://')
  );
}

function r2KeyOwner(objectKey: string): string | null {
  for (const prefix of R2_USER_PREFIXES) {
    if (objectKey.startsWith(prefix)) {
      const rest = objectKey.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash <= 0) return null;
      // 클라 제공 raw_audio_url 은 형식만 통과하면 여기 도달할 수 있다. 잘못된 퍼센트
      // 인코딩(예: '%')이면 decodeURIComponent 가 throw 하는데, 이를 500 이 아니라
      // '소유자 판별 불가(null)'로 처리해 호출자 소유권 게이트가 403/400 을 내게 한다.
      try {
        return decodeURIComponent(rest.slice(0, slash));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * r2:// 키가 access 정책에 따라 허용되는지 판정한다.
 * - trusted: 알려진 사용자 네임스페이스(voices/, generated-tts/) 키만 허용.
 * - owner: 위에 더해 키에 박힌 소유자 id 가 호출자(ownerIds)와 일치해야 함.
 *   → 타인 네임스페이스(r2://voices/{victim}/...) 추측을 통한 cross-tenant
 *     읽기(IDOR)를 차단한다.
 */
export function isR2KeyAuthorized(objectKey: string, access: AudioAccess): boolean {
  const owner = r2KeyOwner(objectKey);
  if (owner === null) return false;
  if (access.kind === 'owner') {
    return access.ownerIds.some((id) => id != null && id === owner);
  }
  return true;
}

export async function loadAudioBytes(
  c: Context<AppEnv>,
  audioUrl: string,
  access: AudioAccess = { kind: 'trusted' },
): Promise<{ bytes: Uint8Array; format: string } | null> {
  const fallbackFormat = audioFormatFromUrl(audioUrl);
  const voiceBucket = c.env?.VOICE_BUCKET;

  if (typeof audioUrl !== 'string' || audioUrl.length > MAX_AUDIO_URL_LENGTH) {
    return null;
  }

  // 임의 https:// (또는 그 외 원격) URL 프록시를 전면 차단한다. 정당한 오디오는
  // 항상 내부 R2(r2://) 에 저장되므로, 사용자 제공 호스트로의 아웃바운드 fetch
  // (SSRF)를 허용할 이유가 없다.
  let objectKey: string;
  if (audioUrl.startsWith('r2://')) {
    objectKey = audioUrl.slice('r2://'.length);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(audioUrl)) {
    // r2:// 가 아닌 스킴 부착 URL(https://, http://, file:// 등)은 거부.
    return null;
  } else {
    // 스킴 없는 값은 곧 R2 객체 키로 취급(레거시 저장 형식).
    objectKey = audioUrl;
  }

  if (!objectKey || !isR2KeyAuthorized(objectKey, access)) {
    return null;
  }
  if (!voiceBucket) return null;
  const stored = await new R2VoiceStorage(voiceBucket).get(objectKey);
  if (!stored) return null;

  return {
    bytes: stored.bytes,
    format: audioFormatFromMime(stored.meta.mimeType) ?? fallbackFormat,
  };
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
