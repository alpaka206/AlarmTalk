import { describe, it, expect, beforeEach } from 'vitest';
import { R2VoiceStorage } from '../src/lib/r2-storage';

interface MockR2Object {
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
  size: number;
  uploaded: Date;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function createMockR2Bucket() {
  const store = new Map<string, { body: ArrayBuffer; meta: Record<string, string>; contentType?: string }>();

  const bucket = {
    put: async (key: string, value: ArrayBufferLike, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => {
      store.set(key, {
        body: value instanceof ArrayBuffer ? value : new Uint8Array(value as Uint8Array).buffer,
        meta: options?.customMetadata ?? {},
        contentType: options?.httpMetadata?.contentType,
      });
    },
    get: async (key: string): Promise<MockR2Object | null> => {
      const item = store.get(key);
      if (!item) return null;
      return {
        customMetadata: item.meta,
        httpMetadata: item.contentType ? { contentType: item.contentType } : undefined,
        size: item.body.byteLength,
        uploaded: new Date('2026-04-24T00:00:00Z'),
        arrayBuffer: async () => item.body,
      };
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };

  return { bucket: bucket as unknown as R2Bucket, store };
}

describe('R2VoiceStorage', () => {
  let mockBucket: ReturnType<typeof createMockR2Bucket>;
  let storage: R2VoiceStorage;

  beforeEach(() => {
    mockBucket = createMockR2Bucket();
    storage = new R2VoiceStorage(mockBucket.bucket);
  });

  it('name = "r2"', () => {
    expect(storage.name).toBe('r2');
  });

  describe('store', () => {
    it('파일 저장 후 메타 반환', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const result = await storage.store({
        userId: 'user-1',
        bytes,
        mimeType: 'audio/mpeg',
        durationMs: 5000,
        originalName: 'hello.mp3',
      });

      expect(result.objectKey).toMatch(/^voices\/user-1\/\d+_\d+$/);
      expect(result.userId).toBe('user-1');
      expect(result.mimeType).toBe('audio/mpeg');
      expect(result.sizeBytes).toBe(4);
      expect(result.durationMs).toBe(5000);
      expect(result.originalName).toBe('hello.mp3');
      expect(result.createdAt).toBeTruthy();

      expect(mockBucket.store.size).toBe(1);
    });

    it('durationMs/originalName 없이도 저장 가능', async () => {
      const result = await storage.store({
        userId: 'user-2',
        bytes: new Uint8Array([10, 20]),
        mimeType: 'audio/wav',
      });

      expect(result.durationMs).toBeUndefined();
      expect(result.originalName).toBeUndefined();
      expect(result.sizeBytes).toBe(2);
    });

    it('다수 저장 시 objectKey 고유', async () => {
      const input = { userId: 'user-1', bytes: new Uint8Array([1]), mimeType: 'audio/mp3' };
      const r1 = await storage.store(input);
      const r2 = await storage.store(input);
      expect(r1.objectKey).not.toBe(r2.objectKey);
    });

    it('R2에 customMetadata 전달 확인', async () => {
      await storage.store({
        userId: 'user-1',
        bytes: new Uint8Array([1]),
        mimeType: 'audio/mpeg',
        durationMs: 3000,
        originalName: 'test.mp3',
      });

      const stored = [...mockBucket.store.values()][0];
      expect(stored.meta.userId).toBe('user-1');
      expect(stored.meta.mimeType).toBe('audio/mpeg');
      expect(stored.meta.durationMs).toBe('3000');
      expect(stored.meta.originalName).toBe('test.mp3');
      expect(stored.contentType).toBe('audio/mpeg');
    });
  });

  describe('get', () => {
    it('존재하는 파일 조회', async () => {
      const bytes = new Uint8Array([5, 6, 7]);
      const stored = await storage.store({
        userId: 'user-1',
        bytes,
        mimeType: 'audio/ogg',
        durationMs: 1234,
        originalName: 'voice.ogg',
      });

      const result = await storage.get(stored.objectKey);
      expect(result).not.toBeNull();
      expect(result!.meta.objectKey).toBe(stored.objectKey);
      expect(result!.meta.userId).toBe('user-1');
      expect(result!.meta.mimeType).toBe('audio/ogg');
      expect(result!.meta.sizeBytes).toBe(3);
      expect(result!.meta.durationMs).toBe(1234);
      expect(result!.meta.originalName).toBe('voice.ogg');
      expect(result!.bytes).toEqual(new Uint8Array([5, 6, 7]));
    });

    it('존재하지 않는 키 → null', async () => {
      const result = await storage.get('voices/nobody/000');
      expect(result).toBeNull();
    });

    it('durationMs 없는 파일 조회', async () => {
      const stored = await storage.store({
        userId: 'user-1',
        bytes: new Uint8Array([1]),
        mimeType: 'audio/wav',
      });
      const result = await storage.get(stored.objectKey);
      expect(result!.meta.durationMs).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('존재하는 파일 삭제 → true', async () => {
      const stored = await storage.store({
        userId: 'user-1',
        bytes: new Uint8Array([1, 2]),
        mimeType: 'audio/mpeg',
      });

      const result = await storage.delete(stored.objectKey);
      expect(result).toBe(true);

      const after = await storage.get(stored.objectKey);
      expect(after).toBeNull();
    });

    it('존재하지 않는 파일 삭제 → true (R2는 에러 없음)', async () => {
      const result = await storage.delete('voices/nobody/000');
      expect(result).toBe(true);
    });
  });
});
