import type { VoiceStorage, StoreInput, StoredObject } from '@alarmtalk/voice';

type StoreAtKeyInput = Omit<StoreInput, 'bytes'> & { bytes: Uint8Array<ArrayBufferLike> };

/**
 * 음성 업로드/클론 원본 최대 크기(25 MiB ≈ 2분 음성). voice-upload(/upload)·
 * voice-profile(/clone) 공용 — arrayBuffer→R2→ElevenLabs 전에 크기 가드로 쓴다.
 */
export const MAX_VOICE_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * 목소리 업로드 원본의 키 앞머리(`voices/<userId>/`) — `store` 가 만드는 키의 **단일 출처**.
 *
 * 업로드 행(`voice_uploads`)이 TTL 로 먼저 지워져도 그 키를 들고 있는 문구
 * (받은 사람 소유의 `family-voice`)를 '누구의 녹음인가' 로 되짚을 때 쓴다
 * (`lib/voice-revocation.ts` 의 `audioUrlPointsAtUploadsOf`).
 */
export function voiceUploadKeyPrefix(userId: string): string {
  return `voices/${userId}/`;
}

export class R2VoiceStorage implements VoiceStorage {
  readonly name = 'r2';
  private bucket: R2Bucket;
  private counter = 0;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async store(input: StoreInput): Promise<StoredObject> {
    this.counter += 1;
    const objectKey = `${voiceUploadKeyPrefix(input.userId)}${Date.now()}_${this.counter}`;
    return this.storeAtKey(objectKey, input);
  }

  async storeAtKey(objectKey: string, input: StoreAtKeyInput): Promise<StoredObject> {
    const meta: StoredObject = {
      objectKey,
      userId: input.userId,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      durationMs: input.durationMs,
      originalName: input.originalName,
      createdAt: new Date().toISOString(),
    };

    await this.bucket.put(objectKey, input.bytes, {
      httpMetadata: { contentType: input.mimeType },
      customMetadata: {
        userId: input.userId,
        mimeType: input.mimeType,
        sizeBytes: String(meta.sizeBytes),
        ...(input.durationMs != null ? { durationMs: String(input.durationMs) } : {}),
        ...(input.originalName != null ? { originalName: input.originalName } : {}),
        createdAt: meta.createdAt,
      },
    });

    return meta;
  }

  async get(objectKey: string): Promise<{ meta: StoredObject; bytes: Uint8Array } | null> {
    const obj = await this.bucket.get(objectKey);
    if (!obj) return null;

    const cm = obj.customMetadata ?? {};
    const meta: StoredObject = {
      objectKey,
      userId: cm.userId ?? '',
      mimeType: cm.mimeType ?? obj.httpMetadata?.contentType ?? 'application/octet-stream',
      sizeBytes: Number(cm.sizeBytes ?? obj.size),
      durationMs: cm.durationMs ? Number(cm.durationMs) : undefined,
      originalName: cm.originalName,
      createdAt: cm.createdAt ?? obj.uploaded.toISOString(),
    };

    const arrayBuf = await obj.arrayBuffer();
    return { meta, bytes: new Uint8Array(arrayBuf) };
  }

  async delete(objectKey: string): Promise<boolean> {
    await this.bucket.delete(objectKey);
    return true;
  }
}
