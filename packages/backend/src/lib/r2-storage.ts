import type { VoiceStorage, StoreInput, StoredObject } from '@voice-alarm/voice';

export class R2VoiceStorage implements VoiceStorage {
  readonly name = 'r2';
  private bucket: R2Bucket;
  private counter = 0;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async store(input: StoreInput): Promise<StoredObject> {
    this.counter += 1;
    const objectKey = `voices/${input.userId}/${Date.now()}_${this.counter}`;
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
